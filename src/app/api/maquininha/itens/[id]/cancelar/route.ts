import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { declararTenant } from "@/lib/tenant-atual";
import { cancelarItem } from "@/lib/cancelamento";
import { precisaAutorizacao } from "@/lib/autorizacao";
import { ErroDeOperacao } from "@/lib/erro-de-operacao";
import { operadorDaRequisicao, podeNoAparelho, unidadeDoAparelho } from "@/lib/maquininha";

export const dynamic = "force-dynamic";

/**
 * POST /api/maquininha/itens/[id]/cancelar — tirar um prato da conta.
 *
 * "Esse eu não quero mais" é dito ao garçom que está na mesa, e a cozinha
 * precisa saber agora, não quando ele chegar ao balcão. A regra é a mesma do
 * PDV (`@/lib/cancelamento`), com o diário e o estorno de estoque.
 *
 * **Quem não pode cancelar não é recusado: é mandado pedir a liberação.** O
 * cargo GARCOM não tem `comanda.cancelarItem`, e é justamente ele quem está na
 * mesa. A resposta vem com `precisaAutorizacao`, o aparelho pede o PIN de quem
 * pode (`POST /api/maquininha/autorizacoes`) e repete a chamada com a
 * liberação. É o mesmo caminho do tablet — e aqui vale ainda mais, porque o
 * gerente anda pelo salão em vez de ficar ao lado do balcão.
 *
 * Por isso a porta não confere `comanda.cancelarItem`: quem decide é a regra,
 * que sabe distinguir "não pode" de "pode com liberação". O que se confere
 * aqui é o mínimo para estar no salão.
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

  if (!podeNoAparelho(operador.permissoes, "comanda.lancarItem", "comanda.cancelarItem")) {
    return NextResponse.json({ erro: "Seu acesso não permite mexer na conta." }, { status: 403 });
  }

  let corpo: { motivo?: string; autorizacaoId?: string | null };
  try {
    corpo = (await request.json()) as typeof corpo;
  } catch {
    return NextResponse.json({ erro: "Corpo inválido: envie JSON." }, { status: 400 });
  }

  const { id: itemId } = await params;

  // O item é conferido pela unidade do aparelho, como as contas: id de outro
  // restaurante responde como id inventado.
  const item = await db.comandaItem.findFirst({
    where: { id: itemId, comanda: { unidadeId: unidade.id } },
    select: { id: true },
  });
  if (!item) return NextResponse.json({ erro: "Item não encontrado." }, { status: 404 });

  try {
    const r = await cancelarItem(operador, {
      itemId,
      motivo: corpo?.motivo ?? "",
      autorizacaoId: corpo?.autorizacaoId,
    });

    /*
     * 403 com o tipo da liberação, e não um erro: é o aparelho sendo mandado
     * pedir o PIN, e a tela precisa distinguir isso de "não dá para cancelar".
     */
    if (precisaAutorizacao(r)) {
      return NextResponse.json(
        { erro: "Cancelar item precisa de autorização.", precisaAutorizacao: r.precisaAutorizacao },
        { status: 403 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    // ErroDeOperacao é frase pronta para a tela ("Informe o motivo do
    // cancelamento.", "A conta já foi paga...").
    if (e instanceof ErroDeOperacao) {
      return NextResponse.json({ erro: e.message }, { status: 409 });
    }
    console.error("Falha ao cancelar item pela maquininha", e);
    return NextResponse.json({ erro: "Não foi possível cancelar o item." }, { status: 500 });
  }
}
