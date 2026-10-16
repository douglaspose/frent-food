import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { POST as entrar } from "@/app/api/maquininha/entrar/route";
import { GET as salao, POST as abrir } from "@/app/api/maquininha/mesas/route";
import { POST as pagar } from "@/app/api/maquininha/pagamentos/route";
import { POST as pedirConta } from "@/app/api/maquininha/comandas/[id]/conferencia/route";
import { POST as reabrir } from "@/app/api/maquininha/comandas/[id]/reabrir/route";
import { POST as atender } from "@/app/api/maquininha/comandas/[id]/atender/route";
import { POST as transferir } from "@/app/api/maquininha/comandas/[id]/transferir/route";
import { POST as cancelar } from "@/app/api/maquininha/itens/[id]/cancelar/route";
import { POST as autorizar } from "@/app/api/maquininha/autorizacoes/route";
import { criarProduto, criarRestaurante, limpar } from "./fixtures";

/**
 * Quem entra no aparelho, e o que cada um pode fazer depois de entrar.
 *
 * A porta do turno exigia `comanda.receberPagamento` — de quando a maquininha
 * só cobrava. O garçom, que tem `comanda.abrir` e `comanda.lancarItem` e não
 * recebe pagamento, batia numa porta que nunca abria, e toda a parte de salão
 * do aparelho ficava inalcançável justamente para quem ela foi feita.
 *
 * Abrir a porta para ele trouxe o risco oposto, e este arquivo existe por
 * causa dele: a rota de pagamento não conferia permissão nenhuma — confiava na
 * porta — e passou a aceitar o turno do garçom. Foi preciso um teste com o
 * aparelho na mão para descobrir, e é o que estes testes prendem.
 */

const SLUG = "teste-porta";
const APARELHO = "token-de-aparelho-do-teste-da-porta";

let tenantId: string;
let unidadeId: string;

/** Headers do aparelho; o do operador entra quando já houve turno. */
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
      nome: `${nome} do teste`,
      email: `${nome.toLowerCase()}@${SLUG}.com`,
      pinHash: await bcrypt.hash(pin, 10),
      unidades: { create: { unidadeId, cargoId: cargo.id } },
    },
  });
}

/** Faz o turno e devolve o token do operador, ou a recusa. */
async function entrarCom(pin: string) {
  const resposta = await entrar(pedido("/api/maquininha/entrar", { pin }));
  return { status: resposta.status, corpo: await resposta.json() };
}

beforeAll(async () => {
  const r = await criarRestaurante(SLUG);
  tenantId = r.tenant.id;
  unidadeId = r.unidade.id;
  await db.unidade.update({ where: { id: unidadeId }, data: { tokenImpressao: APARELHO } });

  await criarCargo(
    "GARCOM",
    ["comanda.abrir", "comanda.lancarItem", "comanda.imprimirParcial", "mesa.transferir"],
    "1111"
  );
  // Só recebe: é o cargo para quem a porta foi feita quando ela nasceu.
  await criarCargo("RECEBEDOR", ["comanda.receberPagamento"], "2222");
  // Nem recebe nem lança: a cozinha não opera a maquininha.
  await criarCargo("COZINHEIRO", ["kds.ver"], "3333");
  // Quem libera o cancelamento — e, por ter a permissão, cancela sem pedir
  // nada a ninguém.
  await criarCargo(
    "SUPERVISOR",
    ["comanda.abrir", "comanda.lancarItem", "comanda.cancelarItem"],
    "4444"
  );

  // Um salão inteiro: cada teste que abre mesa consome uma da lista.
  for (const numero of Array.from({ length: 40 }, (_, i) => String(i + 1))) {
    await db.mesa.create({
      data: { tenantId, unidadeId, numero, capacidade: 4, qrToken: `qr-${SLUG}-${numero}` },
    });
  }
});

afterAll(async () => {
  await limpar(SLUG);
  await db.$disconnect();
});

