"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { exigirPermissao } from "@/lib/session";
import { mesasLivres as livresDaUnidade } from "@/lib/abertura";
import { transferirMesa as transferir } from "@/lib/transferencia";
import { emResultado, ErroDeOperacao } from "@/lib/erro-de-operacao";

/**
 * Move a comanda inteira para outra mesa.
 *
 * A regra mora em `@/lib/transferencia`, compartilhada com a maquininha — o
 * garçom que ouve "dá para sentar lá fora?" está de pé no salão, com o
 * aparelho na mão. O que sobra aqui é a sessão e a tela.
 */
export async function transferirMesa(comandaId: string, mesaDestinoId: string) {
  return emResultado(async () => {
    const sessao = await exigirPermissao("mesa.transferir");
    const destino = await transferir(sessao, comandaId, mesaDestinoId);

    revalidatePath("/pdv");
    revalidatePath("/kds");
    return { mesaId: destino.mesaId, numero: destino.numero };
  });
}

/** Mesas livres da unidade, para escolher o destino. */
export async function mesasLivres(comandaId: string) {
  return emResultado(async () => {
    const sessao = await exigirPermissao("mesa.transferir");

    const comanda = await db.comanda.findUniqueOrThrow({
      where: { id: comandaId },
      select: { tenantId: true, unidadeId: true, mesaId: true },
    });
    if (comanda.tenantId !== sessao.tenantId) throw new ErroDeOperacao("Comanda de outro restaurante.");

    /*
     * A mesma lista que o aparelho usa para abrir mesa, menos a mesa onde a
     * conta já está: duas definições de "mesa livre" seria o caminho mais
     * curto para uma tela oferecer o destino que a outra recusa.
     */
    const mesas = await livresDaUnidade(comanda.unidadeId, { exceto: comanda.mesaId });
    return mesas.map((m) => ({
      id: m.mesaId,
      numero: m.numero,
      capacidade: m.capacidade,
      status: m.status,
      area: m.area,
    }));
  });
}
