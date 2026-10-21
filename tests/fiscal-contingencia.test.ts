import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { emitirNfce } from "@/lib/fiscal/emitir";
import {
  notasEmContingencia,
  resumoDaContingencia,
  transmitirContingencias,
} from "@/lib/fiscal/contingencia";
import { EmissorSimulado } from "@/lib/fiscal/emissor-simulado";
import type { Emissor, ResultadoCancelamento, ResultadoEmissao } from "@/lib/fiscal/tipos";
import { criarRestaurante, limpar } from "./fixtures";

/**
 * A nota que a SEFAZ não recebeu.
 *
 * Quando o emissor não responde, a venda não pode parar: o cliente está de pé
 * no caixa. A nota nasce em contingência offline, com chave própria
 * (`tpEmis=9`) e o documento guardado como nasceu.
 *
 * O que faltava era a outra metade — **transmitir quando o serviço voltar**.
 * Sem ela, as notas ficavam paradas para sempre: um dia de SEFAZ instável
 * virava passivo fiscal silencioso, com prazo legal correndo, e ninguém no
 * restaurante tinha como saber. É o que estes testes prendem.
 */

const SLUG = "teste-contingencia";
/** Onde o `tpEmis` mora na chave: cUF(2) AAMM(4) CNPJ(14) mod(2) série(3) nNF(9). */
const POSICAO_DO_TP_EMIS = 34;

let tenantId: string;
let unidadeId: string;
let usuarioId: string;
let produtoId: string;
let formaId: string;

/** A SEFAZ fora do ar: o caso que põe a nota em contingência. */
const sefazFora: Emissor = {
  nome: "FORA",
  async emitir(): Promise<ResultadoEmissao> {
    return { status: "INDISPONIVEL", motivo: "Serviço da SEFAZ indisponível." };
  },
  async cancelar(): Promise<ResultadoCancelamento> {
    return { status: "RECUSADO", motivo: "fora do ar" };
  },
};

/** A SEFAZ que responde, e responde "não": cadastro errado não melhora com o tempo. */
const sefazRecusa: Emissor = {
  nome: "RECUSA",
  async emitir(): Promise<ResultadoEmissao> {
    return { status: "REJEITADA", motivo: "Rejeição 539: duplicidade de nota." };
  },
  async cancelar(): Promise<ResultadoCancelamento> {
    return { status: "RECUSADO", motivo: "n/a" };
  },
};

/** A SEFAZ no ar. É o emissor de verdade do sistema, que autoriza. */
const sefazNoAr = new EmissorSimulado();

/** Uma venda paga, pronta para virar nota. */
async function vendaPaga(numero: number, valor = 25, onde?: string) {
  const comanda = await db.comanda.create({
    data: {
      tenantId,
      unidadeId: onde ?? unidadeId,
      numero,
      pessoas: 1,
      status: "PAGA",
      abertaPorId: usuarioId,
      taxaServicoPct: 0,
      itens: {
        create: {
          tenantId,
          produtoId,
          quantidade: 1,
          precoUnitario: valor,
          precoTotal: valor,
          status: "ENTREGUE",
          lancadoPorId: usuarioId,
        },
      },
      pagamentos: {
        create: {
          tenantId,
          formaPagamentoId: formaId,
          valor,
          troco: 0,
          taxaPct: 0,
          taxaValor: 0,
          usuarioId,
        },
      },
    },
  });
  return comanda.id;
}

/** Põe uma venda em contingência, que é o estado de partida destes testes. */
async function emContingencia(numero: number, valor = 25, onde?: string) {
  const comandaId = await vendaPaga(numero, valor, onde);
  const r = await emitirNfce(comandaId, usuarioId, sefazFora);
  return { comandaId, notaId: r.notaId! };
}

const quem = () => ({ tenantId, unidadeId });

