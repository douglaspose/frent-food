import { db } from "@/lib/db";
import { publicar } from "@/lib/eventos";
import { ErroDeOperacao } from "@/lib/erro-de-operacao";

/**
 * O chamado da mesa — levantar a mão, e alguém responder.
 *
 * O cliente chama pelo QR da mesa (`/mesa/[token]`) ou o próprio salão
 * registra; o selo acende no mapa do PDV. Atender é a outra metade: apaga o
 * selo e para o relógio de espera. A regra mora aqui porque agora são duas
 * portas — o tablet do balcão e a maquininha no bolso de quem está no salão,
 * que é justamente quem vai até a mesa.
 */

/** Quem está atendendo. Só o restaurante importa: o chamado é da mesa. */
export type QuemAtende = { tenantId: string };

export async function atenderChamado(quem: QuemAtende, comandaId: string) {
  const comanda = await db.comanda.findUniqueOrThrow({ where: { id: comandaId } });
  if (comanda.tenantId !== quem.tenantId) throw new ErroDeOperacao("Comanda de outro restaurante.");

  // Já atendido não é erro: dois garçons podem ir à mesma mesa, e o segundo
  // não precisa descobrir isso por uma mensagem vermelha.
  if (!comanda.chamadoGarcomEm) return { atendido: false };

  await db.comanda.update({ where: { id: comandaId }, data: { chamadoGarcomEm: null } });
  await publicar(comanda.unidadeId, "chamado");
  return { atendido: true };
}
