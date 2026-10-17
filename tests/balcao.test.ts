import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { POST as entrar } from "@/app/api/maquininha/entrar/route";
import { GET as salao } from "@/app/api/maquininha/mesas/route";
import { POST as pagar } from "@/app/api/maquininha/pagamentos/route";
import { CODIGO_DO_BALCAO } from "@/lib/balcao";
import { resumoDosPeriodos } from "@/lib/painel";
import { criarRestaurante, limpar } from "./fixtures";

/**
 * A venda de balcão: o cliente em pé que não abriu conta.
 *
 * O aparelho sempre teve o botão, e a credenciadora sempre aprovou — mas o
 * resultado não ia a lugar nenhum. O aplicativo não mandava (não havia comanda
 * para citar) e esta rota recusaria ("Informe a comanda"). O dinheiro saía do
 * cartão do cliente e a casa fechava o caixa com um extrato da adquirente que
 * nenhuma venda explicava.
 *
 * O que estes testes prendem é que a venda existe no sistema como qualquer
 * outra — soma no faturamento, entra no caixa, congela a taxa da forma — e que
 * o reenvio da fila da maquininha não a duplica.
 */

const SLUG = "teste-balcao";
const APARELHO = "token-de-aparelho-do-teste-do-balcao";

let tenantId: string;
let unidadeId: string;
let formaId: string;
let donoId: string;