describe("a porta do turno", () => {
  it("o garçom entra, porque o aparelho também é do salão", async () => {
    const { status, corpo } = await entrarCom("1111");

    expect(status).toBe(200);
    expect(corpo.token).toBeTruthy();
    expect(corpo.cargo).toBe("GARCOM");
  });

  it("quem só recebe continua entrando", async () => {
    const { status, corpo } = await entrarCom("2222");

    expect(status).toBe(200);
    expect(corpo.token).toBeTruthy();
  });

  it("quem não recebe nem lança fica de fora", async () => {
    const { status, corpo } = await entrarCom("3333");

    expect(status).toBe(403);
    expect(corpo.erro).toContain("não recebe pagamento nem lança pedido");
  });
});

describe("depois de entrar, cada porta confere a sua permissão", () => {
  it("o garçom abre mesa e vê as livres", async () => {
    const { corpo: turno } = await entrarCom("1111");

    const salaoDele = await (await salao(pedido("/api/maquininha/mesas", undefined, turno.token))).json();
    expect(salaoDele.podeAbrir).toBe(true);
    expect(salaoDele.podeReceber).toBe(false);
    expect(salaoDele.livres.length).toBeGreaterThan(0);

    const resposta = await abrir(
      pedido("/api/maquininha/mesas", { mesaId: salaoDele.livres[0].mesaId, pessoas: 2 }, turno.token)
    );
    expect(resposta.status).toBe(200);
    expect((await resposta.json()).comandaId).toBeTruthy();
  });

  it("o garçom não recebe pagamento", async () => {
    const { corpo: turno } = await entrarCom("1111");

    /*
     * Sem comanda nenhuma no corpo de propósito: a recusa tem de vir antes de
     * qualquer leitura do pedido. Foi assim que o furo apareceu — a rota lia o
     * corpo, achava a conta e registrava o pagamento sem nunca olhar para a
     * permissão de quem estava no turno.
     */
    const resposta = await pagar(pedido("/api/maquininha/pagamentos", {}, turno.token));

    expect(resposta.status).toBe(403);
    expect((await resposta.json()).erro).toContain("não permite receber pagamento");
  });

  it("quem só recebe não abre mesa, e nem recebe a lista de livres", async () => {
    const { corpo: turno } = await entrarCom("2222");

    const salaoDele = await (await salao(pedido("/api/maquininha/mesas", undefined, turno.token))).json();
    expect(salaoDele.podeAbrir).toBe(false);
    expect(salaoDele.podeReceber).toBe(true);
    expect(salaoDele.livres).toEqual([]);

    const resposta = await abrir(
      pedido("/api/maquininha/mesas", { mesaId: "qualquer-um", pessoas: 2 }, turno.token)
    );
    expect(resposta.status).toBe(403);
  });

  it("quem só recebe passa da porta do pagamento", async () => {
    const { corpo: turno } = await entrarCom("2222");

    // O corpo vazio é recusado pela validação, e não pela permissão: é a
    // diferença entre "você não pode" e "faltou dizer qual conta".
    const resposta = await pagar(pedido("/api/maquininha/pagamentos", {}, turno.token));

    expect(resposta.status).not.toBe(403);
    expect((await resposta.json()).erro).toContain("Informe a comanda");
  });
});

