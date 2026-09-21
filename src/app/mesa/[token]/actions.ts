"use server";

import { revalidatePath } from "next/cache";
import { db, dbSemRls } from "@/lib/db";
import { atravessandoRestaurantes, comTenant } from "@/lib/tenant-atual";
import { registrarFalha, verificar } from "@/lib/limite-tentativas";
import { publicar } from "@/lib/eventos";
import { emResultado } from "@/lib/erro-de-operacao";

/**
 * Chamado de garçom feito pelo cliente, pelo QR da mesa.
 *
 * Não exige sessão — quem usa é o cliente, não o restaurante. A autorização
 * vem do token da mesa: quem não está sentado ali não tem como descobri-lo.
 */
export async function chamarGarcomPeloQr(token: string) {
  return emResultado(async () => {
    // Sem freio, um engraçadinho com o token faria a mesa piscar sem parar.
    const freio = await verificar(`qr:${token}`);
    if (freio.bloqueado) {
      return { erro: "Já chamamos o garçom. Ele está a caminho." };
    }

    /**
     * Sem sessão não há cookie de onde o adapter tire o restaurante: sob RLS,
     * a busca da mesa voltava vazia e o cliente lia "Mesa não encontrada." —
     * a função não existia em produção. Como no agente de impressão, o token
     * é credencial e endereço: a mesa é achada atravessando, e o resto roda
     * declarado no restaurante dela.
     */
    const mesa = await atravessandoRestaurantes("QR da mesa: identificar pelo token", () =>
      dbSemRls.mesa.findUnique({
        where: { qrToken: token },
        select: { id: true, ativo: true, unidadeId: true, tenantId: true },
      })
    );

    if (!mesa?.ativo) return { erro: "Mesa não encontrada." };

    return comTenant(mesa.tenantId, async () => {
      const comanda = await db.comanda.findFirst({
        where: { mesaId: mesa.id, status: { in: ["ABERTA", "FECHANDO"] } },
        select: { id: true, chamadoGarcomEm: true },
      });
      if (!comanda) return { erro: "Esta mesa ainda não foi aberta." };

      await registrarFalha(`qr:${token}`);

      // Chamado repetido não reinicia o relógio: o tempo de espera conta desde o
      // primeiro pedido de atenção, que é o que o cliente sente.
      if (!comanda.chamadoGarcomEm) {
        await db.comanda.update({
          where: { id: comanda.id },
          data: { chamadoGarcomEm: new Date() },
        });
      }

      revalidatePath("/pdv");
      /**
       * O caso em que o tempo real paga sozinho: o cliente levanta a mão pelo QR e
       * o selo acende no tablet do garçom em menos de um segundo. Com o ciclo de
       * 15s, ele podia esperar quinze segundos por um chamado que já tinha sido
       * feito — e o cliente sente cada um deles.
       */
      await publicar(mesa.unidadeId, "chamado");
      return { ok: true as const };
    });
  });
}
