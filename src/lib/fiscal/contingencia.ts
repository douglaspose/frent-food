import "server-only";
import { db } from "../db";
import { enfileirar } from "../fila-impressao";
import { montarDanfe } from "./danfe";
import { emissorDa } from "./emitir";
import type { Emissor, NotaParaEmitir } from "./tipos";

/**
 * As notas que a SEFAZ não recebeu, e o que fazer com elas depois.
 *
 * Quando o emissor não responde, a venda não para: a nota nasce em
 * contingência, com chave própria (`tpEmis=9`) e o documento guardado como
 * nasceu. O que faltava era a outra metade — **transmitir quando o serviço
 * voltar**. Sem ela, as notas ficavam paradas para sempre: um dia de SEFAZ
 * instável virava passivo fiscal silencioso, e ninguém no restaurante tinha
 * como saber.
 *
 * A transmissão é a mesma emissão, com o mesmo documento. Não se remonta nada
 * da comanda: a data de emissão e o código numérico entram no cálculo da chave
 * que já foi impressa no cupom do cliente, e uma chave nova seria outra nota.
 */

/**
 * Quanto tempo a lei dá para transmitir o que foi emitido offline.
 *
 * 24 horas é o prazo da maioria das UFs. O número mora aqui porque é regra de
 * fora, não decisão nossa: quem for atender uma UF de prazo diferente muda num
 * lugar só.
 */
export const PRAZO_DE_TRANSMISSAO_HORAS = 24;

/** Quantas notas uma passada tenta. Lote pequeno: a SEFAZ cobra por chamada
 * de paciência, e a rotina roda de novo em minutos. */
const POR_PASSADA = 20;

export type QuemTransmite = { tenantId: string; unidadeId: string };

export type NotaParada = {
  id: string;
  numero: number;
  serie: number;
  chaveAcesso: string | null;
  valorTotal: number;
  emitidaEm: Date;
  horasParada: number;
  /** Já passou do prazo legal de transmissão. */
  vencida: boolean;
  tentativas: number;
  motivo: string | null;
  /** Nota antiga, de antes de o documento ser guardado: não há o que transmitir. */
  transmissivel: boolean;
};

const horasEntre = (de: Date, ate: Date) => (ate.getTime() - de.getTime()) / 3_600_000;

/**
 * As notas em contingência desta unidade, da mais velha para a mais nova.
 *
 * A mais velha primeiro porque é a que está mais perto de estourar o prazo — e
 * é a ordem em que a transmissão as tenta.
 */
export async function notasEmContingencia(
  quem: QuemTransmite,
  agora = new Date()
): Promise<NotaParada[]> {
  const notas = await db.notaFiscal.findMany({
    where: { unidadeId: quem.unidadeId, status: "CONTINGENCIA" },
    orderBy: { criadoEm: "asc" },
  });

  return notas.map((n) => {
    const horas = horasEntre(n.criadoEm, agora);
    return {
      id: n.id,
      numero: n.numero,
      serie: n.serie,
      chaveAcesso: n.chaveAcesso,
      valorTotal: Number(n.valorTotal),
      emitidaEm: n.criadoEm,
      horasParada: Math.floor(horas),
      vencida: horas > PRAZO_DE_TRANSMISSAO_HORAS,
      tentativas: n.tentativas,
      motivo: n.motivoRejeicao,
      transmissivel: n.emitida !== null,
    };
  });
}

/**
 * O resumo que a tela mostra sem precisar da lista inteira.
 *
 * Numa casa que ficou um dia sem SEFAZ são dezenas de notas; o que o dono
 * precisa saber é quantas, há quanto tempo a mais velha espera, e se alguma já
 * passou do prazo.
 */
export type ResumoDaContingencia = {
  paradas: number;
  vencidas: number;
  horasDaMaisVelha: number;
  /** Notas de antes desta regra, que só o contador resolve. */
  semDocumento: number;
  /** O prazo legal, para a tela não ter uma segunda cópia do número. */
  prazoHoras: number;
};

export async function resumoDaContingencia(
  quem: QuemTransmite,
  agora = new Date()
): Promise<ResumoDaContingencia> {
  const notas = await notasEmContingencia(quem, agora);
  return {
    paradas: notas.length,
    vencidas: notas.filter((n) => n.vencida).length,
    horasDaMaisVelha: notas[0]?.horasParada ?? 0,
    semDocumento: notas.filter((n) => !n.transmissivel).length,
    prazoHoras: PRAZO_DE_TRANSMISSAO_HORAS,
  };
}

export type ResultadoDaTransmissao = {
  tentadas: number;
  autorizadas: number;
  recusadas: number;
  /** O serviço continua fora: ficam para a próxima passada. */
  aindaParadas: number;
  /** Sem o documento guardado — nada a fazer por aqui. */
  semDocumento: number;
};

/**
 * Transmite o que está esperando, e para na primeira indisponibilidade.
 *
 * Para de propósito: se a SEFAZ respondeu "indisponível" para a primeira, as
 * outras dezenove vão receber a mesma resposta, e insistir só gasta tempo de
 * uma rotina que vai rodar de novo. Recusa de uma nota (cadastro errado, por
 * exemplo) **não** para a fila — ela é problema daquela nota só.
 *
 * `emissor` entra por parâmetro para o teste poder derrubar a SEFAZ e
 * levantá-la de novo; em produção vem do cadastro da unidade, como na emissão.
 */
