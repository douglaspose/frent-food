/**
 * Tamanho da fonte dos campos de digitação operados no celular.
 *
 * 16px não é escolha de tipografia: abaixo disso o Safari do iPhone amplia a
 * página sozinho quando o campo recebe o foco, e ela fica assim até alguém
 * perceber e desfazer com os dedos. No meio de um lançamento de pedido isso
 * acontece a cada item. A regra é fixa do sistema e não se desliga — a única
 * saída é o campo ter 16px. Do `sm` para cima volta aos 14px do resto.
 *
 * Isto é uma constante, e não uma classe repetida em cada campo, porque o
 * caminho óbvio não funciona: uma regra `input { font-size: 16px }` no CSS
 * global perde em especificidade para a classe do Tailwind, e só venceria com
 * `!important` — que atropelaria também os campos já acima de 16px.
 *
 * O scanner do Tailwind lê a string literal daqui, então as classes entram no
 * CSS mesmo sem aparecer escritas nos componentes.
 */
export const TEXTO_DE_CAMPO = "text-base sm:text-sm";