beforeAll(async () => {
  const r = await criarRestaurante(SLUG);
  tenantId = r.tenant.id;
  unidadeId = r.unidade.id;
  usuarioId = r.usuario.id;

  // A unidade emitindo de verdade: sem CNPJ, UF e IE a emissão para antes de
  // chegar ao emissor, e não era isso que se quer testar.
  await db.unidade.update({
    where: { id: unidadeId },
    data: {
      emiteNfce: true,
      cnpj: "11222333000181",
      uf: "GO",
      inscricaoEstadual: "123456789",
      razaoSocial: "Restaurante de Teste LTDA",
      cidade: "Goiânia",
      ambienteFiscal: "HOMOLOGACAO",
      serieNfce: 1,
    },
  });

  const perfil = await db.perfilFiscal.create({
    data: { tenantId, unidadeId, nome: "Padrão", cfop: "5102", padrao: true },
  });
  const produto = await db.produto.create({
    data: {
      tenantId,
      titulo: "Prato do teste",
      unidadeMedida: "UN",
      // NCM válido: sem ele o emissor simulado recusa, de propósito.
      ncm: "21069090",
      perfilFiscalId: perfil.id,
    },
  });
  produtoId = produto.id;

  const forma = await db.formaPagamento.create({
    data: { tenantId, nome: "Dinheiro", tipo: "DINHEIRO", taxaPct: 0 },
  });
  formaId = forma.id;
});

beforeEach(async () => {
  await db.filaImpressao.deleteMany({ where: { tenantId } });
  await db.notaFiscal.deleteMany({ where: { tenantId } });
  await db.pagamento.deleteMany({ where: { tenantId } });
  await db.comanda.deleteMany({ where: { tenantId } });
});

afterAll(async () => {
  await limpar(SLUG);
  await db.$disconnect();
});

