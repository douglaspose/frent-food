import { db } from "@/lib/db";
import { ErroDeOperacao } from "@/lib/erro-de-operacao";

/**
 * A venda de balcão: o que a maquininha cobrou sem passar por mesa nenhuma.
 *
 * O aparelho sempre teve o botão "Cobrar um valor avulso" — é a venda do
 * cliente em pé no balcão, que não abriu conta. A credenciadora aprovava, o
 * dinheiro saía do cartão, e o resultado não ia a lugar nenhum: o aplicativo
 * nem tentava mandar (não havia comanda para citar) e o servidor recusaria
 * ("Informe a comanda"). A casa fechava o caixa com um extrato da adquirente
 * que nenhuma venda do sistema explicava.
 *
 * O que falta para a venda existir aqui é uma comanda, e é só isso: o resto do
 * caminho — congelar a taxa, reconhecer o reenvio, somar no caixa, fechar — já
 * é o mesmo de qualquer conta. Então a venda de balcão **abre uma comanda** de
 * uma linha só e entrega para as regras que já existem.
 *
 * A linha não é enfeite: metade do sistema confere uma comanda somando os
 * itens dela e comparando com o que foi pago — `finalizarConta` recusa uma
 * conta paga a mais, `receberPagamento` recusa receber numa conta quitada.
 * Uma comanda vazia com um pagamento dentro quebraria as duas, e qualquer
 * relatório que recalcule o total veria dinheiro sem venda. Com a linha, a
 * venda de balcão é uma conta normal: um item, um pagamento, total igual.
 *
 * O preço disso é um produto que a casa não cadastrou, e que aparece no
 * ranking como "Venda de balcão". É a resposta honesta: a casa vendeu aquilo
 * pelo aparelho sem dizer o que era.
 */

/** O código reservado do produto interno, por restaurante. */
export const CODIGO_DO_BALCAO = "__BALCAO__";

export const TITULO_DO_BALCAO = "Venda de balcão";

export type QuemVendeNoBalcao = {
  usuarioId: string;
  tenantId: string;
  unidadeId: string;
};

/**
 * O produto interno da casa, criado na primeira venda de balcão.
 *
 * Fora de qualquer cardápio de propósito: ele não é para escolher, é para
 * registrar. Sem ficha e sem estoque — não há o que dar baixa quando não se
 * sabe o que saiu.
 */
async function produtoDoBalcao(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  tenantId: string
) {
  const existente = await tx.produto.findFirst({
    where: { tenantId, codigo: CODIGO_DO_BALCAO },
    select: { id: true },
  });
  if (existente) return existente.id;

  const criado = await tx.produto.create({
    data: {
      tenantId,
      codigo: CODIGO_DO_BALCAO,
      titulo: TITULO_DO_BALCAO,
      descricao:
        "Criado pelo sistema para as vendas cobradas na maquininha sem passar " +
        "por mesa. Não aparece no cardápio.",
      controlaEstoque: false,
      isentoTaxaServico: true,
    },
    select: { id: true },
  });
  return criado.id;
}

/**
 * A comanda de uma venda de balcão, pronta para receber o pagamento.
 *
 * Devolve a mesma comanda quando a referência já passou por aqui: a maquininha
 * reenvia o resultado que ficou preso na rede, e o reenvio não pode virar uma
 * segunda venda. A marca do reenvio é a `referenciaExterna` do item, que é
 * única por restaurante — a mesma chave que o pagamento usa adiante.
 */
export async function comandaDeBalcao(
  quem: QuemVendeNoBalcao,
  dados: { referencia: string; valorEmCentavos: number }
): Promise<{ comandaId: string; jaExistia: boolean }> {
  const referencia = dados.referencia.trim();
  if (!referencia) throw new ErroDeOperacao("Venda de balcão sem referência.");
  if (!Number.isSafeInteger(dados.valorEmCentavos) || dados.valorEmCentavos <= 0) {
    throw new ErroDeOperacao("Informe um valor maior que zero.");
  }
  const valor = dados.valorEmCentavos / 100;

  const jaFeita = await db.comandaItem.findFirst({
    where: { tenantId: quem.tenantId, referenciaExterna: referencia },
    select: { comandaId: true },
  });
  if (jaFeita) return { comandaId: jaFeita.comandaId, jaExistia: true };

  const comandaId = await db.$transaction(async (tx) => {
    /*
     * A mesma trava da abertura de mesa, e pelo mesmo motivo: o número da
     * comanda é max+1, e duas vendas no mesmo instante — o caixa cobrando e o
     * escoamento da fila chegando junto — pegariam o mesmo número. Dentro
     * dela, a referência é conferida de novo: é aqui que dois reenvios
     * simultâneos deixam de virar duas vendas.
     */
    await tx.$queryRaw`SELECT id FROM unidades WHERE id = ${quem.unidadeId} FOR NO KEY UPDATE`;

    const repetida = await tx.comandaItem.findFirst({
      where: { tenantId: quem.tenantId, referenciaExterna: referencia },
      select: { comandaId: true },
    });
    if (repetida) return repetida.comandaId;

    const produtoId = await produtoDoBalcao(tx, quem.tenantId);
    const ultima = await tx.comanda.findFirst({
      where: { unidadeId: quem.unidadeId },
      orderBy: { numero: "desc" },
      select: { numero: true },
    });

    const criada = await tx.comanda.create({
      data: {
        tenantId: quem.tenantId,
        unidadeId: quem.unidadeId,
        numero: (ultima?.numero ?? 0) + 1,
        origem: "BALCAO",
        pessoas: 1,
        // Sem taxa de serviço: ninguém serviu mesa nenhuma.
        taxaServicoPct: 0,
        abertaPorId: quem.usuarioId,
        itens: {
          create: {
            tenantId: quem.tenantId,
            produtoId,
            quantidade: 1,
            precoUnitario: valor,
            precoTotal: valor,
            /*
             * Já entregue: não há cozinha nisto. PENDENTE seria carrinho e
             * ficaria fora do total — a conta nasceria valendo zero e o
             * pagamento seria recusado como "conta já quitada".
             */
            status: "ENTREGUE",
            referenciaExterna: referencia,
            lancadoPorId: quem.usuarioId,
          },
        },
      },
      select: { id: true },
    });
    return criada.id;
  });

  return { comandaId, jaExistia: false };
}
