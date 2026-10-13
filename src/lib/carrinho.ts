import "server-only";
import { db } from "./db";
import { enfileirarPedidos } from "./fila-impressao";
import { baixarVenda } from "./estoque";
import { publicar } from "./eventos";
import { ajusteBooleano, ajusteNumerico } from "./parametros-servidor";
import { ErroDeOperacao } from "./erro-de-operacao";

/**
 * Lançar item e mandar a rodada para a cozinha — a regra, sem a tela.
 *
 * Mora aqui pelo mesmo motivo de `conta.ts`: há dois caminhos até ela. O
 * garçom no PDV, com sessão de navegador, e o garçom na maquininha, com o
 * token do aparelho e o PIN do turno. Duas cópias desta regra é como uma
 * delas passa a aceitar o que a outra recusa — e aqui o que se recusa é
 * picanha lançada a preço de água e rodada enviada duas vezes para a chapa.
 *
 * Quem chama já conferiu quem é a pessoa e se ela pode; este arquivo cuida do
 * que acontece com a comanda.
 */

/** Quem está lançando. No PDV é a sessão; na maquininha, o operador do PIN. */
export type QuemLanca = {
  usuarioId: string;
  tenantId: string;
  unidadeId: string;
};

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

export async function comandaAberta(comandaId: string, tenantId: string) {
  const comanda = await db.comanda.findUniqueOrThrow({ where: { id: comandaId } });
  if (comanda.tenantId !== tenantId) throw new ErroDeOperacao("Comanda de outro restaurante.");
  if (comanda.status === "PAGA") throw new ErroDeOperacao("Comanda já paga. Abra uma nova.");
  // A mensagem diz o que fazer: "não está aberta" deixava o garçom sem saída.
  if (comanda.status !== "ABERTA") {
    throw new ErroDeOperacao("A conta está em fechamento. Reabra a mesa para lançar itens.");
  }
  return comanda;
}

/**
 * O item do cardápio da unidade da comanda — e é dele que saem produto e preço.
 *
 * Quem chama manda preço e produto, mas tanto a server action quanto a rota da
 * maquininha são porta aberta: gravar o que chega deixava lançar picanha a um
 * centavo, preço negativo para abater a conta e item do cardápio de outro
 * restaurante. Nada disso aparecia no diário. O que vale é o cardápio.
 */
async function itemDoCardapio(cardapioItemId: string, unidadeId: string) {
  const item = await db.cardapioItem.findUnique({
    where: { id: cardapioItemId },
    select: {
      produtoId: true,
      preco: true,
      esgotado: true,
      cardapio: { select: { unidadeId: true, ativo: true } },
      produto: { select: { exigePontoCarne: true, titulo: true } },
    },
  });
  // Chave estrangeira ignora o RLS: a conferência da unidade é aqui, no código.
  if (!item || item.cardapio.unidadeId !== unidadeId || !item.cardapio.ativo) {
    throw new ErroDeOperacao("Item fora do cardápio desta casa.");
  }
  if (item.esgotado) throw new ErroDeOperacao("Este item está esgotado.");
  return item;
}

/**
 * O cardápio ativo da unidade, como a tela precisa dele.
 *
 * Só o que está à venda: cardápio ativo, e cada item com o preço que vale
 * agora. O esgotado vem junto, marcado — sumir com ele faria o garçom procurar
 * na tela um prato que ele sabe que existe.
 */
export async function cardapioDaUnidade(unidadeId: string) {
  const cardapio = await db.cardapio.findFirst({
    // `canal` importa: a casa pode ter um cardápio de delivery com outro preço
    // na mesma unidade, e quem está com a maquininha na mão está no salão.
    where: { unidadeId, canal: "SALAO", ativo: true },
    select: {
      id: true,
      itens: {
        // `visivel` é como a casa tira um prato da tela sem apagar o cadastro
        // nem perder o histórico de quem já pediu.
        where: { visivel: true },
        orderBy: { ordem: "asc" },
        select: {
          id: true,
          preco: true,
          esgotado: true,
          // A categoria do item ganha da do produto: é ela que a casa usa para
          // montar a ordem do cardápio, e o mesmo produto pode aparecer em
          // seções diferentes de cardápios diferentes.
          categoria: { select: { id: true, nome: true } },
          produto: {
            select: {
              id: true,
              titulo: true,
              descricao: true,
              exigePontoCarne: true,
              categoria: { select: { id: true, nome: true } },
            },
          },
        },
      },
    },
  });
  if (!cardapio) return [];

  /*
   * Agrupado por categoria aqui, e não na tela: a maquininha tem pouca tela e
   * menos processador, e o navegador já recebe assim no PDV.
   */
  const porCategoria = new Map<
    string,
    { id: string; nome: string; itens: ItemDoCardapio[] }
  >();

  for (const item of cardapio.itens) {
    const categoria = item.categoria ?? item.produto.categoria;
    const chave = categoria?.id ?? "sem-categoria";
    if (!porCategoria.has(chave)) {
      porCategoria.set(chave, {
        id: chave,
        nome: categoria?.nome ?? "Outros",
        itens: [],
      });
    }
    porCategoria.get(chave)!.itens.push({
      cardapioItemId: item.id,
      produtoId: item.produto.id,
      titulo: item.produto.titulo,
      descricao: item.produto.descricao,
      precoEmCentavos: Math.round(Number(item.preco) * 100),
      esgotado: item.esgotado,
      exigePontoCarne: item.produto.exigePontoCarne,
    });
  }

  /*
   * A ordem que a casa definiu manda, e o título só desempata. Ordenar por
   * nome jogaria o prato do dia para o meio da lista — a `ordem` existe
   * justamente para a casa decidir o que aparece primeiro.
   */
  return [...porCategoria.values()];
}

