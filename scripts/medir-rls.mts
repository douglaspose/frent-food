/**
 * Mede o custo de ligar o RLS, comparando as duas formas possíveis.
 *
 * O RLS lê `app.tenant_id` da conexão, e o pool do Prisma não garante que a
 * mesma conexão atenda duas consultas seguidas. Só há duas saídas honestas:
 *
 *   A · uma transação por requisição — declara o tenant uma vez e roda tudo
 *       dentro dela. Custa o paralelismo: `Promise.all` vira fila, porque uma
 *       transação usa uma conexão só. E segura essa conexão do começo ao fim.
 *
 *   B · uma transação por consulta — cada consulta declara o próprio tenant.
 *       Preserva o paralelismo e devolve a conexão logo, mas dobra as idas ao
 *       banco: são dois comandos onde havia um.
 *
 * O molde é o painel da gestão, a tela mais pesada do sistema: seis consultas
 * que hoje saem juntas.
 *
 * Uso: npx tsx scripts/medir-rls.mts
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.error("Defina TEST_DATABASE_URL apontando para o Postgres local.");
  process.exit(1);
}

/**
 * A linha de base e as duas propostas usam conexões diferentes de propósito.
 *
 * `TEST_DATABASE_URL` é superusuário: atravessa qualquer política, então mede
 * o sistema como ele é hoje. `RLS_DATABASE_URL` é a role `app_gestao`, que
 * vive sob as políticas — é nela que A e B rodam, para que o custo medido
 * inclua o que o Postgres gasta avaliando a política linha a linha.
 *
 * Medir A e B pela conexão de superusuário daria números bonitos e falsos: as
 * políticas seriam ignoradas e sobraria só o custo da ida a mais ao banco.
 */
const urlRls = process.env.RLS_DATABASE_URL;
if (!urlRls) {
  console.error(
    "Defina RLS_DATABASE_URL (role app_gestao) — veja scripts/aplicar-rls.mts.\n" +
      "Sem ela, A e B rodariam como superusuário e as políticas nem seriam avaliadas."
  );
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url, max: 10 });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const poolRls = new pg.Pool({ connectionString: urlRls, max: 10 });
const prismaRls = new PrismaClient({ adapter: new PrismaPg(poolRls) });

type Cliente = Omit<PrismaClient, "$transaction" | "$connect" | "$disconnect" | "$on" | "$use" | "$extends">;

const RODADAS = 30;
const DESCARTE = 5; // as primeiras pagam o aquecimento do pool e do plano de consulta
const desde = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

/** As seis consultas do painel, como ele as faz hoje. */
const CONSULTAS: ((c: Cliente) => Promise<unknown>)[] = [
  (c) => c.pagamento.findMany({ take: 50, select: { valor: true, criadoEm: true } }),
  (c) => c.comanda.findMany({ take: 50, select: { pessoas: true } }),
  (c) => c.comandaItem.findMany({ take: 50, select: { precoTotal: true } }),
  (c) =>
    c.comandaItem.groupBy({
      by: ["produtoId"],
      _sum: { quantidade: true },
      orderBy: { produtoId: "asc" },
      take: 20,
    }),
  (c) => c.movimentoEstoque.findMany({ where: { criadoEm: { gte: desde } }, take: 50 }),
  (c) => c.comandaItem.findMany({ take: 50, select: { quantidade: true } }),
];

const mediana = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

async function cronometrar(rotulo: string, umaRequisicao: () => Promise<unknown>) {
  const tempos: number[] = [];
  for (let i = 0; i < RODADAS; i++) {
    const t0 = performance.now();
    await umaRequisicao();
    tempos.push(performance.now() - t0);
  }
  const uteis = tempos.slice(DESCARTE);
  const meio = mediana(uteis);
  console.log(
    `${rotulo.padEnd(34)} mediana ${meio.toFixed(1).padStart(6)}ms   ` +
      `pior ${Math.max(...uteis).toFixed(1).padStart(6)}ms`
  );
  return meio;
}

const tenant = (await prisma.tenant.findFirst({ select: { id: true } }))?.id;
if (!tenant) {
  console.error("Banco de teste vazio: rode `npm test` uma vez para criar o schema e os dados.");
  process.exit(1);
}

/**
 * Uma consulta que volta vazia é rápida. Sem esta conferência, um erro na
 * declaração do tenant produziria os melhores números do relatório e a
 * conclusão errada: "o RLS quase não custa" — porque não estava lendo nada.
 */
const prova = await prismaRls.$transaction(async (tx) => {
  await tx.$executeRaw`select set_config('app.tenant_id', ${tenant}, true)`;
  return tx.comandaItem.count();
});
if (prova === 0) {
  console.error("Sob RLS as consultas voltam vazias — não há o que medir. Confira app.tenant_id.");
  process.exit(1);
}

console.log(`\n${RODADAS} rodadas, descartando as ${DESCARTE} primeiras.`);
console.log(`Sob RLS a role app_gestao enxerga ${prova} itens de comanda.\n`);

const hoje = await cronometrar("hoje (sem RLS, em paralelo)", () =>
  Promise.all(CONSULTAS.map((f) => f(prisma)))
);

const porRequisicao = await cronometrar("A · transação por requisição", () =>
  prismaRls.$transaction(async (tx) => {
    await tx.$executeRaw`select set_config('app.tenant_id', ${tenant}, true)`;
    // Aqui o `Promise.all` não paraleliza de verdade: a transação tem uma conexão.
    return Promise.all(CONSULTAS.map((f) => f(tx)));
  })
);

const porConsulta = await cronometrar("B · transação por consulta", () =>
  Promise.all(
    CONSULTAS.map((f) =>
      prismaRls.$transaction(async (tx) => {
        await tx.$executeRaw`select set_config('app.tenant_id', ${tenant}, true)`;
        return f(tx);
      })
    )
  )
);

const perda = (x: number) =>
  `${(((x - hoje) / hoje) * 100).toFixed(0)}% mais lento que hoje (${hoje.toFixed(1)}ms → ${x.toFixed(1)}ms)`;

console.log(`\nA · ${perda(porRequisicao)}`);
console.log(`B · ${perda(porConsulta)}`);
console.log(
  "\nLembre: A também segura uma conexão por requisição inteira — com pool de 10,\n" +
    "dez requisições lentas ao mesmo tempo param a décima primeira.\n"
);

await prisma.$disconnect();
await prismaRls.$disconnect();
await pool.end();
await poolRls.end();
