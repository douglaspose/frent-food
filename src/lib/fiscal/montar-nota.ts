import { centavos } from "../comanda";
import type { ItemNota, NotaParaEmitir, PagamentoNota } from "./tipos";

/** tPag do layout da NFe, por tipo de pagamento nosso. */
export const CODIGO_PAGAMENTO: Record<string, string> = {
  DINHEIRO: "01",
  CREDITO: "03",
  DEBITO: "04",
  PIX: "17",
  VOUCHER: "10",
  CONVENIO: "05",
  OUTRO: "99",
};

export type PerfilTributario = {
  origemMercadoria: number;
  cfop: string;
  csosn: string;
  cstIcms: string;
  aliquotaIcms: number;
  cstPis: string;
  aliquotaPis: number;
  cstCofins: string;
  aliquotaCofins: number;
};

/** Usado quando o produto não tem perfil: tributação neutra do Simples. */
export const PERFIL_PADRAO: PerfilTributario = {
  origemMercadoria: 0,
  cfop: "5102",
  csosn: "102",
  cstIcms: "00",
  aliquotaIcms: 0,
  cstPis: "49",
  aliquotaPis: 0,
  cstCofins: "49",
  aliquotaCofins: 0,
};

export type ItemDaComanda = {
  codigo: string;
  descricao: string;
  ncm: string | null;
  cest: string | null;
  unidadeMedida: string;
  quantidade: number;
  valorUnitario: number;
  valorTotal: number;
  perfil: PerfilTributario | null;
};

/**
 * Traduz um item da comanda para item de nota, aplicando o regime da unidade.
 *
 * Simples Nacional informa CSOSN e **não** destaca ICMS; Regime Normal informa
 * CST e destaca base, alíquota e valor. Mandar os dois preenchidos é rejeição
 * na certa.
 */
export function montarItem(
  item: ItemDaComanda,
  numero: number,
  regime: "SIMPLES_NACIONAL" | "NORMAL"
): ItemNota {
  const perfil = item.perfil ?? PERFIL_PADRAO;
  const simples = regime === "SIMPLES_NACIONAL";

  const baseIcms = simples ? 0 : item.valorTotal;
  const valorIcms = simples ? 0 : centavos(baseIcms * (perfil.aliquotaIcms / 100));

  return {
    numero,
    codigo: item.codigo || String(numero),
    descricao: item.descricao,
    ncm: (item.ncm ?? "").replace(/\D/g, ""),
    cest: item.cest,
    cfop: perfil.cfop,
    // A NFe usa UN/KG; nosso cadastro usa as mesmas siglas fora G/ML.
    unidade: normalizarUnidade(item.unidadeMedida),
    quantidade: item.quantidade,
    valorUnitario: item.valorUnitario,
    valorTotal: item.valorTotal,
    origemMercadoria: perfil.origemMercadoria,
    csosn: simples ? perfil.csosn : null,
    cstIcms: simples ? null : perfil.cstIcms,
    aliquotaIcms: simples ? 0 : perfil.aliquotaIcms,
    baseCalculoIcms: baseIcms,
    valorIcms,
    cstPis: perfil.cstPis,
    aliquotaPis: perfil.aliquotaPis,
    valorPis: centavos(item.valorTotal * (perfil.aliquotaPis / 100)),
    cstCofins: perfil.cstCofins,
    aliquotaCofins: perfil.aliquotaCofins,
    valorCofins: centavos(item.valorTotal * (perfil.aliquotaCofins / 100)),
  };
}

function normalizarUnidade(unidade: string) {
  if (unidade === "G" || unidade === "ML") return "UN";
  return unidade === "L" ? "LT" : unidade;
}

export function montarPagamento(
  tipo: string,
  nome: string,
  valor: number,
  troco: number
): PagamentoNota {
  return {
    codigo: CODIGO_PAGAMENTO[tipo] ?? "99",
    descricao: nome,
    valor,
    troco,
  };
}

export type DadosMontagem = {
  serie: number;
  numero: number;
  codigoNumerico: number;
  ambiente: "HOMOLOGACAO" | "PRODUCAO";
  contingencia: boolean;
  emitente: NotaParaEmitir["emitente"];
  destinatario: NotaParaEmitir["destinatario"];
  itens: ItemDaComanda[];
  pagamentos: PagamentoNota[];
  desconto: number;
  taxaServico: number;
};

/**
 * Monta a nota completa.
 *
 * A **taxa de serviço fica de fora do total**: ela é gorjeta, não mercadoria, e
 * incluí-la na NFC-e faria o restaurante pagar imposto sobre o dinheiro do
 * garçom. É o erro mais caro que um PDV comete nessa integração.
 */
export function montarNota(dados: DadosMontagem): NotaParaEmitir {
  const itens = dados.itens.map((item, i) =>
    montarItem(item, i + 1, dados.emitente.regime)
  );

  const valorProdutos = centavos(itens.reduce((s, i) => s + i.valorTotal, 0));
  const desconto = centavos(Math.min(dados.desconto, valorProdutos));
  const valorTotal = centavos(valorProdutos - desconto);

  const observacao =
    dados.taxaServico > 0
      ? `Taxa de servico de R$ ${dados.taxaServico.toFixed(2).replace(".", ",")} cobrada a parte, nao inclusa nesta nota.`
      : null;

  return {
    serie: dados.serie,
    numero: dados.numero,
    codigoNumerico: dados.codigoNumerico,
    ambiente: dados.ambiente,
    emissao: new Date(),
    contingencia: dados.contingencia,
    emitente: dados.emitente,
    destinatario: dados.destinatario,
    itens,
    pagamentos: dados.pagamentos,
    valorProdutos,
    valorDesconto: desconto,
    valorTotal,
    informacoesComplementares: observacao,
  };
}
