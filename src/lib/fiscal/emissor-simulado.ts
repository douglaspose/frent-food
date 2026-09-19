import { montarChave, TP_EMIS } from "./chave";
import type {
  Emissor,
  NotaParaEmitir,
  ResultadoCancelamento,
  ResultadoEmissao,
} from "./tipos";

/**
 * Emissor de simulação.
 *
 * Gera chave de acesso real (o algoritmo é o mesmo da SEFAZ) e um XML
 * simplificado, sem assinar nem transmitir nada. Serve para exercitar o
 * sistema inteiro — numeração, contingência, DANFE, cancelamento — antes de
 * existir certificado digital.
 *
 * Também **recusa de propósito** notas com erro de cadastro que a SEFAZ
 * recusaria: NCM faltando, CNPJ inválido, total divergente. É o que faz o
 * caminho de rejeição ser exercitado em vez de descoberto em produção.
 */
export class EmissorSimulado implements Emissor {
  readonly nome = "SIMULADO";

  async emitir(nota: NotaParaEmitir): Promise<ResultadoEmissao> {
    const rejeicao = this.validar(nota);
    if (rejeicao) return { status: "REJEITADA", motivo: rejeicao };

    const chaveAcesso = montarChave({
      uf: nota.emitente.uf,
      emissao: nota.emissao,
      cnpj: nota.emitente.cnpj,
      serie: nota.serie,
      numero: nota.numero,
      codigoNumerico: nota.codigoNumerico,
      tipoEmissao: nota.contingencia ? TP_EMIS.CONTINGENCIA_OFFLINE : TP_EMIS.NORMAL,
    });

    // Latência artificial: sem ela, a tela nunca mostraria o estado
    // "processando" e o problema só apareceria com a SEFAZ real, lenta.
    await new Promise((r) => setTimeout(r, 120));

    const autorizadaEm = new Date();
    const protocolo = `${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(0, 15);

    return {
      status: "AUTORIZADA",
      chaveAcesso,
      protocolo,
      autorizadaEm,
      qrCodeDados: this.montarQrCode(nota, chaveAcesso),
      urlConsulta: this.urlConsulta(nota.emitente.uf, nota.ambiente),
      xml: this.montarXml(nota, chaveAcesso, protocolo, autorizadaEm),
    };
  }

  async cancelar(chaveAcesso: string, motivo: string): Promise<ResultadoCancelamento> {
    // A SEFAZ exige no mínimo 15 caracteres na justificativa.
    if (motivo.trim().length < 15) {
      return { status: "RECUSADO", motivo: "A justificativa deve ter ao menos 15 caracteres." };
    }
    if (chaveAcesso.length !== 44) {
      return { status: "RECUSADO", motivo: "Chave de acesso inválida." };
    }

    await new Promise((r) => setTimeout(r, 120));
    return {
      status: "CANCELADA",
      protocolo: `C${Date.now()}`.slice(0, 15),
      canceladaEm: new Date(),
    };
  }

  /** As rejeições mais comuns de quem está começando a emitir. */
  private validar(nota: NotaParaEmitir): string | null {
    if (nota.itens.length === 0) return "Rejeição 611: nota sem itens.";

    const semNcm = nota.itens.find((i) => !i.ncm || i.ncm.replace(/\D/g, "").length !== 8);
    if (semNcm) {
      return `Rejeição 778: NCM inválido ou ausente no item "${semNcm.descricao}".`;
    }

    if (nota.emitente.cnpj.replace(/\D/g, "").length !== 14) {
      return "Rejeição 207: CNPJ do emitente inválido.";
    }
    if (!nota.emitente.inscricaoEstadual) {
      return "Rejeição 209: Inscrição Estadual do emitente não informada.";
    }

    const somaItens = nota.itens.reduce((s, i) => s + i.valorTotal, 0);
    if (Math.abs(somaItens - nota.valorProdutos) > 0.01) {
      return "Rejeição 531: total dos produtos diverge da soma dos itens.";
    }

    const somaPagamentos = nota.pagamentos.reduce((s, p) => s + p.valor - p.troco, 0);
    if (Math.abs(somaPagamentos - nota.valorTotal) > 0.01) {
      return "Rejeição 897: total dos pagamentos diverge do total da nota.";
    }

    // Regra própria da NFC-e: acima de R$ 10.000 o consumidor precisa ser
    // identificado.
    if (nota.valorTotal > 10_000 && !nota.destinatario?.cpf) {
      return "Rejeição 816: acima de R$ 10.000,00 é obrigatório identificar o consumidor.";
    }

    return null;
  }

  /**
   * Conteúdo do QR Code impresso no cupom. O formato real inclui um hash
   * assinado com o CSC; aqui montamos a mesma estrutura de parâmetros para o
   * DANFE e o agente de impressão já ficarem prontos.
   */
  private montarQrCode(nota: NotaParaEmitir, chave: string) {
    const parametros = new URLSearchParams({
      p: [chave, "2", nota.ambiente === "PRODUCAO" ? "1" : "2", "1", "SIMULADO"].join("|"),
    });
    return `${this.urlConsulta(nota.emitente.uf, nota.ambiente)}?${parametros}`;
  }

  private urlConsulta(uf: string, ambiente: string) {
    const sufixo = ambiente === "PRODUCAO" ? "" : "-homologacao";
    return `https://nfce${sufixo}.sefaz.${uf.toLowerCase()}.gov.br/consulta`;
  }

