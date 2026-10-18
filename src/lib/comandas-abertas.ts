/**
 * Como se nomeia uma comanda aberta para quem precisa achá-la.
 *
 * Nasceu de um caixa que não fechava: "ainda há 1 comanda(s) aberta(s), feche
 * todas antes de fechar o caixa" sobre uma comanda **de balcão** — sem mesa, e
 * por isso ausente do mapa do salão, que só monta as que têm mesa. O número
 * estava certo e era inútil: não dizia qual, e a que travava não aparecia em
 * tela nenhuma.
 *
 * Aqui mora só o nome: quem lê o banco é quem chama. É o suficiente para a
 * conferência deste texto caber num teste — e é dele que depende o caixa
 * conseguir fechar a noite.
 */

export type ComandaAberta = {
  numero: number;
  /** O número da mesa, quando a comanda tem mesa. */
  mesa: string | null;
};

/** "mesa 9 (#281)" para a de salão; "balcão (#282)" para a que não tem mesa. */
export function nomeDaComanda(comanda: ComandaAberta): string {
  const onde = comanda.mesa ? `mesa ${comanda.mesa}` : "balcão";
  return `${onde} (#${comanda.numero})`;
}

/**
 * A frase da recusa, com as comandas nomeadas.
 *
 * Até cinco por extenso, porque é o que cabe numa linha de aviso e o que uma
 * casa costuma ter esquecido aberto. Acima disso, o resto vira contagem: a
 * lista inteira de uma casa cheia não ajudaria ninguém a achar nada.
 */
export function porQueOCaixaNaoFecha(comandas: ComandaAberta[]): string {
  if (comandas.length === 0) return "";

  const nomes = comandas.slice(0, 5).map(nomeDaComanda);
  const sobraram = comandas.length - nomes.length;
  const lista = sobraram > 0 ? `${nomes.join(", ")} e mais ${sobraram}` : nomes.join(", ");
  const quantas = comandas.length === 1 ? "1 comanda aberta" : `${comandas.length} comandas abertas`;

  return `Ainda há ${quantas}: ${lista}. Feche todas antes de fechar o caixa.`;
}
