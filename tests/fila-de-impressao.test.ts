import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { GET as buscarFila, POST as confirmar } from "@/app/api/impressao/route";
import { criarRestaurante, limpar } from "./fixtures";

/**
 * A fila entrega cada papel a um agente só.
 *
 * Ela entregava a quem perguntasse: dois agentes buscando ao mesmo tempo
 * recebiam os mesmos trabalhos e a cozinha ganhava duas vias de cada comanda.
 * Era hipótese enquanto só o balcão imprimia, e deixou de ser quando a
 * maquininha virou agente — ela e o agente do balcão buscam na mesma fila, com
 * o mesmo token da unidade.
 */

const SLUG = "teste-fila";
const APARELHO = "token-do-agente-de-impressao-do-teste";

let tenantId: string;
let unidadeId: string;

/*
 * Os dois aparelhos **cadastrados** da casa.
 *
 * Os testes de reserva acima usam o token da unidade para os dois agentes, e
 * os separam só pelo apelido do `?agente=` — que é o que o agente diz ser, e
 * serve para a tela mostrar. A baixa não pode decidir por ele, então os testes
 * dela precisam de credenciais de verdade, uma por aparelho.
 */
const TOKEN_DO_BALCAO = "token-do-aparelho-do-balcao-do-teste";
const TOKEN_DO_BOLSO = "token-da-maquininha-do-bolso-do-teste";

let idDoBalcao: string;
let idDoBolso: string;

function busca(agente: string) {
  return new NextRequest(`http://localhost/api/impressao?agente=${agente}`, {
    headers: { authorization: `Bearer ${APARELHO}` },
  });
}

/** Busca com a credencial de um aparelho cadastrado. */
function buscaCom(token: string) {
  return new NextRequest("http://localhost/api/impressao", {
    headers: { authorization: `Bearer ${token}` },
  });
}

function avisoCom(token: string, id: string, ok: boolean, erro?: string) {
  return new NextRequest("http://localhost/api/impressao", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ id, ok, erro }),
  });
}

/** O que este aparelho levou. */
async function pegarCom(token: string) {
  const corpo = await (await buscarFila(buscaCom(token))).json();
  return (corpo.trabalhos ?? []).map((t: { id: string }) => t.id) as string[];
}

/** O status da confirmação, que é o que o agente lê. */
async function darBaixa(token: string, id: string, ok = true, erro?: string) {
  const resposta = await confirmar(avisoCom(token, id, ok, erro));
  return { status: resposta.status, corpo: await resposta.json() };
}

const statusDe = async (id: string) =>
  (await db.filaImpressao.findUniqueOrThrow({ where: { id } })).status;

function aviso(id: string, ok: boolean, erro?: string) {
  return new NextRequest("http://localhost/api/impressao", {
    method: "POST",
    headers: { authorization: `Bearer ${APARELHO}`, "content-type": "application/json" },
    body: JSON.stringify({ id, ok, erro }),
  });
}

/** Os títulos que o agente recebeu, que é o que a cozinha veria sair. */
async function pegar(agente: string) {
  const resposta = await buscarFila(busca(agente));
  const corpo = await resposta.json();
  return (corpo.trabalhos ?? []).map((t: { id: string }) => t.id) as string[];
}

async function enfileirar(quantos: number) {
  for (let i = 1; i <= quantos; i++) {
    await db.filaImpressao.create({
      data: {
        tenantId,
        unidadeId,
        tipo: "COMANDA_PRODUCAO",
        titulo: `Comanda ${i}`,
        conteudo: `papel ${i}`,
      },
    });
  }
}

beforeAll(async () => {
  const r = await criarRestaurante(SLUG);
  tenantId = r.tenant.id;
  unidadeId = r.unidade.id;
  await db.unidade.update({ where: { id: unidadeId }, data: { tokenImpressao: APARELHO } });

  const cadastrar = async (nome: string, tipo: "AGENTE_IMPRESSAO" | "MAQUININHA", token: string) =>
    (
      await db.aparelho.create({ data: { tenantId, unidadeId, nome, tipo, token } })
    ).id;
  idDoBalcao = await cadastrar("PC do balcão", "AGENTE_IMPRESSAO", TOKEN_DO_BALCAO);
  idDoBolso = await cadastrar("Maquininha do salão", "MAQUININHA", TOKEN_DO_BOLSO);
});

