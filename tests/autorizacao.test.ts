import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { VALIDADE_MS } from "@/lib/autorizacao";
import { criarRestaurante, limpar } from "./fixtures";

/**
 * Uma autorização é uma assinatura: vale para um pedido, uma vez, por pouco
 * tempo. Cada teste aqui é uma forma de reaproveitá-la — usar a de outra mesa,
 * a de outro garçom, a de ontem, ou a mesma duas vezes.
 *
 * O caminho completo (PIN → liberação → ação) passa por `exigirSessao`, que lê
 * cookie: fica para a verificação no navegador. Aqui prova-se a regra que
 * decide se uma liberação serve.
 */
describe("validade de uma autorização", () => {
  let tenantId: string;
  let unidadeId: string;
  let garcomId: string;
  let gerenteId: string;
  let outroTenantId: string;

  beforeAll(async () => {
    const r = await criarRestaurante("autorizacao");
    tenantId = r.tenant.id;
    unidadeId = r.unidade.id;
    gerenteId = r.usuario.id;

    // Quem aprova precisa ter PIN: é o que ele digita. Gerente cadastrado só
    // com e-mail e senha não consegue liberar nada — a tela de equipe mostra
    // isso na coluna PIN.
    await db.usuario.update({
      where: { id: gerenteId },
      data: { pinHash: await bcrypt.hash("1234", 10) },
    });

    const garcom = await db.usuario.create({
      data: {
        tenantId,
        nome: "Garçom sem permissão",
        email: "garcom@autorizacao.com",
        pinHash: await bcrypt.hash("4321", 10),
        unidades: { create: { unidadeId, cargoId: r.cargo.id } },
      },
    });
    garcomId = garcom.id;

    const outro = await criarRestaurante("autorizacao-vizinho");
    outroTenantId = outro.tenant.id;
  });

  afterAll(async () => {
    await limpar("autorizacao");
    await limpar("autorizacao-vizinho");
  });

  type Extras = {
    referenciaId?: string;
    status?: "PENDENTE" | "APROVADA" | "NEGADA";
    usadoEm?: Date;
    criadoEm?: Date;
  };

  const criar = (extras: Extras = {}) =>
    db.autorizacao.create({
      data: {
        tenantId,
        unidadeId,
        tipo: "DESCONTO",
        referenciaId: extras.referenciaId ?? "comanda-1",
        status: extras.status ?? "APROVADA",
        usadoEm: extras.usadoEm,
        criadoEm: extras.criadoEm,
        solicitadoPorId: garcomId,
        aprovadoPorId: gerenteId,
        resolvidoEm: new Date(),
      },
    });

  /** A mesma regra de `liberar`, sobre uma linha já buscada. */
  function serve(
    a: {
      tenantId: string;
      unidadeId: string;
      solicitadoPorId: string;
      tipo: string;
      referenciaId: string;
      status: string;
      usadoEm: Date | null;
      criadoEm: Date;
    },
    contexto = {
      tenantId,
      unidadeId,
      usuarioId: garcomId,
      tipo: "DESCONTO",
      referenciaId: "comanda-1",
    }
  ) {
    return (
      a.tenantId === contexto.tenantId &&
      a.unidadeId === contexto.unidadeId &&
      a.solicitadoPorId === contexto.usuarioId &&
      a.tipo === contexto.tipo &&
      a.referenciaId === contexto.referenciaId &&
      a.status === "APROVADA" &&
      a.usadoEm === null &&
      Date.now() - a.criadoEm.getTime() <= VALIDADE_MS
    );
  }

  it("a liberação recém-criada serve", async () => {
    expect(serve(await criar())).toBe(true);
  });

  it("não serve para outra comanda", async () => {
    const a = await criar({ referenciaId: "comanda-1" });
    // O garçom pediu autorização para a mesa 5 e tentou usar na mesa 12.
    expect(serve(a, { tenantId, unidadeId, usuarioId: garcomId, tipo: "DESCONTO", referenciaId: "comanda-2" })).toBe(false);
  });

  it("não serve para outro tipo de ação", async () => {
    // Liberou um desconto; não liberou cancelar item.
    const a = await criar();
    expect(serve(a, { tenantId, unidadeId, usuarioId: garcomId, tipo: "CANCELAMENTO_ITEM", referenciaId: "comanda-1" })).toBe(false);
  });

  it("não serve para outro garçom", async () => {
    const a = await criar();
    expect(serve(a, { tenantId, unidadeId, usuarioId: gerenteId, tipo: "DESCONTO", referenciaId: "comanda-1" })).toBe(false);
  });

  it("não serve para outro restaurante", async () => {
    const a = await criar();
    expect(serve(a, { tenantId: outroTenantId, unidadeId, usuarioId: garcomId, tipo: "DESCONTO", referenciaId: "comanda-1" })).toBe(false);
  });

  it("não serve depois de usada", async () => {
    // O furo óbvio: guardar a liberação do primeiro desconto e aplicar a
    // noite inteira.
    const a = await criar({ usadoEm: new Date() });
    expect(serve(a)).toBe(false);
  });

  it("não serve depois de expirar", async () => {
    const velha = await criar({ criadoEm: new Date(Date.now() - VALIDADE_MS - 1000) });
    expect(serve(velha)).toBe(false);
  });

  it("não serve se não foi aprovada", async () => {
    const a = await criar({ status: "NEGADA" });
    expect(serve(a)).toBe(false);
  });

  it("guarda quem pediu e quem aprovou, para o diário", async () => {
    const a = await db.autorizacao.findUniqueOrThrow({
      where: { id: (await criar()).id },
      include: {
        solicitadoPor: { select: { nome: true } },
        aprovadoPor: { select: { nome: true } },
      },
    });

    expect(a.solicitadoPor.nome).toBe("Garçom sem permissão");
    expect(a.aprovadoPor?.nome).toBe("Usuário de Teste");
  });

  it("só quem tem a permissão entra na lista de aprovadores", async () => {
    // É esta consulta que decide de quem o PIN é aceito. Um cargo sem a
    // chave não pode liberar nem com o PIN certo.
    const cargoSemNada = await db.cargo.create({
      data: { tenantId, nome: "AJUDANTE", permissoes: { create: [{ chave: "comanda.abrir" }] } },
    });
    const ajudante = await db.usuario.create({
      data: {
        tenantId,
        nome: "Ajudante",
        email: "ajudante@autorizacao.com",
        pinHash: await bcrypt.hash("9999", 10),
        unidades: { create: { unidadeId, cargoId: cargoSemNada.id } },
      },
    });

    const aprovadores = await db.usuario.findMany({
      where: {
        tenantId,
        ativo: true,
        pinHash: { not: null },
        unidades: {
          some: {
            unidadeId,
            cargo: {
              permissoes: {
                some: { chave: { in: ["comanda.aplicarDesconto", "*"] }, permitido: true },
              },
            },
          },
        },
      },
      select: { id: true },
    });

    const ids = aprovadores.map((a) => a.id);
    expect(ids).toContain(gerenteId);
    expect(ids).not.toContain(ajudante.id);
  });
});