  private montarXml(
    nota: NotaParaEmitir,
    chave: string,
    protocolo: string,
    autorizadaEm: Date
  ) {
    const itens = nota.itens
      .map(
        (i) => `    <det nItem="${i.numero}">
      <prod>
        <cProd>${i.codigo}</cProd>
        <xProd>${escapar(i.descricao)}</xProd>
        <NCM>${i.ncm}</NCM>
        <CFOP>${i.cfop}</CFOP>
        <uCom>${i.unidade}</uCom>
        <qCom>${i.quantidade.toFixed(4)}</qCom>
        <vUnCom>${i.valorUnitario.toFixed(2)}</vUnCom>
        <vProd>${i.valorTotal.toFixed(2)}</vProd>
      </prod>
    </det>`
      )
      .join("\n");

    return `<?xml version="1.0" encoding="UTF-8"?>
<!-- Documento de SIMULAÇÃO. Não tem valor fiscal e não foi transmitido à SEFAZ. -->
<nfeProc versao="4.00">
  <NFe>
    <infNFe Id="NFe${chave}" versao="4.00">
      <ide>
        <mod>65</mod>
        <serie>${nota.serie}</serie>
        <nNF>${nota.numero}</nNF>
        <dhEmi>${nota.emissao.toISOString()}</dhEmi>
        <tpAmb>${nota.ambiente === "PRODUCAO" ? 1 : 2}</tpAmb>
        <tpEmis>${nota.contingencia ? 9 : 1}</tpEmis>
      </ide>
      <emit>
        <CNPJ>${nota.emitente.cnpj.replace(/\D/g, "")}</CNPJ>
        <xNome>${escapar(nota.emitente.razaoSocial)}</xNome>
        <IE>${nota.emitente.inscricaoEstadual ?? ""}</IE>
        <CRT>${nota.emitente.regime === "SIMPLES_NACIONAL" ? 1 : 3}</CRT>
      </emit>
${itens}
      <total>
        <ICMSTot>
          <vProd>${nota.valorProdutos.toFixed(2)}</vProd>
          <vDesc>${nota.valorDesconto.toFixed(2)}</vDesc>
          <vNF>${nota.valorTotal.toFixed(2)}</vNF>
        </ICMSTot>
      </total>
    </infNFe>
  </NFe>
  <protNFe versao="4.00">
    <infProt>
      <chNFe>${chave}</chNFe>
      <nProt>${protocolo}</nProt>
      <dhRecbto>${autorizadaEm.toISOString()}</dhRecbto>
      <cStat>100</cStat>
      <xMotivo>Autorizado o uso da NF-e (SIMULADO)</xMotivo>
    </infProt>
  </protNFe>
</nfeProc>`;
  }
}

function escapar(texto: string) {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
