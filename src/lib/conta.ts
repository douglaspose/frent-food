import "server-only";
import { db } from "./db";
import { CONSUMO } from "./itens";
import { calcularTotais, centavos, TOLERANCIA } from "./comanda";
import { enfileirarCupom } from "./fila-impressao";
import { emitirNfce } from "./fiscal/emitir";
import { publicar } from "./eventos";
import { ErroDeOperacao } from "./erro-de-operacao";

/**
 * Receber e quitar uma conta — a regra, sem a tela.
 *
 * Mora aqui porque agora há dois caminhos até ela: o caixa no PDV, com sessão
 * de navegador, e a maquininha, com o token do aparelho e o PIN do operador.
 * Duas cópias da mesma regra é como uma delas passa a aceitar o que a outra
 * recusa — e o que se recusa aqui é dinheiro cobrado duas vezes.
 *
 * Quem chama já conferiu quem é a pessoa e se ela pode; este arquivo cuida do
 * que acontece com a conta.
 */

/** Quem está recebendo. No PDV é a sessão; na maquininha, o operador do PIN. */
export type QuemRecebe = {
  usuarioId: string;
  tenantId: string;
  unidadeId: string;
  nome: string;
};

export type PagamentoParaRegistrar = {
  comandaId: string;
  formaPagamentoId: string;
  valor: number;
  troco: number;
  /** Dados da maquininha, quando o pagamento veio dela. */
  nsu?: string | null;
  bandeira?: string | null;
  /**
   * A referência da cobrança no aparelho. Única por restaurante: é ela que faz
   * o reenvio de um resultado preso na rede não virar um segundo pagamento.
   */
  referenciaExterna?: string | null;
};

/** Quanto a conta soma e quanto dela já foi recebido. */
export async function contaDaComanda(comandaId: string) {
  const comanda = await db.comanda.findUnique({
    where: { id: comandaId },
    include: {
      mesa: { select: { numero: true } },
      itens: { where: CONSUMO, select: { precoTotal: true } },
      pagamentos: { select: { valor: true, troco: true } },
    },
  });
  if (!comanda) return null;

  const totais = calcularTotais({
    itens: comanda.itens.map((i) => ({ precoTotal: Number(i.precoTotal) })),
    taxaServicoPct: Number(comanda.taxaServicoPct),
    descontoValor: Number(comanda.descontoValor),
  });
  const recebido = centavos(
    comanda.pagamentos.reduce((soma, p) => soma + Number(p.valor) - Number(p.troco), 0)
  );
  return { comanda, ...totais, recebido, falta: centavos(Math.max(0, totais.total - recebido)) };
}

const reais = (v: number) => v.toFixed(2).replace(".", ",");

/**
 * Registra um pagamento na conta.
 *
 * Devolve quanto ainda falta — é o que a maquininha mostra depois de aprovar,
 * e o que decide se a conta pode ser finalizada.
 */
