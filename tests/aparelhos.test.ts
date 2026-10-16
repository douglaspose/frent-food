import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { reconhecerPeloToken, registrarContato, sortearToken } from "@/lib/aparelhos";
import { GET as buscarFila } from "@/app/api/impressao/route";
import { criarRestaurante, limpar } from "./fixtures";

/**
 * Cada aparelho com a sua credencial.
 *
 * Era uma só, a da unidade, e todos usavam a mesma: a maquininha do garçom, a
 * do caixa e o agente de impressão do balcão. Cortar a que sumiu significava
 * regerar esse token e derrubar todas as outras no meio do turno — o que, na
 * prática, quer dizer que ninguém cortava.
 */

const SLUG = "teste-aparelhos";
const TOKEN_DA_UNIDADE = "token-da-unidade-do-teste-de-aparelhos";

let tenantId: string;
let unidadeId: string;

async function cadastrar(nome: string, token = sortearToken()) {
  return db.aparelho.create({
    data: { tenantId, unidadeId, nome, token, tipo: "MAQUININHA" },
  });
}

function buscaDaFila(token: string, agente?: string) {
  const url = agente
    ? `http://localhost/api/impressao?agente=${agente}`
    : "http://localhost/api/impressao";
  return new NextRequest(url, { headers: { authorization: `Bearer ${token}` } });
}

beforeAll(async () => {
  const r = await criarRestaurante(SLUG);
  tenantId = r.tenant.id;
  unidadeId = r.unidade.id;
  await db.unidade.update({
    where: { id: unidadeId },
    data: { tokenImpressao: TOKEN_DA_UNIDADE },
  });
});

beforeEach(async () => {
  await db.aparelho.deleteMany({ where: { tenantId } });
});

afterAll(async () => {
  await limpar(SLUG);
  await db.$disconnect();
});

describe("quem está chamando", () => {
  it("o aparelho cadastrado é reconhecido, e diz qual é", async () => {
    const aparelho = await cadastrar("Maquininha do salão");

    const quem = await reconhecerPeloToken(aparelho.token);

    expect(quem?.unidade.id).toBe(unidadeId);
    expect(quem?.aparelho?.nome).toBe("Maquininha do salão");
  });

  it("o token da unidade continua valendo, sem aparelho nenhum", async () => {
    const quem = await reconhecerPeloToken(TOKEN_DA_UNIDADE);

    // É o que o agente instalado nos restaurantes usa desde sempre: um
    // cadastro novo não pode parar quem já está imprimindo.
    expect(quem?.unidade.id).toBe(unidadeId);
    expect(quem?.aparelho).toBeNull();
  });

  it("aparelho cortado responde como token inventado", async () => {
    const aparelho = await cadastrar("Maquininha perdida no táxi");
    await db.aparelho.update({ where: { id: aparelho.id }, data: { ativo: false } });

    // Nem "cortado", nem "existe mas não vale": quem está com ele na mão não
    // descobre nem que acertou a casa.
    expect(await reconhecerPeloToken(aparelho.token)).toBeNull();
  });

  it("cortar um não derruba os outros", async () => {
    const some = await cadastrar("A que sumiu");
    const fica = await cadastrar("A que ficou");

    await db.aparelho.update({ where: { id: some.id }, data: { ativo: false } });

    expect(await reconhecerPeloToken(some.token)).toBeNull();
    expect((await reconhecerPeloToken(fica.token))?.aparelho?.nome).toBe("A que ficou");
    // E o agente do balcão, que usa o token da unidade, nem fica sabendo.
    expect(await reconhecerPeloToken(TOKEN_DA_UNIDADE)).not.toBeNull();
  });

  it("token de ninguém não abre porta", async () => {
    expect(await reconhecerPeloToken("nao-existe")).toBeNull();
    expect(await reconhecerPeloToken("  ")).toBeNull();
  });
});

describe("o último contato", () => {
  it("a busca da fila marca que o aparelho está vivo", async () => {
    const aparelho = await cadastrar("Maquininha do salão");

    await buscarFila(buscaDaFila(aparelho.token, "maquininha-k7x2"));

    const depois = await db.aparelho.findUniqueOrThrow({ where: { id: aparelho.id } });
    expect(depois.ultimoContatoEm).not.toBeNull();
    // O apelido da fila fica junto: é por ele que se acha de qual aparelho
    // saiu um papel.
    expect(depois.ultimoApelido).toBe("maquininha-k7x2");
  });

  it("marca no máximo uma vez por minuto", async () => {
    const aparelho = await cadastrar("Maquininha do salão");
    await buscarFila(buscaDaFila(aparelho.token));
    const primeira = (await db.aparelho.findUniqueOrThrow({ where: { id: aparelho.id } }))
      .ultimoContatoEm;

    /*
     * A maquininha busca a fila a cada poucos segundos. Um UPDATE por busca
     * seria escrita constante para responder sempre a mesma pergunta — "ele
     * está vivo?" —, e um minuto de defasagem não muda a resposta de ninguém.
     */
    await buscarFila(buscaDaFila(aparelho.token));
    await buscarFila(buscaDaFila(aparelho.token));

    const depois = (await db.aparelho.findUniqueOrThrow({ where: { id: aparelho.id } }))
      .ultimoContatoEm;
    expect(depois?.getTime()).toBe(primeira?.getTime());
  });

  it("passado o minuto, marca de novo", async () => {
    const aparelho = await cadastrar("Maquininha do salão");
    await db.aparelho.update({
      where: { id: aparelho.id },
      data: { ultimoContatoEm: new Date(Date.now() - 5 * 60_000) },
    });

    await registrarContato({ id: aparelho.id }, tenantId);

    const depois = await db.aparelho.findUniqueOrThrow({ where: { id: aparelho.id } });
    expect(Date.now() - (depois.ultimoContatoEm?.getTime() ?? 0)).toBeLessThan(5_000);
  });
});

describe("a fila de impressão pela credencial nova", () => {
  it("o aparelho cadastrado puxa a fila da unidade dele", async () => {
    const aparelho = await cadastrar("Maquininha do salão");
    await db.filaImpressao.create({
      data: {
        tenantId,
        unidadeId,
        tipo: "COMANDA_PRODUCAO",
        titulo: "Comanda da credencial nova",
        conteudo: "papel",
      },
    });

    const resposta = await buscarFila(buscaDaFila(aparelho.token));
    const corpo = await resposta.json();

    expect(resposta.status).toBe(200);
    expect(corpo.trabalhos).toHaveLength(1);
  });

  it("aparelho cortado não puxa mais nada", async () => {
    const aparelho = await cadastrar("Maquininha perdida");
    await db.aparelho.update({ where: { id: aparelho.id }, data: { ativo: false } });

    const resposta = await buscarFila(buscaDaFila(aparelho.token));

    // O papel da casa não sai mais na mão de quem está com o aparelho.
    expect(resposta.status).toBe(401);
  });
});
