import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { movimentar } from "@/lib/estoque";
import { criarProduto, criarRestaurante, limpar } from "./fixtures";

/**
 * Dois restaurantes no mesmo banco. Estes testes existem para provar que um
 * não enxerga o outro — é a falha mais grave possível num SaaS, e a que menos
 * dá sinal quando acontece.
 */
const A = "teste-iso-a";
const B = "teste-iso-b";

let lojaA: Awaited<ReturnType<typeof criarRestaurante>>;
let lojaB: Awaited<ReturnType<typeof criarRestaurante>>;

beforeAll(async () => {
  lojaA = await criarRestaurante(A);
  lojaB = await criarRestaurante(B);

  for (const loja of [lojaA, lojaB]) {
    const produto = await criarProduto(loja.tenant.id, `Espeto ${loja.tenant.slug}`);
    await db.$transaction((tx) =>
      movimentar(tx, {
        tenantId: loja.tenant.id,
        unidadeId: loja.unidade.id,
        produtoId: produto.id,
        tipo: "ENTRADA",
        quantidade: 10,
        custoUnitario: 5,
      })
    );
  }
});

afterAll(async () => {
  await limpar(A);
  await limpar(B);
  await db.$disconnect();
});

describe("isolamento entre restaurantes", () => {
  it("cada um vê apenas os próprios produtos", async () => {
    const doA = await db.produto.findMany({ where: { tenantId: lojaA.tenant.id } });
    const doB = await db.produto.findMany({ where: { tenantId: lojaB.tenant.id } });

    expect(doA).toHaveLength(1);
    expect(doB).toHaveLength(1);
    expect(doA[0].titulo).toContain(A);
    expect(doB[0].titulo).toContain(B);
  });

  it("cada um vê apenas o próprio estoque", async () => {
    const saldosA = await db.estoqueSaldo.findMany({ where: { unidadeId: lojaA.unidade.id } });
    expect(saldosA).toHaveLength(1);

    const produtoDoB = await db.produto.findFirstOrThrow({
      where: { tenantId: lojaB.tenant.id },
    });
    expect(saldosA.some((s) => s.produtoId === produtoDoB.id)).toBe(false);
  });

  it("o guarda barra consulta sem filtro de restaurante", async () => {
    // Exatamente o erro que vaza dados: esquecer o where.
    await expect(db.produto.findMany({})).rejects.toThrow(/isolamento/);
    await expect(db.comanda.findMany({})).rejects.toThrow(/tenantId/);
    await expect(db.estoqueSaldo.findMany({})).rejects.toThrow(/isolamento/);
  });

  it("o guarda deixa passar consulta com filtro", async () => {
    await expect(
      db.produto.findMany({ where: { tenantId: lojaA.tenant.id } })
    ).resolves.toBeInstanceOf(Array);
  });

  it("excluir um restaurante não leva nada do outro junto", async () => {
    const descartavel = await criarRestaurante("teste-iso-descartavel");
    await criarProduto(descartavel.tenant.id, "Produto efêmero");

    await limpar("teste-iso-descartavel");

    expect(await db.produto.count({ where: { tenantId: lojaA.tenant.id } })).toBe(1);
    expect(await db.produto.count({ where: { tenantId: lojaB.tenant.id } })).toBe(1);
    expect(await db.tenant.count({ where: { slug: "teste-iso-descartavel" } })).toBe(0);
  });

  it("excluir um restaurante que já operou também funciona", async () => {
    /**
     * O teste acima apagava um restaurante recém-criado, e por isso passava
     * mesmo com o banco cheio de chaves estrangeiras sem cascata. Um cliente
     * de verdade sai depois de meses de comanda, pagamento e caixa — e era
     * exatamente aí que a exclusão falhava.
     */
    const saindo = await criarRestaurante("teste-iso-com-historia");
    const produto = await criarProduto(saindo.tenant.id, "Espeto vendido");

    const comanda = await db.comanda.create({
      data: {
        tenantId: saindo.tenant.id,
        unidadeId: saindo.unidade.id,
        numero: 1,
        abertaPorId: saindo.usuario.id,
      },
    });

    await db.comandaItem.create({
      data: {
        tenantId: saindo.tenant.id,
        comandaId: comanda.id,
        produtoId: produto.id,
        quantidade: 1,
        precoUnitario: 10,
        precoTotal: 10,
        status: "ENVIADO",
        lancadoPorId: saindo.usuario.id,
      },
    });

    const caixa = await db.caixa.create({
      data: {
        tenantId: saindo.tenant.id,
        unidadeId: saindo.unidade.id,
        tipo: "GERAL",
        data: new Date(),
        turno: "NOITE",
        fundoCaixa: 100,
        abertoPorId: saindo.usuario.id,
      },
    });

    const forma = await db.formaPagamento.create({
      data: { tenantId: saindo.tenant.id, nome: "Dinheiro", tipo: "DINHEIRO" },
    });

    await db.pagamento.create({
      data: {
        tenantId: saindo.tenant.id,
        comandaId: comanda.id,
        caixaId: caixa.id,
        formaPagamentoId: forma.id,
        valor: 10,
        usuarioId: saindo.usuario.id,
      },
    });

    await db.auditLog.create({
      data: {
        tenantId: saindo.tenant.id,
        unidadeId: saindo.unidade.id,
        usuarioId: saindo.usuario.id,
        entidade: "Comanda",
        entidadeId: comanda.id,
        acao: "DESCONTO",
        depois: { valor: 5 },
      },
    });

    await expect(limpar("teste-iso-com-historia")).resolves.not.toThrow();
    expect(await db.tenant.count({ where: { slug: "teste-iso-com-historia" } })).toBe(0);
    expect(await db.comanda.count({ where: { tenantId: saindo.tenant.id } })).toBe(0);
  });
});
