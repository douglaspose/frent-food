import { db } from "@/lib/db";
import { liberar } from "@/lib/autorizacao-servidor";
import type { PrecisaAutorizacao } from "@/lib/autorizacao";
import type { Sessao } from "@/lib/session";
import { estornarVenda } from "@/lib/estoque";
import { enfileirarCancelamento } from "@/lib/fila-impressao";
import { publicar } from "@/lib/eventos";
import { auditoria } from "@/lib/auditoria-servidor";
import { ErroDeOperacao } from "@/lib/erro-de-operacao";

/**
 * Cancela um item já enviado para a cozinha — a regra que o PDV e a maquininha
 * compartilham.
 *
 * Antes dela não havia saída: item lançado por engano, prato recusado ou
 * cliente que desistiu ficavam na conta, e o salão resolvia por fora — dando
 * desconto do valor, ou simplesmente não cobrando. As duas saídas escondem o
 * que aconteceu.
 *
 * Exige permissão porque é o caminho clássico de furo de caixa: lançar,
 * entregar e cancelar. O que a torna segura não é a permissão sozinha, é ela
 * junto com o registro no diário — cancelamento sem rastro é o buraco.
 *
 * Quem não tem a permissão apresenta uma liberação: o PIN de quem tem,
 * digitado ali mesmo, preso a esta ação e a este item. No aparelho isso vale
 * ainda mais do que no tablet — o gerente anda pelo salão, e é o garçom que
 * está com a mesa na frente.
 */

const CONTA_PAGA =
  "A conta já foi paga. Um item pago não se cancela: a devolução sai como sangria, com o motivo.";

export async function cancelarItem(
  quem: Sessao,
  dados: { itemId: string; motivo: string; autorizacaoId?: string | null }
): Promise<{ ok: true } | PrecisaAutorizacao> {
  const { itemId, motivo } = dados;

  const liberacao = await liberar(
    quem,
    "comanda.cancelarItem",
    "CANCELAMENTO_ITEM",
    itemId,
    dados.autorizacaoId
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
    throw new ErroDeOperacao(CONTA_PAGA);
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

  const cancelouAgora = await db.$transaction(async (tx) => {
    /**
     * A comanda travada, e o item e a conta relidos dentro da trava.
     *
     * A conferência acima é feita antes, solta: dois toques em "cancelar"
     * passavam os dois por ela e devolviam o estoque duas vezes (e deixavam
     * dois cancelamentos no diário); e o cancelamento no mesmo instante do
     * "finalizar" tirava o item de uma conta que acabava de ser paga. A
     * finalização trava a mesma linha, então um espera o outro.
     */
    await tx.$queryRaw`SELECT id FROM comandas WHERE id = ${item.comanda.id} FOR UPDATE`;
    const atual = await tx.comandaItem.findUniqueOrThrow({
      where: { id: itemId },
      select: { status: true, comanda: { select: { status: true } } },
    });
    if (atual.status === "CANCELADO") return false;
    if (atual.comanda.status === "PAGA") {
      throw new ErroDeOperacao(CONTA_PAGA);
    }

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
    return true;
  });
  // O outro toque chegou primeiro: o item já está cancelado, e nada mais a fazer.
  if (!cancelouAgora) return { ok: true };

  // Papel e aviso ficam fora da transação: impressora fora do ar não pode
  // desfazer um cancelamento que já vale no salão e na cozinha.
  try {
    await enfileirarCancelamento(itemId);
  } catch (e) {
    console.error("Falha ao enfileirar impressão do cancelamento", e);
  }

  await publicar(item.comanda.unidadeId, "item-cancelado");
  return { ok: true };
}
