import type { Metadata } from "next";
import { db } from "@/lib/db";
import { sessaoDaTela, temPermissao } from "@/lib/session";
import { EstoqueTela } from "./estoque-tela";

export const metadata: Metadata = { title: "Estoque" };
export const dynamic = "force-dynamic";

export default async function EstoquePage() {
  const sessao = await sessaoDaTela();

  const [produtos, saldos, movimentos] = await Promise.all([
    db.produto.findMany({
      where: { tenantId: sessao.tenantId, ativo: true },
      orderBy: { titulo: "asc" },
      select: {
        id: true,
        titulo: true,
        tipo: true,
        unidadeMedida: true,
        controlaEstoque: true,
        estoqueMinimo: true,
        _count: { select: { composicao: true } },
      },
    }),
    db.estoqueSaldo.findMany({ where: { unidadeId: sessao.unidadeId } }),
    db.movimentoEstoque.findMany({
      where: { unidadeId: sessao.unidadeId },
      orderBy: { criadoEm: "desc" },
      take: 40,
      include: { produto: { select: { titulo: true, unidadeMedida: true } } },
    }),
  ]);

  const saldoPorProduto = new Map(saldos.map((s) => [s.produtoId, s]));

  return (
    <EstoqueTela
      podeEditar={temPermissao(sessao, "produto.editar")}
      produtos={produtos.map((p) => {
        const saldo = saldoPorProduto.get(p.id);
        const quantidade = Number(saldo?.quantidade ?? 0);
        const custoMedio = Number(saldo?.custoMedio ?? 0);
        const minimo = p.estoqueMinimo === null ? null : Number(p.estoqueMinimo);

        return {
          id: p.id,
          titulo: p.titulo,
          tipo: p.tipo,
          unidadeMedida: p.unidadeMedida,
          controlaEstoque: p.controlaEstoque,
          temFicha: p._count.composicao > 0,
          estoqueMinimo: minimo,
          quantidade,
          custoMedio,
          valorEmEstoque: Math.round(quantidade * custoMedio * 100) / 100,
          // Só alerta quem é acompanhado: produto sem controle nem ficha não
          // tem saldo para estar "baixo".
          abaixoDoMinimo: minimo !== null && quantidade <= minimo,
        };
      })}
      movimentos={movimentos.map((m) => ({
        id: m.id,
        produto: m.produto.titulo,
        unidadeMedida: m.produto.unidadeMedida,
        tipo: m.tipo,
        quantidade: Number(m.quantidade),
        saldoDepois: Number(m.saldoDepois),
        custoUnitario: Number(m.custoUnitario),
        motivo: m.motivo,
        criadoEm: m.criadoEm.toISOString(),
      }))}
    />
  );
}
