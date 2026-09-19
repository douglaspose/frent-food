"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { exigirPermissao } from "@/lib/session";
import { enfileirarTransferencia } from "@/lib/fila-impressao";
import { publicar } from "@/lib/eventos";
import { auditoria } from "@/lib/auditoria-servidor";
import { emResultado, ErroDeOperacao } from "@/lib/erro-de-operacao";

/**
 * Move a comanda inteira para outra mesa.
 *
 * O grupo pediu para trocar de lugar, ou o garçom abriu na mesa errada — as
 * duas coisas acontecem toda noite. Sem isto, a saída era fechar a conta e
 * abrir outra, o que perde o tempo de mesa, quebra os tickets da cozinha e
 * some com a rastreabilidade.
 *
 * Não junta mesas: se a mesa de destino já tem comanda aberta, a ação recusa.
 * Juntar duas contas é outra operação — envolve pagamentos já lançados e
 * decidir de quem é a taxa de serviço — e fazer as duas coisas com o mesmo
 * botão convida a juntar sem querer.
 */
export async function transferirMesa(comandaId: string, mesaDestinoId: string) {
  return emResultado(async () => {
    const sessao = await exigirPermissao("mesa.transferir");

    const comanda = await db.comanda.findUniqueOrThrow({
      where: { id: comandaId },
      include: { mesa: { select: { id: true, numero: true } } },
    });
    if (comanda.tenantId !== sessao.tenantId) throw new ErroDeOperacao("Comanda de outro restaurante.");
    if (comanda.status === "PAGA") throw new ErroDeOperacao("Comanda já paga. Abra uma nova.");
    if (comanda.status === "CANCELADA") throw new ErroDeOperacao("Comanda cancelada.");
    if (comanda.mesaId === mesaDestinoId) return;

    const destino = await db.mesa.findUniqueOrThrow({
      where: { id: mesaDestinoId },
      include: {
        area: { select: { nome: true } },
        comandas: {
          where: { status: { in: ["ABERTA", "FECHANDO"] } },
          select: { numero: true },
          take: 1,
        },
      },
    });

    // Unidade, não tenant: um restaurante com duas lojas não pode mover uma
    // mesa do salão de uma para o da outra.
    if (destino.unidadeId !== comanda.unidadeId) throw new ErroDeOperacao("Mesa de outra unidade.");
    if (!destino.ativo) throw new ErroDeOperacao("Esta mesa está desativada.");

    if (destino.comandas.length > 0) {
      throw new ErroDeOperacao(
        `A mesa ${destino.numero} já tem a comanda #${destino.comandas[0]!.numero} aberta. ` +
          "Feche-a antes, ou escolha outra mesa."
      );
    }

    const limparAuto = await db.parametroUnidade.findUnique({
      where: {
        unidadeId_chave: { unidadeId: comanda.unidadeId, chave: "mesa.limparAutomaticamente" },
      },
    });

    const origem = comanda.mesa;

    const registro = await auditoria(sessao, {
      entidade: "Comanda",
      entidadeId: comandaId,
      acao: "MESA_TRANSFERIDA",
      antes: { mesa: origem?.numero ?? null },
      depois: { mesa: destino.numero, comanda: comanda.numero },
    });

    await db.$transaction(async (tx) => {
      await tx.comanda.update({ where: { id: comandaId }, data: { mesaId: mesaDestinoId } });

      // A mesa de destino herda o estado da conta: uma mesa que estava pedindo
      // a conta continua laranja no mapa depois de mudar de lugar.
      await tx.mesa.update({
        where: { id: mesaDestinoId },
        data: { status: comanda.status === "FECHANDO" ? "FECHANDO" : "OCUPADA" },
      });

      if (origem) {
        await tx.mesa.update({
          where: { id: origem.id },
          // Mesma regra do fechamento: onde a limpeza não é automática, a mesa
          // fica SUJA até alguém liberar. Um grupo que acabou de sair de lá
          // deixou a mesa do mesmo jeito.
          data: { status: limparAuto?.valor === false ? "SUJA" : "LIVRE" },
        });
      }

      await tx.auditLog.create({ data: registro });
    });

    // Fora da transação: impressora fora do ar não desfaz uma transferência que
    // já vale no salão e no KDS.
    if (origem) {
      try {
        await enfileirarTransferencia(comandaId, origem.numero, destino.numero, sessao.nome);
      } catch (e) {
        console.error("Falha ao enfileirar aviso de transferência", e);
      }
    }

    revalidatePath("/pdv");
    revalidatePath("/kds");
    await publicar(sessao.unidadeId, "mesa-transferida");

    return { mesaId: mesaDestinoId, numero: destino.numero };
  });
}

/** Mesas livres da unidade, para escolher o destino. */
export async function mesasLivres(comandaId: string) {
  return emResultado(async () => {
    const sessao = await exigirPermissao("mesa.transferir");

    const comanda = await db.comanda.findUniqueOrThrow({
      where: { id: comandaId },
      select: { tenantId: true, unidadeId: true, mesaId: true },
    });
    if (comanda.tenantId !== sessao.tenantId) throw new ErroDeOperacao("Comanda de outro restaurante.");

    const mesas = await db.mesa.findMany({
      where: {
        unidadeId: comanda.unidadeId,
        ativo: true,
        ...(comanda.mesaId ? { id: { not: comanda.mesaId } } : {}),
        // SUJA entra na lista: mesa por limpar está livre para receber gente, e
        // esconder metade do salão numa casa sem limpeza automática seria pior
        // que mostrar uma mesa que precisa de um pano.
        comandas: { none: { status: { in: ["ABERTA", "FECHANDO"] } } },
      },
      select: { id: true, numero: true, capacidade: true, status: true, area: { select: { nome: true } } },
    });

    return mesas
      // numero é texto (mesas podem se chamar "12A"), então a ordem alfabética
      // do banco colocaria a 10 antes da 2. Mesma ordenação do mapa.
      .sort((a, b) => Number(a.numero) - Number(b.numero) || a.numero.localeCompare(b.numero))
      .map((m) => ({
      id: m.id,
      numero: m.numero,
      capacidade: m.capacidade,
      status: m.status,
      area: m.area?.nome ?? null,
    }));
  });
}
