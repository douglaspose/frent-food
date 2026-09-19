import { centro, COLUNAS, linha, pares, quebrar } from "../impressao";
import { formatarChave } from "./chave";

const brl = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export type DadosDanfe = {
  emitente: { razaoSocial: string; cnpj: string; endereco: string | null };
  numero: number;
  serie: number;
  ambiente: "HOMOLOGACAO" | "PRODUCAO";
  autorizadaEm: Date;
  chaveAcesso: string;
  protocolo: string;
  qrCodeDados: string;
  urlConsulta: string;
  itens: { descricao: string; quantidade: number; unidade: string; valorUnitario: number; valorTotal: number }[];
  valorProdutos: number;
  valorDesconto: number;
  valorTotal: number;
  pagamentos: { descricao: string; valor: number; troco: number }[];
  consumidor: { cpf: string | null; nome: string | null } | null;
  observacao: string | null;
};

/**
 * DANFE NFC-e simplificado, em 48 colunas.
 *
 * A ordem dos blocos e o texto fixo seguem o manual: identificação do emitente,
 * itens, totais, forma de pagamento, mensagem de consulta, chave, dados do
 * consumidor e protocolo. O QR Code vai como marcador, e o agente de impressão
 * o converte em QR de verdade via ESC/POS.
 */
export function montarDanfe(d: DadosDanfe) {
  const l: string[] = [];

  l.push(centro(d.emitente.razaoSocial.toUpperCase()));
  l.push(centro(`CNPJ ${d.emitente.cnpj}`));
  if (d.emitente.endereco) {
    for (const parte of quebrar(d.emitente.endereco)) l.push(centro(parte));
  }
  l.push(linha());
  l.push(centro("DANFE NFC-e"));
  l.push(centro("Documento Auxiliar da Nota Fiscal"));
  l.push(centro("de Consumidor Eletronica"));

  // Em homologação a nota não vale; o manual exige dizer isso em destaque.
  if (d.ambiente === "HOMOLOGACAO") {
    l.push("");
    l.push(centro("EMITIDA EM AMBIENTE DE HOMOLOGACAO"));
    l.push(centro("SEM VALOR FISCAL"));
  }

  l.push(linha());
  l.push("COD  DESCRICAO           QTD UN   VL UN   TOTAL");
  l.push(linha());

  d.itens.forEach((item, i) => {
    const codigo = String(i + 1).padStart(3, "0");
    const partes = quebrar(item.descricao, COLUNAS - 5);
    l.push(`${codigo}  ${partes[0]}`);
    for (const parte of partes.slice(1)) l.push(`     ${parte}`);

    const detalhe = `     ${item.quantidade} ${item.unidade} x ${brl.format(item.valorUnitario)}`;
    l.push(pares(detalhe, brl.format(item.valorTotal)));
  });

  l.push(linha());
  l.push(pares(`QTD. TOTAL DE ITENS`, String(d.itens.length)));
  l.push(pares("VALOR TOTAL DOS PRODUTOS", brl.format(d.valorProdutos)));
  if (d.valorDesconto > 0) l.push(pares("DESCONTO", `-${brl.format(d.valorDesconto)}`));
  l.push(pares("VALOR A PAGAR", `R$ ${brl.format(d.valorTotal)}`));
  l.push(linha());

  l.push("FORMA DE PAGAMENTO            VALOR PAGO");
  for (const p of d.pagamentos) {
    l.push(pares(p.descricao, brl.format(p.valor)));
    if (p.troco > 0) l.push(pares("  Troco", brl.format(p.troco)));
  }

  l.push(linha());
  l.push(centro("Consulte pela chave de acesso em:"));
  // À esquerda de propósito: URL centralizada que passa de uma linha deixa a
  // continuação boiando no meio do papel e difícil de ler.
  for (const parte of quebrar(d.urlConsulta)) l.push(parte);
  l.push("");
  l.push(centro("CHAVE DE ACESSO"));
  // Em blocos de 4: é assim que o cliente consegue digitar no site.
  for (const parte of quebrar(formatarChave(d.chaveAcesso))) l.push(centro(parte));

  l.push(linha());
  l.push(
    d.consumidor?.cpf
      ? `CONSUMIDOR CPF: ${d.consumidor.cpf}${d.consumidor.nome ? ` - ${d.consumidor.nome}` : ""}`
      : "CONSUMIDOR NAO IDENTIFICADO"
  );
  l.push(linha());

  l.push(
    pares(
      `NFC-e no ${d.numero} Serie ${d.serie}`,
      d.autorizadaEm.toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    )
  );
  l.push(`Protocolo de autorizacao: ${d.protocolo}`);

  if (d.observacao) {
    l.push(linha());
    for (const parte of quebrar(d.observacao)) l.push(parte);
  }

  l.push(linha());
  // O agente troca este marcador por um QR Code real via ESC/POS.
  l.push(`[[QRCODE:${d.qrCodeDados}]]`);

  return l.join("\n");
}
