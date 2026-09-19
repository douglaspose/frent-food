/**
 * Contrato do emissor fiscal.
 *
 * Quem fala com a SEFAZ fica atrás desta interface — hoje um simulador, amanhã
 * um gateway. Trocar de emissor não deve tocar em nada fora desta pasta, e o
 * restaurante não deveria nem perceber.
 */

export type ItemNota = {
  numero: number;
  codigo: string;
  descricao: string;
  ncm: string;
  cest: string | null;
  cfop: string;
  unidade: string;
  quantidade: number;
  valorUnitario: number;
  valorTotal: number;
  origemMercadoria: number;
  /// Simples Nacional preenche csosn; Regime Normal preenche cstIcms.
  csosn: string | null;
  cstIcms: string | null;
  aliquotaIcms: number;
  valorIcms: number;
  baseCalculoIcms: number;
  cstPis: string;
  aliquotaPis: number;
  valorPis: number;
  cstCofins: string;
  aliquotaCofins: number;
  valorCofins: number;
};

export type PagamentoNota = {
  /// tPag do layout: 01 dinheiro, 03 crédito, 04 débito, 17 Pix...
  codigo: string;
  descricao: string;
  valor: number;
  troco: number;
};

export type NotaParaEmitir = {
  serie: number;
  numero: number;
  codigoNumerico: number;
  ambiente: "HOMOLOGACAO" | "PRODUCAO";
  emissao: Date;
  contingencia: boolean;

  emitente: {
    cnpj: string;
    razaoSocial: string;
    nomeFantasia: string | null;
    inscricaoEstadual: string | null;
    regime: "SIMPLES_NACIONAL" | "NORMAL";
    uf: string;
    codigoMunicipio: string | null;
    municipio: string | null;
    logradouro: string | null;
    numero: string | null;
    bairro: string | null;
    cep: string | null;
  };

  /// NFC-e aceita consumidor não identificado — é o caso normal no balcão.
  destinatario: { cpf: string | null; nome: string | null } | null;

  itens: ItemNota[];
  pagamentos: PagamentoNota[];

  valorProdutos: number;
  valorDesconto: number;
  /// A taxa de serviço não é mercadoria e não entra no total da NFC-e.
  valorTotal: number;
  informacoesComplementares: string | null;
};

export type ResultadoEmissao =
  | {
      status: "AUTORIZADA";
      chaveAcesso: string;
      protocolo: string;
      autorizadaEm: Date;
      qrCodeDados: string;
      urlConsulta: string;
      xml: string;
    }
  | { status: "REJEITADA"; motivo: string; codigo?: string }
  | { status: "DENEGADA"; motivo: string }
  /// A SEFAZ não respondeu. A venda não pode parar por isso.
  | { status: "INDISPONIVEL"; motivo: string };

export type ResultadoCancelamento =
  | { status: "CANCELADA"; protocolo: string; canceladaEm: Date }
  | { status: "RECUSADO"; motivo: string };

export interface Emissor {
  readonly nome: string;
  emitir(nota: NotaParaEmitir): Promise<ResultadoEmissao>;
  cancelar(chaveAcesso: string, motivo: string): Promise<ResultadoCancelamento>;
}