export async function transmitirContingencias(
  quem: QuemTransmite,
  /*
   * Sem relógio de propósito: o prazo não entra aqui.
   *
   * Nota vencida continua sendo transmitida — tarde é melhor que nunca, e quem
   * recusa por prazo é a SEFAZ, com a resposta dela. Quem conta as horas é o
   * `resumoDaContingencia`, para a tela avisar.
   */
  opcoes: { emissor?: Emissor; limite?: number } = {}
): Promise<ResultadoDaTransmissao> {
  const limite = opcoes.limite ?? POR_PASSADA;

  const unidade = await db.unidade.findUniqueOrThrow({ where: { id: quem.unidadeId } });
  // A unidade vem do id da sessão, mas o restaurante é conferido: o RLS é por
  // restaurante, e esta rotina também atende porta de máquina (o agendador).
  if (unidade.tenantId !== quem.tenantId) throw new Error("Unidade de outro restaurante.");

  const emissor = opcoes.emissor ?? emissorDa(unidade);

  const paradas = await db.notaFiscal.findMany({
    where: { unidadeId: quem.unidadeId, status: "CONTINGENCIA" },
    orderBy: { criadoEm: "asc" },
    take: limite,
  });

  const resultado: ResultadoDaTransmissao = {
    tentadas: 0,
    autorizadas: 0,
    recusadas: 0,
    aindaParadas: 0,
    semDocumento: 0,
  };

  for (const parada of paradas) {
    if (!parada.emitida) {
      resultado.semDocumento++;
      continue;
    }

    const documento = parada.emitida as unknown as NotaParaEmitir;
    // O JSON devolve data como texto; o emissor espera `Date` — é a única
    // costura da ida e volta pelo banco.
    documento.emissao = new Date(documento.emissao);

    resultado.tentadas++;

    let resposta;
    try {
      resposta = await emissor.emitir(documento);
    } catch (e) {
      // Falha de rede é o mesmo caso de "indisponível": não é problema da nota.
      resposta = {
        status: "INDISPONIVEL" as const,
        motivo: e instanceof Error ? e.message : "Falha ao comunicar com o emissor.",
      };
    }

    if (resposta.status === "AUTORIZADA") {
      await db.notaFiscal.update({
        where: { id: parada.id },
        data: {
          status: "AUTORIZADA",
          chaveAcesso: resposta.chaveAcesso,
          protocolo: resposta.protocolo,
          autorizadaEm: resposta.autorizadaEm,
          qrCodeDados: resposta.qrCodeDados,
          urlConsulta: resposta.urlConsulta,
          xml: resposta.xml,
          motivoRejeicao: null,
          tentativas: { increment: 1 },
        },
      });
      resultado.autorizadas++;

      /*
       * O papel sai agora, com a autorização.
       *
       * O cliente foi embora com o cupom da contingência, que é o que a lei
       * manda entregar; este segundo papel é o da casa — é o que o contador
       * confere contra o movimento do dia, e é o jeito de quem está no balcão
       * ver que a nota parada saiu. Falha de impressão não desfaz a
       * autorização, como na emissão normal.
       */
      try {
        await enfileirar({
          tenantId: parada.tenantId,
          unidadeId: parada.unidadeId,
          tipo: "DANFE_NFCE",
          titulo: `NFC-e ${parada.numero}/${parada.serie} (contingência transmitida)`,
          referenciaId: parada.id,
          conteudo: montarDanfe({
            emitente: {
              razaoSocial: documento.emitente.razaoSocial,
              cnpj: documento.emitente.cnpj,
              endereco: [
                documento.emitente.logradouro,
                documento.emitente.numero,
                documento.emitente.bairro,
                documento.emitente.municipio,
              ]
                .filter(Boolean)
                .join(", "),
            },
            numero: parada.numero,
            serie: parada.serie,
            ambiente: parada.ambiente,
            autorizadaEm: resposta.autorizadaEm,
            chaveAcesso: resposta.chaveAcesso,
            protocolo: resposta.protocolo,
            qrCodeDados: resposta.qrCodeDados,
            urlConsulta: resposta.urlConsulta,
            itens: documento.itens.map((i) => ({
              descricao: i.descricao,
              quantidade: i.quantidade,
              unidade: i.unidade,
              valorUnitario: i.valorUnitario,
              valorTotal: i.valorTotal,
            })),
            valorProdutos: documento.valorProdutos,
            valorDesconto: documento.valorDesconto,
            valorTotal: documento.valorTotal,
            pagamentos: documento.pagamentos.map((p) => ({
              descricao: p.descricao,
              valor: p.valor,
              troco: p.troco,
            })),
            consumidor: documento.destinatario,
            observacao: documento.informacoesComplementares,
          }),
        });
      } catch (e) {
        console.error("Falha ao enfileirar DANFE da contingência", e);
      }
      continue;
    }

    if (resposta.status === "INDISPONIVEL") {
      await db.notaFiscal.update({
        where: { id: parada.id },
        data: { motivoRejeicao: resposta.motivo, tentativas: { increment: 1 } },
      });
      // O serviço está fora: as outras receberiam a mesma resposta.
      resultado.aindaParadas = paradas.length - paradas.indexOf(parada);
      break;
    }

    /*
     * Recusada ou denegada: a nota sai da contingência para a mão de gente.
     *
     * Ficar em contingência seria mentir sobre o que aconteceu — o serviço
     * respondeu, e respondeu que este documento não serve (NCM faltando, total
     * divergente). A rotina não insiste: quem resolve é quem arruma o cadastro,
     * e a tela Fiscal mostra o motivo.
     */
    await db.notaFiscal.update({
      where: { id: parada.id },
      data: {
        status: resposta.status === "DENEGADA" ? "DENEGADA" : "REJEITADA",
        motivoRejeicao: resposta.motivo,
        tentativas: { increment: 1 },
      },
    });
    resultado.recusadas++;
  }

  return resultado;
}
