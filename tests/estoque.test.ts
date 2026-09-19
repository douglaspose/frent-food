import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { baixarVenda, custoDaFicha, movimentar } from "@/lib/estoque";
import { criarProduto, criarRestaurante, limpar } from "./fixtures";

const SLUG = "teste-estoque";

let tenantId: string;
let unidadeId: string;
let usuarioId: string;

beforeAll(async () => {
  const r = await criarRestaurante(SLUG);
  tenantId = r.tenant.id;
  unidadeId = r.unidade.id;
  usuarioId = r.usuario.id;
});

afterAll(async () => {
  await limpar(SLUG);
  await db.$disconnect();
});

async function saldoDe(produtoId: string) {
  const s = await db.estoqueSaldo.findUnique({
    where: { unidadeId_produtoId: { unidadeId, produtoId } },
  });
  return { quantidade: Number(s?.quantidade ?? 0), custoMedio: Number(s?.custoMedio ?? 0) };
}

describe("custo médio ponderado", () => {
  it("adota o preço da primeira compra", async () => {
    const p = await criarProduto(tenantId, "Alcatra A", { unidadeMedida: "KG" });

    await db.$transaction((tx) =>
      movimentar(tx, { tenantId, unidadeId, produtoId: p.id, tipo: "ENTRADA", quantidade: 10, custoUnitario: 40 })
    );

    expect(await saldoDe(p.id)).toEqual({ quantidade: 10, custoMedio: 40 });
  });

  it("mistura o preço novo com o que já estava em casa", async () => {
    const p = await criarProduto(tenantId, "Alcatra B", { unidadeMedida: "KG" });

    await db.$transaction(async (tx) => {
      await movimentar(tx, { tenantId, unidadeId, produtoId: p.id, tipo: "ENTRADA", quantidade: 10, custoUnitario: 40 });
      await movimentar(tx, { tenantId, unidadeId, produtoId: p.id, tipo: "ENTRADA", quantidade: 10, custoUnitario: 50 });
    });

    // 10kg a 40 + 10kg a 50 = 20kg a 45, e não 50.
    expect(await saldoDe(p.id)).toEqual({ quantidade: 20, custoMedio: 45 });
  });

  it("não mexe no custo médio quando sai mercadoria", async () => {
    const p = await criarProduto(tenantId, "Alcatra C", { unidadeMedida: "KG" });

    await db.$transaction(async (tx) => {
      await movimentar(tx, { tenantId, unidadeId, produtoId: p.id, tipo: "ENTRADA", quantidade: 10, custoUnitario: 42 });
      await movimentar(tx, { tenantId, unidadeId, produtoId: p.id, tipo: "SAIDA_VENDA", quantidade: -3 });
    });

    expect(await saldoDe(p.id)).toEqual({ quantidade: 7, custoMedio: 42 });
  });

  it("registra cada movimento com o saldo resultante", async () => {
    const p = await criarProduto(tenantId, "Carvão", { unidadeMedida: "KG" });

    await db.$transaction(async (tx) => {
      await movimentar(tx, { tenantId, unidadeId, produtoId: p.id, tipo: "ENTRADA", quantidade: 20, custoUnitario: 5, usuarioId });
      await movimentar(tx, { tenantId, unidadeId, produtoId: p.id, tipo: "PERDA", quantidade: -2, motivo: "molhou", usuarioId });
    });

    const movimentos = await db.movimentoEstoque.findMany({
      where: { unidadeId, produtoId: p.id },
      orderBy: { criadoEm: "asc" },
    });

    expect(movimentos).toHaveLength(2);
    expect(Number(movimentos[0].saldoDepois)).toBe(20);
    expect(Number(movimentos[1].saldoDepois)).toBe(18);
    expect(movimentos[1].motivo).toBe("molhou");
  });

  it("aceita saldo negativo em vez de travar a venda", async () => {
    const p = await criarProduto(tenantId, "Refrigerante");

    await db.$transaction((tx) =>
      movimentar(tx, { tenantId, unidadeId, produtoId: p.id, tipo: "SAIDA_VENDA", quantidade: -2 })
    );

    // O salão está cheio e a bebida está na geladeira: negativo é alerta,
    // não bloqueio.
    expect((await saldoDe(p.id)).quantidade).toBe(-2);
  });
});

