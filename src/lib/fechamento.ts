import { db } from "@/lib/db";
import { publicar } from "@/lib/eventos";
import { auditoria } from "@/lib/auditoria-servidor";
import { enfileirarConferencia } from "@/lib/fila-impressao";
import { ErroDeOperacao } from "@/lib/erro-de-operacao";

/**
 * Pedir a conta e voltar atrás — a regra que o PDV e a maquininha compartilham.
 *
 * Nasceu dentro das actions do PDV, e saiu de lá quando o garçom passou a
 * atender com o aparelho na mão: é no fim do atendimento, de pé na mesa, que o
 * cliente pede a conta, e era justamente aí que ele tinha de voltar ao tablet
 * do balcão.
 *
 * Quem chama confere quem é a pessoa e se ela pode; aqui cuida-se do que
 * acontece com a comanda.
 */

/** Quem está pedindo ou reabrindo. No PDV é a sessão; na maquininha, o PIN. */
export type QuemFecha = {
  usuarioId: string;
  tenantId: string;
  unidadeId: string;
};

async function comandaDe(quem: QuemFecha, comandaId: string) {
  const comanda = await db.comanda.findUniqueOrThrow({ where: { id: comandaId } });
  if (comanda.tenantId !== quem.tenantId) throw new ErroDeOperacao("Comanda de outro restaurante.");
  return comanda;
}

/**
 * Marca a comanda como em fechamento, e só isso.
 *
 * É o que acende a mesa em laranja no mapa — o salão inteiro passa a ver que
 * aquela mesa pediu a conta, e o caixa sabe onde vai precisar. Enquanto está
 * assim, ninguém lança item novo sem reabrir.
 *
 * Separada de `pedirAConta` porque no PDV o "Fechar conta" leva para a tela de
 * pagamento sem imprimir nada: lá o papel é um botão à parte, e fazer este
 * passo imprimir sozinho jogaria uma folha fora a cada mesa fechada no balcão.
 */
export async function marcarFechando(quem: QuemFecha, comandaId: string) {
  const comanda = await comandaDe(quem, comandaId);
  // Já fechando ou já paga: nada a fazer, e não é erro.
  if (comanda.status !== "ABERTA") return;

  await db.$transaction(async (tx) => {
    await tx.comanda.update({ where: { id: comandaId }, data: { status: "FECHANDO" } });
    if (comanda.mesaId) {
      await tx.mesa.update({ where: { id: comanda.mesaId }, data: { status: "FECHANDO" } });
    }
  });

  await publicar(comanda.unidadeId, "conta-pedida");
}

/**
 * A mesa pediu a conta: a comanda entra em fechamento e o papel sai.
 *
 * São as duas metades de um gesto só. O status é o que acende a mesa em
 * laranja no mapa — o salão inteiro passa a ver onde o caixa vai precisar — e
 * a cozinha marca o ticket daquela mesa, para apressar ou cancelar o que ainda
 * não saiu. O papel é o que o cliente confere antes de pagar.
 *
 * Separá-las custava caro no aparelho: sem o status, o mapa não fica sabendo; e
 * sem o papel, o garçom volta ao balcão para imprimir o que acabou de prometer.
 *
 * Comanda já em fechamento imprime de novo sem reclamar — "some a conta",
 * "manda outra via" é rotina —, e é aí que entra a segunda via marcada no
 * papel.
 */
export async function pedirAConta(
  quem: QuemFecha,
  comandaId: string,
  opcoes: { segundaVia?: boolean } = {}
) {
  const comanda = await comandaDe(quem, comandaId);
  if (comanda.status === "PAGA") throw new ErroDeOperacao("Esta conta já foi paga.");

  await marcarFechando(quem, comandaId);

  /*
   * A segunda via é marcada no papel quando quem chamou não disse nada e a
   * conta já estava em fechamento: a primeira via já saiu antes, e duas folhas
   * iguais na mão do cliente é o que faz ele perguntar qual vale.
   */
  const segundaVia = opcoes.segundaVia ?? comanda.status !== "ABERTA";
  await enfileirarConferencia(comandaId, segundaVia);

  return { fechando: true, segundaVia };
}

/**
 * Devolve a comanda para aberta.
 *
 * "Traz mais uma cerveja" depois de pedir a conta é a coisa mais comum do
 * mundo num restaurante. Travar isso faria o garçom burlar o sistema — lançar
 * na mesa do lado, anotar no papel. Por isso qualquer um que lance item
 * reabre; o que já foi pago continua registrado e entra no novo total.
 */
export async function reabrirConta(quem: QuemFecha, comandaId: string) {
  const comanda = await comandaDe(quem, comandaId);
  if (comanda.status === "PAGA") throw new ErroDeOperacao("Comanda já paga. Abra uma nova.");
  if (comanda.status === "ABERTA") return { reaberta: false };

  const registro = await auditoria(quem, {
    entidade: "Comanda",
    entidadeId: comandaId,
    acao: "CONTA_REABERTA",
    antes: { status: comanda.status },
    depois: { status: "ABERTA", comanda: comanda.numero },
  });

  await db.$transaction(async (tx) => {
    await tx.comanda.update({ where: { id: comandaId }, data: { status: "ABERTA" } });
    if (comanda.mesaId) {
      await tx.mesa.update({ where: { id: comanda.mesaId }, data: { status: "OCUPADA" } });
    }
    await tx.auditLog.create({ data: registro });
  });

  await publicar(comanda.unidadeId, "conta-reaberta");
  return { reaberta: true };
}
