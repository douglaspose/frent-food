import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { custoDaFicha } from "@/lib/estoque";
import { exigirSessao, temPermissao } from "@/lib/session";
import { FichaTela } from "./ficha-tela";

export const metadata: Metadata = { title: "Ficha técnica" };
export const dynamic = "force-dynamic";

export default async function FichaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sessao = await exigirSessao();

  const produto = await db.produto.findUnique({
    where: { id },
    include: {
      cardapioItens: {
        where: { cardapio: { unidadeId: sessao.unidadeId, canal: "SALAO" } },
        select: { preco: true },
      },
    },
  });
  if (!produto || produto.tenantId !== sessao.tenantId) notFound();

  const [{ custo, partes }, insumos] = await Promise.all([
    custoDaFicha(produto.id, sessao.unidadeId),
    db.produto.findMany({
      // Um produto não pode ser insumo de si mesmo.
      where: { tenantId: sessao.tenantId, ativo: true, id: { not: produto.id } },
      orderBy: { titulo: "asc" },
      select: { id: true, titulo: true, unidadeMedida: true },
    }),
  ]);

  const preco = Number(produto.cardapioItens[0]?.preco ?? 0);

  return (
    <FichaTela
      podeEditar={temPermissao(sessao, "produto.editar")}
      produto={{
        id: produto.id,
        titulo: produto.titulo,
        unidadeMedida: produto.unidadeMedida,
        preco,
        margemLucroMin: produto.margemLucroMin === null ? null : Number(produto.margemLucroMin),
      }}
      custo={custo}
      partes={partes}
      insumos={insumos}
    />
  );
}