beforeEach(async () => {
  await db.filaImpressao.deleteMany({ where: { tenantId } });
});

afterAll(async () => {
  await limpar(SLUG);
  await db.$disconnect();
});

describe("quem busca leva", () => {
  it("dois agentes ao mesmo tempo nunca levam o mesmo papel", async () => {
    await enfileirar(6);

    // O balcão e a maquininha buscando no mesmo instante, que é o que acontece
    // a cada rodada enviada para a cozinha.
    const [doBalcao, daMaquininha] = await Promise.all([pegar("balcao"), pegar("maquininha")]);

    const repetidos = doBalcao.filter((id) => daMaquininha.includes(id));
    expect(repetidos).toEqual([]);
    // E nenhum papel se perdeu no caminho: os seis saíram, uma vez cada.
    expect(new Set([...doBalcao, ...daMaquininha]).size).toBe(6);
  });

  it("quem levou segura: a mesma busca não traz de novo", async () => {
    await enfileirar(2);

    expect(await pegar("balcao")).toHaveLength(2);
    // Nem para ele mesmo: o agente está imprimindo, e buscar de novo no meio
    // do lote é o que faria a segunda via sair.
    expect(await pegar("balcao")).toEqual([]);
    expect(await pegar("maquininha")).toEqual([]);
  });

  it("entrega vencida volta para a fila", async () => {
    await enfileirar(1);
    const levados = await pegar("balcao");

    // O agente que levou perdeu a rede, ou morreu no meio. Papel que não saiu
    // merece outra chance — e é o outro aparelho que vai dá-la.
    await db.$executeRaw`
      UPDATE fila_impressao SET "entregueEm" = now() - interval '5 minutes'
       WHERE "tenantId" = ${tenantId}`;

    expect(await pegar("maquininha")).toEqual(levados);
  });

  it("o agente diz que não saiu, e o papel volta na hora", async () => {
    await enfileirar(1);
    const [id] = await pegar("balcao");

    await confirmar(aviso(id, false, "impressora sem papel"));

    // Sem esperar os dois minutos da janela: a cozinha esperaria à toa por um
    // papel que já se sabe que não saiu.
    expect(await pegar("maquininha")).toEqual([id]);
    const trabalho = await db.filaImpressao.findUniqueOrThrow({ where: { id } });
    expect(trabalho.tentativas).toBe(1);
    expect(trabalho.erro).toBe("impressora sem papel");
  });

  it("papel confirmado não volta nunca", async () => {
    await enfileirar(1);
    const [id] = await pegar("balcao");

    await confirmar(aviso(id, true));

    await db.$executeRaw`
      UPDATE fila_impressao SET "entregueEm" = now() - interval '5 minutes'
       WHERE "tenantId" = ${tenantId}`;

    expect(await pegar("maquininha")).toEqual([]);
    expect((await db.filaImpressao.findUniqueOrThrow({ where: { id } })).status).toBe("IMPRESSO");
  });

  it("quem levou fica registrado", async () => {
    await enfileirar(1);
    const [id] = await pegar("maquininha-do-salao");

    // Não é o que garante a exclusão — quem garante é a marca de tempo —, mas
    // é o que a tela de impressão mostra para quem está procurando o papel.
    expect((await db.filaImpressao.findUniqueOrThrow({ where: { id } })).entregueA).toBe(
      "maquininha-do-salao"
    );
  });
});

/**
 * A maquininha imprime na própria bobina o que quer que a fila entregue a ela.
 * Enquanto a fila entregava tudo a todos, isso só gastava papel. Com a reserva,
 * quem leva é um só — e a comanda da cozinha passou a poder sair apenas no
 * bolso do garçom, deixando a praça sem o papel.
 */
