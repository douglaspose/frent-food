import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { POST as entrar } from "@/app/api/maquininha/entrar/route";
import { GET as salao, POST as abrir } from "@/app/api/maquininha/mesas/route";
import { POST as pagar } from "@/app/api/maquininha/pagamentos/route";
import { POST as pedirConta } from "@/app/api/maquininha/comandas/[id]/conferencia/route";
import { POST as reabrir } from "@/app/api/maquininha/comandas/[id]/reabrir/route";
import { criarRestaurante, limpar } from "./fixtures";

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

  for (const numero of ["1", "2", "3", "4", "5", "6"]) {
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
