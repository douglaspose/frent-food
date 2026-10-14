import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { adicionarItem, cardapioDaUnidade } from "@/lib/carrinho";
import { criarProduto, criarRestaurante, limpar } from "./fixtures";

/**
 * A regra de lançar item, que o PDV e a maquininha compartilham.
 *
 * O que estes testes protegem é dinheiro e retrabalho: o preço que vai para a
 * conta, as escolhas que o cliente fez, e o reenvio de uma rodada presa na
 * rede não virar pedido em dobro. Tudo isso foi conferido à mão quando a
 * regra nasceu — à mão não protege a próxima alteração.
 */

const SLUG = "teste-carrinho";

let tenantId: string;
let unidadeId: string;
let usuarioId: string;
let cardapioId: string;
let quem: { usuarioId: string; tenantId: string; unidadeId: string };

beforeAll(async () => {
  const r = await criarRestaurante(SLUG);
  tenantId = r.tenant.id;
  unidadeId = r.unidade.id;
  usuarioId = r.usuario.id;
  quem = { usuarioId, tenantId, unidadeId };

  const cardapio = await db.cardapio.create({
    data: { tenantId, unidadeId, nome: "Salão", canal: "SALAO", ativo: true },
  });
  cardapioId = cardapio.id;
});

afterAll(async () => {
  await limpar(SLUG);
  await db.$disconnect();
});

/** Um produto no cardápio, pelo preço dado. Devolve o item do cardápio. */
async function noCardapio(titulo: string, preco: number, exigePontoCarne = false) {
  const produto = await criarProduto(tenantId, titulo);
  if (exigePontoCarne) {
    await db.produto.update({ where: { id: produto.id }, data: { exigePontoCarne: true } });
  }
  const item = await db.cardapioItem.create({
    data: { cardapioId, produtoId: produto.id, preco },
  });
  return { produto, item };
}

async function comandaAberta() {
  return db.comanda.create({
    data: {
      tenantId,
      unidadeId,
      numero: Math.floor(Math.random() * 1_000_000),
      pessoas: 2,
      status: "ABERTA",
      abertaPorId: usuarioId,
    },
  });
}

/** Um grupo de opcionais ligado a um produto. */
async function grupoCom(
  produtoId: string,
  regra: { titulo: string; min: number; max: number; obrigatorio: boolean },
  opcoes: { titulo: string; preco: number; produtoId?: string }[]
) {
  const grupo = await db.grupoOpcional.create({
    data: {
      tenantId,
      titulo: regra.titulo,
      minEscolhas: regra.min,
      maxEscolhas: regra.max,
      obrigatorio: regra.obrigatorio,
      itens: { create: opcoes.map((o, i) => ({ ...o, ordem: i })) },
      produtos: { create: { produtoId } },
    },
    include: { itens: true },
  });
  return grupo;
}

async function itensDa(comandaId: string) {
  return db.comandaItem.findMany({
    where: { comandaId },
    orderBy: { lancadoEm: "asc" },
    include: { opcionais: true },
  });
}

