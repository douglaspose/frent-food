"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { exigirPermissao, exigirSessao } from "@/lib/session";
import { publicar } from "@/lib/eventos";
import { ajusteNumerico } from "@/lib/parametros-servidor";
import { emResultado, ErroDeOperacao } from "@/lib/erro-de-operacao";

/**
 * O carrinho é feito de itens com status PENDENTE.
 *
 * Antes ele vivia só no navegador do garçom: trocar de tablet ou recarregar a
 * página perdia a rodada inteira, e o mapa de mesas não tinha como avisar que
 * havia pedido esquecido sem enviar. No banco, o carrinho sobrevive ao
 * aparelho e vira informação para o salão.
 */

/**
 * Freio para dedo pesado.
 *
 * Num tablet, o "+" recebe toque repetido sem querer: vinte espetos lançados
 * por engano viram vinte espetos na chapa, e a cozinha só descobre quando o
 * papel sai. O limite é por unidade porque depende do que a casa vende — uma
 * churrascaria lança 20 espetos de uma vez; uma pizzaria, nunca.
 */
async function limitarQuantidade(unidadeId: string, quantidade: number) {
  const maximo = await ajusteNumerico(unidadeId, "cozinha.qtdMaximaPorLancamento");
  if (quantidade > maximo) {
    throw new ErroDeOperacao(`O máximo por item nesta unidade é ${maximo}. Lance em rodadas separadas.`);
  }
}

async function comandaAberta(comandaId: string, tenantId: string) {
  const comanda = await db.comanda.findUniqueOrThrow({ where: { id: comandaId } });
  if (comanda.tenantId !== tenantId) throw new ErroDeOperacao("Comanda de outro restaurante.");
  if (comanda.status === "PAGA") throw new ErroDeOperacao("Comanda já paga. Abra uma nova.");
  // A mensagem diz o que fazer: "não está aberta" deixava o garçom sem saída.
  if (comanda.status !== "ABERTA") {
    throw new ErroDeOperacao("A conta está em fechamento. Reabra a mesa para lançar itens.");
  }
  return comanda;
}

/**
 * O item do cardápio da unidade da comanda — e é dele que saem produto e preço.
 *
 * O navegador manda preço e produto, mas server action é endpoint público:
 * gravar o que chega deixava lançar picanha a um centavo, preço negativo para
 * abater a conta, item do cardápio de outro restaurante e a picanha cobrada a
 * preço de água. Nada disso aparecia no diário. O que vale é o cardápio.
 */
async function itemDoCardapio(cardapioItemId: string, unidadeId: string) {
  const item = await db.cardapioItem.findUnique({
    where: { id: cardapioItemId },
    select: {
      produtoId: true,
      preco: true,
      esgotado: true,
      cardapio: { select: { unidadeId: true, ativo: true } },
      produto: { select: { exigePontoCarne: true } },
    },
  });
  // Chave estrangeira ignora o RLS: a conferência da unidade é aqui, no código.
  if (!item || item.cardapio.unidadeId !== unidadeId || !item.cardapio.ativo) {
    throw new ErroDeOperacao("Item fora do cardápio desta casa.");
  }
  if (item.esgotado) throw new ErroDeOperacao("Este item está esgotado.");
  return item;
}

export async function adicionarAoCarrinho(dados: {
  comandaId: string;
  produtoId: string;
  cardapioItemId: string;
  /** Ignorado: o preço vem do cardápio. Fica na assinatura pela tela. */
  precoUnitario: number;
  exigePontoCarne: boolean;
}) {
  return emResultado(async () => {
    const sessao = await exigirPermissao("comanda.lancarItem");
    const comanda = await comandaAberta(dados.comandaId, sessao.tenantId);
    const item = await itemDoCardapio(dados.cardapioItemId, comanda.unidadeId);
    if (dados.produtoId !== item.produtoId) {
      throw new ErroDeOperacao("O produto não corresponde ao item do cardápio.");
    }
    const precoUnitario = Number(item.preco);

    // Item com ponto da carne nunca agrupa: cada unidade pode ter o seu.
    if (!item.produto.exigePontoCarne) {
      const existente = await db.comandaItem.findFirst({
        where: {
          comandaId: dados.comandaId,
          produtoId: item.produtoId,
          status: "PENDENTE",
          pontoCarne: null,
        },
      });

      if (existente) {
        const quantidade = Number(existente.quantidade) + 1;
        await limitarQuantidade(sessao.unidadeId, quantidade);
        await db.comandaItem.update({
          where: { id: existente.id },
          data: { quantidade, precoTotal: quantidade * Number(existente.precoUnitario) },
        });
        revalidatePath("/pdv");
        await publicar(sessao.unidadeId, "carrinho");
        return;
      }
    }

    await db.comandaItem.create({
      data: {
        tenantId: comanda.tenantId,
        comandaId: dados.comandaId,
        produtoId: item.produtoId,
        cardapioItemId: dados.cardapioItemId,
        quantidade: 1,
        precoUnitario,
        precoTotal: precoUnitario,
        status: "PENDENTE",
        lancadoPorId: sessao.usuarioId,
      },
    });

    revalidatePath("/pdv");
    await publicar(sessao.unidadeId, "carrinho");
  });
}