describe("a nota que a SEFAZ não recebeu", () => {
  it("a venda não para, e a nota nasce em contingência offline", async () => {
    const comandaId = await vendaPaga(901);

    const r = await emitirNfce(comandaId, usuarioId, sefazFora);

    const nota = await db.notaFiscal.findFirstOrThrow({ where: { comandaId } });
    const comanda = await db.comanda.findUniqueOrThrow({ where: { id: comandaId } });

    expect({
      emitiu: r.ok,
      status: nota.status,
      // A chave é calculada por nós, e diz que foi emitida offline.
      tpEmis: nota.chaveAcesso?.[POSICAO_DO_TP_EMIS],
      tamanhoDaChave: nota.chaveAcesso?.length,
      guardouODocumento: nota.emitida !== null,
      // E a venda continua paga: nota é consequência, não condição.
      vendaSegue: comanda.status,
    }).toEqual({
      emitiu: false,
      status: "CONTINGENCIA",
      tpEmis: "9",
      tamanhoDaChave: 44,
      guardouODocumento: true,
      vendaSegue: "PAGA",
    });
  });

  /**
   * O documento guardado é o que permite transmitir **a mesma nota**.
   *
   * A data de emissão e o código numérico entram no cálculo da chave, que já
   * foi impressa no cupom do cliente. Remontar da comanda daria outra chave, e
   * outra chave é outra nota.
   */
  it("a transmissão autoriza a nota parada, com a mesma chave", async () => {
    const { notaId } = await emContingencia(902);
    const antes = await db.notaFiscal.findUniqueOrThrow({ where: { id: notaId } });

    const resultado = await transmitirContingencias(quem(), { emissor: sefazNoAr });

    const depois = await db.notaFiscal.findUniqueOrThrow({ where: { id: notaId } });
    const papel = await db.filaImpressao.findFirst({
      // O guarda de isolamento cobra o filtro: toda consulta tem dono.
      where: { tenantId, referenciaId: notaId, tipo: "DANFE_NFCE" },
    });

    expect({
      resultado,
      status: depois.status,
      mesmaChave: depois.chaveAcesso === antes.chaveAcesso,
      temProtocolo: Boolean(depois.protocolo),
      temXml: Boolean(depois.xml),
      autorizada: depois.autorizadaEm !== null,
      // O papel da casa sai agora, com a autorização.
      saiuPapel: papel?.titulo ?? null,
    }).toEqual({
      resultado: {
        tentadas: 1,
        autorizadas: 1,
        recusadas: 0,
        aindaParadas: 0,
        semDocumento: 0,
      },
      status: "AUTORIZADA",
      mesmaChave: true,
      temProtocolo: true,
      temXml: true,
      autorizada: true,
      saiuPapel: "NFC-e 1/1 (contingência transmitida)",
    });
  });

  /**
   * "Indisponível" na primeira vale para todas: insistir dezenove vezes só
   * gasta o tempo de uma rotina que vai rodar de novo em minutos.
   */
  it("SEFAZ ainda fora: tenta uma, para, e não gasta as outras", async () => {
    await emContingencia(903);
    await emContingencia(904);

    const resultado = await transmitirContingencias(quem(), { emissor: sefazFora });

    const paradas = await notasEmContingencia(quem());
    expect({ resultado, paradas: paradas.length, tentativas: paradas.map((n) => n.tentativas) })
      .toEqual({
        resultado: {
          tentadas: 1,
          autorizadas: 0,
          recusadas: 0,
          aindaParadas: 2,
          semDocumento: 0,
        },
        paradas: 2,
        // Só a primeira foi tentada de novo — a segunda nem foi chamada.
        tentativas: [1, 0],
      });
  });

  /**
   * Recusa é o contrário de indisponibilidade: o serviço respondeu, e
   * respondeu que **este** documento não serve. A nota sai da contingência
   * para a mão de gente, e a fila segue.
   */
  it("recusada vira REJEITADA com o motivo, e a de trás é transmitida", async () => {
    const primeira = await emContingencia(905);
    const segunda = await emContingencia(906);

    // O emissor recusa a primeira e autoriza a segunda, que é o caso de uma
    // nota com cadastro ruim atrás da qual o resto do dia está esperando.
    let chamadas = 0;
    const sefazSeletiva: Emissor = {
      nome: "SELETIVA",
      async emitir(nota) {
        chamadas++;
        return chamadas === 1 ? sefazRecusa.emitir(nota) : sefazNoAr.emitir(nota);
      },
      cancelar: sefazNoAr.cancelar.bind(sefazNoAr),
    };

    const resultado = await transmitirContingencias(quem(), { emissor: sefazSeletiva });

    const uma = await db.notaFiscal.findUniqueOrThrow({ where: { id: primeira.notaId } });
    const outra = await db.notaFiscal.findUniqueOrThrow({ where: { id: segunda.notaId } });

    expect({
      resultado,
      primeira: { status: uma.status, motivo: uma.motivoRejeicao },
      segunda: outra.status,
    }).toEqual({
      resultado: {
        tentadas: 2,
        autorizadas: 1,
        recusadas: 1,
        aindaParadas: 0,
        semDocumento: 0,
      },
      primeira: { status: "REJEITADA", motivo: "Rejeição 539: duplicidade de nota." },
      segunda: "AUTORIZADA",
    });
  });

  /** Falha de rede no meio da transmissão é o mesmo caso de serviço fora. */
  it("emissor que estoura não derruba a rotina", async () => {
    await emContingencia(907);
    const sefazQueEstoura: Emissor = {
      nome: "ESTOURA",
      async emitir(): Promise<ResultadoEmissao> {
        throw new Error("getaddrinfo ENOTFOUND sefaz.go.gov.br");
      },
      cancelar: sefazNoAr.cancelar.bind(sefazNoAr),
    };

    const resultado = await transmitirContingencias(quem(), { emissor: sefazQueEstoura });

    const nota = (await notasEmContingencia(quem()))[0]!;
    expect({ resultado, motivo: nota.motivo }).toEqual({
      resultado: {
        tentadas: 1,
        autorizadas: 0,
        recusadas: 0,
        aindaParadas: 1,
        semDocumento: 0,
      },
      motivo: "getaddrinfo ENOTFOUND sefaz.go.gov.br",
    });
  });
});

