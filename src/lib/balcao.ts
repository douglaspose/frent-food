import { db } from "@/lib/db";
import { ErroDeOperacao } from "@/lib/erro-de-operacao";
import { TOLERANCIA } from "@/lib/comanda";
import { contaDaComanda, finalizarConta, receberPagamento } from "@/lib/conta";
import { liberar } from "@/lib/autorizacao-servidor";
import type { PrecisaAutorizacao } from "@/lib/autorizacao";
import { auditoria } from "@/lib/auditoria-servidor";
import type { Sessao } from "@/lib/session";

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

/**
 * Receber uma venda de balcão pela retaguarda.
 *
 * A saída da comanda de balcão que ficou presa. Ela nasce quando a maquininha
 * cobra sem mesa e, se o pagamento não chega — caixa fechado na hora, ou o
 * servidor recusou aquela venda de vez —, ela fica aberta: sem mesa, fora do
 * mapa do salão, e travando o fechamento do caixa, que recusa enquanto houver
 * comanda aberta na unidade.
 *
 * Aqui a casa registra à mão o que a adquirente já cobrou, com o comprovante
 * na frente. Por isso pede autorização: é dinheiro entrando no sistema pela
 * palavra de quem opera, com a prova em papel e não no banco — a mesma
 * natureza de um movimento de gaveta.
 *
 * O valor não se digita: é o da comanda. Quem escolhe é a forma, porque é ela
 * que diz onde o dinheiro caiu e qual taxa a casa pagou.
 */
export async function receberBalcaoPelaRetaguarda(
  quem: Sessao,
  dados: { comandaId: string; formaPagamentoId: string; autorizacaoId?: string | null }
): Promise<{ ok: true; valor: number } | PrecisaAutorizacao> {
  const liberacao = await liberar(
    quem,
    "caixa.sangria",
    "RECEBER_BALCAO",
    dados.comandaId,
    dados.autorizacaoId
  );
  if (!liberacao) return { precisaAutorizacao: "RECEBER_BALCAO" };
  const { sessao, aprovadoPor, consumir } = liberacao;

  /*
   * A conta vem de `contaDaComanda`, e não de uma soma própria.
   *
   * Somar os itens aqui era somar **outra coisa**: o total de uma conta é o
   * consumo menos o desconto, mais a taxa de serviço, menos o que já entrou —
   * é o que `calcularTotais` faz e o que `receberPagamento` confere do outro
   * lado da porta. Com a soma crua, um desconto de R$ 5 numa venda de R$ 20
   * fazia esta porta oferecer R$ 20 a uma conta que valia R$ 15, e a recusa
   * certa do outro lado ("Falta receber só R$ 15,00") trancava a venda para
   * sempre: sem mesa, ela não tem outra tela por onde ser recebida, e o caixa
   * recusa fechar a noite enquanto ela estiver aberta.
   *
   * `findUnique` por dentro, e não `findUniqueOrThrow`: sob RLS a comanda de
   * outro restaurante não existe para esta sessão, e o que chegava ao caixa
   * era o erro do Prisma com arquivo e linha, onde devia vir uma recusa.
   */
  const conta = await contaDaComanda(dados.comandaId);
  if (!conta) throw new ErroDeOperacao("Venda não encontrada.");
  const comanda = conta.comanda;
  if (comanda.tenantId !== sessao.tenantId) throw new ErroDeOperacao("Comanda de outro restaurante.");
  if (comanda.unidadeId !== sessao.unidadeId) throw new ErroDeOperacao("Comanda de outra unidade.");
  /*
   * Só a de balcão entra por aqui.
   *
   * A conta de mesa tem a tela dela, com o teclado, o troco e a divisão por
   * pessoa. Deixar esta porta aberta para ela seria uma segunda forma de
   * receber, sem nada disso e com autorização de gaveta.
   */
  if (comanda.mesaId) {
    throw new ErroDeOperacao("Esta conta tem mesa: receba por ela, na tela da mesa.");
  }
  if (comanda.status === "PAGA") throw new ErroDeOperacao("Esta venda já foi recebida.");

  /*
   * O que falta, e não o que a venda soma.
   *
   * A venda de balcão cobrada em duas passadas de cartão — a primeira aprova,
   * a segunda cai na rede — fica aberta com parte do dinheiro dentro. Pedindo
   * o total cheio, esta porta era recusada por "falta receber só R$ 12,00" e a
   * venda ficava presa; a faixa do mapa, que só oferece a porta quando nada
   * entrou, nem mostra o botão. Pedindo o que falta, a mesma porta serve aos
   * dois casos.
   */
  const falta = conta.falta;
  if (falta <= TOLERANCIA) {
    /*
     * Nada falta: ou a venda já recebeu tudo e só ficou aberta — e então o que
     * esta porta tem a fazer é fechá-la, que é o que tira a comanda do mapa e
     * destrava o caixa —, ou ela não vale nada e não há o que receber.
     */
    if (conta.recebido <= TOLERANCIA) {
      throw new ErroDeOperacao("Esta venda não tem valor para receber.");
    }
  }

  /*
   * A liberação é gasta antes do dinheiro entrar, e em transação própria.
   *
   * Receber e fechar são duas regras com transações próprias — não há uma só
   * para carregar a liberação junto. Gastando antes, uma falha no meio custa
   * um PIN novo ao gerente; gastando depois, o mesmo PIN receberia duas vezes.
   */
  await db.$transaction(async (tx) => consumir(tx));

  const quemRecebe = {
    usuarioId: sessao.usuarioId,
    tenantId: sessao.tenantId,
    unidadeId: sessao.unidadeId,
    nome: sessao.nome,
  };

  // Venda já quitada e aberta não recebe de novo: só falta fechá-la.
  const { jaRegistrado } =
    falta > TOLERANCIA
      ? await receberPagamento(quemRecebe, {
          comandaId: dados.comandaId,
          formaPagamentoId: dados.formaPagamentoId,
          valor: falta,
          troco: 0,
        })
      : { jaRegistrado: true };

  /*
   * Fecha junto, como a maquininha faria: a venda de balcão nasce terminada, e
   * deixá-la aberta seria repor no mapa a comanda que esta ação veio tirar de
   * lá — e manter o caixa travado.
   */
  await finalizarConta(quemRecebe, dados.comandaId);

  const registro = await auditoria(sessao, {
    entidade: "Comanda",
    entidadeId: dados.comandaId,
    acao: "BALCAO_RECEBIDO_PELA_RETAGUARDA",
    depois: {
      numero: comanda.numero,
      valor: falta,
      jaRegistrado,
      // Quem liberou fica no registro: é o que separa "o caixa decidiu
      // sozinho" de "o gerente conferiu o comprovante".
      aprovadoPor: aprovadoPor?.nome ?? null,
    },
  });
  await db.auditLog.create({ data: registro });


  return { ok: true, valor: falta };
}