function pedido(caminho: string, corpo?: unknown, operador?: string) {
  return new NextRequest(`http://localhost${caminho}`, {
    method: corpo === undefined ? "GET" : "POST",
    headers: {
      authorization: `Bearer ${APARELHO}`,
      "content-type": "application/json",
      ...(operador ? { "x-operador": operador } : {}),
    },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
}

async function criarCargo(nome: string, chaves: string[], pin: string) {
  const cargo = await db.cargo.create({
    data: { tenantId, nome, permissoes: { create: chaves.map((chave) => ({ chave })) } },
  });
  await db.usuario.create({
    data: {
      tenantId,
      nome: `${nome} do balcão`,
      email: `${nome.toLowerCase()}@${SLUG}.com`,
      pinHash: await bcrypt.hash(pin, 10),
      unidades: { create: { unidadeId, cargoId: cargo.id } },
    },
  });
}

async function turnoDe(pin: string): Promise<string> {
  const resposta = await entrar(pedido("/api/maquininha/entrar", { pin }));
  const corpo = await resposta.json();
  return corpo.token as string;
}

async function abrirOCaixa() {
  await db.caixa.create({
    data: {
      tenantId,
      unidadeId,
      data: new Date(),
      tipo: "GERAL",
      turno: "NOITE",
      status: "ABERTO",
      fundoCaixa: 100,
      abertoPorId: donoId,
    },
  });
}

/** Uma venda avulsa como a maquininha a manda: sem comanda nenhuma. */
function vendaAvulsa(referencia: string, valorEmCentavos: number) {
  return {
    referencia,
    forma: "CREDITO",
    valorEmCentavos,
    nsu: "SIM-" + referencia,
    bandeira: "VISA",
    finalizar: true,
  };
}

beforeAll(async () => {
  const r = await criarRestaurante(SLUG);
  tenantId = r.tenant.id;
  unidadeId = r.unidade.id;
  donoId = r.usuario.id;
  await db.unidade.update({ where: { id: unidadeId }, data: { tokenImpressao: APARELHO } });

  const forma = await db.formaPagamento.create({
    data: { tenantId, nome: "Cartão de Crédito", tipo: "CREDITO", taxaPct: 3.2 },
  });
  formaId = forma.id;

  await criarCargo("CAIXA", ["comanda.receberPagamento", "comanda.fechar"], "1111");
  // Recebe mas não fecha mesa: o cargo que deixaria a venda de balcão aberta.
  await criarCargo("RECEBEDOR", ["comanda.receberPagamento"], "2222");
});

beforeEach(async () => {
  await db.pagamento.deleteMany({ where: { tenantId } });
  await db.comanda.deleteMany({ where: { tenantId } });
  await db.caixa.deleteMany({ where: { tenantId } });
  await abrirOCaixa();
});

afterAll(async () => {
  await limpar(SLUG);
  await db.$disconnect();
});

describe("a venda sem mesa", () => {
  it("vira comanda de balcão paga, com o pagamento dentro", async () => {
    const turno = await turnoDe("1111");

    const resposta = await pagar(
      pedido("/api/maquininha/pagamentos", vendaAvulsa("venda-1", 1_500), turno)
    );
    const corpo = await resposta.json();

    expect(resposta.status).toBe(200);
    expect(corpo.deBalcao).toBe(true);
    expect(corpo.quitada).toBe(true);
    expect(corpo.finalizada).toBe(true);

    const comandas = await db.comanda.findMany({
      where: { tenantId },
      include: { itens: true, pagamentos: true },
    });
    expect(comandas).toHaveLength(1);
    const [comanda] = comandas;
    expect(comanda.origem).toBe("BALCAO");
    expect(comanda.status).toBe("PAGA");
    expect(comanda.mesaId).toBeNull();
    expect(comanda.fechadaEm).not.toBeNull();
    // Sem taxa de serviço: ninguém serviu mesa nenhuma.
    expect(Number(comanda.taxaServicoPct)).toBe(0);

    // A linha que faz a conta fechar: item igual ao pago.
    expect(comanda.itens).toHaveLength(1);
    expect(Number(comanda.itens[0].precoTotal)).toBe(15);
    expect(comanda.itens[0].status).toBe("ENTREGUE");

    expect(comanda.pagamentos).toHaveLength(1);
    const [pagamento] = comanda.pagamentos;
    expect(Number(pagamento.valor)).toBe(15);
    expect(pagamento.formaPagamentoId).toBe(formaId);
    expect(pagamento.nsu).toBe("SIM-venda-1");
    // A taxa da adquirente fica congelada na venda, como em qualquer outra.
    expect(Number(pagamento.taxaPct)).toBe(3.2);
    expect(Number(pagamento.taxaValor)).toBe(0.48);
    // E o caixa aberto recebe a venda: é dele que sai a conferência da noite.
    expect(pagamento.caixaId).not.toBeNull();
  });

  /**
   * O caso que a fila da maquininha produz toda noite de rede ruim: o
   * resultado sai duas vezes porque a primeira resposta se perdeu. Duas vendas
   * de balcão seriam o dobro do faturamento com o cliente tendo pago uma vez.
   */
  it("o reenvio da fila não vira uma segunda venda", async () => {
    const turno = await turnoDe("1111");

    const primeira = await pagar(
      pedido("/api/maquininha/pagamentos", vendaAvulsa("venda-2", 2_000), turno)
    );
    const segunda = await pagar(
      pedido("/api/maquininha/pagamentos", vendaAvulsa("venda-2", 2_000), turno)
    );

    expect(primeira.status).toBe(200);
    expect(segunda.status).toBe(200);
    expect((await primeira.json()).jaRegistrado).toBe(false);
    expect((await segunda.json()).jaRegistrado).toBe(true);

    expect(await db.comanda.count({ where: { tenantId } })).toBe(1);
    expect(await db.pagamento.count({ where: { tenantId } })).toBe(1);
  });

  it("soma no faturamento do dia, como qualquer venda", async () => {
    const turno = await turnoDe("1111");
    await pagar(pedido("/api/maquininha/pagamentos", vendaAvulsa("venda-3", 4_990), turno));

    const agora = new Date();
    const resumo = await resumoDosPeriodos(unidadeId, {
      atual: { inicio: new Date(agora.getTime() - 60 * 60 * 1000), fim: new Date(agora.getTime() + 60 * 1000) },
      anterior: { inicio: new Date(agora.getTime() - 120 * 60 * 1000), fim: new Date(agora.getTime() - 60 * 60 * 1000) },
    });

    expect(resumo.atual.faturamento).toBe(49.9);
    expect(resumo.atual.comandas).toBe(1);
  });

  /**
   * Fechar a conta de uma mesa é decidir que o cliente terminou, e por isso é
   * permissão de quem decide. A venda de balcão nasce terminada — o cliente
   * pagou e foi embora —, e deixá-la aberta poria no mapa do salão uma comanda
   * sem mesa, tudo pago, esperando alguém entender o que é aquilo.
   */
  it("quem não fecha mesa ainda assim não deixa a venda de balcão aberta", async () => {
    const turno = await turnoDe("2222");

    const resposta = await pagar(
      pedido("/api/maquininha/pagamentos", vendaAvulsa("venda-4", 900), turno)
    );
    expect(resposta.status).toBe(200);
    expect((await resposta.json()).finalizada).toBe(true);

    const comanda = await db.comanda.findFirstOrThrow({ where: { tenantId } });
    expect(comanda.status).toBe("PAGA");

    // E o salão do aparelho continua vazio: nada de comanda sem mesa na lista.
    const lista = await (await salao(pedido("/api/maquininha/mesas", undefined, turno))).json();
    expect(lista.mesas).toHaveLength(0);
  });

  /**
   * O caixa fechado é o engano de uma casa por noite: ninguém abriu o turno no
   * sistema e o movimento começou. A venda fica pela metade de propósito — a
   * comanda de balcão existe, com valor, sem pagamento — porque o cartão já foi
   * debitado e o que não pode é o dinheiro sumir. Aberto o caixa, o reenvio da
   * fila completa a mesma venda, em vez de criar outra.
   */
  it("sem caixa aberto a venda espera, e o reenvio a completa depois", async () => {
    const turno = await turnoDe("1111");
    await db.caixa.deleteMany({ where: { tenantId } });

    const recusada = await pagar(
      pedido("/api/maquininha/pagamentos", vendaAvulsa("venda-5", 3_000), turno)
    );
    expect(recusada.status).toBe(409);
    expect((await recusada.json()).erro).toContain("caixa");

    const esperando = await db.comanda.findFirstOrThrow({
      where: { tenantId },
      include: { itens: true, pagamentos: true },
    });
    expect(esperando.status).toBe("ABERTA");
    expect(esperando.pagamentos).toHaveLength(0);
    expect(Number(esperando.itens[0].precoTotal)).toBe(30);

    await abrirOCaixa();
    const aceita = await pagar(
      pedido("/api/maquininha/pagamentos", vendaAvulsa("venda-5", 3_000), turno)
    );

    expect(aceita.status).toBe(200);
    expect(await db.comanda.count({ where: { tenantId } })).toBe(1);
    const paga = await db.comanda.findFirstOrThrow({
      where: { tenantId },
      include: { pagamentos: true },
    });
    expect(paga.status).toBe("PAGA");
    expect(paga.pagamentos).toHaveLength(1);
  });
});

describe("o produto interno do balcão", () => {
  it("é criado uma vez e fica fora do cardápio", async () => {
    const turno = await turnoDe("1111");
    await pagar(pedido("/api/maquininha/pagamentos", vendaAvulsa("venda-6", 1_000), turno));
    await pagar(pedido("/api/maquininha/pagamentos", vendaAvulsa("venda-7", 2_000), turno));

    const produtos = await db.produto.findMany({
      where: { tenantId, codigo: CODIGO_DO_BALCAO },
      include: { cardapioItens: true },
    });

    expect(produtos).toHaveLength(1);
    // Fora de qualquer cardápio: ele não é para escolher, é para registrar.
    expect(produtos[0].cardapioItens).toHaveLength(0);
    expect(produtos[0].controlaEstoque).toBe(false);

    expect(await db.comanda.count({ where: { tenantId, origem: "BALCAO" } })).toBe(2);
  });
});
