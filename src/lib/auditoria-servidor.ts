import "server-only";
import { headers } from "next/headers";
import type { Prisma } from "@prisma/client";
import type { Registro } from "./auditoria";
import type { Sessao } from "./session";

/**
 * Monta a linha do diário para gravar **junto** com a mudança.
 *
 * Devolve dados em vez de gravar, de propósito: o chamador põe isto na mesma
 * transação da alteração. Gravar por fora abriria a hipótese de o desconto
 * existir e o registro não — que é exatamente o caso em que alguém iria
 * querer conferir.
 */
export async function auditoria(
  sessao: Sessao,
  registro: Registro
): Promise<Prisma.AuditLogUncheckedCreateInput> {
  return {
    tenantId: sessao.tenantId,
    unidadeId: sessao.unidadeId,
    usuarioId: sessao.usuarioId,
    entidade: registro.entidade,
    entidadeId: registro.entidadeId,
    acao: registro.acao,
    antes: registro.antes,
    depois: registro.depois,
    ip: await ipDaRequisicao(),
  };
}

/**
 * O IP de quem agiu.
 *
 * Num salão todo mundo sai pelo mesmo IP e o campo não diz nada. Ele começa a
 * valer quando a ação vem de fora — o gerente mexendo no preço de casa, de
 * madrugada. Melhor esforço: se o cabeçalho não vier, fica nulo.
 */
async function ipDaRequisicao(): Promise<string | null> {
  try {
    const cabecalhos = await headers();
    const encaminhado = cabecalhos.get("x-forwarded-for");
    // O proxy empilha os saltos; o primeiro é o cliente.
    if (encaminhado) return encaminhado.split(",")[0]!.trim();
    return cabecalhos.get("x-real-ip");
  } catch {
    return null;
  }
}