describe("pedir a conta pelo aparelho", () => {
  /** Abre uma mesa livre e devolve a conta dela. */
  async function contaAberta(turno: string) {
    const salaoDele = await (
      await salao(pedido("/api/maquininha/mesas", undefined, turno))
    ).json();
    const livre = salaoDele.livres[0];
    const aberta = await (
      await abrir(pedido("/api/maquininha/mesas", { mesaId: livre.mesaId, pessoas: 2 }, turno))
    ).json();
    return { comandaId: aberta.comandaId as string, contexto: { params: Promise.resolve({ id: aberta.comandaId as string }) } };
  }

  it("o garçom pede a conta e reabre, que é o par que o salão exige", async () => {
    const { corpo: turno } = await entrarCom("1111");
    const { comandaId } = await contaAberta(turno.token);
    const contexto = () => ({ params: Promise.resolve({ id: comandaId }) });

    const pedida = await pedirConta(
      pedido(`/api/maquininha/comandas/${comandaId}/conferencia`, {}, turno.token),
      contexto()
    );
    expect(pedida.status).toBe(200);
    expect((await db.comanda.findUniqueOrThrow({ where: { id: comandaId } })).status).toBe(
      "FECHANDO"
    );

    /*
     * Reabrir vem junto de propósito: em fechamento a comanda não recebe item,
     * e "traz mais uma cerveja" depois de pedir a conta é rotina. Sem esta
     * porta, o garçom ficaria parado na mesa com o aparelho que acabou de
     * travar a própria mesa.
     */
    const reaberta = await reabrir(
      pedido(`/api/maquininha/comandas/${comandaId}/reabrir`, {}, turno.token),
      contexto()
    );
    expect(reaberta.status).toBe(200);
    expect((await db.comanda.findUniqueOrThrow({ where: { id: comandaId } })).status).toBe(
      "ABERTA"
    );
  });

  it("quem só recebe também pede a conta — é a folha que ele vai cobrar", async () => {
    const { corpo: doGarcom } = await entrarCom("1111");
    const { comandaId } = await contaAberta(doGarcom.token);
    const { corpo: turno } = await entrarCom("2222");

    const salaoDele = await (
      await salao(pedido("/api/maquininha/mesas", undefined, turno.token))
    ).json();
    expect(salaoDele.podePedirConta).toBe(true);

    const resposta = await pedirConta(
      pedido(`/api/maquininha/comandas/${comandaId}/conferencia`, {}, turno.token),
      { params: Promise.resolve({ id: comandaId }) }
    );
    expect(resposta.status).toBe(200);
  });

  it("quem só recebe não reabre: reabrir é para lançar", async () => {
    const { corpo: doGarcom } = await entrarCom("1111");
    const { comandaId } = await contaAberta(doGarcom.token);
    const { corpo: turno } = await entrarCom("2222");

    const resposta = await reabrir(
      pedido(`/api/maquininha/comandas/${comandaId}/reabrir`, {}, turno.token),
      { params: Promise.resolve({ id: comandaId }) }
    );
    expect(resposta.status).toBe(403);
  });
});

/**
 * O cliente levanta a mão pelo QR da mesa e o selo acende no mapa do salão.
 * Quem vai até a mesa é quem está com o aparelho no bolso — e era o tablet do
 * balcão que tinha de apagar o selo.
 */
