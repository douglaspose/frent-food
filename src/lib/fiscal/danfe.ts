import { centro, COLUNAS, linha, pares, quebrar } from "../impressao";
import { formatarChave, urlDeConsulta } from "./chave";
import type { NotaParaEmitir } from "./tipos";

const brl = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export type DadosDanfe = {
  emitente: { razaoSocial: string; cnpj: string; endereco: string | null };
  numero: number;
  serie: number;
  ambiente: "HOMOLOGACAO" | "PRODUCAO";
  /** A hora que vai no papel: a da autorização, ou a da venda na contingência. */
  autorizadaEm: Date;
  chaveAcesso: string;
  /** Nulo na contingência: a autorização ainda não aconteceu. */
  protocolo: string | null;
  /**
   * Nulo na contingência.
   *
   * O QR Code da NFC-e leva um hash assinado com o CSC, e quem assina é o
   * emissor — que, na contingência, é justamente quem não respondeu. O cupom
   * sai com a chave em blocos de quatro, que é como o cliente a digita no site
   * da SEFAZ.
   */
  qrCodeDados: string | null;
  urlConsulta: string;
  /**
   * Emitida offline, com a SEFAZ fora do ar.
   *
   * O papel muda: ganha o aviso de contingência e perde o protocolo. A lei
   * manda entregar o cupom ao consumidor **na hora da venda**, mesmo sem
   * autorização — e é por isso que este modo existe.
   */
  contingencia?: boolean;
  itens: { descricao: string; quantidade: number; unidade: string; valorUnitario: number; valorTotal: number }[];
  valorProdutos: number;
  valorDesconto: number;
  valorTotal: number;
  pagamentos: { descricao: string; valor: number; troco: number }[];
  consumidor: { cpf: string | null; nome: string | null } | null;
  observacao: string | null;
};

/**
 * O papel de uma nota, a partir do documento que foi emitido.
 *
 * Os três lugares que imprimem DANFE — a emissão autorizada, a emissão que
 * caiu em contingência e a transmissão posterior — montavam o mesmo literal de
 * trinta linhas, cada um pegando os campos de um objeto diferente. Era uma
 * cópia a mais a cada caminho novo, e a terceira já nasceu divergindo.
 *
 * O `NotaParaEmitir` tem tudo o que o papel precisa, inclusive o endereço do
 * emitente; o que varia é o desfecho, e é só ele que entra por parâmetro.
 */
export function danfeDaNota(
  documento: NotaParaEmitir,
  desfecho:
    | {
        autorizadaEm: Date;
        protocolo: string;
        chaveAcesso: string;
        qrCodeDados: string;
        urlConsulta: string;
      }
    | { contingencia: true; chaveAcesso: string }
) {
  const e = documento.emitente;
  const autorizada = "protocolo" in desfecho;

  return montarDanfe({
    emitente: {
      razaoSocial: e.razaoSocial,
      cnpj: e.cnpj,
      endereco: [e.logradouro, e.numero, e.bairro, e.municipio].filter(Boolean).join(", "),
    },
    numero: documento.numero,
    serie: documento.serie,
    ambiente: documento.ambiente,
    // Na contingência o papel leva a hora da **venda**, que é quando ele saiu.
    autorizadaEm: autorizada ? desfecho.autorizadaEm : documento.emissao,
    chaveAcesso: desfecho.chaveAcesso,
    protocolo: autorizada ? desfecho.protocolo : null,
    qrCodeDados: autorizada ? desfecho.qrCodeDados : null,
    urlConsulta: autorizada
      ? desfecho.urlConsulta
      : urlDeConsulta(documento.emitente.uf, documento.ambiente),
    contingencia: !autorizada,
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
  });
}

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

  /*
   * O aviso da contingência, em destaque e antes dos itens.
   *
   * É o que diz ao cliente — e ao fiscal, se ele aparecer — que este cupom
   * saiu com o serviço da SEFAZ fora do ar e que a autorização vem depois. Sem
   * ele, o papel se apresentaria como nota autorizada sem nunca ter sido.
   */
  if (d.contingencia) {
    l.push("");
    l.push(centro("EMITIDA EM CONTINGENCIA"));
    l.push(centro("PENDENTE DE AUTORIZACAO"));
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
  /*
   * À esquerda e sem o esquema.
   *
   * À esquerda porque URL centralizada que passa de uma linha deixa a
   * continuação boiando no meio do papel. Sem o `https://` porque com ele o
   * endereço de homologação tem 49 caracteres e o papel tem 48 — a última
   * letra caía sozinha na linha de baixo, que é como estava saindo. Ninguém
   * digita o esquema, e quem lê sabe que é um site.
   */
  for (const parte of quebrar(d.urlConsulta.replace(/^https?:\/\//, ""))) l.push(parte);
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
  if (d.protocolo) {
    l.push(`Protocolo de autorizacao: ${d.protocolo}`);
  } else {
    // Sem protocolo não se escreve "autorizada": o que há é a promessa de
    // transmitir, e o prazo dela.
    l.push("Autorizacao pendente - transmissao em ate 24h");
  }

  if (d.observacao) {
    l.push(linha());
    for (const parte of quebrar(d.observacao)) l.push(parte);
  }

  if (d.qrCodeDados) {
    l.push(linha());
    // O agente troca este marcador por um QR Code real via ESC/POS.
    l.push(`[[QRCODE:${d.qrCodeDados}]]`);
  }

  return l.join("\n");
}