describe("quem só tem a bobina da mão", () => {
  async function comDestino(nome: string) {
    const impressora = await db.impressora.create({
      data: {
        tenantId,
        unidadeId,
        nome,
        conexao: "rede",
        endereco: "192.168.0.70:9100",
      },
    });
    const trabalho = await db.filaImpressao.create({
      data: {
        tenantId,
        unidadeId,
        impressoraId: impressora.id,
        tipo: "COMANDA_PRODUCAO",
        titulo: "Comanda da cozinha",
        conteudo: "papel da praça",
      },
    });
    return trabalho.id;
  }

  /** Um papel sem destino dos que o garçom entrega em mãos. */
  async function papelDaMao(tipo: "CONFERENCIA" | "CUPOM", titulo: string) {
    const trabalho = await db.filaImpressao.create({
      data: { tenantId, unidadeId, tipo, titulo, conteudo: titulo },
    });
    return trabalho.id;
  }

  async function pegarEmbutida(agente: string) {
    const resposta = await buscarFila(
      new NextRequest(`http://localhost/api/impressao?agente=${agente}&embutida=1`, {
        headers: { authorization: `Bearer ${APARELHO}` },
      })
    );
    const corpo = await resposta.json();
    return (corpo.trabalhos ?? []).map((t: { id: string }) => t.id) as string[];
  }

  it("não leva o papel endereçado à impressora da cozinha", async () => {
    const daCozinha = await comDestino("Térmica da cozinha");

    // Sem isto, a comanda sai na mão do garçom e a praça fica sem ela.
    expect(await pegarEmbutida("maquininha")).toEqual([]);
    // E o agente do balcão, que fala com a térmica da cozinha, leva.
    expect(await pegar("balcao")).toEqual([daCozinha]);
  });

  it("leva o que não tem destino: a conferência e o cupom", async () => {
    // O papel da mão, pelo nome: antes este teste enfileirava uma comanda de
    // produção sem endereço como substituta, e a substituta era justamente o
    // caso em que "sem endereço" e "papel da mão" deixam de ser a mesma coisa.
    await papelDaMao("CONFERENCIA", "Conferência da mesa 4");
    await papelDaMao("CUPOM", "Cupom da mesa 4");

    // São os papéis que o garçom quer em mãos, e os únicos que a bobina dele
    // consegue entregar a quem deve recebê-los.
    expect(await pegarEmbutida("maquininha")).toHaveLength(2);
  });

  /**
   * A praça sem impressora própria.
   *
   * A casa comprou a térmica do bar e deixou a cozinha no agente do balcão: a
   * comanda da cozinha não tem impressora endereçada, e pela falta de endereço
   * voltava a caber no bolso do garçom. Com a reserva, o balcão deixava de
   * vê-la — a praça esperando um prato que ninguém mandou fazer, que é o que
   * esta regra veio impedir.
   */
  it("não leva a comanda da praça que não tem impressora própria", async () => {
    const doBar = await comDestino("Térmica do bar");
    const daCozinha = await db.filaImpressao.create({
      data: { tenantId, unidadeId, tipo: "COMANDA_PRODUCAO", titulo: "Cozinha", conteudo: "praça" },
    });

    expect(await pegarEmbutida("maquininha")).toEqual([]);
    // E o agente do balcão, que é quem imprime pela cozinha nesta casa, leva as
    // duas: a endereçada à térmica do bar e a que não tem destino nenhum.
    expect((await pegar("balcao")).sort()).toEqual([doBar, daCozinha.id].sort());
  });

  it("casa sem impressora cadastrada: ele continua levando tudo", async () => {
    // A casa é sem impressora de verdade: a térmica que os testes acima
    // cadastram sobrevive ao `beforeEach`, que só limpa a fila, e sem isto o
    // caso de contraste estaria sendo medido numa casa que tem impressora.
    await db.impressora.deleteMany({ where: { tenantId } });
    await enfileirar(3);

    // Nenhum trabalho tem destino, e a bobina da mão é o único destino que
    // existe ali: recusar a comanda da cozinha seria trocar "o papel saiu no
    // lugar errado" por "o papel não saiu".
    expect(await pegarEmbutida("maquininha")).toHaveLength(3);
  });
});

/**
 * A baixa é de quem levou o papel.
 *
 * A fila entrega cada trabalho a um agente só, mas a confirmação aceitava
 * qualquer token da unidade: o aparelho do bolso dava baixa no papel reservado
 * pelo balcão. Era inofensivo quando todos imprimiam a mesma fila — deixou de
 * ser quando a reserva passou a entregar listas diferentes de propósito, porque
 * dar baixa no papel do outro marca como impresso um papel que não saiu.
 */