describe("o chamado da mesa", () => {
  async function abrirMesa(turno: string) {
    const salaoDele = await (
      await salao(pedido("/api/maquininha/mesas", undefined, turno))
    ).json();
    const aberta = await (
      await abrir(
        pedido("/api/maquininha/mesas", { mesaId: salaoDele.livres[0].mesaId, pessoas: 2 }, turno)
      )
    ).json();
    return aberta.comandaId as string;
  }

  it("a mesa que chamou vem na frente, e diz desde quando", async () => {
    const { corpo: turno } = await entrarCom("1111");
    const primeira = await abrirMesa(turno.token);
    const chamando = await abrirMesa(turno.token);

    // Dez minutos de mão levantada: é o que a tela conta até agora.
    const desde = new Date(Date.now() - 10 * 60_000);
    await db.comanda.update({
      where: { id: chamando },
      data: { chamadoGarcomEm: desde },
    });

    const salaoDele = await (
      await salao(pedido("/api/maquininha/mesas", undefined, turno.token))
    ).json();

    /*
     * Na frente da mais antiga, que é a ordem normal da lista: a espera de
     * quem levantou a mão não é a mesma coisa que a de quem está comendo.
     */
    expect(salaoDele.mesas[0].comandaId).toBe(chamando);
    expect(new Date(salaoDele.mesas[0].chamadoEm).getTime()).toBe(desde.getTime());
    expect(salaoDele.mesas.find((m: { comandaId: string }) => m.comandaId === primeira).chamadoEm).toBe(
      null
    );
  });

  it("atender apaga o selo, e atender de novo não é erro", async () => {
    const { corpo: turno } = await entrarCom("1111");
    const comandaId = await abrirMesa(turno.token);
    await db.comanda.update({
      where: { id: comandaId },
      data: { chamadoGarcomEm: new Date() },
    });
    const contexto = () => ({ params: Promise.resolve({ id: comandaId }) });

    const primeira = await atender(
      pedido(`/api/maquininha/comandas/${comandaId}/atender`, {}, turno.token),
      contexto()
    );
    expect(primeira.status).toBe(200);
    expect((await primeira.json()).atendido).toBe(true);
    expect(
      (await db.comanda.findUniqueOrThrow({ where: { id: comandaId } })).chamadoGarcomEm
    ).toBeNull();

    // Dois garçons indo à mesma mesa: o segundo não precisa de uma mensagem
    // vermelha para descobrir que alguém chegou antes.
    const segunda = await atender(
      pedido(`/api/maquininha/comandas/${comandaId}/atender`, {}, turno.token),
      contexto()
    );
    expect(segunda.status).toBe(200);
    expect((await segunda.json()).atendido).toBe(false);
  });
});

describe("transferir pelo aparelho", () => {
  async function abrirMesa(turno: string) {
    const salaoDele = await (
      await salao(pedido("/api/maquininha/mesas", undefined, turno))
    ).json();
    const livre = salaoDele.livres[0];
    const aberta = await (
      await abrir(pedido("/api/maquininha/mesas", { mesaId: livre.mesaId, pessoas: 2 }, turno))
    ).json();
    return { comandaId: aberta.comandaId as string, mesaId: livre.mesaId as string };
  }

  it("o garçom muda a conta de mesa pela lista de livres do salão", async () => {
    const { corpo: turno } = await entrarCom("1111");
    const { comandaId, mesaId } = await abrirMesa(turno.token);

    const salaoDele = await (
      await salao(pedido("/api/maquininha/mesas", undefined, turno.token))
    ).json();
    expect(salaoDele.podeTransferir).toBe(true);
    // A mesa onde a conta está não aparece: ela tem comanda aberta.
    expect(salaoDele.livres.map((m: { mesaId: string }) => m.mesaId)).not.toContain(mesaId);

    const destino = salaoDele.livres[0];
    const resposta = await transferir(
      pedido(
        `/api/maquininha/comandas/${comandaId}/transferir`,
        { mesaDestinoId: destino.mesaId },
        turno.token
      ),
      { params: Promise.resolve({ id: comandaId }) }
    );

    expect(resposta.status).toBe(200);
    expect((await resposta.json()).mesa).toBe(destino.numero);
    const depois = await db.comanda.findUniqueOrThrow({ where: { id: comandaId } });
    expect(depois.mesaId).toBe(destino.mesaId);
  });

  it("mesa ocupada volta a frase que o garçom precisa ler", async () => {
    const { corpo: turno } = await entrarCom("1111");
    const daqui = await abrirMesa(turno.token);
    const dali = await abrirMesa(turno.token);

    const resposta = await transferir(
      pedido(
        `/api/maquininha/comandas/${daqui.comandaId}/transferir`,
        { mesaDestinoId: dali.mesaId },
        turno.token
      ),
      { params: Promise.resolve({ id: daqui.comandaId }) }
    );

    expect(resposta.status).toBe(409);
    expect((await resposta.json()).erro).toContain("já tem a comanda");
  });

  it("quem só recebe pagamento não transfere", async () => {
    const { corpo: doGarcom } = await entrarCom("1111");
    const { comandaId } = await abrirMesa(doGarcom.token);
    const { corpo: turno } = await entrarCom("2222");

    const salaoDele = await (
      await salao(pedido("/api/maquininha/mesas", undefined, turno.token))
    ).json();
    expect(salaoDele.podeTransferir).toBe(false);

    const resposta = await transferir(
      pedido(
        `/api/maquininha/comandas/${comandaId}/transferir`,
        { mesaDestinoId: "qualquer-uma" },
        turno.token
      ),
      { params: Promise.resolve({ id: comandaId }) }
    );
    expect(resposta.status).toBe(403);
  });
});

