import "server-only";
import type { TipoImpressao } from "@prisma/client";
import { db } from "./db";
import { CONSUMO } from "./itens";
import {
  avisoDeTransferencia,
  comandaDeCancelamento,
  comandaDeProducao,
  conferenciaDeConta,
  cupomDePagamento,
} from "./impressao";
import { calcularTotais } from "./comanda";
import { ajusteBooleano } from "./parametros-servidor";

type Enfileirar = {
  tenantId: string;
  unidadeId: string;
  impressoraId?: string | null;
  // Usa o enum do schema em vez de repetir a lista: acrescentar um tipo de
  // documento não deve exigir lembrar de atualizar este arquivo.
  tipo: TipoImpressao;
  titulo: string;
  conteudo: string;
  referenciaId?: string;
};

export async function enfileirar(dados: Enfileirar) {
  return db.filaImpressao.create({
    data: {
      tenantId: dados.tenantId,
      unidadeId: dados.unidadeId,
      impressoraId: dados.impressoraId ?? null,
      tipo: dados.tipo,
      titulo: dados.titulo,
      conteudo: dados.conteudo,
      referenciaId: dados.referenciaId ?? null,
    },
  });
}

/**
 * Enfileira a comanda de produção de cada ticket recém-criado.
 *
 * A impressão nunca derruba o lançamento: se a impressora estiver fora do ar,
 * o pedido já está na cozinha pelo KDS e o papel sai quando o agente voltar.
 */
export async function enfileirarPedidos(pedidoIds: string[]) {
  if (pedidoIds.length === 0) return;

  const pedidos = await db.pedido.findMany({
    where: { id: { in: pedidoIds } },
    include: {
      estacao: { select: { nome: true, impressoraId: true } },
      comanda: {
        select: {
          numero: true,
          mesa: { select: { numero: true } },
          abertaPor: { select: { nome: true } },
        },
      },
      itens: {
        include: {
          comandaItem: {
            include: { produto: { select: { titulo: true } }, lancadoPor: { select: { nome: true } } },
          },
        },
      },
    },
  });

  for (const pedido of pedidos) {
    const conteudo = comandaDeProducao({
      estacao: pedido.estacao.nome,
      pedidoNumero: pedido.numero,
      mesa: pedido.comanda.mesa?.numero ?? null,
      comandaNumero: pedido.comanda.numero,
      garcom: pedido.itens[0]?.comandaItem.lancadoPor.nome ?? pedido.comanda.abertaPor.nome,
      criadoEm: pedido.criadoEm,
      itens: pedido.itens.map((i) => ({
        titulo: i.comandaItem.produto.titulo,
        quantidade: Number(i.comandaItem.quantidade),
        pontoCarne: i.comandaItem.pontoCarne,
        observacao: i.comandaItem.observacao,
      })),
    });

    await enfileirar({
      tenantId: pedido.tenantId,
      unidadeId: pedido.unidadeId,
      impressoraId: pedido.estacao.impressoraId,
      tipo: "COMANDA_PRODUCAO",
      titulo: `${pedido.estacao.nome} · pedido #${pedido.numero}`,
      conteudo,
      referenciaId: pedido.id,
    });
  }
}

/**
 * Enfileira o aviso de cancelamento nas estações que receberam o item.
 *
 * Só imprime se a unidade pedir (`impressao.imprimirCancelamentos`): casa que
 * trabalha só com KDS não quer papel, e casa que trabalha com papel pendurado
 * precisa do aviso, senão o prato sai.
 *
 * Nunca lança: o item já está cancelado no banco e no KDS quando isto roda.
 */
export async function enfileirarCancelamento(comandaItemId: string) {
  const item = await db.comandaItem.findUnique({
    where: { id: comandaItemId },
    include: {
      produto: { select: { titulo: true } },
      canceladoPor: { select: { nome: true } },
      comanda: {
        select: {
          unidadeId: true,
          numero: true,
          mesa: { select: { numero: true } },
        },
      },
      pedidoItens: {
        include: {
          pedido: {
            select: {
              numero: true,
              unidadeId: true,
              tenantId: true,
              estacao: { select: { nome: true, impressoraId: true } },
            },
          },
        },
      },
    },
  });

  // Item que nunca chegou à cozinha não tem o que cancelar no papel.
  if (!item || item.pedidoItens.length === 0) return;

  const ligado = await db.parametroUnidade.findUnique({
    where: {
      unidadeId_chave: {
        unidadeId: item.comanda.unidadeId,
        chave: "impressao.imprimirCancelamentos",
      },
    },
  });
  if (ligado?.valor !== true) return;

  for (const { pedido } of item.pedidoItens) {
    const conteudo = comandaDeCancelamento({
      estacao: pedido.estacao.nome,
      pedidoNumero: pedido.numero,
      mesa: item.comanda.mesa?.numero ?? null,
      comandaNumero: item.comanda.numero,
      canceladoPor: item.canceladoPor?.nome ?? "—",
      motivo: item.motivoCancelamento,
      canceladoEm: new Date(),
      item: {
        titulo: item.produto.titulo,
        quantidade: Number(item.quantidade),
        pontoCarne: item.pontoCarne,
      },
    });

    await enfileirar({
      tenantId: pedido.tenantId,
      unidadeId: pedido.unidadeId,
      impressoraId: pedido.estacao.impressoraId,
      tipo: "CANCELAMENTO",
      titulo: `CANCELAMENTO · ${pedido.estacao.nome} · pedido #${pedido.numero}`,
      conteudo,
      referenciaId: comandaItemId,
    });
  }
}

