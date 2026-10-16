"use server";

import { aprovarComPin, type ResultadoDaAprovacao } from "@/lib/autorizacao-servidor";
import { exigirSessao } from "@/lib/session";
import type { TipoAutorizacao } from "@/lib/autorizacao";

/**
 * O gerente digita o PIN no tablet do garçom e a liberação fica presa a esta
 * ação e a este alvo. Nada aqui recebe ou devolve o PIN — ele entra, é
 * conferido e some.
 */
export async function pedirAutorizacao(
  tipo: TipoAutorizacao,
  referenciaId: string,
  pin: string,
  motivo?: string
): Promise<ResultadoDaAprovacao> {
  return aprovarComPin(await exigirSessao(), tipo, referenciaId, pin, motivo);
}
