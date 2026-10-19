import { db } from "@/lib/db";
import { publicar } from "@/lib/eventos";
import { comandaDaUnidade } from "@/lib/da-unidade";

/**
 * O chamado da mesa — levantar a mão, e alguém responder.
 *
 * O cliente chama pelo QR da mesa (`/mesa/[token]`) ou o próprio salão
 * registra; o selo acende no mapa do PDV. Atender é a outra metade: apaga o
 * selo e para o relógio de espera. A regra mora aqui porque agora são duas
 * portas — o tablet do balcão e a maquininha no bolso de quem está no salão,
 * que é justamente quem vai até a mesa.
 */

/**
 * Quem está atendendo.
 *
 * A unidade entrou aqui depois: dizia-se que "só o restaurante importa, o
 * chamado é da mesa" — e é verdade que quem atende é quem está perto. Mas
 * "perto" é dentro da mesma casa: apagar o chamado da filial pela matriz
 * deixava a mesa de lá com a mão levantada e sem o aviso na tela de quem
 * poderia ir até ela.
 */
export type QuemAtende = { tenantId: string; unidadeId: string };

export async function atenderChamado(quem: QuemAtende, comandaId: string) {
  const comanda = await comandaDaUnidade(comandaId, quem);

  // Já atendido não é erro: dois garçons podem ir à mesma mesa, e o segundo
  // não precisa descobrir isso por uma mensagem vermelha.
  if (!comanda.chamadoGarcomEm) return { atendido: false };

  await db.comanda.update({ where: { id: comandaId }, data: { chamadoGarcomEm: null } });
  await publicar(comanda.unidadeId, "chamado");
  return { atendido: true };
}
