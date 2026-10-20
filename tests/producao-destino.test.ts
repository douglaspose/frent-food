import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { adicionarItem, enviarCarrinho } from "@/lib/carrinho";
import { dadosDaBarra } from "@/lib/barra";
import { CHAVE_DO_DESTINO, type DestinoDoPedido } from "@/lib/producao";
import { valorDoParametro } from "@/lib/parametros";
import { criarProduto, criarRestaurante, limpar } from "./fixtures";
import type { Sessao } from "@/lib/session";

/**
 * Por onde a cozinha e o bar recebem o pedido.
 *
 * Havia um caminho só, e ele fazia as duas coisas: o ticket aparecia no KDS
 * **e** o papel entrava na fila de impressão. Na casa que só olha a tela, a
 * fila enchia de papel que ninguém imprime; na casa que trabalha com comanda
 * pendurada na praça, sobrava um quadro que ninguém toca — e cada ticket
 * virava "atrasado" na barra vinte minutos depois, o dia inteiro.
 *
 * Agora a casa escolhe, e é o que estes testes prendem: o que sai no papel, o
 * que entra no quadro, e o que a barra conta.
 */

const SLUG = "teste-destino-pedido";

let tenantId: string;
let unidadeId: string;
let usuarioId: string;
let estacaoId: string;
let cardapioId: string;
let produtoId: string;
let cardapioItemId: string;
let preco: number;
let quem: { usuarioId: string; tenantId: string; unidadeId: string };

/** Põe o destino da unidade, como a tela de Ajustes faria. */
async function escolherDestino(destino: DestinoDoPedido) {
  await db.parametroUnidade.upsert({
    where: { unidadeId_chave: { unidadeId, chave: CHAVE_DO_DESTINO } },
    create: { tenantId, unidadeId, grupo: "KDS", chave: CHAVE_DO_DESTINO, valor: destino },
    update: { valor: destino },
  });
}

/** Uma rodada lançada e enviada para a praça. */
async function rodadaEnviada() {
  const comanda = await db.comanda.create({
    data: {
      tenantId,
      unidadeId,
      numero: Math.floor(Math.random() * 1_000_000),
      pessoas: 2,
      status: "ABERTA",
      abertaPorId: usuarioId,
    },
  });
  await adicionarItem(quem, { comandaId: comanda.id, cardapioItemId });
  await enviarCarrinho(quem, comanda.id);

  const pedidos = await db.pedido.findMany({ where: { comandaId: comanda.id } });
  const papeis = await db.filaImpressao.findMany({
    where: { tenantId, tipo: "COMANDA_PRODUCAO", referenciaId: { in: pedidos.map((p) => p.id) } },
  });
  return { comandaId: comanda.id, pedidos, papeis };
}

beforeAll(async () => {
  const r = await criarRestaurante(SLUG);
  tenantId = r.tenant.id;
  unidadeId = r.unidade.id;
  usuarioId = r.usuario.id;
  estacaoId = r.estacao.id;
  quem = { usuarioId, tenantId, unidadeId };

  const cardapio = await db.cardapio.create({
    data: { tenantId, unidadeId, nome: "Salão", canal: "SALAO", ativo: true },
  });
  cardapioId = cardapio.id;

  const produto = await criarProduto(tenantId, "Costela do teste");
  produtoId = produto.id;
  // Sem praça o item não vira pedido nenhum, e não é isso que se testa aqui.
  await db.produtoEstacao.create({ data: { produtoId, estacaoId } });

  preco = 40;
  const item = await db.cardapioItem.create({ data: { cardapioId, produtoId, preco } });
  cardapioItemId = item.id;
});

beforeEach(async () => {
  await db.filaImpressao.deleteMany({ where: { tenantId } });
  await db.pedidoItem.deleteMany({ where: { pedido: { tenantId } } });
  await db.pedido.deleteMany({ where: { tenantId } });
  await db.comanda.deleteMany({ where: { tenantId } });
});

afterAll(async () => {
  await limpar(SLUG);
  await db.$disconnect();
});

