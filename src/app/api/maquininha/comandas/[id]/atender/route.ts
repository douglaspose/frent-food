import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { declararTenant } from "@/lib/tenant-atual";
import { atenderChamado } from "@/lib/chamado";
import { ErroDeOperacao } from "@/lib/erro-de-operacao";
import { operadorDaRequisicao, unidadeDoAparelho } from "@/lib/maquininha";

export const dynamic = "force-dynamic";

/**
 * POST /api/maquininha/comandas/[id]/atender — alguém foi até a mesa.
 *
 * O cliente levanta a mão pelo QR da mesa e o selo acende no mapa do salão;
 * quem apaga o selo, até agora, era o tablet do balcão — apesar de quem vai
 * até a mesa ser justamente quem está com o aparelho no bolso.
 *
 * Sem permissão própria, como no PDV: atender um chamado é ir até a mesa, e
 * todo mundo que opera o aparelho faz isso. O que a operação apaga é um selo;
 * o consumo, a conta e o pagamento continuam cada um com a sua conferência.
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

  const { id: comandaId } = await params;

  const comanda = await db.comanda.findFirst({
    where: { id: comandaId, unidadeId: unidade.id },
    select: { id: true },
  });
  if (!comanda) return NextResponse.json({ erro: "Conta não encontrada." }, { status: 404 });

  try {
    const { atendido } = await atenderChamado(operador, comandaId);
    // `atendido` falso quer dizer que o selo já não estava lá: outro garçom
    // chegou primeiro, ou é o segundo toque do mesmo. Nenhum dos dois é erro.
    return NextResponse.json({ ok: true, atendido });
  } catch (e) {
    if (e instanceof ErroDeOperacao) {
      return NextResponse.json({ erro: e.message }, { status: 409 });
    }
    console.error("Falha ao atender o chamado pela maquininha", e);
    return NextResponse.json({ erro: "Não foi possível atender o chamado." }, { status: 500 });
  }
}
