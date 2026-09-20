import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Os caminhos que entram sem sessão, sob RLS, pelos clientes de verdade.
 *
 * `isolamento-rls.test.ts` prova o adapter. Este prova a fiação: que o
 * `db.ts` monta os dois clientes certos, que o login consegue descobrir o
 * restaurante antes de conhecê-lo, e que depois disso tudo volta a rodar
 * fechado. Um esquecimento aqui não daria erro — daria tela vazia para quem
 * digitou a senha certa.
 *
 * O `vi.stubEnv` antes do `import()` é o que permite carregar o `db.ts` real
 * apontando para a role `app_gestao`: os clientes são criados na importação do
 * módulo, então trocar depois não teria efeito.
 */

const urlDaRole = process.env.RLS_DATABASE_URL;
const urlDeAdmin = process.env.TEST_DATABASE_URL;
const temBancoDeVerdade = Boolean(urlDaRole && urlDeAdmin);

const SLUG = "teste-login-rls";
const TOKEN = "token-de-impressao-do-teste";

let admin: PrismaClient;
let db: typeof import("@/lib/db")["db"];
let dbSemRls: typeof import("@/lib/db")["dbSemRls"];
let declararTenant: typeof import("@/lib/tenant-atual")["declararTenant"];
let semContexto: typeof import("@/lib/tenant-atual")["semContexto"];
let atravessandoRestaurantes: typeof import("@/lib/tenant-atual")["atravessandoRestaurantes"];

let tenantId = "";
let unidadeId = "";

beforeAll(async () => {
  if (!temBancoDeVerdade) return;

  admin = new PrismaClient({ adapter: new PrismaPg({ connectionString: urlDeAdmin }) });

  await admin.tenant.deleteMany({ where: { slug: SLUG } });
  const tenant = await admin.tenant.create({ data: { slug: SLUG, nome: "Login sob RLS" } });
  tenantId = tenant.id;

  const unidade = await admin.unidade.create({
    data: { tenantId, codigo: "001", nome: "Matriz", tokenImpressao: TOKEN },
  });
  unidadeId = unidade.id;

  const cargo = await admin.cargo.create({
    data: { tenantId, nome: "GERENTE", permissoes: { create: [{ chave: "*" }] } },
  });

  await admin.usuario.create({
    data: {
      tenantId,
      nome: "Dona do Bar",
      email: `dona@${SLUG}.com`,
      unidades: { create: { unidadeId, cargoId: cargo.id } },
    },
  });

  execFileSync("npx", ["tsx", "scripts/aplicar-rls.mts"], {
    env: { ...process.env, DATABASE_URL: urlDeAdmin, SENHA_APP_GESTAO: new URL(urlDaRole!).password },
    stdio: "pipe",
    shell: process.platform === "win32",
  });

  vi.stubEnv("DATABASE_URL", urlDaRole!);
  vi.stubEnv("DATABASE_URL_SEM_RLS", urlDeAdmin!);

  ({ db, dbSemRls } = await import("@/lib/db"));
  ({ declararTenant, semContexto, atravessandoRestaurantes } = await import("@/lib/tenant-atual"));
}, 120_000);

afterAll(async () => {
  if (!temBancoDeVerdade) return;

  await db?.$disconnect();
  await dbSemRls?.$disconnect();
  await admin.tenant.deleteMany({ where: { slug: SLUG } });
  await admin.$disconnect();
  vi.unstubAllEnvs();
});

describe.skipIf(!temBancoDeVerdade)("entrar no sistema com o RLS ligado", () => {
  it("o cliente normal não acha o restaurante antes de alguém declará-lo", async () => {
    /**
     * O impasse que justifica o segundo cliente: para declarar o restaurante é
     * preciso descobri-lo, e para descobri-lo seria preciso declará-lo. Sem
     * saída, a tela de login ficaria inacessível para todo mundo.
     */
    const achou = await semContexto(
      async () => await db.tenant.findFirst({ where: { slug: SLUG } })
    );

    expect(achou).toBeNull();
  });

  it("o cliente que atravessa acha, e é só isso que ele faz no login", async () => {
    const achou = await atravessandoRestaurantes("login", () =>
      dbSemRls.tenant.findFirst({ where: { slug: SLUG, ativo: true } })
    );

    expect(achou?.id).toBe(tenantId);
  });

  it("declarado o restaurante, a busca do usuário roda fechada e acha", async () => {
    /**
     * `declararTenant` é chamado aqui no corpo do teste, e não dentro de um
     * escopo, porque é assim que o login o chama: `enterWith` vale do ponto em
     * que foi chamado até o fim daquele contexto assíncrono. Os testes daqui
     * para baixo declaram o que precisam, então o que sobra não atrapalha.
     */
    declararTenant(tenantId);

    const usuario = await db.usuario.findFirst({ where: { tenantId, ativo: true } });

    expect(usuario?.nome).toBe("Dona do Bar");
  });

  it("declarado o restaurante, o usuário do vizinho continua invisível", async () => {
    const outro = await admin.tenant.create({
      data: { slug: `${SLUG}-vizinho`, nome: "Vizinho" },
    });
    await admin.usuario.create({
      data: { tenantId: outro.id, nome: "Do vizinho", email: `x@${SLUG}.com` },
    });

    declararTenant(tenantId);

    const doVizinho = await db.usuario.findMany({ where: { tenantId: outro.id } });
    // Sem esta segunda leitura, a lista vazia acima passaria mesmo se o RLS
    // estivesse cego e escondendo tudo de todos.
    const osMeus = await db.usuario.findMany({ where: { tenantId } });

    await admin.tenant.delete({ where: { id: outro.id } });

    expect(doVizinho).toEqual([]);
    expect(osMeus).toHaveLength(1);
  });

  it("o agente de impressão se identifica pelo token e fica preso ao seu restaurante", async () => {
    const unidade = await atravessandoRestaurantes("agente de impressão", () =>
      dbSemRls.unidade.findUnique({
        where: { tokenImpressao: TOKEN },
        select: { id: true, tenantId: true, ativo: true },
      })
    );

    expect(unidade?.tenantId).toBe(tenantId);

    declararTenant(unidade!.tenantId);

    const fila = await db.filaImpressao.findMany({ where: { unidadeId } });
    // A unidade é visível porque é dele: prova que a declaração pegou.
    const minhaUnidade = await db.unidade.findMany({ where: { tenantId } });

    expect(fila).toEqual([]);
    expect(minhaUnidade).toHaveLength(1);
  });

  it("o cliente que atravessa tem pool pequeno — é exceção, não caminho", async () => {
    /**
     * Se ele começar a precisar de muitas conexões, alguém o transformou em
     * atalho. Trinta chamadas ao mesmo tempo com pool de 3 devem passar (em
     * fila), e é isso que se quer: que o estreito incomode antes de virar
     * hábito.
     */
    const todas = await Promise.all(
      Array.from({ length: 30 }, () =>
        atravessandoRestaurantes("teste", () =>
          dbSemRls.tenant.findFirst({ where: { slug: SLUG } })
        )
      )
    );

    expect(todas.every((t) => t?.id === tenantId)).toBe(true);
  });
});
