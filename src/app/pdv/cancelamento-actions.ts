"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { liberar } from "@/lib/autorizacao-servidor";
import type { PrecisaAutorizacao } from "@/lib/autorizacao";
import { estornarVenda } from "@/lib/estoque";
import { enfileirarCancelamento } from "@/lib/fila-impressao";
import { publicar } from "@/lib/eventos";
import { auditoria } from "@/lib/auditoria-servidor";
import { emResultado, ErroDeOperacao, type ComErro } from "@/lib/erro-de-operacao";

/**
 * Cancela um item já enviado para a cozinha.
 *
 * Antes disso não havia saída: item lançado por engano, prato recusado ou
 * cliente que desistiu ficavam na conta, e o salão resolvia por fora — dando
 * desconto do valor, ou simplesmente não cobrando. As duas saídas escondem o
 * que aconteceu.
 *
 * Exige permissão porque é o caminho clássico de furo de caixa: lançar,
 * entregar e cancelar. O que o torna seguro não é a permissão sozinha, é ela
 * junto com o registro no diário — cancelamento sem rastro é o buraco.
 */
export async function cancelarItem(
  itemId: string,
  motivo: string,
  autorizacaoId?: string | null
): Promise<{ ok: true } | PrecisaAutorizacao | ComErro> {
  return emResultado(async () => {
    const liberacao = await liberar(
      "comanda.cancelarItem",
      "CANCELAMENTO_ITEM",
      itemId,
      autorizacaoId
    );
    if (!liberacao) return { precisaAutorizacao: "CANCELAMENTO_ITEM" };
    const { sessao, aprovadoPor } = liberacao;

    const item = await db.comandaItem.findUniqueOrThrow({
      where: { id: itemId },
      include: {
        produto: { select: { titulo: true } },
        comanda: { select: { id: true, numero: true, status: true, unidadeId: true } },
        pedidoItens: { select: { pedidoId: true } },
      },
    });

    if (item.tenantId !== sessao.tenantId) throw new ErroDeOperacao("Item de outro restaurante.");
    if (item.status === "CANCELADO") return { ok: true };
    // O carrinho tem as próprias ferramentas: diminuir a quantidade até zero
    // apaga a linha, e nada disso precisa de permissão de gerente.
    if (item.status === "PENDENTE") {
      throw new ErroDeOperacao("Este item ainda está no carrinho. Use o menos para retirá-lo.");
    }
    if (item.comanda.status === "PAGA") {
      throw new ErroDeOperacao("A conta já foi paga. Um item pago se resolve por estorno, não por cancelamento.");
    }

    const limpo = motivo.trim();
    // Motivo obrigatório: "cancelado" sem explicação não responde nada a quem
    // for conferir depois, que é a única razão de existir este registro.
    if (!limpo) throw new ErroDeOperacao("Informe o motivo do cancelamento.");

    const registro = await auditoria(sessao, {
      entidade: "ComandaItem",
      entidadeId: itemId,
      acao: "ITEM_CANCELADO",
      // Em que pé o item estava é a informação que separa um engano de lançamento
      // de comida pronta jogada fora.
      antes: { estavaEm: item.status },
      depois: {
        titulo: item.produto.titulo,
        quantidade: Number(item.quantidade),
        valor: Number(item.precoTotal),
        comanda: item.comanda.numero,
        motivo: limpo,
        ...(aprovadoPor ? { autorizadoPor: aprovadoPor.nome } : {}),
      },
    });

    await db.$transaction(async (tx) => {
      await tx.comandaItem.update({
        where: { id: itemId },
        data: {
          status: "CANCELADO",
          canceladoPorId: sessao.usuarioId,
          motivoCancelamento: limpo,
        },
      });

      // A carne volta para a câmara. Fora da transação isso poderia dobrar o
      // saldo numa repetição de clique.
      await estornarVenda(tx, {
        tenantId: item.tenantId,
        unidadeId: item.comanda.unidadeId,
        usuarioId: sessao.usuarioId,
        motivo: `Cancelamento: ${limpo}`,
        itens: [
          {
            produtoId: item.produtoId,
            quantidade: Number(item.quantidade),
            comandaItemId: itemId,
          },
        ],
      });

      /**
       * Ticket que ficou só com itens cancelados sai do quadro.
       *
       * Um ticket vazio no KDS é pior que nenhum: o cozinheiro vê um cartão sem
       * nada para fazer e perde tempo decidindo se aquilo é erro do sistema.
       */
      for (const { pedidoId } of item.pedidoItens) {
        const vivos = await tx.pedidoItem.count({
          where: { pedidoId, comandaItem: { status: { not: "CANCELADO" } } },
        });
        if (vivos === 0) {
          await tx.pedido.update({ where: { id: pedidoId }, data: { status: "CANCELADO" } });
        }
      }

      await tx.auditLog.create({ data: registro });
      await liberacao.consumir(tx);
    });

    // Papel e aviso ficam fora da transação: impressora fora do ar não pode
    // desfazer um cancelamento que já vale no salão e na cozinha.
    try {
      await enfileirarCancelamento(itemId);
    } catch (e) {
      console.error("Falha ao enfileirar impressão do cancelamento", e);
    }

    revalidatePath("/pdv");
    revalidatePath("/kds");
    await publicar(sessao.unidadeId, "item-cancelado");
    return { ok: true };
  });
}
