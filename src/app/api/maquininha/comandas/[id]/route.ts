import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { declararTenant } from "@/lib/tenant-atual";
import { CONSUMO } from "@/lib/itens";
import { centavos } from "@/lib/comanda";
import { contaDaComanda } from "@/lib/conta";
import { operadorDaRequisicao, unidadeDoAparelho } from "@/lib/maquininha";

export const dynamic = "force-dynamic";

const emCentavos = (v: number) => Math.round(centavos(v) * 100);

/**
 * GET /api/maquininha/comandas/{id} — a conta de uma mesa.
 *
 * O que o cliente confere antes de pagar: os itens, o que já foi pago e o que
 * falta. A divisão por pessoa vem pronta porque é a conta que mais se faz no
 * balcão, e fazê-la no aparelho daria dois números diferentes do papel.
 */
export async function GET(request: NextRequest, contexto: { params: Promise<{ id: string }> }) {
  const unidade = await unidadeDoAparelho(request);
  if (!unidade?.ativo) {
    return NextResponse.json({ erro: "Token do aparelho inválido." }, { status: 401 });
  }
  declararTenant(unidade.tenantId);

  const operador = await operadorDaRequisicao(request, unidade);
  if (!operador) {
    return NextResponse.json({ erro: "Sessão do operador expirada." }, { status: 401 });
  }

  const { id } = await contexto.params;
  const conta = await contaDaComanda(id);
  /*
   * Comanda de outra unidade responde como id inventado: a maquininha não
   * pode virar detector de ids válidos do restaurante vizinho.
   */
  if (!conta || conta.comanda.unidadeId !== unidade.id) {
    return NextResponse.json({ erro: "Conta não encontrada." }, { status: 404 });
  }

  const [itens, pagamentos] = await Promise.all([
    db.comandaItem.findMany({
      where: { comandaId: id, ...CONSUMO },
      orderBy: { lancadoEm: "asc" },
      select: { quantidade: true, precoTotal: true, produto: { select: { titulo: true } } },
    }),
    db.pagamento.findMany({
      where: { comandaId: id },
      orderBy: { criadoEm: "asc" },
      select: {
        valor: true,
        troco: true,
        criadoEm: true,
        formaPagamento: { select: { nome: true } },
      },
    }),
  ]);

  const c = conta.comanda;
  return NextResponse.json({
    comandaId: c.id,
    numero: c.numero,
    mesa: c.mesa ? `Mesa ${c.mesa.numero}` : null,
    pessoas: c.pessoas,
    nomeCliente: c.nomeCliente,
    status: c.status,
    subtotalEmCentavos: emCentavos(conta.subtotal),
    descontoEmCentavos: emCentavos(conta.desconto),
    taxaServicoEmCentavos: emCentavos(conta.taxaServico),
    totalEmCentavos: emCentavos(conta.total),
    recebidoEmCentavos: emCentavos(conta.recebido),
    faltaEmCentavos: emCentavos(conta.falta),
    porPessoaEmCentavos: c.pessoas > 0 ? Math.round(emCentavos(conta.total) / c.pessoas) : null,
    itens: itens.map((i) => ({
      titulo: i.produto.titulo,
      quantidade: Number(i.quantidade),
      totalEmCentavos: emCentavos(Number(i.precoTotal)),
    })),
    pagamentos: pagamentos.map((p) => ({
      forma: p.formaPagamento.nome,
      valorEmCentavos: emCentavos(Number(p.valor) - Number(p.troco)),
      em: p.criadoEm.toISOString(),
    })),
  });
}
