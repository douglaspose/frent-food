import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { declararTenant } from "@/lib/tenant-atual";
import { adicionarItem, enviarCarrinho } from "@/lib/carrinho";
import { ErroDeOperacao } from "@/lib/erro-de-operacao";
import { operadorDaRequisicao, unidadeDoAparelho } from "@/lib/maquininha";

export const dynamic = "force-dynamic";

type ItemPedido = {
  cardapioItemId?: string;
  quantidade?: number;
  observacao?: string | null;
  /**
   * As escolhas do cliente nos grupos do produto (ponto, adicionais). Só os
   * identificadores: título e preço saem do cadastro, congelados na comanda,
   * porque é a porta aberta que manda isto.
   */
  opcionais?: { opcionalId?: string; quantidade?: number }[];
};

/**
 * POST /api/maquininha/comandas/[id]/itens — o garçom lança a rodada.
 *
 * A rodada inteira numa chamada só, e não uma por item: o garçom anota na
 * mesa, confere e manda. Item a item, uma rede ruim deixaria metade da rodada
 * na cozinha e metade no aparelho.
 *
 * A regra é a mesma do PDV (`@/lib/carrinho`), inclusive o preço, que sai do
 * cardápio e nunca do que a maquininha mandou.
 *
 * **Reenvio ainda duplica.** Se a resposta se perder depois de os itens terem
 * entrado, o garçom que tocar de novo lança a rodada duas vezes — ao contrário
 * do pagamento, que tem `referenciaExterna` para isso. O conserto é uma
 * referência por rodada, com índice único, e está anotado em `docs/maquininha.md`.
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

  const podeLancar =
    operador.permissoes.includes("*") || operador.permissoes.includes("comanda.lancarItem");
  if (!podeLancar) {
    return NextResponse.json({ erro: "Seu acesso não permite lançar itens." }, { status: 403 });
  }

  const { id: comandaId } = await params;

  let corpo: { itens?: ItemPedido[]; enviar?: boolean };
  try {
    corpo = (await request.json()) as typeof corpo;
  } catch {
    return NextResponse.json({ erro: "Corpo inválido: envie JSON." }, { status: 400 });
  }

  const itens = Array.isArray(corpo?.itens) ? corpo.itens : [];
  if (itens.length === 0) {
    return NextResponse.json({ erro: "Nenhum item para lançar." }, { status: 400 });
  }
  if (itens.some((i) => typeof i?.cardapioItemId !== "string" || !i.cardapioItemId)) {
    return NextResponse.json({ erro: "Item sem identificação do cardápio." }, { status: 400 });
  }
  if (
    itens.some((i) =>
      (i.opcionais ?? []).some((o) => typeof o?.opcionalId !== "string" || !o.opcionalId)
    )
  ) {
    return NextResponse.json({ erro: "Opção sem identificação." }, { status: 400 });
  }

  // A comanda é conferida aqui também, antes de qualquer escrita: 404 de conta
  // que não é desta unidade é melhor do que erro genérico no meio da rodada.
  const comanda = await db.comanda.findFirst({
    where: { id: comandaId, unidadeId: unidade.id },
    select: { id: true },
  });
  if (!comanda) return NextResponse.json({ erro: "Conta não encontrada." }, { status: 404 });

  const quem = {
    usuarioId: operador.usuarioId,
    tenantId: unidade.tenantId,
    unidadeId: unidade.id,
  };

  try {
    /*
     * Em sequência, e não em paralelo: dois itens iguais chegando juntos
     * encontrariam o mesmo pendente e cada um somaria por cima do outro —
     * três cervejas viravam duas.
     */
    for (const item of itens) {
      await adicionarItem(quem, {
        comandaId,
        cardapioItemId: item.cardapioItemId!,
        quantidade: item.quantidade,
        observacao: item.observacao,
        opcionais: item.opcionais?.map((o) => ({
          opcionalId: o.opcionalId!,
          quantidade: o.quantidade,
        })),
      });
    }

    // Por padrão a rodada vai para a cozinha: o garçom que lançou na mesa quer
    // o prato andando, não um carrinho esperando alguém lembrar de enviar.
    const enviar = corpo.enviar !== false;
    const enviados = enviar ? (await enviarCarrinho(quem, comandaId)).enviados : 0;

    return NextResponse.json({ ok: true, lancados: itens.length, enviados });
  } catch (e) {
    // ErroDeOperacao é frase pronta para a tela ("Este item está esgotado.");
    // o resto é defeito nosso e não vira texto na mão do garçom.
    if (e instanceof ErroDeOperacao) {
      return NextResponse.json({ erro: e.message }, { status: 409 });
    }
    console.error("Falha ao lançar itens pela maquininha", e);
    return NextResponse.json({ erro: "Não foi possível lançar os itens." }, { status: 500 });
  }
}