describe("baixa na venda", () => {
  it("consome os insumos da ficha técnica", async () => {
    const carne = await criarProduto(tenantId, "Alcatra ficha", { unidadeMedida: "KG" });
    const espeto = await criarProduto(tenantId, "Espeto ficha");

    await db.composicao.create({ data: { produtoId: espeto.id, insumoId: carne.id, quantidade: 0.12 } });
    await db.$transaction((tx) =>
      movimentar(tx, { tenantId, unidadeId, produtoId: carne.id, tipo: "ENTRADA", quantidade: 10, custoUnitario: 42 })
    );

    await db.$transaction((tx) =>
      baixarVenda(tx, {
        tenantId,
        unidadeId,
        usuarioId,
        itens: [{ produtoId: espeto.id, quantidade: 3, comandaItemId: "ci-1" }],
      })
    );

    expect((await saldoDe(carne.id)).quantidade).toBe(9.64);
    // O produto de venda em si não tem saldo — quem estoca é o insumo.
    expect((await saldoDe(espeto.id)).quantidade).toBe(0);
  });

  it("junta o consumo do mesmo insumo num movimento só", async () => {
    const carne = await criarProduto(tenantId, "Alcatra junta", { unidadeMedida: "KG" });
    const espeto = await criarProduto(tenantId, "Espeto junta");
    const kafta = await criarProduto(tenantId, "Kafta junta");

    await db.composicao.createMany({
      data: [
        { produtoId: espeto.id, insumoId: carne.id, quantidade: 0.1 },
        { produtoId: kafta.id, insumoId: carne.id, quantidade: 0.2 },
      ],
    });

    await db.$transaction((tx) =>
      baixarVenda(tx, {
        tenantId,
        unidadeId,
        usuarioId,
        itens: [
          { produtoId: espeto.id, quantidade: 2, comandaItemId: "ci-2" },
          { produtoId: kafta.id, quantidade: 1, comandaItemId: "ci-3" },
        ],
      })
    );

    const movimentos = await db.movimentoEstoque.findMany({ where: { unidadeId, produtoId: carne.id } });
    expect(movimentos).toHaveLength(1);
    expect(Number(movimentos[0].quantidade)).toBe(-0.4); // 2×0,1 + 1×0,2
  });

  it("dá baixa direta em produto marcado como controlado", async () => {
    const cerveja = await criarProduto(tenantId, "Cerveja controlada", { controlaEstoque: true });

    await db.$transaction((tx) =>
      baixarVenda(tx, {
        tenantId,
        unidadeId,
        usuarioId,
        itens: [{ produtoId: cerveja.id, quantidade: 4, comandaItemId: "ci-4" }],
      })
    );

    expect((await saldoDe(cerveja.id)).quantidade).toBe(-4);
  });

  it("não move nada para produto sem ficha e sem controle", async () => {
    const sobremesa = await criarProduto(tenantId, "Pudim sem ficha");

    await db.$transaction((tx) =>
      baixarVenda(tx, {
        tenantId,
        unidadeId,
        usuarioId,
        itens: [{ produtoId: sobremesa.id, quantidade: 5, comandaItemId: "ci-5" }],
      })
    );

    // Quem ainda não cadastrou a ficha não pode ficar impedido de vender.
    const movimentos = await db.movimentoEstoque.findMany({ where: { unidadeId, produtoId: sobremesa.id } });
    expect(movimentos).toHaveLength(0);
  });
});

describe("custo da ficha", () => {
  it("soma os insumos pelo custo médio atual", async () => {
    const carne = await criarProduto(tenantId, "Alcatra custo", { unidadeMedida: "KG" });
    const palito = await criarProduto(tenantId, "Palito custo");
    const espeto = await criarProduto(tenantId, "Espeto custo");

    await db.composicao.createMany({
      data: [
        { produtoId: espeto.id, insumoId: carne.id, quantidade: 0.12 },
        { produtoId: espeto.id, insumoId: palito.id, quantidade: 1 },
      ],
    });

    await db.$transaction(async (tx) => {
      await movimentar(tx, { tenantId, unidadeId, produtoId: carne.id, tipo: "ENTRADA", quantidade: 10, custoUnitario: 42 });
      await movimentar(tx, { tenantId, unidadeId, produtoId: palito.id, tipo: "ENTRADA", quantidade: 100, custoUnitario: 0.15 });
    });

    const { custo, partes } = await custoDaFicha(espeto.id, unidadeId);
    expect(custo).toBe(5.19); // 0,12 × 42 + 1 × 0,15
    expect(partes).toHaveLength(2);
  });

  it("devolve zero para produto sem ficha", async () => {
    const p = await criarProduto(tenantId, "Sem ficha nenhuma");
    expect(await custoDaFicha(p.id, unidadeId)).toEqual({ custo: 0, partes: [] });
  });
});
