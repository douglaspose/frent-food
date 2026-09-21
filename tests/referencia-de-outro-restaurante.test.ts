import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import type { Sessao } from "@/lib/session";
import { criarRestaurante, limpar } from "./fixtures";

/**
 * O navegador manda ids, e um id pode ser de outro restaurante.
 *
 * O `tenantId` nunca vem do navegador — ele sai do token assinado. Mas o
 * cargo que se escolhe numa tela, a unidade onde se abre um caixa, esses vêm.
 * Server action é endpoint público: qualquer um chama com o argumento que
 * quiser, sem passar pela tela.
 *
 * Aqui as actions rodam de verdade contra o banco. Só a sessão é simulada — ela
 * lê cookie, e não há requisição num teste. O resto é o código que roda em
 * produção, com o id adulterado que um atacante mandaria.
 */

const estado = vi.hoisted(() => ({ sessao: null as Sessao | null }));

vi.mock("@/lib/session", () => ({
  exigirSessao: async () => estado.sessao,
  exigirPermissao: async () => estado.sessao,
  temPermissao: () => true,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined }),
}));
// O aviso de tempo real não é o assunto aqui, e abriria um LISTEN no banco.
vi.mock("@/lib/eventos", () => ({ publicar: async () => {} }));

const { criarUsuario, atualizarUsuario } = await import("@/app/gestao/equipe/actions");
const { abrirCaixa } = await import("@/app/pdv/pagamento-actions");

const A = "teste-ref-a";
const B = "teste-ref-b";

let lojaA: Awaited<ReturnType<typeof criarRestaurante>>;
let lojaB: Awaited<ReturnType<typeof criarRestaurante>>;

function sessaoDe(loja: typeof lojaA, unidadeId = loja.unidade.id): Sessao {
  return {
    usuarioId: loja.usuario.id,
    tenantId: loja.tenant.id,
    unidadeId,
    nome: loja.usuario.nome,
    cargo: "GERENTE",
    permissoes: ["*"],
  };
}

beforeAll(async () => {
  lojaA = await criarRestaurante(A);
  lojaB = await criarRestaurante(B);
});

afterAll(async () => {
  await limpar(A);
  await limpar(B);
  await db.$disconnect();
});

beforeEach(() => {
  estado.sessao = sessaoDe(lojaA);
});

describe("cargo de outro restaurante", () => {
  /**
   * O cargo do restaurante B tem permissão "*". Pendurado num funcionário do A,
   * daria acesso total no A a quem só podia gerenciar a equipe.
   *
   * O RLS não pega isso: a checagem de chave estrangeira no Postgres ignora as
   * políticas por definição. Quem barra é o código, e é o que se prova aqui.
   */
  it("não entra no cadastro de um funcionário novo", async () => {
    const r = await criarUsuario({
      nome: "Infiltrado",
      email: "infiltrado@teste-ref-a.com",
      cargoId: lojaB.cargo.id,
      pin: "",
      senha: "senha-qualquer",
    });

    expect(r).toEqual({ erro: "Cargo não encontrado." });

    // E nada foi gravado — nem o usuário, nem o vínculo com o cargo alheio.
    const criado = await db.usuario.findFirst({
      where: { tenantId: lojaA.tenant.id, email: "infiltrado@teste-ref-a.com" },
    });
    expect(criado).toBeNull();
    const vinculos = await db.usuarioUnidade.count({ where: { cargoId: lojaB.cargo.id } });
    expect(vinculos).toBe(1); // só o do próprio B, que a fixture criou
  });

  it("não entra na edição de um funcionário que já existe", async () => {
    const r = await atualizarUsuario(lojaA.usuario.id, {
      nome: lojaA.usuario.nome,
      email: lojaA.usuario.email,
      cargoId: lojaB.cargo.id,
      pin: "",
      senha: "",
    });

    expect(r).toEqual({ erro: "Cargo não encontrado." });

    const vinculo = await db.usuarioUnidade.findFirstOrThrow({
      where: { usuarioId: lojaA.usuario.id },
    });
    expect(vinculo.cargoId).toBe(lojaA.cargo.id);
  });

  it("o cargo do próprio restaurante continua valendo", async () => {
    const r = await criarUsuario({
      nome: "Contratado",
      email: "contratado@teste-ref-a.com",
      cargoId: lojaA.cargo.id,
      pin: "",
      senha: "senha-qualquer",
    });

    expect(r).toBeUndefined();
    const criado = await db.usuario.findFirstOrThrow({
      where: { tenantId: lojaA.tenant.id, email: "contratado@teste-ref-a.com" },
      include: { unidades: true },
    });
    expect(criado.tenantId).toBe(lojaA.tenant.id);
    expect(criado.unidades[0]!.cargoId).toBe(lojaA.cargo.id);
  });
});

describe("abertura de caixa", () => {
  it("abre na unidade da sessão", async () => {
    const r = await abrirCaixa("NOITE", 200);
    if (!r || "erro" in r) throw new Error(`esperava caixa, veio ${JSON.stringify(r)}`);

    const caixa = await db.caixa.findUniqueOrThrow({ where: { id: r.caixaId } });
    expect(caixa.unidadeId).toBe(lojaA.unidade.id);
    expect(caixa.tenantId).toBe(lojaA.tenant.id);
  });

  /**
   * O ataque que existia: a unidade de **outra filial do mesmo restaurante**.
   *
   * Unidade de outro restaurante o código antigo já barrava, conferindo o
   * tenant. A filial passava: mesmo restaurante, conferência satisfeita, e o
   * caixa da matriz abria o caixa da filial.
   *
   * Antes a unidade era o primeiro argumento. Um cliente adulterado — ou
   * antigo — que ainda a mande na frente não escolhe mais onde o caixa abre:
   * o id cai no lugar do turno e a action recusa.
   */
  it("não abre o caixa de outra filial do mesmo restaurante", async () => {
    const filial = await db.unidade.create({
      data: { tenantId: lojaA.tenant.id, codigo: "002", nome: "Filial", taxaServicoPct: 10 },
    });

    // Sem caixa aberto na unidade da sessão. Com um aberto, a action devolve o
    // existente antes de olhar os argumentos, e o teste passaria pelo motivo
    // errado.
    await db.caixa.deleteMany({ where: { unidadeId: lojaA.unidade.id } });

    const abrirComUnidade = abrirCaixa as unknown as (
      unidadeId: string,
      turno: string,
      fundo: number
    ) => Promise<unknown>;

    await expect(abrirComUnidade(filial.id, "NOITE", 200)).rejects.toThrow();

    const naFilial = await db.caixa.count({ where: { unidadeId: filial.id } });
    expect(naFilial).toBe(0);
  });
});
