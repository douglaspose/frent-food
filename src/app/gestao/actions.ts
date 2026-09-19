"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { exigirPermissao } from "@/lib/session";
import { somenteDigitos } from "@/lib/fiscal/chave";
import { auditoria } from "@/lib/auditoria-servidor";
import { emResultado, ErroDeOperacao } from "@/lib/erro-de-operacao";

/** Confere que o item pertence ao restaurante da sessão antes de alterar. */
async function itemDoTenant(cardapioItemId: string, tenantId: string) {
  const item = await db.cardapioItem.findUnique({
    where: { id: cardapioItemId },
    include: { cardapio: { select: { tenantId: true } } },
  });
  if (!item || item.cardapio.tenantId !== tenantId) throw new ErroDeOperacao("Item não encontrado.");
  return item;
}

export async function alterarPreco(cardapioItemId: string, preco: number) {
  return emResultado(async () => {
    const sessao = await exigirPermissao("cardapio.editar");
    if (!Number.isFinite(preco) || preco < 0) throw new ErroDeOperacao("Preço inválido.");

    const item = await itemDoTenant(cardapioItemId, sessao.tenantId);

    await db.$transaction([
      db.cardapioItem.update({ where: { id: cardapioItemId }, data: { preco } }),
      db.auditLog.create({
        data: await auditoria(sessao, {
          entidade: "CardapioItem",
          entidadeId: cardapioItemId,
          acao: "PRECO_ALTERADO",
          antes: { preco: Number(item.preco) },
          depois: { preco },
        }),
      }),
    ]);

    // O PDV lê o preço do cardápio, então precisa enxergar a mudança na hora.
    revalidatePath("/gestao/cardapio");
    revalidatePath("/pdv");
  });
}

export async function alternarEsgotado(cardapioItemId: string, esgotado: boolean) {
  return emResultado(async () => {
    const sessao = await exigirPermissao("cardapio.editar");
    await itemDoTenant(cardapioItemId, sessao.tenantId);

    await db.cardapioItem.update({ where: { id: cardapioItemId }, data: { esgotado } });
    revalidatePath("/gestao/cardapio");
    revalidatePath("/pdv");
  });
}

export async function alternarVisivel(cardapioItemId: string, visivel: boolean) {
  return emResultado(async () => {
    const sessao = await exigirPermissao("cardapio.editar");
    await itemDoTenant(cardapioItemId, sessao.tenantId);

    await db.cardapioItem.update({ where: { id: cardapioItemId }, data: { visivel } });
    revalidatePath("/gestao/cardapio");
    revalidatePath("/pdv");
  });
}

export type DadosProduto = {
  titulo: string;
  codigo: string;
  categoriaId: string;
  preco: number;
  descricao: string;
  exigePontoCarne: boolean;
  ncm: string;
  cest: string;
  perfilFiscalId: string;
  maiorDeIdade: boolean;
  estacaoId: string;
};

/**
 * Cria produto, entrada no cardápio do salão e destino de produção de uma vez.
 * Cadastrar as três coisas em telas separadas seria fiel ao modelo de dados e
 * péssimo para quem só quer colocar um prato novo no cardápio.
 */
export async function criarProduto(dados: DadosProduto) {
  return emResultado(async () => {
    const sessao = await exigirPermissao("produto.editar");
    if (!dados.titulo.trim()) throw new ErroDeOperacao("Informe o título do produto.");

    const cardapio = await db.cardapio.findFirst({
      where: { unidadeId: sessao.unidadeId, canal: "SALAO" },
    });
    if (!cardapio) throw new ErroDeOperacao("Cardápio do salão não encontrado.");

    await db.produto.create({
      data: {
        tenantId: sessao.tenantId,
        titulo: dados.titulo.trim(),
        codigo: dados.codigo.trim() || null,
        categoriaId: dados.categoriaId || null,
        descricao: dados.descricao.trim() || null,
        // NCM sem pontuação: a SEFAZ recusa a nota se vier formatado.
        ncm: somenteDigitos(dados.ncm) || null,
        cest: somenteDigitos(dados.cest) || null,
        perfilFiscalId: dados.perfilFiscalId || null,
        exigePontoCarne: dados.exigePontoCarne,
        maiorDeIdade: dados.maiorDeIdade,
        estacoes: dados.estacaoId ? { create: { estacaoId: dados.estacaoId } } : undefined,
        cardapioItens: {
          create: {
            cardapioId: cardapio.id,
            categoriaId: dados.categoriaId || null,
            preco: dados.preco,
          },
        },
      },
    });

    revalidatePath("/gestao/produtos");
    revalidatePath("/gestao/cardapio");
    revalidatePath("/pdv");
  });
}

