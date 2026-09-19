import { centavos } from "./comanda";

/**
 * A conta da gaveta, num lugar só.
 *
 * Três telas precisam deste número: o "esperado na gaveta" durante o turno, a
 * trava que impede retirar mais do que existe, e o "apurado" do fechamento.
 * Com três cópias da fórmula, a divergência do fechamento acabaria medindo o
 * desencontro entre elas em vez da diferença real da gaveta — e ninguém
 * descobriria, porque cada tela continuaria coerente consigo mesma.
 *
 * Sem `server-only`: o painel do caixa é componente de cliente e usa a mesma
 * função, que é justamente o ponto.
 */

/**
 * Quem opera a gaveta. Qualquer uma destas abre a tela do caixa.
 *
 * A tela mostra quanto há em dinheiro na gaveta agora, o faturamento do turno
 * por forma de pagamento e o histórico de sangrias — quem tirou e para onde
 * levou. É a mesma classe de informação que a retaguarda esconde de quem está
 * atendendo mesa, e "R$ 3.240 na gaveta" circulando pelo salão é o tipo de
 * coisa que nenhum dono quer.
 *
 * Fica aqui, numa lista só, porque a barra e a própria tela precisam decidir
 * igual: esconder o botão não é segurança, então as duas conferem.
 */
export const PERMISSOES_DO_CAIXA = ["caixa.abrir", "caixa.fechar", "caixa.sangria"];

/** Sangria e pagamento tiram; suprimento e recebimento põem. */
export const RETIRA_DA_GAVETA = new Set(["SANGRIA", "PAGAMENTO"]);

export type MovimentoDeCaixa = { tipo: string; valor: number };

export function saldoDeMovimentos(movimentos: MovimentoDeCaixa[]) {
  return centavos(
    movimentos.reduce((soma, m) => (RETIRA_DA_GAVETA.has(m.tipo) ? soma - m.valor : soma + m.valor), 0)
  );
}

/**
 * Quanto de papel-moeda deveria estar na gaveta.
 *
 * Cartão e Pix não passam por ela; o troco devolvido sai dela — por isso quem
 * chama passa o **líquido** do que entrou em dinheiro, não o valor cheio.
 */
export function dinheiroNaGaveta(dados: {
  fundoCaixa: number;
  recebidoEmEspecie: number;
  movimentos: MovimentoDeCaixa[];
}) {
  return centavos(
    dados.fundoCaixa + dados.recebidoEmEspecie + saldoDeMovimentos(dados.movimentos)
  );
}