describe("a baixa é de quem levou", () => {
  it("o aparelho do bolso não dá baixa no papel do balcão", async () => {
    await enfileirar(1);
    const [id] = await pegarCom(TOKEN_DO_BALCAO);

    const recusa = await darBaixa(TOKEN_DO_BOLSO, id!);

    expect(recusa.status).toBe(409);
    expect(recusa.corpo.erro).toContain("outro aparelho");
    // O papel continua esperando quem o levou: é ele que tem a bobina.
    expect(await statusDe(id!)).toBe("PENDENTE");
  });

  it("e o balcão dá", async () => {
    await enfileirar(1);
    const [id] = await pegarCom(TOKEN_DO_BALCAO);

    expect((await darBaixa(TOKEN_DO_BALCAO, id!)).status).toBe(200);
    expect(await statusDe(id!)).toBe("IMPRESSO");
  });

  it("reserva vencida troca de dono, e a baixa do primeiro não vale mais", async () => {
    await enfileirar(1);
    const [id] = await pegarCom(TOKEN_DO_BALCAO);

    // O balcão perdeu a rede no meio; passados os dois minutos, o papel volta
    // à fila e o bolso o leva — a segunda via é de propósito, papel que não
    // saiu merece outra chance.
    await db.$executeRaw`
      UPDATE fila_impressao SET "entregueEm" = now() - interval '5 minutes'
       WHERE "tenantId" = ${tenantId}`;
    expect(await pegarCom(TOKEN_DO_BOLSO)).toEqual([id]);

    // Agora o balcão volta e confirma o que imprimiu antes de cair. A reserva
    // é do bolso, e a baixa do papel é de quem está com ele.
    expect((await darBaixa(TOKEN_DO_BALCAO, id!)).status).toBe(409);
    expect(await statusDe(id!)).toBe("PENDENTE");

    expect((await darBaixa(TOKEN_DO_BOLSO, id!)).status).toBe(200);
    expect(await statusDe(id!)).toBe("IMPRESSO");
  });

  it("falha devolve a reserva sem dono, e o outro dá baixa no que imprimiu", async () => {
    await enfileirar(1);
    const [id] = await pegarCom(TOKEN_DO_BALCAO);

    // "Acabou o papel": a reserva é devolvida na hora, com o dono.
    expect((await darBaixa(TOKEN_DO_BALCAO, id!, false, "impressora sem papel")).status).toBe(200);
    expect(await db.filaImpressao.findUniqueOrThrow({ where: { id: id! } })).toMatchObject({
      status: "PENDENTE",
      entregueAoAparelhoId: null,
    });

    expect(await pegarCom(TOKEN_DO_BOLSO)).toEqual([id]);
    expect((await darBaixa(TOKEN_DO_BOLSO, id!)).status).toBe(200);
    expect(await statusDe(id!)).toBe("IMPRESSO");
  });

  it("a reserva guarda o aparelho, e não o apelido que o agente diz ter", async () => {
    await enfileirar(1);
    const [id] = await pegarCom(TOKEN_DO_BOLSO);

    const trabalho = await db.filaImpressao.findUniqueOrThrow({ where: { id: id! } });
    expect(trabalho.entregueAoAparelhoId).toBe(idDoBolso);
    expect(idDoBolso).not.toBe(idDoBalcao);
  });

  /**
   * O agente sem cadastro, que é o que está instalado nos restaurantes.
   *
   * Ele usa o token da unidade e não tem id: a reserva nasce sem dono, e a
   * baixa continua passando para qualquer um. É o que **não** dá para fechar —
   * dois agentes com a mesma credencial são a mesma credencial —, e cadastrar o
   * aparelho é o que fecha. O teste existe para que a regra nova não derrube
   * quem está imprimindo hoje.
   */
  it("o agente do token da unidade continua dando baixa no que levou", async () => {
    await enfileirar(1);
    const [id] = await pegar("balcao");

    expect(await db.filaImpressao.findUniqueOrThrow({ where: { id: id! } })).toMatchObject({
      entregueA: "balcao",
      entregueAoAparelhoId: null,
    });
    expect((await darBaixa(APARELHO, id!)).status).toBe(200);
    expect(await statusDe(id!)).toBe("IMPRESSO");
  });
});
