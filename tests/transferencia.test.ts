import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { avisoDeTransferencia, COLUNAS } from "@/lib/impressao";
import { criarProduto, criarRestaurante, limpar } from "./fixtures";

/**
 * Transferir mesa mexe em duas mesas, na comanda e nos tickets da cozinha ao
 * mesmo tempo. O erro caro aqui é silencioso: a mesa de origem fica ocupada
 * para sempre no mapa, ou a de destino recebe duas contas.
 */
describe("transferência de mesa", () => {
  let tenantId: string;
  let unidadeId: string;
  let usuarioId: string;
  let areaId: string;

  beforeAll(async () => {
    const r = await criarRestaurante("transferencia");
    tenantId = r.tenant.id;
    unidadeId = r.unidade.id;
    usuarioId = r.usuario.id;

    const area = await db.area.create({
      data: { tenantId, unidadeId, nome: "Salão", ordem: 1 },
    });
    areaId = area.id;
  });

  afterAll(async () => {
    await limpar("transferencia");
  });

  async function criarMesa(numero: string, status = "LIVRE") {
    return db.mesa.create({
      data: {
        tenantId,
        unidadeId,
        areaId,
        numero,
        capacidade: 4,
        status: status as "LIVRE" | "OCUPADA" | "FECHANDO" | "SUJA" | "RESERVADA",
      },
    });
  }

  async function abrirComanda(mesaId: string, numero: number, status = "ABERTA") {
    return db.comanda.create({
      data: {
        tenantId,
        unidadeId,
        mesaId,
        numero,
        abertaPorId: usuarioId,
        status: status as "ABERTA" | "FECHANDO",
      },
    });
  }

  it("mesa livre não aparece duas vezes: só uma comanda aberta por mesa", async () => {
    // A regra que a transferência tem que respeitar. Se a mesa de destino já
    // tem conta, mover para lá criaria duas contas na mesma mesa e o mapa
    // mostraria só uma delas.
    const mesa = await criarMesa("100", "OCUPADA");
    await abrirComanda(mesa.id, 100);

    const ocupadas = await db.comanda.count({
      where: { mesaId: mesa.id, status: { in: ["ABERTA", "FECHANDO"] } },
    });
    expect(ocupadas).toBe(1);
  });

  it("a comanda muda de mesa e as duas mesas trocam de estado", async () => {
    const origem = await criarMesa("101", "OCUPADA");
    const destino = await criarMesa("102");
    const comanda = await abrirComanda(origem.id, 101);

    await db.$transaction(async (tx) => {
      await tx.comanda.update({ where: { id: comanda.id }, data: { mesaId: destino.id } });
      await tx.mesa.update({ where: { id: destino.id }, data: { status: "OCUPADA" } });
      await tx.mesa.update({ where: { id: origem.id }, data: { status: "LIVRE" } });
    });

    expect((await db.mesa.findUniqueOrThrow({ where: { id: origem.id } })).status).toBe("LIVRE");
    expect((await db.mesa.findUniqueOrThrow({ where: { id: destino.id } })).status).toBe("OCUPADA");
    expect((await db.comanda.findUniqueOrThrow({ where: { id: comanda.id } })).mesaId).toBe(
      destino.id
    );
  });

  it("os itens e o total acompanham a comanda, sem relançar nada", async () => {
    // O motivo de existir a transferência: fechar e reabrir perderia isto.
    const origem = await criarMesa("103", "OCUPADA");
    const destino = await criarMesa("104");
    const comanda = await abrirComanda(origem.id, 103);
    const produto = await criarProduto(tenantId, "Espeto");

    await db.comandaItem.create({
      data: {
        tenantId,
        comandaId: comanda.id,
        produtoId: produto.id,
        quantidade: 2,
        precoUnitario: 17.5,
        precoTotal: 35,
        status: "ENVIADO",
        lancadoPorId: usuarioId,
      },
    });

    await db.comanda.update({ where: { id: comanda.id }, data: { mesaId: destino.id } });

    const depois = await db.comanda.findUniqueOrThrow({
      where: { id: comanda.id },
      include: { itens: true, mesa: { select: { numero: true } } },
    });

    expect(depois.mesa?.numero).toBe("104");
    expect(depois.itens).toHaveLength(1);
    expect(Number(depois.itens[0]!.precoTotal)).toBe(35);
    // O relógio da mesa não reinicia: é a mesma conta, noutro lugar.
    expect(depois.abertaEm).toEqual(comanda.abertaEm);
  });

  it("os tickets da cozinha seguem a comanda sem tocar em PedidoItem", async () => {
    const origem = await criarMesa("105", "OCUPADA");
    const destino = await criarMesa("106");
    const comanda = await abrirComanda(origem.id, 105);
    const produto = await criarProduto(tenantId, "Espeto do ticket");
    const estacao = await db.estacao.findFirstOrThrow({ where: { unidadeId } });

    const item = await db.comandaItem.create({
      data: {
        tenantId,
        comandaId: comanda.id,
        produtoId: produto.id,
        quantidade: 1,
        precoUnitario: 10,
        precoTotal: 10,
        status: "ENVIADO",
        lancadoPorId: usuarioId,
      },
    });

    const pedido = await db.pedido.create({
      data: {
        tenantId,
        unidadeId,
        comandaId: comanda.id,
        estacaoId: estacao.id,
        numero: 500,
        itens: { create: { comandaItemId: item.id } },
      },
    });

    await db.comanda.update({ where: { id: comanda.id }, data: { mesaId: destino.id } });

    // O KDS lê o número da mesa pela comanda, então o ticket acompanha sozinho.
    const noKds = await db.pedido.findUniqueOrThrow({
      where: { id: pedido.id },
      include: { comanda: { select: { mesa: { select: { numero: true } } } } },
    });
    expect(noKds.comanda.mesa?.numero).toBe("106");
  });

  it("a mesa de destino herda o estado de conta em fechamento", async () => {
    // Uma mesa que pediu a conta continua laranja no mapa depois de mudar de
    // lugar — senão o caixa perde de vista quem está esperando para pagar.
    const origem = await criarMesa("107", "FECHANDO");
    const destino = await criarMesa("108");
    const comanda = await abrirComanda(origem.id, 107, "FECHANDO");

    await db.$transaction(async (tx) => {
      await tx.comanda.update({ where: { id: comanda.id }, data: { mesaId: destino.id } });
      await tx.mesa.update({ where: { id: destino.id }, data: { status: "FECHANDO" } });
      await tx.mesa.update({ where: { id: origem.id }, data: { status: "LIVRE" } });
    });

    expect((await db.mesa.findUniqueOrThrow({ where: { id: destino.id } })).status).toBe("FECHANDO");
  });
});

describe("aviso de transferência impresso", () => {
  const papel = avisoDeTransferencia({
    estacao: "CHURRASQUEIRA",
    pedidoNumero: 77,
    de: "5",
    para: "12",
    comandaNumero: 9,
    transferidoPor: "João Garçom",
    transferidoEm: new Date("2026-09-19T21:30:00"),
    itens: [
      { titulo: "Espeto de Alcatra", quantidade: 2 },
      { titulo: "Espeto de Queijo Coalho com nome bem comprido para quebrar", quantidade: 1 },
    ],
  });

  it("cabe na bobina", () => {
    for (const l of papel.split("\n")) expect(l.length).toBeLessThanOrEqual(COLUNAS);
  });

  it("mostra de onde para onde, que é o que a cozinha precisa ler", () => {
    expect(papel).toContain("*** MUDOU DE MESA ***");
    expect(papel).toContain("MESA 5  >>>  MESA 12");
  });

  it("lista os itens e quem transferiu", () => {
    expect(papel).toContain("2x Espeto de Alcatra");
    expect(papel).toContain("João Garçom");
    expect(papel).toContain("Comanda #9");
  });
});