export type ItemDoCardapio = {
  cardapioItemId: string;
  produtoId: string;
  titulo: string;
  descricao: string | null;
  precoEmCentavos: number;
  esgotado: boolean;
  exigePontoCarne: boolean;
};

/**
 * Põe um item no carrinho da comanda (status PENDENTE).
 *
 * O carrinho mora no banco, e não no aparelho: trocar de maquininha ou
 * recarregar a tela perdia a rodada inteira, e o salão não tinha como avisar
 * que havia pedido esquecido sem enviar.
 */
export async function adicionarItem(
  quem: QuemLanca,
  dados: {
    comandaId: string;
    cardapioItemId: string;
    quantidade?: number;
    observacao?: string | null;
  }
) {
  const quantidade = dados.quantidade ?? 1;
  if (!Number.isFinite(quantidade) || quantidade <= 0) {
    throw new ErroDeOperacao("Informe uma quantidade maior que zero.");
  }

  const comanda = await comandaAberta(dados.comandaId, quem.tenantId);
  const item = await itemDoCardapio(dados.cardapioItemId, comanda.unidadeId);
  const precoUnitario = Number(item.preco);

  /*
   * Observação separa itens. Dois chopes, um "sem colarinho", não são a mesma
   * linha: agrupados, a cozinha receberia a observação valendo para os dois.
   * Item com ponto da carne também nunca agrupa — cada unidade pode ter o seu.
   */
  const observacao = limparObservacao(dados.observacao);
  if (!item.produto.exigePontoCarne && !observacao) {
    const existente = await db.comandaItem.findFirst({
      where: {
        comandaId: dados.comandaId,
        produtoId: item.produtoId,
        status: "PENDENTE",
        pontoCarne: null,
        observacao: null,
      },
    });

    if (existente) {
      const somada = Number(existente.quantidade) + quantidade;
      await limitarQuantidade(comanda.unidadeId, somada);
      await db.comandaItem.update({
        where: { id: existente.id },
        data: { quantidade: somada, precoTotal: somada * Number(existente.precoUnitario) },
      });
      await publicar(comanda.unidadeId, "carrinho");
      return;
    }
  }

  await limitarQuantidade(comanda.unidadeId, quantidade);
  await db.comandaItem.create({
    data: {
      tenantId: comanda.tenantId,
      comandaId: dados.comandaId,
      produtoId: item.produtoId,
      cardapioItemId: dados.cardapioItemId,
      quantidade,
      precoUnitario,
      precoTotal: precoUnitario * quantidade,
      observacao,
      status: "PENDENTE",
      lancadoPorId: quem.usuarioId,
    },
  });

  await publicar(comanda.unidadeId, "carrinho");
}

/**
 * A observação vai para o papel da cozinha, então passa pelo mesmo crivo do
 * nome do cliente: caractere de controle fora (o byte zero chega à térmica
 * como comando) e tamanho de observação, não de redação.
 */
function limparObservacao(texto: string | null | undefined) {
  const limpo = texto?.replace(/[\x00-\x1f\x7f]/g, "").trim();
  if (!limpo) return null;
  if (limpo.length > 200) throw new ErroDeOperacao("A observação vai até 200 caracteres.");
  return limpo;
}

/**
 * Manda a rodada para a cozinha: os pendentes viram pedido por estação.
 *
 * É a operação mais delicada do sistema — por isso ela é uma só, e não uma por
 * tela. O que ela segura está comentado passo a passo abaixo.
 */
