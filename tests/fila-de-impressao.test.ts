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

function busca(agente: string) {
  return new NextRequest(`http://localhost/api/impressao?agente=${agente}`, {
    headers: { authorization: `Bearer ${APARELHO}` },
  });
}

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