async function itemPendente(itemId: string, tenantId: string) {
  const item = await db.comandaItem.findUniqueOrThrow({
    where: { id: itemId },
    include: { comanda: { select: { status: true } } },
  });
  if (item.tenantId !== tenantId) throw new ErroDeOperacao("Item de outro restaurante.");
  // Item já enviado não se mexe por aqui: cancelar pedido na cozinha é outra
  // operação, com autorização.
  if (item.status !== "PENDENTE") throw new ErroDeOperacao("Este item já foi enviado para a cozinha.");
  /**
   * Checar só o status do item deixava um furo: com a conta em fechamento, o
   * garçom não conseguia acrescentar uma cerveja, mas conseguia transformar
   * 1 picanha em 5 num carrinho já montado.
   */
  if (item.comanda.status !== "ABERTA") {
    throw new ErroDeOperacao("A conta está em fechamento. Reabra a mesa para alterar o carrinho.");
  }
  return item;
}

export async function alterarQuantidade(itemId: string, delta: number) {
  return emResultado(async () => {
    const sessao = await exigirPermissao("comanda.lancarItem");
    const item = await itemPendente(itemId, sessao.tenantId);

    const quantidade = Number(item.quantidade) + delta;

    if (quantidade <= 0) {
      await db.comandaItem.delete({ where: { id: itemId } });
    } else {
      await limitarQuantidade(sessao.unidadeId, quantidade);
      await db.comandaItem.update({
        where: { id: itemId },
        data: { quantidade, precoTotal: quantidade * Number(item.precoUnitario) },
      });
    }

    revalidatePath("/pdv");
    await publicar(sessao.unidadeId, "carrinho");
  });
}

export async function definirPontoCarne(itemId: string, pontoCarne: string) {
  return emResultado(async () => {
    const sessao = await exigirPermissao("comanda.lancarItem");
    await itemPendente(itemId, sessao.tenantId);

    await db.comandaItem.update({ where: { id: itemId }, data: { pontoCarne } });
    revalidatePath("/pdv");
    await publicar(sessao.unidadeId, "carrinho");
  });
}

export async function limparCarrinho(comandaId: string) {
  return emResultado(async () => {
    const sessao = await exigirPermissao("comanda.lancarItem");
    await comandaAberta(comandaId, sessao.tenantId);

    await db.comandaItem.deleteMany({ where: { comandaId, status: "PENDENTE" } });
    revalidatePath("/pdv");
    await publicar(sessao.unidadeId, "carrinho");
  });
}

/**
 * Cliente pede atenção. Virá do QR da mesa quando o pedido pelo celular
 * existir; por ora o próprio salão registra.
 */
export async function chamarGarcom(mesaId: string) {
  return emResultado(async () => {
    const sessao = await exigirSessao();

    const comanda = await db.comanda.findFirst({
      where: { mesaId, status: { in: ["ABERTA", "FECHANDO"] } },
    });
    if (!comanda || comanda.tenantId !== sessao.tenantId) throw new ErroDeOperacao("Mesa sem comanda aberta.");

    // Chamado repetido não reinicia o relógio: o tempo de espera do cliente
    // conta desde o primeiro pedido de atenção.
    if (!comanda.chamadoGarcomEm) {
      await db.comanda.update({ where: { id: comanda.id }, data: { chamadoGarcomEm: new Date() } });
    }

    revalidatePath("/pdv");
    await publicar(sessao.unidadeId, "chamado");
  });
}

export async function atenderChamado(comandaId: string) {
  return emResultado(async () => {
    const sessao = await exigirSessao();

    const comanda = await db.comanda.findUniqueOrThrow({ where: { id: comandaId } });
    if (comanda.tenantId !== sessao.tenantId) throw new ErroDeOperacao("Comanda de outro restaurante.");

    await db.comanda.update({ where: { id: comandaId }, data: { chamadoGarcomEm: null } });
    revalidatePath("/pdv");
    await publicar(sessao.unidadeId, "chamado");
  });
}
