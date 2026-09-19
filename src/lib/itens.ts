import type { Prisma } from "@prisma/client";

/**
 * Filtro do que conta como consumo.
 *
 * `PENDENTE` é carrinho: o garçom montou mas não enviou para a cozinha. Não
 * entra na conta, não vai para o cupom e não conta no faturamento — senão o
 * cliente pagaria por um pedido que ninguém preparou.
 *
 * `CANCELADO` sai pelo motivo óbvio.
 */
export const CONSUMO: Prisma.ComandaItemWhereInput = {
  status: { notIn: ["PENDENTE", "CANCELADO"] },
};