export async function atualizarProduto(produtoId: string, dados: DadosProduto) {
  return emResultado(async () => {
    const sessao = await exigirPermissao("produto.editar");

    const produto = await db.produto.findUnique({ where: { id: produtoId } });
    if (!produto || produto.tenantId !== sessao.tenantId) throw new ErroDeOperacao("Produto não encontrado.");

    await db.$transaction(async (tx) => {
      await tx.produto.update({
        where: { id: produtoId },
        data: {
          titulo: dados.titulo.trim(),
          codigo: dados.codigo.trim() || null,
          categoriaId: dados.categoriaId || null,
          descricao: dados.descricao.trim() || null,
          ncm: somenteDigitos(dados.ncm) || null,
          cest: somenteDigitos(dados.cest) || null,
          perfilFiscalId: dados.perfilFiscalId || null,
          exigePontoCarne: dados.exigePontoCarne,
          maiorDeIdade: dados.maiorDeIdade,
        },
      });

      // Um produto sai de uma estação e vai para outra; substituir é mais simples
      // e mais previsível do que calcular a diferença.
      await tx.produtoEstacao.deleteMany({ where: { produtoId } });
      if (dados.estacaoId) {
        await tx.produtoEstacao.create({ data: { produtoId, estacaoId: dados.estacaoId } });
      }

      const item = await tx.cardapioItem.findFirst({
        where: { produtoId, cardapio: { unidadeId: sessao.unidadeId, canal: "SALAO" } },
      });
      if (item) {
        await tx.cardapioItem.update({
          where: { id: item.id },
          data: { preco: dados.preco, categoriaId: dados.categoriaId || null },
        });
      }
    });

    revalidatePath("/gestao/produtos");
    revalidatePath("/gestao/cardapio");
    revalidatePath("/pdv");
  });
}

export async function alternarProdutoAtivo(produtoId: string, ativo: boolean) {
  return emResultado(async () => {
    const sessao = await exigirPermissao("produto.editar");

    const produto = await db.produto.findUnique({ where: { id: produtoId } });
    if (!produto || produto.tenantId !== sessao.tenantId) throw new ErroDeOperacao("Produto não encontrado.");

    // Produto nunca é excluído: ele aparece em comandas antigas e relatórios.
    await db.$transaction([
      db.produto.update({ where: { id: produtoId }, data: { ativo } }),
      db.cardapioItem.updateMany({ where: { produtoId }, data: { visivel: ativo } }),
      db.auditLog.create({
        data: await auditoria(sessao, {
          entidade: "Produto",
          entidadeId: produtoId,
          acao: ativo ? "PRODUTO_REATIVADO" : "PRODUTO_DESATIVADO",
          depois: { titulo: produto.titulo, ativo },
        }),
      }),
    ]);

    revalidatePath("/gestao/produtos");
    revalidatePath("/gestao/cardapio");
    revalidatePath("/pdv");
  });
}

export async function criarCategoria(nome: string) {
  return emResultado(async () => {
    const sessao = await exigirPermissao("produto.editar");
    if (!nome.trim()) throw new ErroDeOperacao("Informe o nome da categoria.");

    const ultima = await db.categoriaProduto.findFirst({
      where: { tenantId: sessao.tenantId },
      orderBy: { ordem: "desc" },
      select: { ordem: true },
    });

    await db.categoriaProduto.create({
      data: { tenantId: sessao.tenantId, nome: nome.trim(), ordem: (ultima?.ordem ?? 0) + 1 },
    });

    revalidatePath("/gestao/produtos");
    revalidatePath("/gestao/cardapio");
  });
}
