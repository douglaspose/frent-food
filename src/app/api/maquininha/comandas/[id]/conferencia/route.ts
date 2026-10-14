import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { declararTenant } from "@/lib/tenant-atual";
import { pedirAConta } from "@/lib/fechamento";
import { ErroDeOperacao } from "@/lib/erro-de-operacao";
import { operadorDaRequisicao, podeNoAparelho, unidadeDoAparelho } from "@/lib/maquininha";

export const dynamic = "force-dynamic";

/**
 * POST /api/maquininha/comandas/[id]/conferencia — a mesa pediu a conta.
 *
 * O cliente pede a conta ao garçom que está na mesa, e era aí que o garçom
 * tinha de voltar ao tablet do balcão: para marcar o fechamento, que acende a
 * mesa no mapa do salão, e para mandar imprimir a folha que o cliente confere.
 * Com o aparelho na mão, é um toque na própria mesa.
 *
 * A regra é a mesma do PDV (`@/lib/fechamento`). O papel sai na impressora do
 * salão pela fila de impressão — a mesma que esta maquininha pode estar
 * servindo como agente.
 *
 * Repetir é seguro e é esperado: "sumiu a conta", "manda outra via" é rotina.
 * A partir da segunda, a folha sai marcada como segunda via.
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

  /*
   * O garçom imprime a parcial; quem recebe também, porque é a folha da conta
   * que ele vai cobrar — o cargo CAIXA não tem a chave de impressão parcial.
   */
  const podePedir = podeNoAparelho(
    operador.permissoes,
    "comanda.imprimirParcial",
    "comanda.receberPagamento"
  );
  if (!podePedir) {
    return NextResponse.json({ erro: "Seu acesso não permite pedir a conta." }, { status: 403 });
  }

  const { id: comandaId } = await params;

  // Conta de outra unidade responde como id inventado: a maquininha não pode
  // virar detector de ids válidos do restaurante vizinho.
  const comanda = await db.comanda.findFirst({
    where: { id: comandaId, unidadeId: unidade.id },
    select: { id: true },
  });
  if (!comanda) return NextResponse.json({ erro: "Conta não encontrada." }, { status: 404 });

  try {
    const { segundaVia } = await pedirAConta(operador, comandaId);
    return NextResponse.json({ ok: true, fechando: true, segundaVia });
  } catch (e) {
    // ErroDeOperacao é frase pronta para a tela ("Esta conta já foi paga.").
    if (e instanceof ErroDeOperacao) {
      return NextResponse.json({ erro: e.message }, { status: 409 });
    }
    console.error("Falha ao pedir a conta pela maquininha", e);
    return NextResponse.json({ erro: "Não foi possível pedir a conta." }, { status: 500 });
  }
}