describe("o prazo legal de transmissão", () => {
  it("conta as horas da mais velha e avisa quando passou", async () => {
    const { notaId } = await emContingencia(908);
    // Trinta horas atrás: a venda de ontem que ninguém transmitiu.
    await db.notaFiscal.update({
      where: { id: notaId },
      data: { criadoEm: new Date(Date.now() - 30 * 3_600_000) },
    });
    await emContingencia(909);

    const resumo = await resumoDaContingencia(quem());

    expect(resumo).toEqual({
      paradas: 2,
      vencidas: 1,
      horasDaMaisVelha: 30,
      semDocumento: 0,
      prazoHoras: 24,
    });
  });

  /** Vencida continua sendo transmitida: tarde é melhor que nunca, e quem
   * recusa por prazo é a SEFAZ, não nós. */
  it("nota vencida ainda é transmitida", async () => {
    const { notaId } = await emContingencia(910);
    await db.notaFiscal.update({
      where: { id: notaId },
      data: { criadoEm: new Date(Date.now() - 72 * 3_600_000) },
    });

    const resultado = await transmitirContingencias(quem(), { emissor: sefazNoAr });

    expect({
      autorizadas: resultado.autorizadas,
      status: (await db.notaFiscal.findUniqueOrThrow({ where: { id: notaId } })).status,
    }).toEqual({ autorizadas: 1, status: "AUTORIZADA" });
  });

  /**
   * As notas que ficaram em contingência antes desta versão não guardaram o
   * documento. Não há o que transmitir daqui — e a rotina precisa dizer isso
   * em vez de estourar ou fingir que tentou.
   */
  it("nota antiga, sem o documento guardado, é contada e não tentada", async () => {
    const { notaId } = await emContingencia(911);
    await db.notaFiscal.update({ where: { id: notaId }, data: { emitida: Prisma.DbNull } });

    const resultado = await transmitirContingencias(quem(), { emissor: sefazNoAr });
    const resumo = await resumoDaContingencia(quem());

    expect({ resultado, semDocumento: resumo.semDocumento, paradas: resumo.paradas }).toEqual({
      resultado: {
        tentadas: 0,
        autorizadas: 0,
        recusadas: 0,
        aindaParadas: 0,
        semDocumento: 1,
      },
      semDocumento: 1,
      paradas: 1,
    });
  });
});

/**
 * A fila é por unidade.
 *
 * O RLS é por restaurante: a nota da filial existe para a sessão da matriz. Se
 * a varredura olhasse só o restaurante, o botão da matriz transmitiria — e
 * imprimiria o DANFE — da nota de outra cidade, com a série e o CNPJ de lá.
 */
describe("a contingência da filial vizinha", () => {
  it("a matriz transmite só o que é dela", async () => {
    const filial = await db.unidade.create({
      data: {
        tenantId,
        codigo: "002",
        nome: "Filial",
        taxaServicoPct: 10,
        emiteNfce: true,
        cnpj: "11222333000262",
        uf: "GO",
        inscricaoEstadual: "987654321",
        serieNfce: 1,
      },
    });
    // Em contingência pelo mesmo caminho da matriz, com documento guardado:
    // sem isso ela seria pulada por falta de documento, e o teste passaria com
    // a conferência de unidade desligada.
    const { notaId: daFilial } = await emContingencia(912, 50, filial.id);
    const { notaId: daMatriz } = await emContingencia(913);

    const resultado = await transmitirContingencias(quem(), { emissor: sefazNoAr });

    const depoisMatriz = await db.notaFiscal.findUniqueOrThrow({ where: { id: daMatriz } });
    const depoisFilial = await db.notaFiscal.findUniqueOrThrow({ where: { id: daFilial } });
    await db.pagamento.deleteMany({ where: { tenantId } });
    await db.notaFiscal.deleteMany({ where: { unidadeId: filial.id } });
    await db.comanda.deleteMany({ where: { unidadeId: filial.id } });
    await db.unidade.delete({ where: { id: filial.id } });

    expect({
      autorizadas: resultado.autorizadas,
      matriz: depoisMatriz.status,
      filial: depoisFilial.status,
      filialIntocada: depoisFilial.tentativas,
    }).toEqual({ autorizadas: 1, matriz: "AUTORIZADA", filial: "CONTINGENCIA", filialIntocada: 0 });
  });

  it("e não transmite a de outro restaurante nem por engano", async () => {
    await emContingencia(914);

    await expect(
      transmitirContingencias({ tenantId: "outro-restaurante", unidadeId })
    ).rejects.toThrow("outro restaurante");
  });
});

/**
 * As duas portas da mesma fila.
 *
 * A transmissão tem dois gatilhos de propósito: o botão da retaguarda, para
 * quem está olhando a tela, e `POST /api/fiscal/contingencia`, para o
 * agendador que roda a cada poucos minutos. Nada impede que os dois caiam na
 * mesma nota no mesmo segundo — e é o caso mais provável de todos, porque o
 * dono aperta o botão exatamente quando percebe a fila crescendo, que é quando
 * o agendador também está passando.
 *
 * Transmitir a mesma nota duas vezes não é um papel a mais: é um documento
 * fiscal duplicado na SEFAZ, com a resposta da segunda sobrescrevendo a da
 * primeira no banco.
 */