describe("preço", () => {
  it("sai do cardápio, não de quem chamou", async () => {
    const { item } = await noCardapio("Picanha", 129.9);
    const comanda = await comandaAberta();

    await adicionarItem(quem, { comandaId: comanda.id, cardapioItemId: item.id, quantidade: 2 });

    const [linha] = await itensDa(comanda.id);
    expect(Number(linha.precoUnitario)).toBe(129.9);
    expect(Number(linha.precoTotal)).toBe(259.8);
  });

  it("soma o adicional no item, e não numa linha à parte", async () => {
    const { produto, item } = await noCardapio("Cupim", 99.9);
    const grupo = await grupoCom(
      produto.id,
      { titulo: "Adicionais", min: 0, max: 3, obrigatorio: false },
      [{ titulo: "Bacon", preco: 8 }]
    );
    const comanda = await comandaAberta();

    await adicionarItem(quem, {
      comandaId: comanda.id,
      cardapioItemId: item.id,
      quantidade: 2,
      opcionais: [{ opcionalId: grupo.itens[0].id }],
    });

    const [linha] = await itensDa(comanda.id);
    // 99,90 + 8,00 = 107,90 por unidade; é esse número que a divisão por
    // pessoa e a taxa de serviço usam.
    expect(Number(linha.precoUnitario)).toBe(107.9);
    expect(Number(linha.precoTotal)).toBe(215.8);
    expect(linha.opcionais).toHaveLength(1);
  });

  it("congela título e preço da escolha no lançamento", async () => {
    const { produto, item } = await noCardapio("Costela", 119.9);
    const grupo = await grupoCom(
      produto.id,
      { titulo: "Adicionais", min: 0, max: 2, obrigatorio: false },
      [{ titulo: "Queijo", preco: 7 }]
    );
    const comanda = await comandaAberta();

    await adicionarItem(quem, {
      comandaId: comanda.id,
      cardapioItemId: item.id,
      opcionais: [{ opcionalId: grupo.itens[0].id }],
    });

    // A casa renomeia e reprecifica depois — a conta de ontem não muda.
    await db.opcionalItem.update({
      where: { id: grupo.itens[0].id },
      data: { titulo: "Queijo coalho premium", preco: 12 },
    });

    const [linha] = await itensDa(comanda.id);
    expect(linha.opcionais[0].titulo).toBe("Queijo");
    expect(Number(linha.opcionais[0].preco)).toBe(7);
  });
});

describe("as escolhas são conferidas no servidor", () => {
  it("recusa opção que não é do produto", async () => {
    const { item } = await noCardapio("Alcatra", 14.9);
    const outro = await noCardapio("Frango", 12.9);
    const grupoDoOutro = await grupoCom(
      outro.produto.id,
      { titulo: "Adicionais", min: 0, max: 1, obrigatorio: false },
      [{ titulo: "Bacon de graça", preco: 0 }]
    );
    const comanda = await comandaAberta();

    await expect(
      adicionarItem(quem, {
        comandaId: comanda.id,
        cardapioItemId: item.id,
        opcionais: [{ opcionalId: grupoDoOutro.itens[0].id }],
      })
    ).rejects.toThrow("não pertence a este item");
  });

  it("exige escolha no grupo obrigatório", async () => {
    const { produto, item } = await noCardapio("Picanha ao ponto", 129.9);
    await grupoCom(
      produto.id,
      { titulo: "Ponto da carne", min: 1, max: 1, obrigatorio: true },
      [{ titulo: "Mal passada", preco: 0 }]
    );
    const comanda = await comandaAberta();

    await expect(
      adicionarItem(quem, { comandaId: comanda.id, cardapioItemId: item.id })
    ).rejects.toThrow('Escolha uma opção em "Ponto da carne"');
  });

  it("recusa mais escolhas do que o grupo aceita", async () => {
    const { produto, item } = await noCardapio("Fraldinha", 89.9);
    const grupo = await grupoCom(
      produto.id,
      { titulo: "Ponto", min: 1, max: 1, obrigatorio: true },
      [
        { titulo: "Mal passada", preco: 0 },
        { titulo: "Bem passada", preco: 0 },
      ]
    );
    const comanda = await comandaAberta();

    await expect(
      adicionarItem(quem, {
        comandaId: comanda.id,
        cardapioItemId: item.id,
        opcionais: grupo.itens.map((i) => ({ opcionalId: i.id })),
      })
    ).rejects.toThrow("aceita uma opção só");
  });

  it("obrigatório com mínimo zero ainda pede uma escolha", async () => {
    // A casa marca "obrigatório" e esquece o mínimo: a intenção é clara.
    const { produto, item } = await noCardapio("Mandioca", 34.9);
    await grupoCom(
      produto.id,
      { titulo: "Acompanhamento", min: 0, max: 2, obrigatorio: true },
      [{ titulo: "Arroz", preco: 0 }]
    );
    const comanda = await comandaAberta();

    await expect(
      adicionarItem(quem, { comandaId: comanda.id, cardapioItemId: item.id })
    ).rejects.toThrow("Escolha uma opção");
  });
});

