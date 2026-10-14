import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { declararTenant } from "@/lib/tenant-atual";
import { reabrirConta } from "@/lib/fechamento";
import { ErroDeOperacao } from "@/lib/erro-de-operacao";
import { operadorDaRequisicao, podeNoAparelho, unidadeDoAparelho } from "@/lib/maquininha";

export const dynamic = "force-dynamic";

/**
 * POST /api/maquininha/comandas/[id]/reabrir — "traz mais uma cerveja".
 *
 * Existe por causa do botão ao lado: depois de pedir a conta, a comanda fica em
 * fechamento e não recebe item novo. O pedido que vem depois disso é a coisa
 * mais comum do mundo num restaurante, e sem esta porta o garçom ficaria
 * parado na mesa com o aparelho que acabou de travar a própria mesa.
 *
 * Quem lança item reabre, como no PDV: é para lançar que se reabre.
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

  if (!podeNoAparelho(operador.permissoes, "comanda.lancarItem")) {
    return NextResponse.json({ erro: "Seu acesso não permite reabrir a conta." }, { status: 403 });
  }

  const { id: comandaId } = await params;

  const comanda = await db.comanda.findFirst({
    where: { id: comandaId, unidadeId: unidade.id },
    select: { id: true },
  });
  if (!comanda) return NextResponse.json({ erro: "Conta não encontrada." }, { status: 404 });

  try {
    const { reaberta } = await reabrirConta(operador, comandaId);
    // `reaberta` falso quer dizer que ela já estava aberta — e isso não é erro:
    // dois toques no mesmo botão, ou o reenvio de uma resposta perdida.
    return NextResponse.json({ ok: true, reaberta });
  } catch (e) {
    if (e instanceof ErroDeOperacao) {
      return NextResponse.json({ erro: e.message }, { status: 409 });
    }
    console.error("Falha ao reabrir a conta pela maquininha", e);
    return NextResponse.json({ erro: "Não foi possível reabrir a conta." }, { status: 500 });
  }
}