describe("duas passadas na mesma nota", () => {
  it("o botão da tela e o agendador juntos transmitem a nota uma vez só", async () => {
    const { notaId } = await emContingencia(915);

    let idas = 0;
    /**
     * A SEFAZ como ela responde a um documento repetido.
     *
     * A primeira chamada autoriza. A segunda recebe a rejeição 539 —
     * literalmente a resposta dela para uma nota que já entrou — e recebe
     * **depois**, porque a duplicidade só aparece depois de consultar o que já
     * está lá. É o que faz a resposta da duplicidade ser a última a escrever.
     */
    const sefazQueVeDuplicidade: Emissor = {
      nome: "DUPLICIDADE",
      async emitir(nota): Promise<ResultadoEmissao> {
        if (++idas === 1) return sefazNoAr.emitir(nota);
        await new Promise((r) => setTimeout(r, 400));
        return { status: "REJEITADA", motivo: "Rejeição 539: duplicidade de NF-e." };
      },
      async cancelar(): Promise<ResultadoCancelamento> {
        return { status: "RECUSADO", motivo: "n/a" };
      },
    };

    await Promise.all([
      transmitirContingencias(quem(), { emissor: sefazQueVeDuplicidade }),
      transmitirContingencias(quem(), { emissor: sefazQueVeDuplicidade }),
    ]);

    const nota = await db.notaFiscal.findUniqueOrThrow({ where: { id: notaId } });
    const danfes = await db.filaImpressao.count({
      where: { tenantId, referenciaId: notaId, tipo: "DANFE_NFCE" },
    });

    expect({ idas, status: nota.status, motivo: nota.motivoRejeicao, danfes }).toEqual({
      idas: 1,
      status: "AUTORIZADA",
      motivo: null,
      danfes: 1,
    });
  });
});

/**
 * A reserva, sem depender de quem chega primeiro.
 *
 * O teste das duas passadas simultâneas acima prova a corrida, mas por
 * repetição: ele depende de qual delas o laço de eventos escolhe. Estes aqui
 * põem a nota em cada estado da reserva **à mão** e afirmam o que a varredura
 * faz com ela — é o desenho que fica preso, não a sorte.
 *
 * A primeira versão da reserva usava o contador de tentativas e passava no
 * teste simultâneo em duas de quatro execuções, porque a segunda passada lia a
 * linha depois da reserva e antes da autorização. Estes testes a derrubam
 * sempre.
 */