describe("o que separa uma linha de outra", () => {
  it("itens iguais e sem nada somam na mesma linha", async () => {
    const { item } = await noCardapio("Cerveja", 12);
    const comanda = await comandaAberta();

    await adicionarItem(quem, { comandaId: comanda.id, cardapioItemId: item.id });
    await adicionarItem(quem, { comandaId: comanda.id, cardapioItemId: item.id });

    const linhas = await itensDa(comanda.id);
    expect(linhas).toHaveLength(1);
    expect(Number(linhas[0].quantidade)).toBe(2);
  });

  it("observação separa — a cozinha não pode receber o recado valendo para os dois", async () => {
    const { item } = await noCardapio("Chopp", 11);
    const comanda = await comandaAberta();

    await adicionarItem(quem, { comandaId: comanda.id, cardapioItemId: item.id });
    await adicionarItem(quem, {
      comandaId: comanda.id,
      cardapioItemId: item.id,
      observacao: "sem colarinho",
    });

    expect(await itensDa(comanda.id)).toHaveLength(2);
  });

  it("escolhas separam — senão a picanha sem bacon sai pelo preço da com bacon", async () => {
    const { produto, item } = await noCardapio("Picanha com e sem", 129.9);
    const grupo = await grupoCom(
      produto.id,
      { titulo: "Adicionais", min: 0, max: 1, obrigatorio: false },
      [{ titulo: "Bacon", preco: 8 }]
    );
    const comanda = await comandaAberta();

    await adicionarItem(quem, { comandaId: comanda.id, cardapioItemId: item.id });
    await adicionarItem(quem, {
      comandaId: comanda.id,
      cardapioItemId: item.id,
      opcionais: [{ opcionalId: grupo.itens[0].id }],
    });

    const linhas = await itensDa(comanda.id);
    expect(linhas).toHaveLength(2);
    expect(linhas.map((l) => Number(l.precoUnitario)).sort()).toEqual([129.9, 137.9]);
  });

  it("item que pede ponto nunca agrupa", async () => {
    const { item } = await noCardapio("Bife", 49.9, true);
    const comanda = await comandaAberta();

    await adicionarItem(quem, { comandaId: comanda.id, cardapioItemId: item.id });
    await adicionarItem(quem, { comandaId: comanda.id, cardapioItemId: item.id });

    expect(await itensDa(comanda.id)).toHaveLength(2);
  });
});

/**
 * O recado é o único texto livre que o garçom escreve, e ele sai impresso na
 * praça. Até agora só a maquininha o escrevia; com o PDV também escrevendo, o
 * crivo passou a ter duas portas — e é ele que estes dois testes prendem.
 */
describe("o recado da linha", () => {
  it("caractere de controle não chega à térmica", async () => {
    const { item } = await noCardapio("Fraldinha", 59.9);
    const comanda = await comandaAberta();

    // O byte zero e o escape não são texto para a impressora: são comando.
    await adicionarItem(quem, {
      comandaId: comanda.id,
      cardapioItemId: item.id,
      observacao: "sem  cebola",
    });

    const linhas = await itensDa(comanda.id);
    expect(linhas[0].observacao).toBe("sem cebola");
  });

  it("acima de 200 caracteres é recusado", async () => {
    const { item } = await noCardapio("Costela", 79.9);
    const comanda = await comandaAberta();

    await expect(
      adicionarItem(quem, {
        comandaId: comanda.id,
        cardapioItemId: item.id,
        observacao: "a".repeat(201),
      })
    ).rejects.toThrow("200 caracteres");
  });
});

