import { db } from "@/lib/db";
import { ErroDeOperacao } from "@/lib/erro-de-operacao";

/**
 * "Isto é da unidade de quem está pedindo?"
 *
 * O RLS é por **restaurante**, não por unidade: a conta, a gaveta e o ticket da
 * filial existem para a sessão da matriz, porque as duas são do mesmo tenant.
 * Quem segura a unidade é o código — e por isso ela tinha que ser conferida em
 * cada porta que recebe um id do navegador, uma por uma, o que é a receita de
 * esquecer em algumas.
 *
 * Esquecemos em doze. O caixa da matriz fechava o turno da filial e tirava
 * sangria da gaveta dela; o gerente abatia a conta de outra cidade. As quatro
 * primeiras foram corrigidas na rodada de teste de 18/10; as outras oito —
 * carrinho, cozinha, cancelamento, transferência, estorno, fechamento, chamado
 * e nota fiscal — são as que esta regra fecha de uma vez.
 *
 * A conferência vem depois da do restaurante, e as duas dizem coisas
 * diferentes: "de outro restaurante" é id inventado ou vazado; "de outra
 * unidade" é alguém logado na matriz mexendo na filial — acontece com gente de
 * boa-fé que trocou de unidade sem perceber, e a mensagem precisa dizer isso.
 *
 * Relacionado: a mesma armadilha do `aparelhoDaUnidade`, em `lib/aparelhos`.
 */

/** Quem está pedindo. É a sessão do navegador, ou o operador do PIN no aparelho. */
export type QuemPergunta = { tenantId: string; unidadeId: string };

/** O que tem dono e endereço: comanda, gaveta, mesa, aparelho. */
type ComDono = { tenantId: string; unidadeId: string };

/**
 * Confere o restaurante e a unidade, nesta ordem.
 *
 * `oQueE` entra na mensagem ("Comanda", "Pedido", "Pagamento") porque quem lê é
 * quem está no salão com o cliente na frente, e "registro de outra unidade" não
 * diz a ninguém o que fazer.
 */
export function conferirUnidade(coisa: ComDono, quem: QuemPergunta, oQueE: string) {
  if (coisa.tenantId !== quem.tenantId) {
    throw new ErroDeOperacao(`${oQueE} de outro restaurante.`);
  }
  if (coisa.unidadeId !== quem.unidadeId) {
    throw new ErroDeOperacao(`${oQueE} de outra unidade.`);
  }
}

/**
 * A comanda, se for desta unidade.
 *
 * `findUnique`, e não `findUniqueOrThrow`: sob RLS a comanda de outro
 * restaurante não existe para esta sessão, e o que chegava à tela era o erro do
 * Prisma com arquivo e linha, onde devia vir uma recusa legível.
 */
export async function comandaDaUnidade(comandaId: string, quem: QuemPergunta) {
  const comanda = await db.comanda.findUnique({ where: { id: comandaId } });
  if (!comanda) throw new ErroDeOperacao("Comanda não encontrada.");
  conferirUnidade(comanda, quem, "Comanda");
  return comanda;
}