describe("a nota reservada sai da fila", () => {
  /** Como a nota fica enquanto uma passada está falando com a SEFAZ. */
  async function noAr(notaId: string, desdeMinutos: number) {
    await db.notaFiscal.update({
      where: { id: notaId },
      data: {
        status: "PROCESSANDO",
        transmitindoDesde: new Date(Date.now() - desdeMinutos * 60_000),
        tentativas: 1,
      },
    });
  }

  it("nota no ar agora não é pega por outra passada", async () => {
    const { notaId } = await emContingencia(920);
    await noAr(notaId, 0);

    const resultado = await transmitirContingencias(quem(), { emissor: sefazNoAr });

    const depois = await db.notaFiscal.findUniqueOrThrow({ where: { id: notaId } });
    expect({
      tentadas: resultado.tentadas,
      autorizadas: resultado.autorizadas,
      // Intocada: quem a reservou é quem vai escrever o desfecho dela.
      status: depois.status,
      tentativas: depois.tentativas,
    }).toEqual({ tentadas: 0, autorizadas: 0, status: "PROCESSANDO", tentativas: 1 });
  });

  /** Reserva sem prazo seria nota perdida para sempre se a passada morrer. */
  it("reserva vencida volta para a fila e é transmitida", async () => {
    const { notaId } = await emContingencia(921);
    await noAr(notaId, 10);

    const resultado = await transmitirContingencias(quem(), { emissor: sefazNoAr });

    const depois = await db.notaFiscal.findUniqueOrThrow({ where: { id: notaId } });
    expect({
      autorizadas: resultado.autorizadas,
      status: depois.status,
      // A marca sai com o desfecho: a nota não fica "em transmissão" para sempre.
      marca: depois.transmitindoDesde,
      tentativas: depois.tentativas,
    }).toEqual({ autorizadas: 1, status: "AUTORIZADA", marca: null, tentativas: 2 });
  });

  /**
   * A PROCESSANDO da emissão original não é desta fila.
   *
   * Uma nota que ficou em PROCESSANDO porque a emissão morreu no meio nunca
   * foi reservada aqui — e transmiti-la seria mandar à SEFAZ um documento que
   * não foi guardado para isso. `transmitindoDesde` nula é o que as separa.
   */
  it("PROCESSANDO sem marca de transmissão fica de fora", async () => {
    const { notaId } = await emContingencia(922);
    await db.notaFiscal.update({
      where: { id: notaId },
      data: { status: "PROCESSANDO", transmitindoDesde: null },
    });

    const resultado = await transmitirContingencias(quem(), { emissor: sefazNoAr });

    expect({ tentadas: resultado.tentadas, autorizadas: resultado.autorizadas }).toEqual({
      tentadas: 0,
      autorizadas: 0,
    });
  });

  /**
   * O encontro das duas passadas, sem sorteio.
   *
   * O teste simultâneo lá acima depende de qual passada o laço de eventos
   * escolhe — com a reserva antiga ele passava em duas de quatro execuções.
   * Aqui a segunda passada acontece **dentro** da chamada à SEFAZ da primeira:
   * é exatamente o instante em que a nota está reservada e ainda não tem
   * desfecho, e é o instante que a reserva existe para cobrir.
   */
  it("enquanto uma passada fala com a SEFAZ, a outra não encontra a nota", async () => {
    const { notaId } = await emContingencia(925);

    let segunda: Awaited<ReturnType<typeof transmitirContingencias>> | null = null;
    const sefazQueDeixaAOutraPassar: Emissor = {
      nome: "ENCONTRO",
      async emitir(nota) {
        segunda = await transmitirContingencias(quem(), { emissor: sefazNoAr });
        return sefazNoAr.emitir(nota);
      },
      cancelar: sefazNoAr.cancelar.bind(sefazNoAr),
    };

    const primeira = await transmitirContingencias(quem(), {
      emissor: sefazQueDeixaAOutraPassar,
    });

    const depois = await db.notaFiscal.findUniqueOrThrow({ where: { id: notaId } });
    const danfes = await db.filaImpressao.count({
      where: { tenantId, referenciaId: notaId, tipo: "DANFE_NFCE" },
    });

    expect({
      primeiraAutorizou: primeira.autorizadas,
      segundaTentou: segunda!.tentadas,
      status: depois.status,
      // Uma transmissão, uma tentativa, um papel.
      tentativas: depois.tentativas,
      danfes,
    }).toEqual({
      primeiraAutorizou: 1,
      segundaTentou: 0,
      status: "AUTORIZADA",
      tentativas: 1,
      danfes: 1,
    });
  });

  /** Serviço fora devolve a nota à contingência, e não a deixa reservada. */
  it("SEFAZ fora devolve a nota à fila na hora", async () => {
    const { notaId } = await emContingencia(923);

    await transmitirContingencias(quem(), { emissor: sefazFora });

    const depois = await db.notaFiscal.findUniqueOrThrow({ where: { id: notaId } });
    expect({ status: depois.status, marca: depois.transmitindoDesde }).toEqual({
      status: "CONTINGENCIA",
      marca: null,
    });
  });

  /**
   * A tela conta a nota que está no ar.
   *
   * Dizer "nenhuma nota esperando" enquanto uma está presa numa transmissão
   * que morreu seria esconder justamente a que tem prazo correndo.
   */
  it("o resumo conta a que está em transmissão", async () => {
    const { notaId } = await emContingencia(924);
    await noAr(notaId, 1);

    const resumo = await resumoDaContingencia(quem());

    expect({ paradas: resumo.paradas, vencidas: resumo.vencidas }).toEqual({
      paradas: 1,
      vencidas: 0,
    });
  });
});