describe("quando a casa recebe só pela tela", () => {
  beforeEach(() => escolherDestino("TELA"));

  it("o ticket entra no fluxo do KDS e não sai papel de produção", async () => {
    const { pedidos, papeis } = await rodadaEnviada();

    expect({
      tickets: pedidos.length,
      status: pedidos[0]?.status,
      papeis: papeis.length,
    }).toEqual({ tickets: 1, status: "AGUARDANDO", papeis: 0 });
  });
});

describe("quando a casa recebe só pela impressora", () => {
  beforeEach(() => escolherDestino("PAPEL"));

  it("o papel sai e o ticket nasce fora da tela", async () => {
    const { pedidos, papeis } = await rodadaEnviada();

    expect({
      tickets: pedidos.length,
      status: pedidos[0]?.status,
      // A hora de início é agora: o papel já saiu para a praça.
      começou: pedidos[0]?.iniciadoEm !== null,
      papeis: papeis.length,
      titulo: papeis[0]?.titulo,
      // O papel vai endereçado à impressora da praça, quando ela tem uma.
      impressora: papeis[0]?.impressoraId ?? null,
    }).toEqual({
      tickets: 1,
      status: "NO_PAPEL",
      começou: true,
      papeis: 1,
      titulo: "COZINHA · pedido #1",
      impressora: null,
    });
  });

  /**
   * O ticket de papel fora do quadro e fora do alerta.
   *
   * É a razão de ele ter estado próprio: ninguém toca em "pronto" nesta casa,
   * e sem isso cada pedido viraria alarme na barra vinte minutos depois.
   */
  it("não entra no quadro do KDS nem na contagem de atrasados", async () => {
    await rodadaEnviada();

    const noQuadro = await db.pedido.count({
      where: {
        unidadeId,
        OR: [
          { status: { in: ["AGUARDANDO", "EM_PREPARO"] } },
          { status: "PRONTO", comanda: { status: { not: "PAGA" } } },
        ],
      },
    });
    const sessao: Sessao = {
      usuarioId,
      tenantId,
      unidadeId,
      nome: "Teste",
      cargo: "GERENTE",
      permissoes: ["*"],
    };
    const barra = await dadosDaBarra(sessao);

    expect({ noQuadro, alertas: barra.cozinhaAlertas, detalhe: barra.cozinhaDetalhe }).toEqual({
      noQuadro: 0,
      alertas: 0,
      detalhe: "Nada pendente na cozinha",
    });
  });

});

describe("quando a casa usa as duas", () => {
  beforeEach(() => escolherDestino("TELA_E_PAPEL"));

  /** É como o sistema sempre se comportou, e por isso é o padrão. */
  it("o ticket entra no quadro e o papel sai", async () => {
    const { pedidos, papeis } = await rodadaEnviada();

    expect({ status: pedidos[0]?.status, papeis: papeis.length }).toEqual({
      status: "AGUARDANDO",
      papeis: 1,
    });
  });

  it("é o que vale quando a unidade nunca escolheu", async () => {
    await db.parametroUnidade.deleteMany({ where: { unidadeId, chave: CHAVE_DO_DESTINO } });

    const { pedidos, papeis } = await rodadaEnviada();

    expect({ status: pedidos[0]?.status, papeis: papeis.length }).toEqual({
      status: "AGUARDANDO",
      papeis: 1,
    });
  });
});

describe("o valor guardado", () => {
  it("destino inventado cai no padrão em vez de deixar a praça sem receber", () => {
    expect(valorDoParametro(CHAVE_DO_DESTINO, "FAX")).toBe("TELA_E_PAPEL");
    expect(valorDoParametro(CHAVE_DO_DESTINO, "PAPEL")).toBe("PAPEL");
  });

  it("e um destino válido atravessa a gravação", async () => {
    await escolherDestino("PAPEL");
    const linha = await db.parametroUnidade.findUniqueOrThrow({
      where: { unidadeId_chave: { unidadeId, chave: CHAVE_DO_DESTINO } },
    });
    expect(valorDoParametro(CHAVE_DO_DESTINO, linha.valor)).toBe("PAPEL");
  });
});
