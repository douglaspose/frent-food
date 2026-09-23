import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { declararTenant } from "@/lib/tenant-atual";
import { CONSUMO } from "@/lib/itens";
import { calcularTotais, centavos } from "@/lib/comanda";
import { operadorDaRequisicao, unidadeDoAparelho } from "@/lib/maquininha";

export const dynamic = "force-dynamic";

/** Reais viram centavos na porta: dentro da maquininha tudo é inteiro. */
const emCentavos = (v: number) => Math.round(centavos(v) * 100);

/**
 * GET /api/maquininha/mesas — as contas abertas do salão.
 *
 * É a tela inicial de quem vai receber: mesa, quanto deu e quanto falta. Uma
 * consulta só para o salão inteiro, e não uma por mesa — num sábado são
 * dezenas de mesas abertas ao mesmo tempo.
 */
export async function GET(request: NextRequest) {
  const unidade = await unidadeDoAparelho(request);
  if (!unidade?.ativo) {
    return NextResponse.json({ erro: "Token do aparelho inválido." }, { status: 401 });
  }
  declararTenant(unidade.tenantId);

  const operador = await operadorDaRequisicao(request, unidade);
  if (!operador) {
    return NextResponse.json({ erro: "Sessão do operador expirada." }, { status: 401 });
  }

  const comandas = await db.comanda.findMany({
    where: { unidadeId: unidade.id, status: { in: ["ABERTA", "FECHANDO"] } },
    orderBy: [{ abertaEm: "asc" }],
    include: {
      mesa: { select: { numero: true } },
      itens: { where: CONSUMO, select: { precoTotal: true } },
      pagamentos: { select: { valor: true, troco: true } },
    },
  });

  const caixaAberto = await db.caixa.findFirst({
    where: { unidadeId: unidade.id, tipo: "GERAL", status: "ABERTO" },
    select: { id: true },
  });

  /*
   * Quem pediu a conta vem primeiro: é a mesa que está esperando a maquininha.
   * Depois as demais, da mais antiga para a mais nova, que é a ordem em que
   * elas vão pedir.
   */
  const emOrdem = [...comandas].sort((a, b) => {
    const pediu = Number(b.status === "FECHANDO") - Number(a.status === "FECHANDO");
    return pediu !== 0 ? pediu : a.abertaEm.getTime() - b.abertaEm.getTime();
  });

  return NextResponse.json({
    unidade: unidade.nome,
    operador: operador.nome,
    // Sem caixa aberto nenhum pagamento entra. A maquininha avisa antes de o
    // cliente entregar o cartão, em vez de recusar depois de cobrar.
    caixaAberto: Boolean(caixaAberto),
    mesas: emOrdem.map((c) => {
      const totais = calcularTotais({
        itens: c.itens.map((i) => ({ precoTotal: Number(i.precoTotal) })),
        taxaServicoPct: Number(c.taxaServicoPct),
        descontoValor: Number(c.descontoValor),
      });
      const recebido = centavos(
        c.pagamentos.reduce((soma, p) => soma + Number(p.valor) - Number(p.troco), 0)
      );
      return {
        comandaId: c.id,
        numero: c.numero,
        mesa: c.mesa ? `Mesa ${c.mesa.numero}` : null,
        nomeCliente: c.nomeCliente,
        pessoas: c.pessoas,
        fechando: c.status === "FECHANDO",
        abertaEm: c.abertaEm.toISOString(),
        totalEmCentavos: emCentavos(totais.total),
        recebidoEmCentavos: emCentavos(recebido),
        faltaEmCentavos: emCentavos(Math.max(0, totais.total - recebido)),
      };
    }),
  });
}
