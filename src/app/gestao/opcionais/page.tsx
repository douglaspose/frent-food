import type { Metadata } from "next";
import { db } from "@/lib/db";
import { sessaoDaTela, temPermissao } from "@/lib/session";
import { OpcionaisTela, type GrupoNaTela, type ProdutoNaLista } from "./opcionais-tela";

export const metadata: Metadata = { title: "Opcionais" };
export const dynamic = "force-dynamic";

/**
 * Os grupos de opcionais da casa.
 *
 * É aqui que nasce o "escolha o ponto da carne" e o "bacon + R$ 8,00" que o
 * garçom vê na maquininha. Sem esta tela, os grupos só existiam no banco — e
 * quem decide o cardápio não tinha como mexer neles.
 */
export default async function OpcionaisPage() {
  const sessao = await sessaoDaTela();

  const [grupos, produtos] = await Promise.all([
    db.grupoOpcional.findMany({
      where: { tenantId: sessao.tenantId },
      orderBy: { ordem: "asc" },
      include: {
        itens: { orderBy: { ordem: "asc" } },
        produtos: {
          orderBy: { ordem: "asc" },
          include: { produto: { select: { id: true, titulo: true } } },
        },
      },
    }),
    db.produto.findMany({
      where: { tenantId: sessao.tenantId, ativo: true, tipo: "VENDA" },
      orderBy: { titulo: "asc" },
      select: { id: true, titulo: true },
    }),
  ]);

  const naTela: GrupoNaTela[] = grupos.map((g) => ({
    id: g.id,
    titulo: g.titulo,
    minEscolhas: g.minEscolhas,
    maxEscolhas: g.maxEscolhas,
    obrigatorio: g.obrigatorio,
    opcoes: g.itens.map((i) => ({
      id: i.id,
      titulo: i.titulo,
      preco: Number(i.preco),
      ativo: i.ativo,
      produtoId: i.produtoId,
    })),
    produtos: g.produtos.map((p) => ({ id: p.produto.id, titulo: p.produto.titulo })),
  }));

  const lista: ProdutoNaLista[] = produtos;

  return (
    <>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Opcionais</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {grupos.length === 0
            ? "Nenhum grupo ainda — o primeiro costuma ser o ponto da carne."
            : `${grupos.length} grupo(s) · o garçom escolhe na maquininha ao lançar o prato`}
        </p>
      </div>

      <OpcionaisTela
        grupos={naTela}
        produtos={lista}
        podeEditar={temPermissao(sessao, "cardapio.editar")}
      />
    </>
  );
}
