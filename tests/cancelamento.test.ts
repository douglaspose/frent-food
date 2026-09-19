import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { baixarVenda, estornarVenda } from "@/lib/estoque";
import { CONSUMO } from "@/lib/itens";
import { comandaDeCancelamento, COLUNAS } from "@/lib/impressao";
import { calcularTotais } from "@/lib/comanda";
import { criarProduto, criarRestaurante, limpar } from "./fixtures";

/**
 * Cancelar um item mexe em três lugares ao mesmo tempo: a conta do cliente, o
 * saldo do estoque e o ticket da cozinha. Errar em qualquer um deles custa
 * dinheiro de um jeito difícil de perceber depois.
 */
describe("cancelamento de item", () => {
  let tenantId: string;
  let unidadeId: string;
  let usuarioId: string;
  let estacaoId: string;
  let espetoId: string;
  let carneId: string;

  beforeAll(async () => {
    const r = await criarRestaurante("cancelamento");
    tenantId = r.tenant.id;
    unidadeId = r.unidade.id;
    usuarioId = r.usuario.id;
    estacaoId = r.estacao.id;

    // Espeto de alcatra: 0,15 kg de carne por unidade.
    carneId = (await criarProduto(tenantId, "Alcatra", { controlaEstoque: true, unidadeMedida: "KG" })).id;
    espetoId = (await criarProduto(tenantId, "Espeto de Alcatra")).id;
    await db.composicao.create({
      data: { produtoId: espetoId, insumoId: carneId, quantidade: 0.15 },
    });

    // 10 kg em casa a R$ 40.
    await db.estoqueSaldo.create({
      data: { tenantId, unidadeId, produtoId: carneId, quantidade: 10, custoMedio: 40 },
    });
  });

  afterAll(async () => {
    await limpar("cancelamento");
  });

  async function comandaComItem(quantidade = 2) {
    const comanda = await db.comanda.create({
      data: { tenantId, unidadeId, numero: Math.floor(Math.random() * 100000), abertaPorId: usuarioId },
    });

    const item = await db.comandaItem.create({
      data: {
        tenantId,
        comandaId: comanda.id,
        produtoId: espetoId,
        quantidade,
        precoUnitario: 17.5,
        precoTotal: 17.5 * quantidade,
        status: "ENVIADO",
        lancadoPorId: usuarioId,
      },
    });

    await db.$transaction(async (tx) => {
      await baixarVenda(tx, {
        tenantId,
        unidadeId,
        usuarioId,
        itens: [{ produtoId: espetoId, quantidade, comandaItemId: item.id }],
      });
    });

    return { comanda, item };
  }

  const saldo = async () =>
    Number(
      (
        await db.estoqueSaldo.findUniqueOrThrow({
          where: { unidadeId_produtoId: { unidadeId, produtoId: carneId } },
        })
      ).quantidade
    );

  it("devolve ao estoque exatamente o que a venda baixou", async () => {
    const antes = await saldo();
    const { item } = await comandaComItem(2);

    // 2 espetos × 0,15 kg = 0,30 kg fora.
    expect(await saldo()).toBeCloseTo(antes - 0.3, 4);

    await db.$transaction(async (tx) => {
      await estornarVenda(tx, {
        tenantId,
        unidadeId,
        usuarioId,
        motivo: "Cancelamento: cliente desistiu",
        itens: [{ produtoId: espetoId, quantidade: 2, comandaItemId: item.id }],
      });
    });

    expect(await saldo()).toBeCloseTo(antes, 4);
  });

  it("não mexe no custo médio ao devolver", async () => {
    // Devolução não é compra. Se mexesse no médio ponderado, cancelar itens
    // seria uma forma de bagunçar o CMV sem ninguém notar.
    const { item } = await comandaComItem(1);

    await db.$transaction(async (tx) => {
      await estornarVenda(tx, {
        tenantId,
        unidadeId,
        usuarioId,
        itens: [{ produtoId: espetoId, quantidade: 1, comandaItemId: item.id }],
      });
    });

    const depois = await db.estoqueSaldo.findUniqueOrThrow({
      where: { unidadeId_produtoId: { unidadeId, produtoId: carneId } },
    });
    expect(Number(depois.custoMedio)).toBe(40);
  });

  it("grava a devolução como DEVOLUCAO, que é o que abate o CMV", async () => {
    const { item } = await comandaComItem(1);

    await db.$transaction(async (tx) => {
      await estornarVenda(tx, {
        tenantId,
        unidadeId,
        usuarioId,
        itens: [{ produtoId: espetoId, quantidade: 1, comandaItemId: item.id }],
      });
    });

    const movimento = await db.movimentoEstoque.findFirst({
      where: { unidadeId, referenciaId: item.id, tipo: "DEVOLUCAO" },
    });

    expect(movimento).not.toBeNull();
    expect(Number(movimento!.quantidade)).toBeCloseTo(0.15, 4);
    // Custo congelado no valor vigente: é ele que o painel abate do CMV.
    expect(Number(movimento!.custoUnitario)).toBe(40);
  });

  it("tira o item cancelado da conta do cliente", async () => {
    const { comanda, item } = await comandaComItem(2);

    await db.comandaItem.update({
      where: { id: item.id },
      data: { status: "CANCELADO", canceladoPorId: usuarioId, motivoCancelamento: "Veio errado" },
    });

    const itens = await db.comandaItem.findMany({ where: { comandaId: comanda.id, ...CONSUMO } });
    const totais = calcularTotais({
      itens: itens.map((i) => ({ precoTotal: Number(i.precoTotal) })),
      taxaServicoPct: 10,
      descontoValor: 0,
    });

    // O item valia R$ 35 e a conta tem que fechar em zero — inclusive a taxa,
    // que não pode ser cobrada sobre o que foi cancelado.
    expect(totais.subtotal).toBe(0);
    expect(totais.total).toBe(0);
  });

  it("não perde o rastro de quem cancelou nem o motivo", async () => {
    const { item } = await comandaComItem(1);

    await db.comandaItem.update({
      where: { id: item.id },
      data: { status: "CANCELADO", canceladoPorId: usuarioId, motivoCancelamento: "Cliente desistiu" },
    });

    const salvo = await db.comandaItem.findUniqueOrThrow({
      where: { id: item.id },
      include: { canceladoPor: { select: { nome: true } } },
    });

    expect(salvo.canceladoPor?.nome).toBe("Usuário de Teste");
    expect(salvo.motivoCancelamento).toBe("Cliente desistiu");
  });

  it("derruba o ticket que ficou só com itens cancelados", async () => {
    const { comanda, item } = await comandaComItem(1);

    const pedido = await db.pedido.create({
      data: {
        tenantId,
        unidadeId,
        comandaId: comanda.id,
        estacaoId,
        numero: 1,
        itens: { create: { comandaItemId: item.id } },
      },
    });

    await db.comandaItem.update({ where: { id: item.id }, data: { status: "CANCELADO" } });

    const vivos = await db.pedidoItem.count({
      where: { pedidoId: pedido.id, comandaItem: { status: { not: "CANCELADO" } } },
    });
    expect(vivos).toBe(0);
  });

  it("mantém de pé o ticket que ainda tem item vivo", async () => {
    // O caso que um cancelamento apressado quebraria: mesa pede dois pratos,
    // desiste de um. O outro continua tendo que sair da cozinha.
    const { comanda, item } = await comandaComItem(1);
    const outro = await db.comandaItem.create({
      data: {
        tenantId,
        comandaId: comanda.id,
        produtoId: espetoId,
        quantidade: 1,
        precoUnitario: 17.5,
        precoTotal: 17.5,
        status: "ENVIADO",
        lancadoPorId: usuarioId,
      },
    });

    const pedido = await db.pedido.create({
      data: {
        tenantId,
        unidadeId,
        comandaId: comanda.id,
        estacaoId,
        numero: 2,
        itens: { create: [{ comandaItemId: item.id }, { comandaItemId: outro.id }] },
      },
    });

    await db.comandaItem.update({ where: { id: item.id }, data: { status: "CANCELADO" } });

    const vivos = await db.pedidoItem.count({
      where: { pedidoId: pedido.id, comandaItem: { status: { not: "CANCELADO" } } },
    });
    expect(vivos).toBe(1);
  });
});

describe("papel de cancelamento", () => {
  const papel = comandaDeCancelamento({
    estacao: "CHURRASQUEIRA",
    pedidoNumero: 42,
    mesa: "12",
    comandaNumero: 7,
    canceladoPor: "Marina Gerente",
    motivo: "Cliente desistiu depois de meia hora de espera",
    canceladoEm: new Date("2026-09-19T20:15:00"),
    item: { titulo: "Espeto de Alcatra", quantidade: 2, pontoCarne: "AO PONTO" },
  });

  it("cabe na bobina", () => {
    for (const l of papel.split("\n")) expect(l.length).toBeLessThanOrEqual(COLUNAS);
  });

  it("grita o que é", () => {
    // Um papel parecido com o de produção seria pendurado junto e o prato
    // sairia do mesmo jeito.
    expect(papel).toContain("*** CANCELAMENTO ***");
    expect(papel).toContain("NAO PREPARAR:");
  });

  it("diz o item, o motivo e quem cancelou", () => {
    expect(papel).toContain("2x Espeto de Alcatra");
    expect(papel).toContain("Cliente desistiu");
    expect(papel).toContain("Marina Gerente");
    expect(papel).toContain("MESA 12");
  });
});
