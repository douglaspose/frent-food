import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { criarRestaurante } from "./fixtures";

/**
 * O diário só vale se for confiável. Estes testes cobrem as duas formas de ele
 * mentir: registrar uma mudança que não aconteceu, e deixar acontecer uma
 * mudança sem registrar.
 */
describe("diário de auditoria", () => {
  let tenantId: string;
  let unidadeId: string;
  let usuarioId: string;
  let comandaId: string;

  beforeAll(async () => {
    const r = await criarRestaurante("auditoria");
    tenantId = r.tenant.id;
    unidadeId = r.unidade.id;
    usuarioId = r.usuario.id;

    const comanda = await db.comanda.create({
      data: {
        tenantId,
        unidadeId,
        numero: 1,
        abertaPorId: usuarioId,
        descontoValor: 0,
      },
    });
    comandaId = comanda.id;
  });

  afterAll(async () => {
    await db.tenant.deleteMany({ where: { slug: "auditoria" } });
  });

  const linha = (acao: string, dados: object) => ({
    tenantId,
    unidadeId,
    usuarioId,
    entidade: "Comanda",
    entidadeId: comandaId,
    acao,
    ...dados,
  });

  it("grava a alteração e o registro na mesma transação", async () => {
    await db.$transaction([
      db.comanda.update({ where: { id: comandaId }, data: { descontoValor: 25 } }),
      db.auditLog.create({
        data: linha("DESCONTO", { antes: { valor: 0 }, depois: { valor: 25 } }),
      }),
    ]);

    const comanda = await db.comanda.findUniqueOrThrow({ where: { id: comandaId } });
    const registros = await db.auditLog.findMany({ where: { tenantId, acao: "DESCONTO" } });

    expect(Number(comanda.descontoValor)).toBe(25);
    expect(registros).toHaveLength(1);
  });

  it("não deixa registro quando a alteração falha", async () => {
    // O update aponta para uma comanda inexistente: a transação inteira cai.
    await expect(
      db.$transaction([
        db.comanda.update({ where: { id: "comanda-que-nao-existe" }, data: { descontoValor: 99 } }),
        db.auditLog.create({ data: linha("DESCONTO", { depois: { valor: 99 } }) }),
      ])
    ).rejects.toThrow();

    const registros = await db.auditLog.findMany({ where: { tenantId, acao: "DESCONTO" } });
    // Continua só o da primeira asserção: o desconto de 99 não existiu e não
    // deixou linha. Sem isso, o diário acusaria alguém por algo que não houve.
    expect(registros).toHaveLength(1);
  });

  it("guarda o histórico, não só o estado atual", async () => {
    await db.$transaction([
      db.comanda.update({ where: { id: comandaId }, data: { descontoValor: 40 } }),
      db.auditLog.create({
        data: linha("DESCONTO", { antes: { valor: 25 }, depois: { valor: 40 } }),
      }),
    ]);

    const registros = await db.auditLog.findMany({
      where: { tenantId, acao: "DESCONTO" },
      orderBy: { criadoEm: "asc" },
    });

    // Dois descontos, duas linhas. A comanda só sabe dizer 40.
    expect(registros).toHaveLength(2);
    expect(registros.map((r) => (r.depois as { valor: number }).valor)).toEqual([25, 40]);
  });

  it("sobrevive ao usuário que fez a ação", async () => {
    // Funcionário demitido não apaga o que ele fez — o registro tem que
    // continuar de pé, senão bastaria desativar a conta para sumir o rastro.
    await db.usuario.update({ where: { id: usuarioId }, data: { ativo: false } });

    const registro = await db.auditLog.findFirst({
      where: { tenantId },
      include: { usuario: { select: { nome: true, ativo: true } } },
    });

    expect(registro?.usuario?.nome).toBe("Usuário de Teste");
    expect(registro?.usuario?.ativo).toBe(false);
  });
});
