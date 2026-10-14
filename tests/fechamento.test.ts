import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { marcarFechando, pedirAConta, reabrirConta } from "@/lib/fechamento";
import { adicionarItem } from "@/lib/carrinho";
import { criarProduto, criarRestaurante, limpar } from "./fixtures";

/**
 * Pedir a conta e voltar atrás, que o PDV e a maquininha compartilham.
 *
 * O estado da comanda aqui não é enfeite: em fechamento, a mesa acende no mapa
 * do salão, a cozinha marca o ticket e o lançamento de item novo é recusado. É
 * o caminho inteiro do fim do atendimento, e era conferido à mão.
 */

const SLUG = "teste-fechamento";

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

let proxima = 1;

async function mesaComConta() {
  const mesa = await db.mesa.create({
    data: {
      tenantId,
      unidadeId,
      numero: String(proxima++),
      capacidade: 4,
      status: "OCUPADA",
      qrToken: `qr-${SLUG}-${proxima}`,
    },
  });
  const comanda = await db.comanda.create({
    data: {
      tenantId,
      unidadeId,
      mesaId: mesa.id,
      numero: Math.floor(Math.random() * 1_000_000),
      pessoas: 2,
      status: "ABERTA",
      abertaPorId: usuarioId,
      taxaServicoPct: 10,
    },
  });
  return { mesa, comanda };
}

async function itemNoCardapio(titulo: string, preco: number) {
  const produto = await criarProduto(tenantId, titulo);
  return db.cardapioItem.create({ data: { cardapioId, produtoId: produto.id, preco } });
}

async function papeisDe(comandaId: string) {
  return db.filaImpressao.findMany({
    where: { tenantId, referenciaId: comandaId, tipo: "CONFERENCIA" },
    orderBy: { criadoEm: "asc" },
  });
}

describe("pedir a conta", () => {
  it("a comanda entra em fechamento, a mesa acompanha, e o papel vai para a fila", async () => {
    const { mesa, comanda } = await mesaComConta();

    const r = await pedirAConta(quem, comanda.id);

    expect(r.fechando).toBe(true);
    expect(r.segundaVia).toBe(false);
    expect((await db.comanda.findUniqueOrThrow({ where: { id: comanda.id } })).status).toBe(
      "FECHANDO"
    );
    // A mesa é o que o mapa do salão lê; sem ela, o caixa não vê quem chamou.
    expect((await db.mesa.findUniqueOrThrow({ where: { id: mesa.id } })).status).toBe("FECHANDO");
    expect(await papeisDe(comanda.id)).toHaveLength(1);
  });

  it("de novo imprime outra folha, marcada como segunda via", async () => {
    const { comanda } = await mesaComConta();

    await pedirAConta(quem, comanda.id);
    const segunda = await pedirAConta(quem, comanda.id);

    // "Sumiu a conta", "manda outra via" é rotina: imprime, e não recusa.
    expect(segunda.segundaVia).toBe(true);
    const papeis = await papeisDe(comanda.id);
    expect(papeis).toHaveLength(2);
    expect(papeis[0].conteudo).not.toContain("SEGUNDA VIA");
    expect(papeis[1].conteudo).toContain("SEGUNDA VIA");
  });

  it("em fechamento, a cozinha não recebe item novo", async () => {
    const { comanda } = await mesaComConta();
    const item = await itemNoCardapio("Cerveja do fechamento", 12);

    await pedirAConta(quem, comanda.id);

    await expect(
      adicionarItem(quem, { comandaId: comanda.id, cardapioItemId: item.id })
    ).rejects.toThrow();
  });

  it("conta já paga não volta a pedir", async () => {
    const { comanda } = await mesaComConta();
    await db.comanda.update({ where: { id: comanda.id }, data: { status: "PAGA" } });

    await expect(pedirAConta(quem, comanda.id)).rejects.toThrow("já foi paga");
    expect(await papeisDe(comanda.id)).toHaveLength(0);
  });

  it("marcar o fechamento sozinho não imprime nada", async () => {
    const { comanda } = await mesaComConta();

    // É o caminho do PDV: "Fechar conta" leva para a tela de pagamento, e o
    // papel é um botão à parte. Imprimir aqui jogaria uma folha fora por mesa.
    await marcarFechando(quem, comanda.id);

    expect((await db.comanda.findUniqueOrThrow({ where: { id: comanda.id } })).status).toBe(
      "FECHANDO"
    );
    expect(await papeisDe(comanda.id)).toHaveLength(0);
  });
});

describe("reabrir", () => {
  it('"traz mais uma cerveja": a conta volta a aceitar item', async () => {
    const { mesa, comanda } = await mesaComConta();
    const item = await itemNoCardapio("Cerveja da reabertura", 12);
    await pedirAConta(quem, comanda.id);

    expect((await reabrirConta(quem, comanda.id)).reaberta).toBe(true);

    expect((await db.comanda.findUniqueOrThrow({ where: { id: comanda.id } })).status).toBe(
      "ABERTA"
    );
    expect((await db.mesa.findUniqueOrThrow({ where: { id: mesa.id } })).status).toBe("OCUPADA");
    await expect(
      adicionarItem(quem, { comandaId: comanda.id, cardapioItemId: item.id })
    ).resolves.toBeTruthy();
  });

  it("fica registrado quem reabriu", async () => {
    const { comanda } = await mesaComConta();
    await pedirAConta(quem, comanda.id);

    await reabrirConta(quem, comanda.id);

    // Reabrir desfaz o fechamento de uma conta que o cliente pediu: é do tipo
    // de coisa que o dono quer poder reconstituir no fim do turno.
    const registros = await db.auditLog.findMany({
      where: { tenantId, entidadeId: comanda.id, acao: "CONTA_REABERTA" },
    });
    expect(registros).toHaveLength(1);
    expect(registros[0].usuarioId).toBe(usuarioId);
  });

  it("reabrir o que já está aberto não faz nada, e não é erro", async () => {
    const { comanda } = await mesaComConta();

    expect((await reabrirConta(quem, comanda.id)).reaberta).toBe(false);
    expect(
      await db.auditLog.count({
        where: { tenantId, entidadeId: comanda.id, acao: "CONTA_REABERTA" },
      })
    ).toBe(0);
  });

  it("conta paga não reabre", async () => {
    const { comanda } = await mesaComConta();
    await db.comanda.update({ where: { id: comanda.id }, data: { status: "PAGA" } });

    await expect(reabrirConta(quem, comanda.id)).rejects.toThrow("Abra uma nova");
  });
});
