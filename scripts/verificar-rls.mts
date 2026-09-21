/**
 * Prova que o RLS está protegendo — ou falha dizendo por quê.
 *
 * Existe porque "o script aplicou sem erro" não significa nada aqui. Num banco
 * onde a conexão é superusuário, todo o `prisma/rls.sql` é aceito, nenhuma
 * política é aplicada, e o sistema parece protegido. Foi exatamente o que
 * aconteceu no banco de desenvolvimento do `prisma dev`.
 *
 * Rode contra o banco de verdade, com a URL da role da aplicação:
 *
 *   DATABASE_URL="postgres://app_gestao:senha@host:5432/gestao_restaurante" \
 *     npm run rls:verificar
 *
 * Sai com código 1 em qualquer falha: serve para portão de deploy.
 */
import "dotenv/config";
import pg from "pg";

const TABELAS_DE_PROVA = [
  "mesas",
  "comandas",
  "produtos",
  "cardapio_itens",
  "tenants",
  // A logomarca é servida por uma rota pública, pela role que ignora o RLS.
  // Justamente por isso a tabela precisa ser conferida aqui: é a única em que
  // a travessia é rotina, e a política é o que garante que ela seja a exceção.
  "logomarcas",
];

let falhas = 0;

function ok(mensagem: string) {
  console.log(`  ok    ${mensagem}`);
}

function falhou(mensagem: string, detalhe?: string) {
  falhas++;
  console.log(`  FALHA ${mensagem}${detalhe ? `\n        ${detalhe}` : ""}`);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Defina DATABASE_URL apontando para o banco a verificar.");
  process.exit(1);
}

const db = new pg.Client({ connectionString: url, connectionTimeoutMillis: 10_000 });
await db.connect();

console.log("\n1. Quem está conectado\n");

const identidade = (
  await db.query<{ usuario: string; superusuario: boolean; ignora_rls: boolean }>(
    `select current_user as usuario,
            rolsuper as superusuario,
            rolbypassrls as ignora_rls
       from pg_roles where rolname = current_user`
  )
).rows[0]!;

console.log(`  conectado como: ${identidade.usuario}`);

/**
 * A verificação mais importante do arquivo.
 *
 * Superusuário e role com BYPASSRLS atravessam qualquer política. Se a
 * aplicação conecta assim, todo o resto deste script daria verde num banco
 * completamente aberto.
 */
if (identidade.superusuario) {
  falhou(
    "a conexão é SUPERUSUÁRIO — RLS não vale para ela",
    "Crie a role app_gestao (ver prisma/rls.sql) e aponte a DATABASE_URL da aplicação para ela."
  );
} else {
  ok("não é superusuário");
}

if (identidade.ignora_rls) {
  falhou("a role tem BYPASSRLS — atravessa toda política", "Use NOBYPASSRLS na role da aplicação.");
} else {
  ok("não tem BYPASSRLS");
}

console.log("\n2. Políticas no lugar\n");

for (const tabela of TABELAS_DE_PROVA) {
  const estado = (
    await db.query<{ ligado: boolean; forcado: boolean; politicas: number }>(
      `select c.relrowsecurity as ligado,
              c.relforcerowsecurity as forcado,
              (select count(*)::int from pg_policies p
                where p.tablename = $1 and p.policyname = 'isolamento_tenant') as politicas
         from pg_class c where c.relname = $1`,
      [tabela]
    )
  ).rows[0];

  if (!estado) {
    falhou(`tabela ${tabela} não existe`);
  } else if (!estado.ligado) {
    falhou(`${tabela}: RLS desligado`, "Rode prisma/rls.sql.");
  } else if (!estado.forcado) {
    falhou(`${tabela}: sem FORCE`, "Sem FORCE, o dono da tabela ignora a política.");
  } else if (estado.politicas === 0) {
    falhou(`${tabela}: sem a política isolamento_tenant`);
  } else {
    ok(`${tabela}: RLS ligado, forçado e com política`);
  }
}

console.log("\n3. A proteção funciona de verdade\n");

/**
 * Aqui é onde a prova acontece: não se pergunta ao catálogo se a política
 * existe, pergunta-se ao banco o que ele devolve.
 */
/**
 * O id do restaurante de prova vem de fora, e não de um `select` em `tenants`.
 *
 * A primeira versão lia a lista aqui mesmo e falhava dizendo "não há tenants
 * no banco" — no banco cheio. A política de `tenants` estava fazendo o
 * trabalho dela: sem tenant declarado, a lista volta vazia. O verificador não
 * consegue se guiar por uma consulta que a própria proteção precisa cegar.
 */
