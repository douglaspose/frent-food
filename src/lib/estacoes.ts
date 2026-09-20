/** Acima disso os nomes deixam de caber e de ajudar. */
const CABEM_NO_TITULO = 3;

/**
 * O título do KDS quando nenhuma estação está filtrada.
 *
 * Dizer "Cozinha" ali era ambíguo: "Cozinha" também é o nome de uma das
 * estações, então o título parecia prometer o que o filtro entregava. Listar
 * os nomes resolve — a tela do Lipão passa a dizer "Bar & Cozinha", que é
 * exatamente o que está aparecendo.
 *
 * A lista só vale enquanto for curta. Numa casa com chapa, fritura, saladas,
 * sobremesas e bar, cinco nomes emendados viram uma faixa de texto que
 * ninguém lê de longe — e a tela do KDS é lida de longe, de relance, por
 * alguém de mãos ocupadas. A partir daí a contagem informa mais que os nomes.
 */
export function tituloDeTodasAsEstacoes(nomes: string[]): string {
  const limpos = nomes.map((n) => n.trim()).filter(Boolean);

  if (limpos.length === 0) return "Cozinha";
  if (limpos.length === 1) return limpos[0];
  if (limpos.length > CABEM_NO_TITULO) return `${limpos.length} estações`;

  // "Bar & Cozinha" com dois; "Bar, Chapa & Fritura" com três.
  const ultimo = limpos[limpos.length - 1];
  return `${limpos.slice(0, -1).join(", ")} & ${ultimo}`;
}