export async function receberPagamento(
  quem: QuemRecebe,
  dados: PagamentoParaRegistrar
): Promise<{ falta: number; jaRegistrado: boolean }> {
  const { comandaId, formaPagamentoId, valor, troco } = dados;

  /**
   * Valor e troco chegam de fora — do navegador ou do aparelho. Sem esta
   * conferência, pagamento negativo abatia a conta, troco maior que o valor
   * virava dinheiro negativo no Painel, e NaN estourava como erro de sistema
   * expondo a consulta inteira.
   */
  if (!Number.isFinite(valor) || valor <= 0) throw new ErroDeOperacao("Informe um valor maior que zero.");
  if (!Number.isFinite(troco) || troco < 0) throw new ErroDeOperacao("Troco inválido.");
  if (troco >= valor) throw new ErroDeOperacao("O troco não pode ser maior que o valor entregue.");

  const comanda = await db.comanda.findUniqueOrThrow({ where: { id: comandaId } });
  if (comanda.tenantId !== quem.tenantId) throw new ErroDeOperacao("Comanda de outro restaurante.");
  if (comanda.unidadeId !== quem.unidadeId) throw new ErroDeOperacao("Comanda de outra unidade.");
  if (comanda.status === "PAGA") throw new ErroDeOperacao("Comanda já está paga.");

  const caixa = await db.caixa.findFirst({
    where: { unidadeId: comanda.unidadeId, tipo: "GERAL", status: "ABERTO" },
  });
  if (!caixa) throw new ErroDeOperacao("Nenhum caixa aberto. Abra o caixa antes de receber.");

  /**
   * A taxa da adquirente é copiada para dentro do pagamento, não consultada
   * depois.
   *
   * O painel multiplicava cada pagamento pela taxa cadastrada hoje, e
   * renegociar com a maquininha reescrevia o custo de um mês já fechado: o
   * número de ontem virava outro hoje sem nada ter acontecido. Congelada
   * aqui, a conta do mês passado fica parada como deve.
   *
   * `findUnique` e não `findUniqueOrThrow`: forma apagada entre a escolha na
   * tela e o clique é caso de erro legível, não de exceção minificada.
   */
  const forma = await db.formaPagamento.findUnique({
    where: { id: formaPagamentoId },
    select: { tenantId: true, ativo: true, taxaPct: true, tipo: true },
  });
  if (!forma || forma.tenantId !== quem.tenantId) {
    throw new ErroDeOperacao("Forma de pagamento não encontrada.");
  }
  if (!forma.ativo) throw new ErroDeOperacao("Esta forma de pagamento está desativada.");
  // Só dinheiro tem troco: cartão e Pix são cobrados no valor exato.
  if (troco > 0 && forma.tipo !== "DINHEIRO") throw new ErroDeOperacao("Só pagamento em dinheiro tem troco.");

  const taxaPct = Number(forma.taxaPct);
  // Troco fora da base: a adquirente cobra sobre o que passou na maquininha,
  // e o que voltou para a mão do cliente nunca passou.
  const taxaValor = centavos(((valor - troco) * taxaPct) / 100);

  /**
   * Dois toques em "receber" cobravam duas vezes: R$ 91,74 numa conta de
   * R$ 45,87. A comanda é travada para a conta e a gravação acontecerem
   * juntas — o segundo toque espera o primeiro e encontra a conta quitada.
   * E ninguém recebe mais do que falta: o que passar disso é troco, e troco
   * se lança como troco.
   */
  const resultado = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM comandas WHERE id = ${comandaId} FOR UPDATE`;

    /*
     * O reenvio da maquininha encontra o pagamento que já entrou e sai em paz.
     * Conferido dentro da trava: dois reenvios ao mesmo tempo, um esperaria o
     * outro terminar e os dois gravariam.
     */
    if (dados.referenciaExterna) {
      const mesmo = await tx.pagamento.findFirst({
        where: { tenantId: quem.tenantId, referenciaExterna: dados.referenciaExterna },
        select: { id: true },
      });
      if (mesmo) return { jaRegistrado: true };
    }

    const atual = await tx.comanda.findUniqueOrThrow({
      where: { id: comandaId },
      include: {
        itens: { where: CONSUMO, select: { precoTotal: true } },
        pagamentos: { select: { valor: true, troco: true } },
      },
    });
    if (atual.status === "PAGA") throw new ErroDeOperacao("Comanda já está paga.");

    const { total } = calcularTotais({
      itens: atual.itens.map((i) => ({ precoTotal: Number(i.precoTotal) })),
      taxaServicoPct: Number(atual.taxaServicoPct),
      descontoValor: Number(atual.descontoValor),
    });
    const recebido = centavos(atual.pagamentos.reduce((s, p) => s + Number(p.valor) - Number(p.troco), 0));
    const falta = centavos(total - recebido);
    if (falta <= TOLERANCIA) throw new ErroDeOperacao("Esta conta já está quitada.");
    if (valor - troco > falta + TOLERANCIA) {
      throw new ErroDeOperacao(`Falta receber só R$ ${reais(falta)}.`);
    }

    await tx.pagamento.create({
      data: {
        tenantId: comanda.tenantId,
        comandaId,
        caixaId: caixa.id,
        formaPagamentoId,
        valor,
        troco,
        taxaPct,
        taxaValor,
        nsu: dados.nsu ?? null,
        bandeira: dados.bandeira ?? null,
        referenciaExterna: dados.referenciaExterna ?? null,
        usuarioId: quem.usuarioId,
      },
    });
    return { jaRegistrado: false, falta: centavos(falta - (valor - troco)) };
  });

  await publicar(quem.unidadeId, "pagamento");

  if (resultado.jaRegistrado) {
    const conta = await contaDaComanda(comandaId);
    return { falta: conta?.falta ?? 0, jaRegistrado: true };
  }
  return { falta: resultado.falta!, jaRegistrado: false };
}

/**
 * Quita a comanda e devolve a mesa para o salão. Só passa se o recebido cobrir
 * o total — caso contrário a mesa sairia do mapa com dinheiro faltando.
 *
 * Devolve `false` quando outro toque fechou a conta primeiro: quem chamou não
 * precisa tratar isso como erro, só não repete o cupom.
 */
export async function finalizarConta(quem: QuemRecebe, comandaId: string): Promise<boolean> {
  const comanda = await db.comanda.findUniqueOrThrow({ where: { id: comandaId } });
  if (comanda.tenantId !== quem.tenantId) throw new ErroDeOperacao("Comanda de outro restaurante.");
  if (comanda.unidadeId !== quem.unidadeId) throw new ErroDeOperacao("Comanda de outra unidade.");
  if (comanda.status === "PAGA") return false;

  const caixa = await db.caixa.findFirst({
    where: { unidadeId: comanda.unidadeId, tipo: "GERAL", status: "ABERTO" },
  });

  const limparAuto = await db.parametroUnidade.findUnique({
    where: {
      unidadeId_chave: { unidadeId: comanda.unidadeId, chave: "mesa.limparAutomaticamente" },
    },
  });

  /**
   * Dois toques em "finalizar" passavam os dois pela conferência acima e
   * emitiam dois cupons (e duas tentativas de NFC-e). Com a comanda travada,
   * só o primeiro a fecha; o segundo encontra PAGA e sai sem efeito.
   */
  const fechouAgora = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM comandas WHERE id = ${comandaId} FOR UPDATE`;
    const atual = await tx.comanda.findUniqueOrThrow({
      where: { id: comandaId },
      include: {
        itens: { where: CONSUMO, select: { precoTotal: true } },
        pagamentos: { select: { valor: true, troco: true } },
      },
    });
    if (atual.status === "PAGA") return false;

    /**
     * A conta é conferida aqui, dentro da trava, e não antes.
     *
     * Conferida antes, um estorno ou um cancelamento no mesmo instante
     * passava pelo meio: a conta saía PAGA sem o pagamento que acabava de
     * ser estornado, ou com o dinheiro de um item que acabava de ser
     * cancelado. Estorno e cancelamento travam a mesma linha.
     *
     * E conta paga recebeu o total — nem a menos, nem a mais. O que sobra
     * (item cancelado ou desconto dado depois de receber) é dinheiro sem
     * venda: o caixa estorna e recebe o valor certo.
     */
    const { total } = calcularTotais({
      itens: atual.itens.map((i) => ({ precoTotal: Number(i.precoTotal) })),
      taxaServicoPct: Number(atual.taxaServicoPct),
      descontoValor: Number(atual.descontoValor),
    });
    const recebido = centavos(
      atual.pagamentos.reduce((soma, p) => soma + Number(p.valor) - Number(p.troco), 0)
    );
    if (recebido + TOLERANCIA < total) {
      throw new ErroDeOperacao(`Faltam R$ ${reais(total - recebido)} para quitar a comanda.`);
    }
    if (recebido > total + TOLERANCIA) {
      throw new ErroDeOperacao(
        `Foram recebidos R$ ${reais(recebido - total)} a mais que a conta (R$ ${reais(total)}). ` +
          "Estorne o pagamento e receba o valor certo."
      );
    }

    await tx.comanda.update({
      where: { id: comandaId },
      data: { status: "PAGA", fechadaEm: new Date(), caixaId: caixa?.id ?? null },
    });
    /**
     * Carrinho fica fora. O item PENDENTE nunca foi enviado nem cobrado —
     * o total acima o exclui —, mas virava ENTREGUE aqui: a conta paga
     * passava a ter um item não pago, que entrava no faturamento sem ter
     * baixado estoque.
     */
    await tx.comandaItem.updateMany({
      where: { comandaId, status: { notIn: ["CANCELADO", "ENTREGUE", "PENDENTE"] } },
      data: { status: "ENTREGUE" },
    });
    /**
     * O ticket pronto sai da cozinha junto com a conta: é o que acumulava no
     * KDS, porque ninguém toca em "entregue" num prato que já está na mesa.
     *
     * O que ainda está na fila ou no fogo fica. Há casa em que se paga antes
     * de a comida sair — balcão, a última rodada paga na hora —, e ali
     * encerrar o ticket junto com a conta sumiria com um pedido por fazer.
     */
    await tx.pedido.updateMany({
      where: { comandaId, status: "PRONTO" },
      data: { status: "ENTREGUE", entregueEm: new Date() },
    });
    if (comanda.mesaId) {
      await tx.mesa.update({
        where: { id: comanda.mesaId },
        // Onde a limpeza não é automática, a mesa fica SUJA até alguém liberar.
        data: { status: limparAuto?.valor === false ? "SUJA" : "LIVRE" },
      });
    }
    return true;
  });
  if (!fechouAgora) return false;

  // A conta já foi paga; se o cupom falhar, ninguém segura o cliente na porta.
  try {
    await enfileirarCupom(comandaId, quem.nome);
  } catch (e) {
    console.error("Falha ao enfileirar cupom", e);
  }

  // Mesma regra para a nota: problema fiscal vira pendência para a gestão
  // resolver, nunca venda travada com o cliente esperando no caixa.
  try {
    const nota = await emitirNfce(comandaId, quem.usuarioId);
    if (!nota.ok) console.error("NFC-e não autorizada:", nota.motivo);
  } catch (e) {
    console.error("Falha ao emitir NFC-e", e);
  }

  await publicar(quem.unidadeId, "mesa-liberada");
  return true;
}