export async function enviarCarrinho(quem: QuemLanca, comandaId: string) {
  const comanda = await db.comanda.findUniqueOrThrow({ where: { id: comandaId } });
  if (comanda.tenantId !== quem.tenantId) throw new ErroDeOperacao("Comanda de outro restaurante.");
  if (comanda.status !== "ABERTA") throw new ErroDeOperacao("A comanda não está aberta.");

  const pedidosCriados: string[] = [];

  /**
   * Cozinha que não quer o toque a mais recebe o ticket já em preparo. Com a
   * confirmação ligada ele nasce em NA FILA e alguém assume o prato — é o que
   * separa "a cozinha viu" de "o pedido chegou".
   */
  const confirmaNaTela = await ajusteBooleano(comanda.unidadeId, "kds.confirmarPedidoNaTela");
  const statusInicial = confirmaNaTela ? "AGUARDANDO" : "EM_PREPARO";

  const pendentes = await db.$transaction(async (tx) => {
    /**
     * Um envio por vez na mesma comanda.
     *
     * O carrinho era lido fora da transação: dois toques em "enviar" liam os
     * mesmos itens pendentes, e a rodada ia duas vezes para a cozinha — dois
     * tickets e a baixa do estoque em dobro. Com a comanda travada, o
     * segundo toque espera o primeiro e encontra o carrinho vazio.
     */
    await tx.$queryRaw`SELECT id FROM comandas WHERE id = ${comandaId} FOR UPDATE`;
    const atual = await tx.comanda.findUniqueOrThrow({ where: { id: comandaId }, select: { status: true } });
    if (atual.status !== "ABERTA") throw new ErroDeOperacao("A comanda não está aberta.");

    const pendentes = await tx.comandaItem.findMany({
      where: { comandaId, status: "PENDENTE" },
      select: { id: true, produtoId: true, quantidade: true },
    });
    if (pendentes.length === 0) return pendentes;

    const estacoesPorProduto = await tx.produtoEstacao.findMany({
      where: { produtoId: { in: pendentes.map((i) => i.produtoId) } },
    });
    const estacaoDoProduto = new Map(estacoesPorProduto.map((e) => [e.produtoId, e.estacaoId]));

    await tx.comandaItem.updateMany({
      where: { id: { in: pendentes.map((i) => i.id) } },
      // O item da comanda acompanha o ticket: o garçom vê "EM_PREPARO" na
      // tela da mesa sem a cozinha precisar tocar em nada.
      data: { status: confirmaNaTela ? "ENVIADO" : "EM_PREPARO", lancadoEm: new Date() },
    });

    // Agrupa os itens por estação de produção.
    const porEstacao = new Map<string, string[]>();
    for (const item of pendentes) {
      const estacaoId = estacaoDoProduto.get(item.produtoId);
      if (!estacaoId) continue; // produto sem estação não vai para produção
      porEstacao.set(estacaoId, [...(porEstacao.get(estacaoId) ?? []), item.id]);
    }

    // Dentro da transação: o item enviado e a baixa do estoque têm que nascer
    // juntos, senão o consumo fica sem contrapartida quando algo falhar.
    await baixarVenda(tx, {
      tenantId: comanda.tenantId,
      unidadeId: comanda.unidadeId,
      usuarioId: quem.usuarioId,
      itens: pendentes.map((i) => ({
        produtoId: i.produtoId,
        quantidade: Number(i.quantidade),
        comandaItemId: i.id,
      })),
    });

    /**
     * A numeração dos tickets, por último e em fila.
     *
     * O max+1 corria solto: dois envios ao mesmo tempo liam o mesmo último
     * número, e no dia simulado 140 de 620 tickets repetiam número — o que a
     * cozinha grita e o que vai pendurado na chapa. A trava (consultiva, só
     * desta numeração) dura até o fim da transação; por isso este é o último
     * passo, depois da baixa do estoque, e segura a fila só pelos inserts.
     */
    await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext(${`pedido:${comanda.unidadeId}`}))) AS trava`;
    const ultimo = await tx.pedido.findFirst({
      where: { unidadeId: comanda.unidadeId },
      orderBy: { numero: "desc" },
      select: { numero: true },
    });
    let numero = (ultimo?.numero ?? 0) + 1;

    for (const [estacaoId, itemIds] of porEstacao) {
      const pedido = await tx.pedido.create({
        data: {
          tenantId: comanda.tenantId,
          unidadeId: comanda.unidadeId,
          comandaId,
          estacaoId,
          numero: numero++,
          status: statusInicial,
          iniciadoEm: confirmaNaTela ? null : new Date(),
          itens: { create: itemIds.map((comandaItemId) => ({ comandaItemId })) },
        },
      });
      pedidosCriados.push(pedido.id);
    }
    return pendentes;
  });
  if (pendentes.length === 0) return { enviados: 0 };

  // Fora da transação: o pedido já está no KDS, e uma falha ao montar o papel
  // não pode desfazer o lançamento que a cozinha já está vendo.
  try {
    await enfileirarPedidos(pedidosCriados);
  } catch (e) {
    console.error("Falha ao enfileirar impressão dos pedidos", e);
  }

  // O evento que mais importa: é ele que faz o ticket aparecer na cozinha sem
  // ninguém esperar o próximo ciclo.
  await publicar(comanda.unidadeId, "pedido-enviado");
  return { enviados: pendentes.length };
}