describe("reenvio", () => {
  it("a mesma referência não lança duas vezes", async () => {
    const { item } = await noCardapio("Torresmo", 44.9);
    const comanda = await comandaAberta();
    const referencia = `rodada-${Date.now()}`;

    const primeira = await adicionarItem(quem, {
      comandaId: comanda.id,
      cardapioItemId: item.id,
      quantidade: 2,
      referencia,
    });
    const segunda = await adicionarItem(quem, {
      comandaId: comanda.id,
      cardapioItemId: item.id,
      quantidade: 2,
      referencia,
    });

    expect(primeira.jaExistia).toBe(false);
    expect(segunda.jaExistia).toBe(true);

    const linhas = await itensDa(comanda.id);
    expect(linhas).toHaveLength(1);
    expect(Number(linhas[0].quantidade)).toBe(2);
  });

  it("completa a rodada que entrou pela metade", async () => {
    // A rede caiu no meio: o primeiro item entrou, o segundo não. No reenvio,
    // o que falta tem de entrar sem o que já está lá duplicar.
    const a = await noCardapio("Pudim", 16.9);
    const b = await noCardapio("Petit Gateau", 24.9);
    const comanda = await comandaAberta();
    const refA = `meia-a-${Date.now()}`;
    const refB = `meia-b-${Date.now()}`;

    await adicionarItem(quem, {
      comandaId: comanda.id,
      cardapioItemId: a.item.id,
      referencia: refA,
    });

    // Reenvio da rodada inteira.
    await adicionarItem(quem, {
      comandaId: comanda.id,
      cardapioItemId: a.item.id,
      referencia: refA,
    });
    await adicionarItem(quem, {
      comandaId: comanda.id,
      cardapioItemId: b.item.id,
      referencia: refB,
    });

    const linhas = await itensDa(comanda.id);
    expect(linhas).toHaveLength(2);
    expect(linhas.every((l) => Number(l.quantidade) === 1)).toBe(true);
  });

  it("item com referência não agrupa, para o reenvio não somar de novo", async () => {
    const { item } = await noCardapio("Água", 5);
    const comanda = await comandaAberta();

    await adicionarItem(quem, {
      comandaId: comanda.id,
      cardapioItemId: item.id,
      referencia: `a-${Date.now()}`,
    });
    await adicionarItem(quem, {
      comandaId: comanda.id,
      cardapioItemId: item.id,
      referencia: `b-${Date.now()}`,
    });

    // Duas linhas de 1, e não uma de 2: cada uma guarda a sua referência.
    const linhas = await itensDa(comanda.id);
    expect(linhas).toHaveLength(2);
    expect(linhas.every((l) => l.referenciaExterna !== null)).toBe(true);
  });
});

describe("cardápio", () => {
  it("traz os grupos do produto e esconde a opção desativada", async () => {
    const { produto, item } = await noCardapio("Espeto com molho", 14.9);
    const grupo = await grupoCom(
      produto.id,
      { titulo: "Molhos", min: 0, max: 2, obrigatorio: false },
      [
        { titulo: "Alho", preco: 0 },
        { titulo: "Pimenta", preco: 0 },
      ]
    );
    await db.opcionalItem.update({ where: { id: grupo.itens[1].id }, data: { ativo: false } });

    const categorias = await cardapioDaUnidade(unidadeId);
    const naTela = categorias.flatMap((c) => c.itens).find((i) => i.cardapioItemId === item.id);

    expect(naTela?.grupos).toHaveLength(1);
    expect(naTela?.grupos[0].itens.map((i) => i.titulo)).toEqual(["Alho"]);
  });

  it("não traz item escondido pela casa", async () => {
    const { item } = await noCardapio("Fora do cardápio", 10);
    await db.cardapioItem.update({ where: { id: item.id }, data: { visivel: false } });

    const categorias = await cardapioDaUnidade(unidadeId);
    const todos = categorias.flatMap((c) => c.itens).map((i) => i.cardapioItemId);

    expect(todos).not.toContain(item.id);
  });
});