const idDeProva =
  process.env.TENANT_DE_PROVA ??
  (await db.query<{ id: string }>(`select "tenantId" id from unidades limit 1`)).rows[0]?.id;

if (!idDeProva) {
  falhou(
    "não consegui um id de restaurante para testar",
    "Passe TENANT_DE_PROVA=<id> — a política esconde a lista de tenants, que é o esperado."
  );
} else {
  const a = idDeProva;

  // 3.1 — sem tenant declarado, nada deve aparecer.
  const semTenant = (await db.query<{ n: number }>(`select count(*)::int n from mesas`)).rows[0]!.n;
  if (semTenant > 0) {
    falhou(
      `sem tenant declarado, a consulta devolveu ${semTenant} mesas`,
      "A política não está sendo aplicada. Confira o item 1."
    );
  } else {
    ok("sem tenant declarado: consulta volta vazia");
  }

  // 3.2 — com o tenant declarado, só o que é dele.
  await db.query("begin");
  await db.query(`select set_config('app.tenant_id', $1, true)`, [a]);
  const doA = (
    await db.query<{ total: number; alheias: number }>(
      `select count(*)::int total,
              count(*) filter (where "tenantId" <> $1)::int alheias
         from mesas`,
      [a]
    )
  ).rows[0]!;
  await db.query("commit");

  if (doA.alheias > 0) {
    falhou(`vazou: ${doA.alheias} mesa(s) de outro restaurante apareceram`);
  } else if (doA.total === 0) {
    falhou(
      "com o tenant declarado a consulta continua vazia",
      "Ou o restaurante não tem mesas, ou a variável app.tenant_id não está chegando."
    );
  } else {
    ok(`com o tenant declarado: ${doA.total} mesa(s), nenhuma de outro restaurante`);
  }

  // 3.3 — tenant inexistente não enxerga nada.
  await db.query("begin");
  await db.query(`select set_config('app.tenant_id', 'restaurante-que-nao-existe', true)`);
  const fantasma = (await db.query<{ n: number }>(`select count(*)::int n from mesas`)).rows[0]!.n;
  await db.query("commit");

  if (fantasma > 0) falhou(`tenant inexistente enxergou ${fantasma} mesa(s)`);
  else ok("tenant inexistente: consulta volta vazia");

  // 3.4 — a tabela-filha também está coberta.
  await db.query("begin");
  await db.query(`select set_config('app.tenant_id', 'restaurante-que-nao-existe', true)`);
  const filha = (await db.query<{ n: number }>(`select count(*)::int n from cardapio_itens`)).rows[0]!.n;
  await db.query("commit");

  if (filha > 0) {
    falhou(
      `cardapio_itens entregou ${filha} linha(s) para um tenant inexistente`,
      "É a tabela que carrega cardápio e preço — sem política, vaza para todo mundo."
    );
  } else {
    ok("tabela-filha (cardapio_itens): coberta pela política do pai");
  }

  /**
   * 3.5 — gravar no nome de outro restaurante é recusado (WITH CHECK).
   *
   * A recusa só conta se vier da política. Uma primeira versão deste teste
   * dava verde porque o INSERT falhava por outro motivo — um check que passa
   * pela razão errada é pior que nenhum, porque ninguém volta a olhar.
   */
  await db.query("begin");
  try {
    await db.query(`select set_config('app.tenant_id', $1, true)`, [a]);
    await db.query(`insert into mesas (id, "tenantId", "unidadeId", numero, capacidade, status, ativo)
                    select 'sonda-rls', 'tenant-de-outro', m."unidadeId", 'SONDA', 2, 'LIVRE', true
                      from mesas m limit 1`);
    await db.query("rollback");
    falhou(
      "consegui gravar uma linha no nome de outro restaurante",
      "O WITH CHECK não está valendo."
    );
  } catch (e) {
    await db.query("rollback");
    // 42501 = insufficient_privilege, que é como o Postgres recusa por política.
    const codigo = (e as { code?: string }).code;
    if (codigo === "42501") {
      ok("gravar no nome de outro restaurante: recusado pela política");
    } else {
      falhou(
        "o INSERT falhou, mas não foi a política que recusou",
        `Código ${codigo ?? "?"}: ${(e as Error).message.slice(0, 100)}`
      );
    }
  }
}

await db.end();

console.log("");
if (falhas > 0) {
  console.error(`RLS NÃO está protegendo: ${falhas} falha(s) acima.\n`);
  process.exit(1);
}
console.log("RLS verificado: o banco está isolando os restaurantes.\n");
