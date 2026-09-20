import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { comIsolamentoDeTenant } from "@/lib/adaptador-rls";
import { atravessandoRestaurantes, comTenant, semContexto } from "@/lib/tenant-atual";
import { db } from "@/lib/db";
import { criarProduto, criarRestaurante, limpar } from "./fixtures";

/**
 * O isolamento pelo caminho que o sistema realmente usa.
 *
 * `tests/isolamento.test.ts` prova que as consultas filtram por restaurante.
 * `npm run rls:verificar` prova que o Postgres barra quem não filtra. Falta o
 * meio de campo, que é este arquivo: o cliente do Prisma, com o adapter de
 * verdade, conectado pela role que vive sob as políticas. É onde um erro de
 * encanamento aparece — e onde um apareceu: as sondas que escrevi para depurar
 * isto eram `.mts` importando `.ts`, dois sistemas de módulo, duas cópias do
 * `AsyncLocalStorage`. Davam "zero linhas" com o código certo.
 *
 * Roda só quando há um Postgres de verdade com a role `app_gestao`. O
 * `prisma dev` não serve: ele é superusuário e atravessa toda política.
 */

const urlDaRole = process.env.RLS_DATABASE_URL;
const urlDeAdmin = process.env.TEST_DATABASE_URL;
const temBancoDeVerdade = Boolean(urlDaRole && urlDeAdmin);

const A = "teste-rls-a";
const B = "teste-rls-b";

let lojaA: Awaited<ReturnType<typeof criarRestaurante>>;
let lojaB: Awaited<ReturnType<typeof criarRestaurante>>;
let sobRls: PrismaClient;
let pool: pg.Pool;
let admin: pg.Client;

beforeAll(async () => {
  if (!temBancoDeVerdade) return;

  lojaA = await criarRestaurante(A);
  lojaB = await criarRestaurante(B);
  await criarProduto(lojaA.tenant.id, "Espeto do A");
  await criarProduto(lojaB.tenant.id, "Espeto do B");

  /**
   * O `preparar-banco` derruba e recria o schema a cada execução, e leva as
   * políticas junto. Reaplicar aqui é o que torna este teste repetível — e de
   * quebra exercita o próprio `aplicar-rls`.
   */
  execFileSync("npx", ["tsx", "scripts/aplicar-rls.mts"], {
    env: {
      ...process.env,
      DATABASE_URL: urlDeAdmin,
      SENHA_APP_GESTAO: new URL(urlDaRole!).password,
    },
    stdio: "pipe",
    shell: process.platform === "win32",
  });

  pool = new pg.Pool({ connectionString: urlDaRole, max: 5 });
  sobRls = new PrismaClient({ adapter: comIsolamentoDeTenant(new PrismaPg(pool)) });

  admin = new pg.Client({ connectionString: urlDeAdmin });
  await admin.connect();
}, 120_000);

afterAll(async () => {
  if (!temBancoDeVerdade) return;

  await sobRls?.$disconnect();
  await pool?.end();
  await admin?.end();
  await limpar(A);
  await limpar(B);
  await db.$disconnect();
});

