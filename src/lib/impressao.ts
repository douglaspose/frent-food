import { calcularTotais, centavos } from "./comanda";

/**
 * Impressora térmica de 80mm imprime 48 colunas na fonte padrão. Todo o layout
 * daqui é monoespaçado nessa largura — por isso alinhamento é feito com espaço,
 * não com tabulação.
 *
 * É o padrão, não a única: a térmica embutida numa maquininha é de 58mm e faz
 * 32. Por isso cada papel aceita a largura de quem vai imprimi-lo, e esta
 * constante serve só a quem não disser nada.
 */
export const COLUNAS = 48;

// Máximo também: sem ele, uma divisão como 178,09 / 4 sai "44,523" no papel.
const brl = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Letra dupla na térmica: o dobro da largura e o dobro da altura.
 *
 * Na impressora é `GS ! n`, o comando de tamanho do ESC/POS — `0x11` dobra as
 * duas medidas, `0x00` volta ao normal. Mas o texto que fica guardado na fila
 * não leva o comando, leva um marcador: o comando que desliga termina no byte
 * zero, e o Postgres não guarda byte zero numa coluna de texto ("invalid byte
 * sequence for encoding UTF8: 0x00"). A primeira versão fazia exatamente isso,
 * e derrubava a impressão da conferência em toda mesa.
 *
 * Os marcadores são SO e SI ("shift out" e "shift in") — dois caracteres que o
 * ASCII criou justamente para trocar de conjunto de caracteres e voltar, e que
 * não aparecem em texto de verdade. A rota do agente troca pelos comandos na
 * entrega (`paraImpressora`), e a tela os tira (`paraTela`).
 *
 * Com a letra dupla cabem 24 colunas, e não 48. Quem usa `grande` monta a
 * linha já nessa largura.
 */
const LIGA_GRANDE = "\x0e";
const DESLIGA_GRANDE = "\x0f";
export const COLUNAS_GRANDES = COLUNAS / 2;

/** Em letra dupla cabe metade, seja qual for a largura do papel. */
export const grandesDe = (colunas: number) => Math.floor(colunas / 2);

function grande(texto: string, colunas = COLUNAS) {
  return LIGA_GRANDE + texto.slice(0, grandesDe(colunas)) + DESLIGA_GRANDE;
}

/**
 * O texto como deve aparecer numa tela, sem os marcadores de letra dupla.
 *
 * A fila de impressão tem um "ver" na gestão; com o marcador no meio do texto,
 * a tela mostraria caractere estranho no lugar da letra grande.
 */
export function paraTela(conteudo: string) {
  return conteudo.split(LIGA_GRANDE).join("").split(DESLIGA_GRANDE).join("");
}

/**
 * O papel linha a linha, dizendo quais saem em letra dupla — para a prévia na
 * tela desenhar o que a impressora desenha.
 *
 * Só tirar os marcadores (`paraTela`) não bastava: a linha grande é montada em
 * 24 colunas para ocupar 48 no papel, e em letra normal na tela ela aparecia
 * torta, com a mesa e o total encolhidos à esquerda.
 */
export function linhasParaTela(conteudo: string) {
  return conteudo
    .split("\n")
    .map((l) => ({ texto: paraTela(l), grande: l.includes(LIGA_GRANDE) }));
}

/**
 * Caractere de controle que não é a quebra de linha nem um dos marcadores.
 * Escrito pelo código do caractere para o arquivo não carregar nenhum deles.
 */
const CONTROLE_ESTRANHO = new RegExp("[\\u0000-\\u0009\\u000b-\\u000d\\u0010-\\u001f\\u007f]", "g");

/**
 * O texto como vai para a impressora: marcadores trocados pelo ESC/POS.
 *
 * Antes disso, sai todo caractere de controle que não seja a quebra de linha
 * ou um marcador. O agente manda o conteúdo byte a byte para a térmica, e o
 * papel carrega texto digitado — ponto da carne, nome do cliente, observação.
 * Um `ESC p` no meio dele é o pulso que abre a gaveta de dinheiro; um `GS V`
 * corta o papel. O único comando no papel é o que este arquivo põe.
 */
export function paraImpressora(conteudo: string) {
  return conteudo
    .replace(CONTROLE_ESTRANHO, "")
    .split(LIGA_GRANDE)
    .join("\x1d\x21\x11")
    .split(DESLIGA_GRANDE)
    .join("\x1d\x21\x00");
}

/**
 * Quanto a linha ocupa no papel, em colunas.
 *
 * Contar caracteres não serve mais: o marcador não ocupa nada, e cada letra
 * dupla ocupa duas colunas. É por esta medida que se garante que nenhuma
 * linha estoura as 48 — uma linha grande de 25 letras quebraria no meio do
 * valor.
 */
export function larguraImpressa(linhaDoPapel: string) {
  const visivel = paraTela(linhaDoPapel).length;
  return linhaDoPapel.includes(LIGA_GRANDE) ? visivel * 2 : visivel;
}

export function linha(caractere = "-", largura = COLUNAS) {
  return caractere.repeat(largura);
}

export function centro(texto: string, largura = COLUNAS) {
  const t = texto.slice(0, largura);
  const espacos = Math.max(0, Math.floor((largura - t.length) / 2));
  return " ".repeat(espacos) + t;
}

/** Texto à esquerda e valor à direita, preenchendo o meio. */
export function pares(esquerda: string, direita: string, preenchimento = " ", largura = COLUNAS) {
  const sobra = largura - esquerda.length - direita.length;
  if (sobra < 1) return `${esquerda.slice(0, largura - direita.length - 1)} ${direita}`;
  return esquerda + preenchimento.repeat(sobra) + direita;
}

/**
 * Quebra respeitando palavras, para o nome do produto não cortar no meio.
 *
 * Palavra maior que a largura é partida à força — é o caso da URL de consulta
 * da NFC-e, que não tem espaço nenhum. Sem isso ela era truncada e o cliente
 * ficava com um endereço que não abre.
 */
/**
 * O par numa linha, ou em duas quando não cabe.
 *
 * `pares` corta a esquerda para a direita caber, o que em papel largo nunca
 * acontecia. Em 32 colunas, "Aberta em: 14/10, 17:00" com "Impressa: 14/10,
 * 17:34" virava "Aberta em Impressa: 14/10, 17:34" — a hora de abertura
 * sumia e o que sobrava parecia uma frase quebrada. Empilhado, cada data fica
 * legível, e a de baixo alinhada à direita continua parecendo um par.
 */
export function paresEmpilhando(
  esquerda: string,
  direita: string,
  largura = COLUNAS
): string[] {
  if (esquerda.length + direita.length + 1 <= largura) {
    return [pares(esquerda, direita, " ", largura)];
  }
  return [...quebrar(esquerda, largura), pares("", direita, " ", largura)];
}

export function quebrar(texto: string, largura = COLUNAS) {
  const palavras = texto.split(/\s+/).flatMap((palavra) => {
    if (palavra.length <= largura) return [palavra];
    const pedacos: string[] = [];
    for (let i = 0; i < palavra.length; i += largura) {
      pedacos.push(palavra.slice(i, i + largura));
    }
    return pedacos;
  });

  const linhas: string[] = [];
  let atual = "";

  for (const palavra of palavras) {
    if (!atual) atual = palavra;
    else if (atual.length + 1 + palavra.length <= largura) atual += ` ${palavra}`;
    else {
      linhas.push(atual);
      atual = palavra;
    }
  }
  if (atual) linhas.push(atual);
  return linhas.length > 0 ? linhas : [""];
}

function horario(data: Date) {
  return data.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Só a hora: o dia do pagamento é o da conferência, e o espaço da linha é curto. */
function hora(data: Date) {
  return data.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export type ItemImpressao = {
  titulo: string;
  quantidade: number;
  precoTotal?: number;
  pontoCarne?: string | null;
  observacao?: string | null;
  /**
   * As escolhas do cliente: "sem cebola", "bacon extra", "ponto para a mesa".
   * Vêm com o título congelado no lançamento, e não o de hoje — o papel tem de
   * dizer o que foi pedido, mesmo que a casa renomeie o adicional depois.
   */
  opcionais?: { titulo: string; quantidade: number }[];
};

/**
 * Comanda de produção: o papel que fica pendurado na cozinha.
 *
 * Sem preço nenhum — cozinheiro não precisa saber quanto custa, e a informação
 * a mais só atrapalha na hora de ler rápido. Mesa e quantidade vêm grandes.
 */
export function comandaDeProducao(
  dados: {
    estacao: string;
    pedidoNumero: number;
    mesa: string | null;
    comandaNumero: number;
    garcom: string;
    criadoEm: Date;
    itens: ItemImpressao[];
  },
  colunas = COLUNAS
) {
  const linhas: string[] = [];

  linhas.push(linha("=", colunas));
  linhas.push(centro(dados.estacao.toUpperCase(), colunas));
  linhas.push(
    centro(dados.mesa ? `MESA ${dados.mesa}` : `COMANDA ${dados.comandaNumero}`, colunas)
  );
  linhas.push(linha("=", colunas));
  linhas.push(pares(`Pedido #${dados.pedidoNumero}`, horario(dados.criadoEm), " ", colunas));
  linhas.push(`Garcom: ${dados.garcom}`);
  linhas.push(linha("-", colunas));

  for (const item of dados.itens) {
    const prefixo = `${item.quantidade}x `;
    const partes = quebrar(item.titulo, colunas - prefixo.length);
    linhas.push(prefixo + partes[0]);
    // Continuação alinhada sob o título, não sob a quantidade.
    for (const parte of partes.slice(1)) linhas.push(" ".repeat(prefixo.length) + parte);

    if (item.pontoCarne) linhas.push(`   >> ${item.pontoCarne}`);
    /*
     * As escolhas antes da observação: elas mudam o prato (bacon extra, sem
     * cebola), enquanto a observação é o recado solto. Na correria, o
     * cozinheiro lê de cima para baixo e para no primeiro branco.
     */
    for (const opcional of item.opcionais ?? []) {
      const vezes = opcional.quantidade > 1 ? `${opcional.quantidade}x ` : "";
      for (const parte of quebrar(vezes + opcional.titulo, colunas - 6)) {
        linhas.push(`   + ${parte}`);
      }
    }
    if (item.observacao) {
      for (const parte of quebrar(item.observacao, colunas - 6)) linhas.push(`   * ${parte}`);
    }
    linhas.push("");
  }

  linhas.push(linha("=", colunas));
  return linhas.join("\n");
}

/**
 * Cancelamento: o papel que manda a cozinha parar.
 *
 * Sai na mesma impressora da comanda de produção, e precisa gritar. Um papel
 * parecido com o de produção seria pendurado junto com os outros e o prato
 * sairia do mesmo jeito — por isso a palavra ocupa três linhas cheias, com o
 * item logo abaixo e o motivo por último.
 */
export function comandaDeCancelamento(
  dados: {
    estacao: string;
    pedidoNumero: number;
    mesa: string | null;
    comandaNumero: number;
    canceladoPor: string;
    motivo: string | null;
    canceladoEm: Date;
    item: ItemImpressao;
  },
  colunas = COLUNAS
) {
  const linhas: string[] = [];

  linhas.push(linha("*", colunas));
  linhas.push(centro("*** CANCELAMENTO ***", colunas));
  linhas.push(linha("*", colunas));
  linhas.push(centro(dados.estacao.toUpperCase(), colunas));
  linhas.push(
    centro(dados.mesa ? `MESA ${dados.mesa}` : `COMANDA ${dados.comandaNumero}`, colunas)
  );
  linhas.push(linha("-", colunas));
  linhas.push(pares(`Pedido #${dados.pedidoNumero}`, horario(dados.canceladoEm), " ", colunas));
  linhas.push(linha("-", colunas));

  linhas.push("NAO PREPARAR:");
  const prefixo = `${dados.item.quantidade}x `;
  const partes = quebrar(dados.item.titulo, colunas - prefixo.length);
  linhas.push(prefixo + partes[0]);
  for (const parte of partes.slice(1)) linhas.push(" ".repeat(prefixo.length) + parte);
  if (dados.item.pontoCarne) linhas.push(`   >> ${dados.item.pontoCarne}`);

  linhas.push(linha("-", colunas));
  if (dados.motivo) {
    for (const parte of quebrar(`Motivo: ${dados.motivo}`, colunas)) linhas.push(parte);
  }
  linhas.push(`Cancelado por: ${dados.canceladoPor}`);
  linhas.push(linha("*", colunas));

  return linhas.join("\n");
}

/**
 * Aviso de mesa trocada.
 *
 * A cozinha de papel já tem um ticket pendurado com o número velho. Sem este
 * aviso, o prato sai para a mesa errada — e quem descobre é o cliente que não
 * pediu aquilo.
 */
export function avisoDeTransferencia(
  dados: {
    estacao: string;
    pedidoNumero: number;
    de: string;
    para: string;
    comandaNumero: number;
    transferidoPor: string;
    transferidoEm: Date;
    itens: ItemImpressao[];
  },
  colunas = COLUNAS
) {
  const linhas: string[] = [];

  linhas.push(linha("*", colunas));
  linhas.push(centro("*** MUDOU DE MESA ***", colunas));
  linhas.push(linha("*", colunas));
  linhas.push(centro(dados.estacao.toUpperCase(), colunas));
  linhas.push(linha("=", colunas));
  // O par velho→novo em destaque: é a única informação que a cozinha precisa
  // ler de longe para corrigir o papel pendurado.
  linhas.push(centro(`MESA ${dados.de}  >>>  MESA ${dados.para}`, colunas));
  linhas.push(linha("=", colunas));
  linhas.push(pares(`Pedido #${dados.pedidoNumero}`, horario(dados.transferidoEm), " ", colunas));
  linhas.push(linha("-", colunas));

  for (const item of dados.itens) {
    const prefixo = `${item.quantidade}x `;
    const partes = quebrar(item.titulo, colunas - prefixo.length);
    linhas.push(prefixo + partes[0]);
    for (const parte of partes.slice(1)) linhas.push(" ".repeat(prefixo.length) + parte);
  }

  linhas.push(linha("-", colunas));
  linhas.push(`Comanda #${dados.comandaNumero}`);
  linhas.push(`Transferido por: ${dados.transferidoPor}`);
  linhas.push(linha("*", colunas));

  return linhas.join("\n");
}

/**
 * Conferência de conta: o papel que vai para a mesa antes de pagar.
 * Não é documento fiscal, e diz isso.
 */
export function conferenciaDeConta(
  dados: {
  restaurante: string;
  mesa: string | null;
  comandaNumero: number;
  pessoas: number;
  nomeCliente: string | null;
  abertaEm: Date;
  taxaServicoPct: number;
  descontoValor: number;
  descontoMotivo: string | null;
  itens: { titulo: string; quantidade: number; precoTotal: number }[];
  /**
   * O que já foi pago — os clientes que acertaram a parte deles e foram
   * embora. Valor líquido, sem o troco: para quem ficou na mesa, o que conta
   * é quanto entrou na conta, não quanto foi entregue na mão.
   */
  pagamentos?: { forma: string; valor: number; em: Date }[];
  segundaVia?: boolean;
  },
  colunas = COLUNAS
) {
  const grandes = grandesDe(colunas);
  const totais = calcularTotais({
    itens: dados.itens,
    taxaServicoPct: dados.taxaServicoPct,
    descontoValor: dados.descontoValor,
  });

  const linhas: string[] = [];
  linhas.push(centro(dados.restaurante.toUpperCase(), colunas));
  linhas.push(centro("CONFERENCIA DE CONSUMO", colunas));
  if (dados.segundaVia) linhas.push(centro("*** SEGUNDA VIA ***", colunas));
  linhas.push(linha("=", colunas));
  // A mesa em letra dupla: é o que o garçom procura no papel antes de levar.
  linhas.push(
    grande(
      centro(dados.mesa ? `Mesa ${dados.mesa}` : `Comanda ${dados.comandaNumero}`, grandes),
      colunas
    )
  );
  linhas.push(
    pares(`Comanda #${dados.comandaNumero}`, `${dados.pessoas} pessoa(s)`, " ", colunas)
  );
  if (dados.nomeCliente) linhas.push(`Cliente: ${dados.nomeCliente}`);
  // A hora da impressão morava na linha da mesa; em letra dupla não cabe.
  linhas.push(
    ...paresEmpilhando(
      `Aberta em: ${horario(dados.abertaEm)}`,
      `Impressa: ${horario(new Date())}`,
      colunas
    )
  );
  linhas.push(linha("-", colunas));

  for (const item of dados.itens) {
    const valor = brl.format(item.precoTotal);
    const prefixo = `${item.quantidade}x `;
    const partes = quebrar(item.titulo, colunas - prefixo.length - valor.length - 1);
    linhas.push(pares(prefixo + partes[0], valor, " ", colunas));
    for (const parte of partes.slice(1)) linhas.push(" ".repeat(prefixo.length) + parte);
  }

  linhas.push(linha("-", colunas));
  linhas.push(pares("Subtotal", brl.format(totais.subtotal), " ", colunas));
  if (totais.desconto > 0) {
    linhas.push(
      pares(
        `Desconto${dados.descontoMotivo ? ` (${dados.descontoMotivo})` : ""}`,
        `-${brl.format(totais.desconto)}`,
        " ",
        colunas
      )
    );
  }
  if (dados.taxaServicoPct > 0) {
    linhas.push(
      pares(
        `Taxa de servico ${dados.taxaServicoPct}%`,
        brl.format(totais.taxaServico),
        " ",
        colunas
      )
    );
  }
  linhas.push(linha("=", colunas));
  // O total em letra dupla, montado na metade das colunas para caber no papel.
  linhas.push(grande(pares("TOTAL", `R$ ${brl.format(totais.total)}`, " ", grandes), colunas));
  if (dados.pessoas > 1) {
    linhas.push(
      pares(
        `Por pessoa (${dados.pessoas})`,
        brl.format(totais.total / dados.pessoas),
        " ",
        colunas
      )
    );
  }

  /*
   * Quem já pagou e foi embora.
   *
   * Sem isto, os que ficaram na mesa recebiam o total inteiro, sem sinal de
   * que parte já entrou — e o garçom tinha de explicar de cabeça quem pagou o
   * quê, ou alguém pagava de novo. Cada pagamento com a forma e a hora, que é
   * o que ajuda a mesa a reconhecer "esse fui eu". Sem pagamento, o papel é o
   * de sempre.
   */
  const pagamentos = dados.pagamentos ?? [];
  if (pagamentos.length > 0) {
    const pago = centavos(pagamentos.reduce((soma, p) => soma + p.valor, 0));
    linhas.push(linha("-", colunas));
    linhas.push("JA PAGO");
    for (const p of pagamentos) {
      linhas.push(pares(`  ${p.forma}`, `${hora(p.em)}   ${brl.format(p.valor)}`, " ", colunas));
    }
    linhas.push(linha("-", colunas));
    linhas.push(
      pares(
        "FALTA PAGAR",
        `R$ ${brl.format(Math.max(0, centavos(totais.total - pago)))}`,
        " ",
        colunas
      )
    );
  }

  linhas.push(linha("=", colunas));
  linhas.push("");
  linhas.push(centro("NAO E DOCUMENTO FISCAL", colunas));
  if (dados.taxaServicoPct > 0) linhas.push(centro("A taxa de servico e opcional", colunas));

  return linhas.join("\n");
}

/**
 * Remonta um papel guardado na fila, na largura de quem vai imprimi-lo.
 *
 * A fila guarda o texto pronto em 48 colunas — é ele que garante que a segunda
 * via saia idêntica à primeira. Mas quem busca pode ter outra largura: a
 * térmica embutida numa maquininha faz 32. Guardando também os argumentos que
 * montaram o papel, dá para montá-lo de novo na medida certa, em vez de tentar
 * reflui­r um texto já formatado — que é como se perde o valor no fim da linha.
 *
 * Volta `null` quando não dá para remontar: trabalho antigo sem `dados`, tipo
 * que não se remonta (a DANFE tem layout da SEFAZ) ou JSON que não bate com o
 * tipo. Quem chama cai no texto guardado, que é o que sempre foi entregue.
 */
export function remontar(
  tipo: string,
  dados: unknown,
  colunas: number
): string | null {
  if (!dados || typeof dados !== "object") return null;

  // As datas viajaram como texto no JSON e voltam como texto: quem monta o
  // papel espera Date, e `horario()` de uma string daria "Invalid Date".
  const comDatas = reviverDatas(dados as Record<string, unknown>);

  try {
    switch (tipo) {
      case "COMANDA_PRODUCAO":
        return comandaDeProducao(comDatas as never, colunas);
      case "CANCELAMENTO":
        return comandaDeCancelamento(comDatas as never, colunas);
      case "TRANSFERENCIA":
        return avisoDeTransferencia(comDatas as never, colunas);
      case "CONFERENCIA":
        return conferenciaDeConta(comDatas as never, colunas);
      case "CUPOM":
        return cupomDePagamento(comDatas as never, colunas);
      default:
        // DANFE_NFCE e o que vier depois: layout que não é nosso para refazer.
        return null;
    }
  } catch {
    /*
     * Papel que não remonta não pode parar a impressão: o texto guardado sai
     * como sempre saiu, mesmo que estreito demais. Melhor um cupom apertado do
     * que um pedido que não chega à cozinha.
     */
    return null;
  }
}

/** Converte de volta em `Date` o que o JSON transformou em texto ISO. */
function reviverDatas(objeto: Record<string, unknown>): Record<string, unknown> {
  const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
  const convertido: Record<string, unknown> = {};
  for (const [chave, valor] of Object.entries(objeto)) {
    if (typeof valor === "string" && ISO.test(valor)) {
      convertido[chave] = new Date(valor);
    } else if (Array.isArray(valor)) {
      convertido[chave] = valor.map((v) =>
        v && typeof v === "object" ? reviverDatas(v as Record<string, unknown>) : v
      );
    } else if (valor && typeof valor === "object") {
      convertido[chave] = reviverDatas(valor as Record<string, unknown>);
    } else {
      convertido[chave] = valor;
    }
  }
  return convertido;
}

/** Cupom entregue depois do pagamento, com as formas usadas. */
export function cupomDePagamento(
  dados: {
    restaurante: string;
    mesa: string | null;
    comandaNumero: number;
    total: number;
    pagamentos: { forma: string; valor: number; troco: number }[];
    operador: string;
  },
  colunas = COLUNAS
) {
  const linhas: string[] = [];
  linhas.push(centro(dados.restaurante.toUpperCase(), colunas));
  linhas.push(centro("COMPROVANTE DE PAGAMENTO", colunas));
  linhas.push(linha("=", colunas));
  linhas.push(
    pares(
      dados.mesa ? `Mesa ${dados.mesa}` : `Comanda ${dados.comandaNumero}`,
      horario(new Date()),
      " ",
      colunas
    )
  );
  linhas.push(pares(`Comanda #${dados.comandaNumero}`, dados.operador, " ", colunas));
  linhas.push(linha("-", colunas));
  linhas.push(pares("TOTAL", `R$ ${brl.format(dados.total)}`, " ", colunas));
  linhas.push(linha("-", colunas));

  for (const p of dados.pagamentos) {
    linhas.push(pares(p.forma, brl.format(p.valor), " ", colunas));
    if (p.troco > 0) linhas.push(pares("  Troco", brl.format(p.troco), " ", colunas));
  }

  linhas.push(linha("=", colunas));
  linhas.push("");
  linhas.push(centro("Obrigado pela preferencia!", colunas));
  linhas.push(centro("NAO E DOCUMENTO FISCAL", colunas));

  return linhas.join("\n");
}
