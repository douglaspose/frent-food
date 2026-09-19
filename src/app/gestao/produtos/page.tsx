import type { Metadata } from "next";
import { db } from "@/lib/db";
import { exigirSessao, temPermissao } from "@/lib/session";
import { ProdutosTela } from "./produtos-tela";

export const metadata: Metadata = { title: "Produtos" };
export const dynamic = "force-dynamic";

export default async function ProdutosPage() {
  const sessao = await exigirSessao();

  const [produtos, categorias, estacoes, perfis] = await Promise.all([
    db.produto.findMany({
      where: { tenantId: sessao.tenantId },
      orderBy: [{ ativo: "desc" }, { titulo: "asc" }],
      include: {
        categoria: { select: { id: true, nome: true } },
        estacoes: { select: { estacaoId: true } },
        cardapioItens: {
          where: { cardapio: { unidadeId: sessao.unidadeId, canal: "SALAO" } },
          select: { preco: true },
        },
      },
    }),
    db.categoriaProduto.findMany({
      where: { tenantId: sessao.tenantId },
      orderBy: { ordem: "asc" },
      select: { id: true, nome: true },
    }),
    db.estacao.findMany({
      where: { unidadeId: sessao.unidadeId, ativo: true },
      orderBy: { ordem: "asc" },
      select: { id: true, nome: true },
    }),
    db.perfilFiscal.findMany({
      where: { unidadeId: sessao.unidadeId },
      orderBy: [{ padrao: "desc" }, { nome: "asc" }],
      select: { id: true, nome: true },
    }),
  ]);

  return (
    <ProdutosTela
      podeEditar={temPermissao(sessao, "produto.editar")}
      categorias={categorias}
      estacoes={estacoes}
      perfis={perfis}
      produtos={produtos.map((p) => ({
        id: p.id,
        titulo: p.titulo,
        codigo: p.codigo ?? "",
        descricao: p.descricao ?? "",
        categoriaId: p.categoria?.id ?? "",
        categoriaNome: p.categoria?.nome ?? "—",
        estacaoId: p.estacoes[0]?.estacaoId ?? "",
        ncm: p.ncm ?? "",
        cest: p.cest ?? "",
        perfilFiscalId: p.perfilFiscalId ?? "",
        preco: Number(p.cardapioItens[0]?.preco ?? 0),
        exigePontoCarne: p.exigePontoCarne,
        maiorDeIdade: p.maiorDeIdade,
        ativo: p.ativo,
      }))}
    />
  );
}
