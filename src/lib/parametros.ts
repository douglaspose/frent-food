/**
 * Catálogo dos parâmetros de comportamento da unidade.
 *
 * Fonte única: o seed cria a partir daqui, a tela de ajustes desenha a partir
 * daqui e o código lê com o padrão daqui. Antes, a lista vivia só no seed e
 * **nenhum** destes parâmetros era lido por lugar nenhum — o banco guardava
 * quatorze configurações que não configuravam nada.
 *
 * Sem `server-only`: o seed roda em Node puro e a tela de ajustes é
 * componente de cliente. As duas precisam desta lista.
 */

export type TipoParametro = "bool" | "inteiro";

export type Parametro = {
  chave: string;
  grupo: Grupo;
  tipo: TipoParametro;
  rotulo: string;
  /** O que muda de verdade quando se mexe. Aparece na tela, embaixo do rótulo. */
  explicacao: string;
  padrao: boolean | number;
  min?: number;
  max?: number;
  sufixo?: string;
};

export const GRUPOS = ["MESAS", "COZINHA", "KDS", "CAIXA", "IMPRESSAO"] as const;
export type Grupo = (typeof GRUPOS)[number];

export const TITULO_DO_GRUPO: Record<Grupo, string> = {
  MESAS: "Salão e mesas",
  COZINHA: "Lançamento",
  KDS: "Cozinha",
  CAIXA: "Caixa",
  IMPRESSAO: "Impressão",
};

export const PARAMETROS: Parametro[] = [
  {
    chave: "mesa.exigirIdentificacaoCliente",
    grupo: "MESAS",
    tipo: "bool",
    rotulo: "Exigir nome do cliente ao abrir a mesa",
    explicacao:
      "Desligado, o campo nem aparece ao abrir a mesa. Ligado, ele aparece e a abertura é recusada sem ele — útil onde a conta anda pelo salão e precisa de dono.",
    padrao: false,
  },
  {
    chave: "mesa.limparAutomaticamente",
    grupo: "MESAS",
    tipo: "bool",
    rotulo: "Liberar a mesa assim que a conta é paga",
    explicacao:
      "Desligado, a mesa fica SUJA no mapa até alguém liberar — é o fluxo de quem tem equipe de limpeza.",
    padrao: true,
  },
  {
    chave: "mesa.voltarParaAreasAoFechar",
    grupo: "MESAS",
    tipo: "bool",
    rotulo: "Mostrar todas as áreas ao voltar de uma conta",
    explicacao:
      "Desligado, o mapa guarda a área que o garçom estava filtrando. Quem atende sempre o mesmo setor prefere assim.",
    padrao: true,
  },
  {
    chave: "mesa.alertaSemLancamentoMin",
    grupo: "MESAS",
    tipo: "inteiro",
    rotulo: "Avisar mesa sentada sem pedir",
    explicacao:
      "O relógio cinza só acende depois deste tempo. Zero acende assim que a mesa abre.",
    padrao: 30,
    min: 0,
    max: 240,
    sufixo: "min",
  },
  {
    chave: "mesa.exibirNomeGarcomNosItens",
    grupo: "MESAS",
    tipo: "bool",
    rotulo: "Mostrar quem lançou cada item",
    explicacao:
      "O nome do garçom aparece na comanda. Desligado, sobra espaço na tela — o registro continua no banco.",
    padrao: true,
  },
  {
    chave: "cozinha.qtdMaximaPorLancamento",
    grupo: "COZINHA",
    tipo: "inteiro",
    rotulo: "Quantidade máxima por item",
    explicacao:
      "Freio para dedo pesado: 20 espetos lançados sem querer viram 20 espetos na chapa.",
    padrao: 99,
    min: 1,
    max: 999,
    sufixo: "un",
  },
  {
    chave: "cozinha.voltarParaCategoriaAposLancar",
    grupo: "COZINHA",
    tipo: "bool",
    rotulo: "Limpar a busca depois de lançar",
    explicacao:
      "Desligado, o resultado da busca fica na tela — quem lança o mesmo produto várias vezes seguidas ganha tempo.",
    padrao: true,
  },
  {
    chave: "kds.confirmarPedidoNaTela",
    grupo: "KDS",
    tipo: "bool",
    rotulo: "Cozinha confirma o pedido na tela",
    explicacao:
      "Ligado, o ticket nasce em NA FILA e alguém toca em 'Iniciar preparo'. Desligado, já entra em preparo — para cozinha que não quer o toque a mais.",
    padrao: true,
  },
  {
    chave: "kds.alertaAtrasoMin",
    grupo: "KDS",
    tipo: "inteiro",
    rotulo: "Ticket atrasado a partir de",
    explicacao: "O ticket fica vermelho e entra na contagem da barra.",
    padrao: 20,
    min: 1,
    max: 120,
    sufixo: "min",
  },
  {
    chave: "kds.alertaRetiradaMin",
    grupo: "KDS",
    tipo: "inteiro",
    rotulo: "Prato pronto esperando no balcão a partir de",
    explicacao: "Prato pronto parado esfria. Este é o ponto em que vale chamar alguém para levar.",
    padrao: 5,
    min: 1,
    max: 60,
    sufixo: "min",
  },
  {
    chave: "caixa.exigirMotivoDesconto",
    grupo: "CAIXA",
    tipo: "bool",
    rotulo: "Exigir motivo no desconto",
    explicacao: "Desconto sem motivo não responde nada a quem for conferir o diário depois.",
    padrao: true,
  },
  {
    chave: "caixa.exigirFundoNaAbertura",
    grupo: "CAIXA",
    tipo: "bool",
    rotulo: "Exigir fundo de troco na abertura",
    explicacao:
      "Abrir com zero faz o primeiro cliente que pagar em dinheiro ficar sem troco.",
    padrao: true,
  },
  {
    chave: "caixa.perguntarQtdPessoasAoPagar",
    grupo: "CAIXA",
    tipo: "bool",
    rotulo: "Confirmar número de pessoas ao fechar",
    explicacao:
      "A divisão por pessoa fica editável na tela de pagamento. Desligado, usa o número informado na abertura.",
    padrao: true,
  },
  {
    chave: "impressao.naoImprimirItensZerados",
    grupo: "IMPRESSAO",
    tipo: "bool",
    rotulo: "Omitir itens de valor zero na conta",
    explicacao:
      "Cortesia sai do papel do cliente. O item continua na comanda e nos relatórios.",
    padrao: true,
  },
  {
    chave: "impressao.imprimirCancelamentos",
    grupo: "IMPRESSAO",
    tipo: "bool",
    rotulo: "Imprimir aviso de cancelamento",
    explicacao:
      "Cozinha que pendura comanda precisa do papel, senão o prato sai mesmo cancelado. Quem só usa KDS pode desligar.",
    padrao: true,
  },
];