describe.skipIf(!temBancoDeVerdade)("isolamento pelo adapter, sob RLS", () => {
  it("com o restaurante declarado, enxerga o que é dele", async () => {
    const mesas = await comTenant(lojaA.tenant.id, () =>
      sobRls.produto.findMany({ where: { tenantId: lojaA.tenant.id } })
    );

    expect(mesas.map((p) => p.titulo)).toEqual(["Espeto do A"]);
  });

  it("declarado como A, pedir os dados de B devolve vazio", async () => {
    /**
     * O caso que importa: a consulta está *errada* — pede explicitamente o
     * tenant do vizinho, como faria um id adulterado numa URL. Sem RLS ela
     * entregaria o produto do B.
     */
    const roubo = await comTenant(lojaA.tenant.id, () =>
      sobRls.produto.findMany({ where: { tenantId: lojaB.tenant.id } })
    );

    expect(roubo).toEqual([]);
  });

  it("cada um enxerga o seu, no mesmo processo", async () => {
    const doA = await comTenant(lojaA.tenant.id, () =>
      sobRls.produto.findMany({ where: { tenantId: lojaA.tenant.id } })
    );
    const doB = await comTenant(lojaB.tenant.id, () =>
      sobRls.produto.findMany({ where: { tenantId: lojaB.tenant.id } })
    );

    expect([doA[0]?.titulo, doB[0]?.titulo]).toEqual(["Espeto do A", "Espeto do B"]);
  });

  it("consultas simultâneas de restaurantes diferentes não se misturam", async () => {
    /**
     * A prova de que a declaração acompanha a consulta e não a conexão. Com
     * `set_config` de sessão em vez de local, uma destas leria o tenant da
     * outra — e o pool entrega as conexões fora de ordem, então o erro
     * apareceria uma vez a cada tantas.
     */
    const [aa, bb] = await Promise.all([
      comTenant(lojaA.tenant.id, () =>
        sobRls.produto.findMany({ where: { tenantId: lojaA.tenant.id } })
      ),
      comTenant(lojaB.tenant.id, () =>
        sobRls.produto.findMany({ where: { tenantId: lojaB.tenant.id } })
      ),
    ]);

    expect([aa[0]?.titulo, bb[0]?.titulo]).toEqual(["Espeto do A", "Espeto do B"]);
  });

  it("sem restaurante declarado, volta vazio — fecha, não abre", async () => {
    const nada = await semContexto(
      async () => await sobRls.produto.findMany({ where: { tenantId: lojaA.tenant.id } })
    );

    expect(nada).toEqual([]);
  });

  it("travessia declarada não desliga o RLS, só a declaração", async () => {
    /**
     * `atravessandoRestaurantes` diz "esta consulta é de propósito", não
     * "esta consulta pode tudo". Quem atravessa de verdade é o cliente com
     * role própria, que é assunto do login.
     */
    const nada = await atravessandoRestaurantes("login", () =>
      sobRls.produto.findMany({ where: { tenantId: lojaA.tenant.id } })
    );

    expect(nada).toEqual([]);
  });

  it("gravar no nome de outro restaurante é recusado pelo banco", async () => {
    await expect(
      comTenant(lojaA.tenant.id, () =>
        sobRls.area.create({
          data: { tenantId: lojaB.tenant.id, unidadeId: lojaB.unidade.id, nome: "Invasão" },
        })
      )
    ).rejects.toThrow();

    // A conferência é feita pelo cliente sem RLS, para não confundir
    // "a política escondeu" com "não foi gravado".
    const criou = await db.area.findMany({
      where: { tenantId: lojaB.tenant.id, nome: "Invasão" },
    });
    expect(criou).toEqual([]);
  });

  it("dentro de uma transação do código, a declaração vale para tudo", async () => {
    const [produtos, unidades] = await comTenant(lojaA.tenant.id, () =>
      sobRls.$transaction(async (tx) => [
        await tx.produto.findMany({ where: { tenantId: lojaA.tenant.id } }),
        await tx.unidade.findMany({ where: { tenantId: lojaA.tenant.id } }),
      ])
    );

    expect(produtos).toHaveLength(1);
    expect(unidades).toHaveLength(1);
  });

  it("não deixa conexão presa em transação aberta", async () => {
    /**
     * O `commit()` do adapter só devolve a conexão ao pool; quem manda o
     * `COMMIT` é quem abriu a transação. Esquecer isso não daria erro nenhum —
     * as conexões voltariam ao pool com transação aberta, segurando lock e
     * snapshot até a aplicação ser reiniciada.
     */
    for (let i = 0; i < 20; i++) {
      await comTenant(lojaA.tenant.id, () =>
        sobRls.produto.findMany({ where: { tenantId: lojaA.tenant.id } })
      );
    }

    const { rows } = await admin.query<{ n: string }>(
      `select count(*) n from pg_stat_activity
        where datname = current_database()
          and usename = 'app_gestao'
          and state = 'idle in transaction'`
    );

    expect(Number(rows[0]!.n)).toBe(0);
  });
});
