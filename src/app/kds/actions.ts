"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { exigirSessao } from "@/lib/session";
import { publicar } from "@/lib/eventos";
import { emResultado, ErroDeOperacao } from "@/lib/erro-de-operacao";

/** O status do ticket e o dos itens dele andam juntos. */
const STATUS_DO_ITEM = {
  EM_PREPARO: "EM_PREPARO",
  PRONTO: "PRONTO",
  ENTREGUE: "ENTREGUE",
} as const;

type Avanco = keyof typeof STATUS_DO_ITEM;

const CARIMBO: Record<Avanco, "iniciadoEm" | "prontoEm" | "entregueEm"> = {
  EM_PREPARO: "iniciadoEm",
  PRONTO: "prontoEm",
  ENTREGUE: "entregueEm",
};

/**
 * Move um ticket para a próxima etapa e propaga o status para os itens da
 * comanda — é assim que o garçom vê "PRONTO" na tela dele sem a cozinha
 * precisar avisar.
 */
export async function avancarPedido(pedidoId: string, para: Avanco) {
  return emResultado(async () => {
    // Basta estar logado: mover ticket é o trabalho de todo mundo na cozinha,
    // e travar isso por cargo só faria o cozinheiro chamar o gerente a cada prato.
    const sessao = await exigirSessao();

    const pedido = await db.pedido.findUniqueOrThrow({
      where: { id: pedidoId },
      include: {
        itens: { select: { comandaItemId: true } },
        comanda: { select: { status: true } },
      },
    });
    if (pedido.tenantId !== sessao.tenantId) throw new ErroDeOperacao("Pedido de outro restaurante.");
    if (pedido.status === "CANCELADO") throw new ErroDeOperacao("Este pedido foi cancelado.");
    if (pedido.comanda.status === "CANCELADA") {
      throw new ErroDeOperacao("A conta desta mesa foi cancelada.");
    }

    const avancarTicket = db.pedido.update({
      where: { id: pedidoId },
      data: { status: para, [CARIMBO[para]]: new Date() },
    });

    // Conta paga com prato ainda por fazer: a cozinha segue com o ticket, mas
    // os itens ficam como a finalização os deixou. Propagar voltaria para
    // "em preparo" um item de conta fechada.
    if (pedido.comanda.status === "PAGA") {
      await avancarTicket;
      revalidatePath("/kds");
      await publicar(sessao.unidadeId, "ticket-avancou");
      return;
    }

    await db.$transaction([
      avancarTicket,
      /**
       * O item cancelado fica cancelado. Sem este filtro, a cozinha tocando
       * "em preparo" num ticket com um prato já cancelado devolvia o prato à
       * conta: o cliente pagava o que devolveu, e o estoque — devolvido no
       * cancelamento — ficava errado. O dia simulado achou isto como conta
       * que "recebeu a menos".
       */
      db.comandaItem.updateMany({
        where: {
          id: { in: pedido.itens.map((i) => i.comandaItemId) },
          status: { notIn: ["CANCELADO", "PENDENTE"] },
        },
        data: { status: STATUS_DO_ITEM[para] },
      }),
    ]);

    revalidatePath("/kds");
    revalidatePath("/pdv");
    await publicar(sessao.unidadeId, "ticket-avancou");
  });
}
