import { centavos } from "./comanda";

/**
 * Como a casa reparte a taxa de serviço entre as áreas da equipe.
 *
 * Cada casa tem a sua: uma dá tudo ao atendimento, outra divide com a cozinha,
 * outra ainda separa uma parte para a gerência. Por isso é uma lista que o
 * dono monta, e não um número fixo.
 *
 * A porcentagem é **da taxa**, não da conta: com 10% de taxa, uma área com 40
 * leva 4% da conta. Assim a divisão continua valendo na conta com taxa
 * diferente, e as áreas sempre somam 100.
 *
 * Sem `server-only`: a tela de ajustes confere a soma antes de salvar, e o
 * servidor confere de novo com a mesma função.
 */

/** Guardado como parâmetro da unidade, fora do catálogo de ajustes simples. */
export const CHAVE_DIVISAO_DA_TAXA = "caixa.divisaoTaxaServico";

export const MAXIMO_DE_AREAS = 10;
export const TAMANHO_DO_NOME = 40;

export type AreaDaTaxa = { nome: string; pct: number };

/**
 * O que veio do banco, só com o que tem forma de área.
 *
 * O campo é `Json`: qualquer coisa pode estar lá. Valor torto vira "sem
 * divisão", que mostra o total inteiro — nunca uma repartição inventada.
 */
export function lerDivisao(bruto: unknown): AreaDaTaxa[] {
  if (!Array.isArray(bruto)) return [];
  const areas = bruto.filter(
    (a): a is AreaDaTaxa =>
      typeof a === "object" &&
      a !== null &&
      typeof (a as AreaDaTaxa).nome === "string" &&
      typeof (a as AreaDaTaxa).pct === "number"
  );
  return validarDivisao(areas) ? [] : areas.map((a) => ({ nome: a.nome.trim(), pct: a.pct }));
}

/** O motivo da recusa, ou `null` quando a divisão está boa. Lista vazia é "não dividir". */
export function validarDivisao(areas: AreaDaTaxa[]): string | null {
  if (areas.length === 0) return null;
  if (areas.length > MAXIMO_DE_AREAS) return `No máximo ${MAXIMO_DE_AREAS} áreas.`;

  const vistos = new Set<string>();
  for (const a of areas) {
    const nome = typeof a.nome === "string" ? a.nome.trim() : "";
    if (!nome) return "Dê um nome a cada área.";
    if (nome.length > TAMANHO_DO_NOME) return `Nome de área com até ${TAMANHO_DO_NOME} letras.`;
    if (vistos.has(nome.toLowerCase())) return `A área "${nome}" aparece duas vezes.`;
    vistos.add(nome.toLowerCase());

    if (!Number.isInteger(a.pct) || a.pct < 1 || a.pct > 100) {
      return `A parte de "${nome}" precisa ser um número inteiro de 1 a 100.`;
    }
  }

  const soma = areas.reduce((s, a) => s + a.pct, 0);
  if (soma !== 100) return `As áreas somam ${soma}% da taxa; precisam somar 100%.`;
  return null;
}

/**
 * Quanto cabe a cada área.
 *
 * Cada uma leva a sua porcentagem arredondada ao centavo, e a última leva o
 * que sobrou: arredondando todas, a soma podia sair um centavo acima ou abaixo
 * do que entrou — e esse centavo é de alguém.
 */
export function dividirTaxa(total: number, areas: AreaDaTaxa[]) {
  let distribuido = 0;
  return areas.map((a, i) => {
    const valor =
      i === areas.length - 1 ? centavos(total - distribuido) : centavos(total * (a.pct / 100));
    distribuido = centavos(distribuido + valor);
    return { ...a, valor };
  });
}