export const POR_CHAVE = new Map(PARAMETROS.map((p) => [p.chave, p]));

/**
 * Converte o que veio do banco para o tipo declarado.
 *
 * O campo é `Json`, então qualquer coisa pode ter sido gravada ali — inclusive
 * por uma versão anterior do sistema. Valor torto cai no padrão em vez de
 * virar `NaN` no meio de um cálculo de alerta.
 */
export function valorDoParametro(chave: string, bruto: unknown): boolean | number {
  const def = POR_CHAVE.get(chave);
  if (!def) return typeof bruto === "boolean" || typeof bruto === "number" ? bruto : false;

  if (def.tipo === "bool") return typeof bruto === "boolean" ? bruto : def.padrao;

  /**
   * Só número ou texto que é número. `Number(null)` e `Number("")` valem zero
   * — passariam no teste de "é finito" e virariam o mínimo da faixa em vez do
   * padrão, que é o oposto do que se espera de um valor ausente.
   */
  const n =
    typeof bruto === "number"
      ? bruto
      : typeof bruto === "string" && bruto.trim() !== ""
        ? Number(bruto)
        : NaN;

  if (!Number.isFinite(n)) return def.padrao;
  return Math.min(def.max ?? Infinity, Math.max(def.min ?? -Infinity, Math.round(n)));
}

/** Tudo com o padrão, para quem lê antes de a unidade ter salvo qualquer coisa. */
export function padroes(): Record<string, boolean | number> {
  return Object.fromEntries(PARAMETROS.map((p) => [p.chave, p.padrao]));
}
