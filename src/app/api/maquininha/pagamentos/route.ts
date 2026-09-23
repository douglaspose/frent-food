import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { declararTenant } from "@/lib/tenant-atual";
import { centavos, TOLERANCIA } from "@/lib/comanda";
import { contaDaComanda, finalizarConta, receberPagamento } from "@/lib/conta";
import { operadorDaRequisicao, unidadeDoAparelho } from "@/lib/maquininha";
import { temErro } from "@/lib/erro-de-operacao";
import { emResultado } from "@/lib/erro-de-operacao";

export const dynamic = "force-dynamic";

const emCentavos = (v: number) => Math.round(centavos(v) * 100);

/**
 * O que a maquininha cobrou e a forma cadastrada no restaurante.
 *
 * A maquininha fala em crédito, débito, Pix e voucher; o restaurante cadastra
 * formas com nome próprio ("Cartão de Crédito", "Pix Itaú"). O encontro é pelo
 * tipo, que é o que a forma tem de fixo — o nome cada casa escolhe o seu.
 */
const TIPO_DA_FORMA: Record<string, string> = {
  CREDITO: "CREDITO",
  CREDITO_PARCELADO: "CREDITO",
  DEBITO: "DEBITO",
  PIX: "PIX",
  VOUCHER: "VOUCHER",
};

/**
 * POST /api/maquininha/pagamentos — registra o que a maquininha já cobrou.
 *
 * Chega **depois** de a credenciadora aprovar: aqui não se cobra nada, só se
 * conta o que aconteceu. Por isso a `referencia` é obrigatória — a maquininha
 * reenvia este mesmo corpo quando a rede cai, e o servidor precisa reconhecer
 * o reenvio em vez de registrar um segundo pagamento.
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

  let corpo: {
    comandaId?: string;
    referencia?: string;
    forma?: string;
    valorEmCentavos?: number;
    nsu?: string;
    bandeira?: string;
    finalizar?: boolean;
  };
  try {
    corpo = (await request.json()) as typeof corpo;
  } catch {
    return NextResponse.json({ erro: "Corpo inválido: envie JSON." }, { status: 400 });
  }

  const comandaId = typeof corpo.comandaId === "string" ? corpo.comandaId : "";
  const referencia = typeof corpo.referencia === "string" ? corpo.referencia.trim() : "";
  const tipo = TIPO_DA_FORMA[String(corpo.forma ?? "")];
  const valorEmCentavos = corpo.valorEmCentavos;

  if (!comandaId) return NextResponse.json({ erro: "Informe a comanda." }, { status: 400 });
  if (!referencia) return NextResponse.json({ erro: "Informe a referência." }, { status: 400 });
  if (!tipo) return NextResponse.json({ erro: "Forma de pagamento desconhecida." }, { status: 400 });
  if (!Number.isSafeInteger(valorEmCentavos) || (valorEmCentavos as number) <= 0) {
    return NextResponse.json({ erro: "Valor inválido." }, { status: 400 });
  }

  const conta = await contaDaComanda(comandaId);
  if (!conta || conta.comanda.unidadeId !== unidade.id) {
    return NextResponse.json({ erro: "Conta não encontrada." }, { status: 404 });
  }

  const forma = await db.formaPagamento.findFirst({
    where: { tenantId: unidade.tenantId, tipo: tipo as never, ativo: true },
    orderBy: { nome: "asc" },
    select: { id: true, nome: true },
  });
  if (!forma) {
    return NextResponse.json(
      { erro: `Nenhuma forma de pagamento do tipo ${tipo} cadastrada no restaurante.` },
      { status: 409 }
    );
  }

  const resposta = await emResultado(async () => {
    const { falta, jaRegistrado } = await receberPagamento(operador, {
      comandaId,
      formaPagamentoId: forma.id,
      valor: (valorEmCentavos as number) / 100,
      troco: 0,
      nsu: corpo.nsu ?? null,
      bandeira: corpo.bandeira ?? null,
      referenciaExterna: referencia,
    });

    /*
     * Quitou: a conta fecha aqui mesmo, e não numa segunda chamada. Entre uma
     * e outra a rede pode cair, e a mesa ficaria paga e aberta no mapa — que
     * é o estado que faz o salão cobrar o cliente duas vezes.
     *
     * Quem não pode fechar conta recebe assim mesmo; só não fecha. É o caso
     * de quem só tem `comanda.receberPagamento`.
     */
    const podeFechar =
      operador.permissoes.includes("*") || operador.permissoes.includes("comanda.fechar");
    const quitada = falta <= TOLERANCIA;
    const finalizada = quitada && podeFechar && corpo.finalizar !== false
      ? await finalizarConta(operador, comandaId)
      : false;

    return {
      ok: true as const,
      jaRegistrado,
      forma: forma.nome,
      faltaEmCentavos: emCentavos(falta),
      quitada,
      finalizada,
    };
  });

  // Regra de negócio recusada volta como 409 com a mensagem: é o que a
  // maquininha mostra ao operador, que está com o cliente na frente.
  if (temErro(resposta)) return NextResponse.json({ erro: resposta.erro }, { status: 409 });
  return NextResponse.json(resposta);
}
