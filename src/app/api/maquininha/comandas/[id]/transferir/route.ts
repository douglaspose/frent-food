import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { declararTenant } from "@/lib/tenant-atual";
import { transferirMesa } from "@/lib/transferencia";
import { ErroDeOperacao } from "@/lib/erro-de-operacao";
import { operadorDaRequisicao, podeNoAparelho, unidadeDoAparelho } from "@/lib/maquininha";

export const dynamic = "force-dynamic";

/**
 * POST /api/maquininha/comandas/[id]/transferir — a conta muda de mesa.
 *
 * "Dá para sentar lá fora?" é dito ao garçom que está na mesa, e abrir na mesa
 * errada se descobre na mesa errada: as duas coisas acontecem com ele de pé no
 * salão, e as duas obrigavam uma volta ao tablet do balcão.
 *
 * A regra é a mesma do PDV (`@/lib/transferencia`), inclusive a trava que
 * impede duas contas de caírem na mesma mesa livre. O destino sai da lista de
 * mesas livres que o aparelho já recebe do salão.
 *
 * Repetir é seguro: a conta que já está na mesa pedida responde `mudou: false`
 * em vez de registrar uma segunda transferência.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unidade = await unidadeDoAparelho(request);
  if (!unidade?.ativo) {
    return NextResponse.json({ erro: "Token do aparelho inválido." }, { status: 401 });
  }
  declararTenant(unidade.tenantId);

  const operador = await operadorDaRequisicao(request, unidade);
  if (!operador) {
    return NextResponse.json({ erro: "Sessão do operador expirada." }, { status: 401 });
  }

  if (!podeNoAparelho(operador.permissoes, "mesa.transferir")) {
    return NextResponse.json({ erro: "Seu acesso não permite transferir mesa." }, { status: 403 });
  }

  let corpo: { mesaDestinoId?: string };
  try {
    corpo = (await request.json()) as typeof corpo;
  } catch {
    return NextResponse.json({ erro: "Corpo inválido: envie JSON." }, { status: 400 });
  }

  if (typeof corpo?.mesaDestinoId !== "string" || !corpo.mesaDestinoId) {
    return NextResponse.json({ erro: "Mesa de destino sem identificação." }, { status: 400 });
  }

  const { id: comandaId } = await params;

  /*
   * Conta e mesa conferidas aqui, antes de qualquer escrita, e as duas pela
   * unidade do aparelho: id de outra unidade responde como id inventado, em
   * vez de deixar a maquininha descobrir o salão do restaurante vizinho.
   */
  const comanda = await db.comanda.findFirst({
    where: { id: comandaId, unidadeId: unidade.id },
    select: { id: true },
  });
  if (!comanda) return NextResponse.json({ erro: "Conta não encontrada." }, { status: 404 });

  const destino = await db.mesa.findFirst({
    where: { id: corpo.mesaDestinoId, unidadeId: unidade.id },
    select: { id: true },
  });
  if (!destino) return NextResponse.json({ erro: "Mesa não encontrada." }, { status: 404 });

  try {
    const r = await transferirMesa(operador, comandaId, destino.id);
    return NextResponse.json({ ok: true, mesa: r.numero, mudou: r.mudou });
  } catch (e) {
    // ErroDeOperacao é frase pronta para a tela ("A mesa 12 já tem a comanda
    // #87 aberta."), que é o que o garçom precisa ler para escolher outra.
    if (e instanceof ErroDeOperacao) {
      return NextResponse.json({ erro: e.message }, { status: 409 });
    }
    console.error("Falha ao transferir a mesa pela maquininha", e);
    return NextResponse.json({ erro: "Não foi possível transferir a mesa." }, { status: 500 });
  }
}