/**
 * Cancelar é o caminho clássico de furo de caixa — lançar, entregar e
 * cancelar —, e é também o que o garçom mais precisa fazer de pé na mesa. Por
 * isso a porta do aparelho não recusa quem não pode: ela manda pedir o PIN de
 * quem pode, e o diário guarda os dois nomes.
 */
describe("cancelar item pelo aparelho", () => {
  /** Uma conta com um prato já enviado para a cozinha. */
  async function itemEnviado(turno: string) {
    const salaoDele = await (
      await salao(pedido("/api/maquininha/mesas", undefined, turno))
    ).json();
    const aberta = await (
      await abrir(
        pedido("/api/maquininha/mesas", { mesaId: salaoDele.livres[0].mesaId, pessoas: 2 }, turno)
      )
    ).json();

    const produto = await criarProduto(tenantId, `Prato ${Math.random()}`);
    const item = await db.comandaItem.create({
      data: {
        tenantId,
        comandaId: aberta.comandaId,
        produtoId: produto.id,
        quantidade: 1,
        precoUnitario: 50,
        precoTotal: 50,
        status: "ENVIADO",
        lancadoPorId: (await db.usuario.findFirstOrThrow({ where: { tenantId } })).id,
      },
    });
    return { comandaId: aberta.comandaId as string, itemId: item.id };
  }

  const contexto = (id: string) => ({ params: Promise.resolve({ id }) });

  it("o garçom é mandado pedir o PIN, e não recusado", async () => {
    const { corpo: turno } = await entrarCom("1111");
    const { itemId } = await itemEnviado(turno.token);

    const resposta = await cancelar(
      pedido(`/api/maquininha/itens/${itemId}/cancelar`, { motivo: "cliente desistiu" }, turno.token),
      contexto(itemId)
    );

    expect(resposta.status).toBe(403);
    // A tela precisa distinguir isto de "não dá para cancelar".
    expect((await resposta.json()).precisaAutorizacao).toBe("CANCELAMENTO_ITEM");
    expect((await db.comandaItem.findUniqueOrThrow({ where: { id: itemId } })).status).toBe(
      "ENVIADO"
    );
  });

  it("com o PIN do gerente, cancela — e o diário guarda os dois nomes", async () => {
    const { corpo: turno } = await entrarCom("1111");
    const { itemId } = await itemEnviado(turno.token);

    const liberacao = await (
      await autorizar(
        pedido(
          "/api/maquininha/autorizacoes",
          { tipo: "CANCELAMENTO_ITEM", referenciaId: itemId, pin: "4444" },
          turno.token
        )
      )
    ).json();
    expect(liberacao.ok).toBe(true);
    expect(liberacao.aprovador).toContain("SUPERVISOR");

    const resposta = await cancelar(
      pedido(
        `/api/maquininha/itens/${itemId}/cancelar`,
        { motivo: "saiu errado da cozinha", autorizacaoId: liberacao.autorizacaoId },
        turno.token
      ),
      contexto(itemId)
    );

    expect(resposta.status).toBe(200);
    const item = await db.comandaItem.findUniqueOrThrow({ where: { id: itemId } });
    expect(item.status).toBe("CANCELADO");
    expect(item.motivoCancelamento).toBe("saiu errado da cozinha");

    const registro = await db.auditLog.findFirstOrThrow({
      where: { tenantId, entidadeId: itemId, acao: "ITEM_CANCELADO" },
    });
    // Quem fez e quem liberou: é o par que torna o cancelamento auditável.
    expect(JSON.stringify(registro.depois)).toContain("autorizadoPor");
  });

  it("a liberação é presa ao item: não cancela o prato do lado", async () => {
    const { corpo: turno } = await entrarCom("1111");
    const pedida = await itemEnviado(turno.token);
    const outra = await itemEnviado(turno.token);

    const liberacao = await (
      await autorizar(
        pedido(
          "/api/maquininha/autorizacoes",
          { tipo: "CANCELAMENTO_ITEM", referenciaId: pedida.itemId, pin: "4444" },
          turno.token
        )
      )
    ).json();

    /*
     * Sem gastar a liberação antes, de propósito: usada, ela seria recusada
     * por já ter sido usada, e o teste passaria mesmo se o alvo deixasse de
     * ser conferido. Aqui o que a recusa é o item ser outro.
     */
    const noPratoDoLado = await cancelar(
      pedido(
        `/api/maquininha/itens/${outra.itemId}/cancelar`,
        { motivo: "o do lado", autorizacaoId: liberacao.autorizacaoId },
        turno.token
      ),
      contexto(outra.itemId)
    );

    expect(noPratoDoLado.status).toBe(403);
    expect((await db.comandaItem.findUniqueOrThrow({ where: { id: outra.itemId } })).status).toBe(
      "ENVIADO"
    );

    // E continua valendo para o item que o gerente liberou.
    const noItemCerto = await cancelar(
      pedido(
        `/api/maquininha/itens/${pedida.itemId}/cancelar`,
        { motivo: "cliente desistiu", autorizacaoId: liberacao.autorizacaoId },
        turno.token
      ),
      contexto(pedida.itemId)
    );
    expect(noItemCerto.status).toBe(200);
  });

  it("PIN errado volta 200 com a recusa, e não derruba o turno", async () => {
    const { corpo: turno } = await entrarCom("1111");
    const { itemId } = await itemEnviado(turno.token);

    const resposta = await autorizar(
      pedido(
        "/api/maquininha/autorizacoes",
        { tipo: "CANCELAMENTO_ITEM", referenciaId: itemId, pin: "9999" },
        turno.token
      )
    );

    /*
     * 401 aqui mandaria o garçom redigitar o PIN do próprio turno no meio de
     * um cancelamento — o 401 do aparelho quer dizer "o turno venceu".
     */
    expect(resposta.status).toBe(200);
    const corpo = await resposta.json();
    expect(corpo.ok).toBe(false);
    expect(corpo.motivo).toContain("PIN não confere");
  });

  it("sem motivo, não cancela", async () => {
    const { corpo: turno } = await entrarCom("4444");
    const { itemId } = await itemEnviado(turno.token);

    const resposta = await cancelar(
      pedido(`/api/maquininha/itens/${itemId}/cancelar`, { motivo: "   " }, turno.token),
      contexto(itemId)
    );

    // "Cancelado" sem explicação não responde nada a quem for conferir depois.
    expect(resposta.status).toBe(409);
    expect((await resposta.json()).erro).toContain("motivo");
  });

  it("quem pode cancelar não precisa de PIN nenhum", async () => {
    const { corpo: turno } = await entrarCom("4444");
    const { itemId } = await itemEnviado(turno.token);

    const resposta = await cancelar(
      pedido(`/api/maquininha/itens/${itemId}/cancelar`, { motivo: "cozinha sem o item" }, turno.token),
      contexto(itemId)
    );

    expect(resposta.status).toBe(200);
    expect((await db.comandaItem.findUniqueOrThrow({ where: { id: itemId } })).status).toBe(
      "CANCELADO"
    );
  });
});
