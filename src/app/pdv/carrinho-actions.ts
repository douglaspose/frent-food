"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { exigirPermissao, exigirSessao } from "@/lib/session";
import { publicar } from "@/lib/eventos";
import { ajusteNumerico } from "@/lib/parametros-servidor";
import { emResultado, ErroDeOperacao } from "@/lib/erro-de-operacao";
import { adicionarItem, comandaAberta } from "@/lib/carrinho";

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



/**
 * A regra mora em `@/lib/carrinho`, compartilhada com a maquininha. Aqui ficam
 * a sessão e a tela; `produtoId`, `precoUnitario` e `exigePontoCarne` seguem na
 * assinatura porque a tela os tem à mão, mas nenhum deles é usado: o que vale
 * é o que está no cardápio, não o que o navegador mandou.
 */
export async function adicionarAoCarrinho(dados: {
  comandaId: string;
  produtoId: string;
  cardapioItemId: string;
  precoUnitario: number;
  exigePontoCarne: boolean;
  /**
   * As escolhas do prato (ponto, adicionais). Só os identificadores: título e
   * preço saem do cadastro, como o resto — o navegador não precifica nada.
   */
  opcionais?: { opcionalId: string }[];
}) {
  return emResultado(async () => {
    const sessao = await exigirPermissao("comanda.lancarItem");
    await adicionarItem(sessao, {
      comandaId: dados.comandaId,
      cardapioItemId: dados.cardapioItemId,
      opcionais: dados.opcionais,
    });
    revalidatePath("/pdv");
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
    /**
     * A tela manda +1 e −1; o que chega é o que alguém quiser mandar. Com
     * −0,99, a cerveja de R$ 12 virava 0,01 cerveja a R$ 0,12 — e ia assim
     * para o bar e para a conta. Com NaN, a action estourava. A quantidade
     * anda de inteiro em inteiro.
     */
    if (!Number.isInteger(delta)) throw new ErroDeOperacao("Quantidade inválida.");
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
