import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { sessaoDaTela, temPermissao } from "@/lib/session";
import { CardapioEditor, type CategoriaCardapio } from "./cardapio-editor";

export const metadata: Metadata = { title: "Cardápio" };
export const dynamic = "force-dynamic";

export default async function CardapioPage() {
  const sessao = await sessaoDaTela();

  const cardapio = await db.cardapio.findFirst({
    where: { unidadeId: sessao.unidadeId, canal: "SALAO" },
    include: {
      itens: {
        orderBy: [{ categoria: { ordem: "asc" } }, { ordem: "asc" }],
        include: {
          categoria: true,
          produto: { select: { titulo: true, codigo: true, ativo: true } },
        },
      },
    },
  });

  if (!cardapio) {
    return (
      <p className="text-neutral-500">
        Nenhum cardápio do salão encontrado para esta unidade.{" "}
        <Link href="/gestao/produtos" className="text-orange-600 underline">
          Cadastrar produtos
        </Link>
      </p>
    );
  }

  const categorias = new Map<string, CategoriaCardapio>();
  for (const item of cardapio.itens) {
    const chave = item.categoria?.id ?? "sem-categoria";
    if (!categorias.has(chave)) {
      categorias.set(chave, { id: chave, nome: item.categoria?.nome ?? "Sem categoria", itens: [] });
    }
    categorias.get(chave)!.itens.push({
      id: item.id,
      titulo: item.produto.titulo,
      codigo: item.produto.codigo ?? "",
      preco: Number(item.preco),
      esgotado: item.esgotado,
      visivel: item.visivel,
      produtoAtivo: item.produto.ativo,
    });
  }

  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Cardápio do salão</h1>
          <p className="mt-1 text-sm text-neutral-500">
            {cardapio.itens.length} itens · alterações aparecem no PDV na hora
          </p>
        </div>
        <Link
          href="/gestao/produtos"
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-700"
        >
          Novo produto
        </Link>
      </div>

      <CardapioEditor
        categorias={[...categorias.values()]}
        podeEditar={temPermissao(sessao, "cardapio.editar")}
      />
    </>
  );
}
