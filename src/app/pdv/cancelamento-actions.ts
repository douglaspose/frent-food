"use server";

import { revalidatePath } from "next/cache";
import { exigirSessao } from "@/lib/session";
import { cancelarItem as cancelar } from "@/lib/cancelamento";
import type { PrecisaAutorizacao } from "@/lib/autorizacao";
import { emResultado, type ComErro } from "@/lib/erro-de-operacao";

/**
 * Cancela um item já enviado para a cozinha.
 *
 * A regra mora em `@/lib/cancelamento`, compartilhada com a maquininha — quem
 * ouve "esse eu não quero mais" é o garçom que está na mesa. O que sobra aqui
 * é a sessão e a tela.
 */
export async function cancelarItem(
  itemId: string,
  motivo: string,
  autorizacaoId?: string | null
): Promise<{ ok: true } | PrecisaAutorizacao | ComErro> {
  return emResultado(async () => {
    const sessao = await exigirSessao();
    const r = await cancelar(sessao, { itemId, motivo, autorizacaoId });

    revalidatePath("/pdv");
    revalidatePath("/kds");
    return r;
  });
}
