import "server-only";
import { db } from "./db";
import { padroes, valorDoParametro } from "./parametros";
import { CHAVE_DO_DESTINO, destinoValido, type DestinoDoPedido } from "./producao";
import { CHAVE_DIVISAO_DA_TAXA, lerDivisao, type AreaDaTaxa } from "./divisao-da-taxa";

export type Ajustes = Record<string, boolean | number | string>;

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

/**
 * Por onde a cozinha e o bar desta unidade recebem o pedido.
 *
 * Atalho próprio, e não `ajusteTexto` genérico: quem chama recebe o tipo dos
 * três destinos, e o valor estranho no banco cai no padrão aqui, uma vez, em
 * vez de em cada `if` de quem lê.
 */
export async function destinoDoPedido(unidadeId: string): Promise<DestinoDoPedido> {
  return destinoValido((await lerAjustes(unidadeId, [CHAVE_DO_DESTINO]))[CHAVE_DO_DESTINO]);
}

/** As áreas que repartem a taxa de serviço; vazio quando a casa não divide. */
export async function divisaoDaTaxa(unidadeId: string): Promise<AreaDaTaxa[]> {
  const linha = await db.parametroUnidade.findUnique({
    where: { unidadeId_chave: { unidadeId, chave: CHAVE_DIVISAO_DA_TAXA } },
    select: { valor: true },
  });
  return lerDivisao(linha?.valor);
}
