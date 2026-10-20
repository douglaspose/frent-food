/**
 * Por onde a cozinha e o bar recebem o pedido.
 *
 * Havia um caminho só, e ele fazia as duas coisas: o ticket aparecia no KDS
 * **e** o papel entrava na fila de impressão. Numa casa que só olha a tela,
 * isso enchia a fila de papel que ninguém imprime; numa casa que trabalha com
 * comanda pendurada na praça, sobrava um quadro que ninguém toca — e cada
 * ticket virava "atrasado" na barra depois de vinte minutos, o dia inteiro.
 *
 * Então a casa escolhe, e a escolha é uma só por unidade:
 *
 *   - `TELA`: o KDS é a cozinha. Nada de papel de produção.
 *   - `PAPEL`: a térmica da praça é a cozinha. O ticket nasce `NO_PAPEL`, fora
 *     do quadro e fora dos alertas, porque não há quem toque nele na tela.
 *   - `TELA_E_PAPEL`: as duas, que é como o sistema sempre se comportou — e
 *     por isso é o padrão: ninguém acorda com a cozinha diferente por causa de
 *     uma atualização.
 *
 * Sem `server-only`: o catálogo de parâmetros e a tela de ajustes também
 * precisam destes nomes.
 */

export const DESTINOS_DO_PEDIDO = ["TELA", "PAPEL", "TELA_E_PAPEL"] as const;
export type DestinoDoPedido = (typeof DESTINOS_DO_PEDIDO)[number];

export const CHAVE_DO_DESTINO = "producao.destinoDoPedido";
export const DESTINO_PADRAO: DestinoDoPedido = "TELA_E_PAPEL";

/** O papel de produção sai nesta casa. */
export const saiNoPapel = (destino: DestinoDoPedido) => destino !== "TELA";

/**
 * O ticket é acompanhado na tela.
 *
 * É o que decide o estado em que ele nasce: acompanhado, entra no fluxo do KDS
 * (na fila ou em preparo); não acompanhado, nasce `NO_PAPEL` e sai do caminho.
 */
export const vaiParaTela = (destino: DestinoDoPedido) => destino !== "PAPEL";

/** O valor guardado, se for um dos três; qualquer outra coisa é o padrão. */
export function destinoValido(bruto: unknown): DestinoDoPedido {
  return DESTINOS_DO_PEDIDO.includes(bruto as DestinoDoPedido)
    ? (bruto as DestinoDoPedido)
    : DESTINO_PADRAO;
}
