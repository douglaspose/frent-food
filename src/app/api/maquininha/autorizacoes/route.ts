import { NextResponse, type NextRequest } from "next/server";
import { declararTenant } from "@/lib/tenant-atual";
import { aprovarComPin } from "@/lib/autorizacao-servidor";
import { TIPOS_DE_AUTORIZACAO, type TipoAutorizacao } from "@/lib/autorizacao";
import { operadorDaRequisicao, unidadeDoAparelho } from "@/lib/maquininha";

export const dynamic = "force-dynamic";

/**
 * POST /api/maquininha/autorizacoes — o gerente libera com o PIN dele.
 *
 * O garçom pede, o gerente digita no aparelho que está na mão do garçom, e a
 * liberação fica presa àquela ação e àquele alvo por três minutos. É o mesmo
 * caminho do tablet, e no salão ele vale mais: o gerente passa pela mesa, e o
 * garçom não precisa ir atrás dele até o balcão.
 *
 * O PIN não é comparado contra um usuário escolhido na tela — não há lista de
 * gerentes para apontar. Ele é conferido contra quem tem a permissão na
 * unidade, e o dono é descoberto pela conferência; o aparelho nunca recebe
 * quem pode aprovar. O freio de tentativas é por solicitante, dentro da regra.
 */
export async function POST(request: NextRequest) {
  const unidade = await unidadeDoAparelho(request);
  if (!unidade?.ativo) {
    return NextResponse.json({ erro: "Token do aparelho inválido." }, { status: 401 });
  }
  declararTenant(unidade.tenantId);

  const operador = await operadorDaRequisicao(request, unidade);
  if (!operador) {
    return NextResponse.json({ erro: "Sessão do operador expirada." }, { status: 401 });
  }

  let corpo: { tipo?: string; referenciaId?: string; pin?: string; motivo?: string };
  try {
    corpo = (await request.json()) as typeof corpo;
  } catch {
    return NextResponse.json({ erro: "Corpo inválido: envie JSON." }, { status: 400 });
  }

  const tipo = corpo?.tipo as TipoAutorizacao;
  if (!tipo || !(tipo in TIPOS_DE_AUTORIZACAO)) {
    return NextResponse.json({ erro: "Tipo de autorização desconhecido." }, { status: 400 });
  }
  if (typeof corpo.referenciaId !== "string" || !corpo.referenciaId) {
    return NextResponse.json({ erro: "Autorização sem alvo." }, { status: 400 });
  }

  const r = await aprovarComPin(
    operador,
    tipo,
    corpo.referenciaId,
    String(corpo.pin ?? ""),
    corpo.motivo
  );

  /*
   * PIN errado volta 200 com `ok: false`, e não 401: o 401 do aparelho quer
   * dizer "o turno venceu" e mandaria o garçom redigitar o próprio PIN no meio
   * de um cancelamento. A mensagem já vem pronta para a tela, e nunca diz se
   * aquele PIN existe — só que não serve aqui.
   */
  if (!r.ok) return NextResponse.json({ ok: false, motivo: r.motivo });

  return NextResponse.json({ ok: true, autorizacaoId: r.id, aprovador: r.aprovador });
}