/**
 * Avisa a cozinha de que a comanda mudou de mesa.
 *
 * Só os tickets que ainda não saíram: avisar sobre prato já entregue seria
 * papel jogado fora e um aviso a menos de credibilidade para o próximo.
 */
export async function enfileirarTransferencia(
  comandaId: string,
  de: string,
  para: string,
  transferidoPor: string
) {
  const pedidos = await db.pedido.findMany({
    where: { comandaId, status: { in: ["AGUARDANDO", "EM_PREPARO", "PRONTO"] } },
    include: {
      estacao: { select: { nome: true, impressoraId: true } },
      comanda: { select: { numero: true } },
      itens: { include: { comandaItem: { include: { produto: { select: { titulo: true } } } } } },
    },
  });

  for (const pedido of pedidos) {
    const vivos = pedido.itens.filter((i) => i.comandaItem.status !== "CANCELADO");
    if (vivos.length === 0) continue;

    const conteudo = avisoDeTransferencia({
      estacao: pedido.estacao.nome,
      pedidoNumero: pedido.numero,
      de,
      para,
      comandaNumero: pedido.comanda.numero,
      transferidoPor,
      transferidoEm: new Date(),
      itens: vivos.map((i) => ({
        titulo: i.comandaItem.produto.titulo,
        quantidade: Number(i.comandaItem.quantidade),
      })),
    });

    await enfileirar({
      tenantId: pedido.tenantId,
      unidadeId: pedido.unidadeId,
      impressoraId: pedido.estacao.impressoraId,
      tipo: "TRANSFERENCIA",
      titulo: `MESA ${de} → ${para} · ${pedido.estacao.nome} · pedido #${pedido.numero}`,
      conteudo,
      referenciaId: pedido.id,
    });
  }
}

/** Monta a conferência a partir do estado atual da comanda. */
export async function enfileirarConferencia(comandaId: string, segundaVia = false) {
  const comanda = await db.comanda.findUniqueOrThrow({
    where: { id: comandaId },
    include: {
      unidade: { select: { nome: true } },
      mesa: { select: { numero: true } },
      itens: {
        where: CONSUMO,
        orderBy: { lancadoEm: "asc" },
        include: { produto: { select: { titulo: true } } },
      },
      pagamentos: {
        orderBy: { criadoEm: "asc" },
        select: {
          valor: true,
          troco: true,
          criadoEm: true,
          formaPagamento: { select: { nome: true } },
        },
      },
    },
  });

  /**
   * Cortesia sai do papel do cliente quando a unidade pede.
   *
   * Uma linha "Pão de alho ... R$ 0,00" no meio da conta abre uma conversa que
   * o garçom não quer ter no fim da noite. O item continua na comanda e nos
   * relatórios — some só do papel.
   */
  const omitirZerados = await ajusteBooleano(
    comanda.unidadeId,
    "impressao.naoImprimirItensZerados"
  );
  const itens = comanda.itens.filter((i) => !omitirZerados || Number(i.precoTotal) > 0);

  const conteudo = conferenciaDeConta({
    restaurante: comanda.unidade.nome,
    mesa: comanda.mesa?.numero ?? null,
    comandaNumero: comanda.numero,
    pessoas: comanda.pessoas,
    nomeCliente: comanda.nomeCliente,
    abertaEm: comanda.abertaEm,
    taxaServicoPct: Number(comanda.taxaServicoPct),
    descontoValor: Number(comanda.descontoValor),
    descontoMotivo: comanda.descontoMotivo,
    segundaVia,
    itens: itens.map((i) => ({
      titulo: i.produto.titulo,
      quantidade: Number(i.quantidade),
      precoTotal: Number(i.precoTotal),
    })),
    pagamentos: comanda.pagamentos.map((p) => ({
      forma: p.formaPagamento.nome,
      valor: Number(p.valor) - Number(p.troco),
      em: p.criadoEm,
    })),
  });

  return enfileirar({
    tenantId: comanda.tenantId,
    unidadeId: comanda.unidadeId,
    tipo: "CONFERENCIA",
    titulo: comanda.mesa ? `Conferência mesa ${comanda.mesa.numero}` : `Conferência #${comanda.numero}`,
    conteudo,
    referenciaId: comanda.id,
  });
}

export async function enfileirarCupom(comandaId: string, operador: string) {
  const comanda = await db.comanda.findUniqueOrThrow({
    where: { id: comandaId },
    include: {
      unidade: { select: { nome: true } },
      mesa: { select: { numero: true } },
      itens: { where: CONSUMO, select: { precoTotal: true } },
      pagamentos: { include: { formaPagamento: { select: { nome: true } } } },
    },
  });

  const { total } = calcularTotais({
    itens: comanda.itens.map((i) => ({ precoTotal: Number(i.precoTotal) })),
    taxaServicoPct: Number(comanda.taxaServicoPct),
    descontoValor: Number(comanda.descontoValor),
  });

  const conteudo = cupomDePagamento({
    restaurante: comanda.unidade.nome,
    mesa: comanda.mesa?.numero ?? null,
    comandaNumero: comanda.numero,
    total,
    operador,
    pagamentos: comanda.pagamentos.map((p) => ({
      forma: p.formaPagamento.nome,
      valor: Number(p.valor),
      troco: Number(p.troco),
    })),
  });

  return enfileirar({
    tenantId: comanda.tenantId,
    unidadeId: comanda.unidadeId,
    tipo: "CUPOM",
    titulo: comanda.mesa ? `Cupom mesa ${comanda.mesa.numero}` : `Cupom #${comanda.numero}`,
    conteudo,
    referenciaId: comanda.id,
  });
}
