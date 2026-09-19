import "server-only";
import { db } from "./db";
import { padroes, valorDoParametro } from "./parametros";

export type Ajustes = Record<string, boolean | number>;

/**
 * Lê os parâmetros da unidade, já com os padrões preenchidos.
 *
 * Sempre devolve todas as chaves do catálogo: quem chama nunca precisa tratar
 * "ainda não foi salvo", que é o caso de toda unidade recém-criada e a origem
 * mais provável de um `undefined` virando `0` num cálculo de alerta.
 */
export async function lerAjustes(unidadeId: string, chaves?: string[]): Promise<Ajustes> {
  const linhas = await db.parametroUnidade.findMany({
    where: { unidadeId, ...(chaves ? { chave: { in: chaves } } : {}) },
    select: { chave: true, valor: true },
  });

  const ajustes = padroes();
  for (const linha of linhas) {
    ajustes[linha.chave] = valorDoParametro(linha.chave, linha.valor);
  }
  return ajustes;
}

/** Atalhos para quem só precisa de uma chave e quer o tipo certo. */
export async function ajusteBooleano(unidadeId: string, chave: string): Promise<boolean> {
  return Boolean((await lerAjustes(unidadeId, [chave]))[chave]);
}

export async function ajusteNumerico(unidadeId: string, chave: string): Promise<number> {
  return Number((await lerAjustes(unidadeId, [chave]))[chave]);
}
