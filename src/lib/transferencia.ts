import { db } from "@/lib/db";
import { publicar } from "@/lib/eventos";
import { auditoria } from "@/lib/auditoria-servidor";
import { enfileirarTransferencia } from "@/lib/fila-impressao";
import { ErroDeOperacao } from "@/lib/erro-de-operacao";

/**
 * Mudar a comanda de mesa — a regra que o PDV e a maquininha compartilham.
 *
 * O grupo pediu para trocar de lugar, ou o garçom abriu na mesa errada: as
 * duas coisas acontecem toda noite, e as duas acontecem com o garçom de pé no
 * salão. Sem isto, a saída era fechar a conta e abrir outra, o que perde o
 * tempo de mesa, quebra os tickets da cozinha e some com a rastreabilidade.
 *
 * Não junta mesas: se a de destino já tem comanda aberta, a operação recusa.
 * Juntar duas contas é outra coisa — envolve pagamentos já lançados e decidir
 * de quem é a taxa de serviço — e fazer as duas com o mesmo botão convida a
 * juntar sem querer.
 */

/** Quem está transferindo. O nome vai no papel que avisa a cozinha. */
export type QuemTransfere = {
  usuarioId: string;
  tenantId: string;
  unidadeId: string;
  nome: string;
};

export async function transferirMesa(
  quem: QuemTransfere,
  comandaId: string,
  mesaDestinoId: string
) {
  const comanda = await db.comanda.findUniqueOrThrow({
    where: { id: comandaId },
    include: { mesa: { select: { id: true, numero: true } } },
  });
  if (comanda.tenantId !== quem.tenantId) throw new ErroDeOperacao("Comanda de outro restaurante.");
  if (comanda.status === "PAGA") throw new ErroDeOperacao("Comanda já paga. Abra uma nova.");
  if (comanda.status === "CANCELADA") throw new ErroDeOperacao("Comanda cancelada.");
  // Mesma mesa não é erro: é o toque repetido, ou o reenvio de uma resposta
  // que se perdeu na rede com o garçom andando pelo salão.
  if (comanda.mesaId === mesaDestinoId) {
    return { mesaId: mesaDestinoId, numero: comanda.mesa?.numero ?? "", mudou: false };
  }

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

  // Unidade, não tenant: um restaurante com duas lojas não pode mover uma mesa
  // do salão de uma para o da outra.
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

  const registro = await auditoria(quem, {
    entidade: "Comanda",
    entidadeId: comandaId,
    acao: "MESA_TRANSFERIDA",
    antes: { mesa: origem?.numero ?? null },
    depois: { mesa: destino.numero, comanda: comanda.numero },
  });

  await db.$transaction(async (tx) => {
    /**
     * A mesma fila das aberturas: a trava da linha da unidade.
     *
     * A mesa de destino era conferida solta, antes. Duas transferências para a
     * mesma mesa livre — ou uma transferência e uma abertura nela — passavam as
     * duas pela conferência, e a mesa ficava com duas comandas abertas: o mapa
     * mostra uma, a outra some do salão. Dentro da trava, a mesa e a conta são
     * conferidas de novo.
     */
    await tx.$queryRaw`SELECT id FROM unidades WHERE id = ${comanda.unidadeId} FOR NO KEY UPDATE`;
    const ocupada = await tx.comanda.findFirst({
      where: { mesaId: mesaDestinoId, status: { in: ["ABERTA", "FECHANDO"] } },
      select: { numero: true },
    });
    if (ocupada) {
      throw new ErroDeOperacao(
        `A mesa ${destino.numero} acabou de receber a comanda #${ocupada.numero}. Escolha outra mesa.`
      );
    }
    const agora = await tx.comanda.findUniqueOrThrow({
      where: { id: comandaId },
      select: { status: true },
    });
    if (agora.status !== "ABERTA" && agora.status !== "FECHANDO") {
      throw new ErroDeOperacao("Esta comanda acabou de ser fechada.");
    }

    await tx.comanda.update({ where: { id: comandaId }, data: { mesaId: mesaDestinoId } });

    // A mesa de destino herda o estado da conta: uma mesa que estava pedindo a
    // conta continua laranja no mapa depois de mudar de lugar.
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
      await enfileirarTransferencia(comandaId, origem.numero, destino.numero, quem.nome);
    } catch (e) {
      console.error("Falha ao enfileirar aviso de transferência", e);
    }
  }

  await publicar(comanda.unidadeId, "mesa-transferida");

  return { mesaId: mesaDestinoId, numero: destino.numero, mudou: true };
}
