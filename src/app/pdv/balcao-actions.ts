"use server";

import { revalidatePath } from "next/cache";
import { receberBalcaoPelaRetaguarda } from "@/lib/balcao";
import { exigirSessao } from "@/lib/session";
import { emResultado } from "@/lib/erro-de-operacao";

/**
 * Receber pela retaguarda a venda de balcão que ficou presa.
 *
 * A permissão não é conferida aqui: quem a confere é a regra, que ou deixa
 * passar (quem responde pela gaveta) ou devolve `precisaAutorizacao` para a
 * tela pedir o PIN do gerente. É o mesmo caminho do cancelamento de item.
 */
export async function receberBalcao(
  comandaId: string,
  formaPagamentoId: string,
  autorizacaoId?: string | null
) {
  const sessao = await exigirSessao();

  const resposta = await emResultado(() =>
    receberBalcaoPelaRetaguarda(sessao, { comandaId, formaPagamentoId, autorizacaoId })
  );

  // O mapa do salão mostra a faixa das sem mesa, e o caixa trava por elas: as
  // duas telas precisam esquecer o que sabiam.
  revalidatePath("/pdv");
  revalidatePath("/pdv/caixa");

  return resposta;
}
