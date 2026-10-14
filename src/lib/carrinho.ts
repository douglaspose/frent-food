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

  const grupos = await gruposDosProdutos(cardapio.itens.map((i) => i.produto.id));

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
      grupos: grupos.get(item.produto.id) ?? [],
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
  /** O que o cliente escolhe: ponto, adicionais, acompanhamentos. */
  grupos: GrupoDeOpcionais[];
};

export type GrupoDeOpcionais = {
  id: string;
  titulo: string;
  /**
   * Quantas escolhas o grupo aceita. `min` 1 com `obrigatorio` é o "escolha o
   * ponto da carne"; `max` 3 é o "até três adicionais".
   */
  minEscolhas: number;
  maxEscolhas: number;
  obrigatorio: boolean;
  itens: OpcionalDoCardapio[];
};

export type OpcionalDoCardapio = {
  opcionalId: string;
  titulo: string;
  /** Zero no que não cobra — "sem cebola" não tem preço. */
  precoEmCentavos: number;
};

/**
 * Os grupos de opcionais dos produtos pedidos, já em forma de tela.
 *
 * Numa consulta só para o cardápio inteiro, e não uma por produto: são
 * algumas centenas de itens, e uma ida ao banco por item deixaria a abertura
 * do cardápio na maquininha em segundos.
 */
export async function gruposDosProdutos(produtoIds: string[]) {
  if (produtoIds.length === 0) return new Map<string, GrupoDeOpcionais[]>()

  const vinculos = await db.produtoGrupoOpcional.findMany({
    where: { produtoId: { in: produtoIds } },
    orderBy: { ordem: "asc" },
    select: {
      produtoId: true,
      grupo: {
        select: {
          id: true,
          titulo: true,
          minEscolhas: true,
          maxEscolhas: true,
          obrigatorio: true,
          ordem: true,
          itens: {
            // Opcional desativado sai da tela, mas segue existindo nos
            // lançamentos antigos — por isso o título é congelado na comanda.
            where: { ativo: true },
            orderBy: { ordem: "asc" },
            select: { id: true, titulo: true, preco: true },
          },
        },
      },
    },
  });

  const porProduto = new Map<string, GrupoDeOpcionais[]>();
  for (const vinculo of vinculos) {
    // Grupo sem opção ativa não vai para a tela: seria um título sozinho, e no
    // obrigatório travaria o lançamento sem o garçom ter o que escolher.
    if (vinculo.grupo.itens.length === 0) continue;
    const lista = porProduto.get(vinculo.produtoId) ?? []
    lista.push({
      id: vinculo.grupo.id,
      titulo: vinculo.grupo.titulo,
      minEscolhas: vinculo.grupo.minEscolhas,
      maxEscolhas: vinculo.grupo.maxEscolhas,
      obrigatorio: vinculo.grupo.obrigatorio,
      itens: vinculo.grupo.itens.map((i) => ({
        opcionalId: i.id,
        titulo: i.titulo,
        precoEmCentavos: Math.round(Number(i.preco) * 100),
      })),
    });
    porProduto.set(vinculo.produtoId, lista);
  }
  return porProduto;
}

/**
 * Põe um item no carrinho da comanda (status PENDENTE).
 *
 * O carrinho mora no banco, e não no aparelho: trocar de maquininha ou
 * recarregar a tela perdia a rodada inteira, e o salão não tinha como avisar
 * que havia pedido esquecido sem enviar.
 */
/** O que o garçom escolheu num grupo. */
export type EscolhaDeOpcional = { opcionalId: string; quantidade?: number };

/**
 * Confere as escolhas contra os grupos do produto e devolve o que gravar.
 *
 * A conferência é aqui, e não na tela, pelo mesmo motivo do preço: a porta é
 * aberta. Sem ela, dava para pedir "bacon extra" de graça mandando um opcional
 * de outro produto, furar o "escolha o ponto" obrigatório, ou somar dez
 * adicionais num grupo que aceita um.
 *
 * O título e o preço saem congelados: o papel da cozinha e a conta precisam
 * dizer o que foi pedido, mesmo que a casa renomeie ou reprecifique depois.
 */
async function conferirOpcionais(produtoId: string, escolhas: EscolhaDeOpcional[]) {
  const grupos = (await gruposDosProdutos([produtoId])).get(produtoId) ?? [];

  const porOpcional = new Map<string, { grupo: GrupoDeOpcionais; opcional: OpcionalDoCardapio }>();
  for (const grupo of grupos) {
    for (const opcional of grupo.itens) porOpcional.set(opcional.opcionalId, { grupo, opcional });
  }

  const escolhidosPorGrupo = new Map<string, number>();
  const paraGravar: { opcionalId: string; titulo: string; preco: number; quantidade: number }[] = [];

  for (const escolha of escolhas) {
    const achado = porOpcional.get(escolha.opcionalId);
    if (!achado) throw new ErroDeOperacao("Opção que não pertence a este item.");

    const quantidade = escolha.quantidade ?? 1;
    if (!Number.isInteger(quantidade) || quantidade < 1) {
      throw new ErroDeOperacao("Quantidade inválida numa das opções.");
    }

    const jaNoGrupo = escolhidosPorGrupo.get(achado.grupo.id) ?? 0;
    escolhidosPorGrupo.set(achado.grupo.id, jaNoGrupo + quantidade);

    paraGravar.push({
      opcionalId: escolha.opcionalId,
      titulo: achado.opcional.titulo,
      preco: achado.opcional.precoEmCentavos / 100,
      quantidade,
    });
  }

  for (const grupo of grupos) {
    const escolhidos = escolhidosPorGrupo.get(grupo.id) ?? 0;
    // O obrigatório com `min` 0 ainda pede uma escolha: é o "escolha o ponto"
    // que a casa marcou como obrigatório sem pensar no mínimo.
    const minimo = grupo.obrigatorio ? Math.max(1, grupo.minEscolhas) : grupo.minEscolhas;
    if (escolhidos < minimo) {
      throw new ErroDeOperacao(
        minimo === 1
          ? `Escolha uma opção em "${grupo.titulo}".`
          : `Escolha ao menos ${minimo} opções em "${grupo.titulo}".`
      );
    }
    if (grupo.maxEscolhas > 0 && escolhidos > grupo.maxEscolhas) {
      throw new ErroDeOperacao(
        grupo.maxEscolhas === 1
          ? `"${grupo.titulo}" aceita uma opção só.`
          : `"${grupo.titulo}" aceita até ${grupo.maxEscolhas} opções.`
      );
    }
  }

  return paraGravar;
}

export async function adicionarItem(
  quem: QuemLanca,
  dados: {
    comandaId: string;
    cardapioItemId: string;
    quantidade?: number;
    observacao?: string | null;
    opcionais?: EscolhaDeOpcional[];
    /**
     * A linha do carrinho que originou este item, quando quem chama tem uma.
     *
     * É o que torna o lançamento idempotente: a maquininha manda a mesma
     * referência em toda tentativa, e a segunda não lança nada. O PDV não
     * passa referência — ali o "+" é um toque deliberado do garçom, e somar
     * de novo é o que ele quis.
     */
    referencia?: string | null;
  }
) {
  const quantidade = dados.quantidade ?? 1;
  if (!Number.isFinite(quantidade) || quantidade <= 0) {
    throw new ErroDeOperacao("Informe uma quantidade maior que zero.");
  }

  const comanda = await comandaAberta(dados.comandaId, quem.tenantId);
  const referencia = dados.referencia?.trim() || null;
  const item = await itemDoCardapio(dados.cardapioItemId, comanda.unidadeId);
  const opcionais = await conferirOpcionais(item.produtoId, dados.opcionais ?? []);

  /*
   * O adicional entra no preço do item, não numa linha à parte: na conta do
   * cliente, "Picanha 129,90 + bacon 8,00" é uma picanha de 137,90 — e é esse
   * número que a divisão por pessoa e a taxa de serviço usam.
   */
  const somaDosOpcionais = opcionais.reduce((soma, o) => soma + o.preco * o.quantidade, 0);
  const precoUnitario = Number(item.preco) + somaDosOpcionais;

  /*
   * Observação separa itens. Dois chopes, um "sem colarinho", não são a mesma
   * linha: agrupados, a cozinha receberia a observação valendo para os dois.
   * Item com ponto da carne também nunca agrupa — cada unidade pode ter o seu.
   *
   * Escolhas separam do mesmo jeito, e com mais razão: somar uma picanha com
   * bacon a uma sem bacon daria uma linha cujo preço não corresponde a nenhum
   * dos dois pratos.
   */
  const observacao = limparObservacao(dados.observacao);
  /*
   * Com referência, a linha nasce sozinha em vez de somar numa existente.
   *
   * Somar não deixaria rastro da referência, e o reenvio somaria de novo — a
   * idempotência e o agrupamento não cabem na mesma linha. Quem perde pouco é
   * o agrupamento: o carrinho da maquininha já junta as unidades na tela
   * antes de mandar, e o que deixa de acontecer é só a fusão com um pendente
   * que outro aparelho tenha deixado na mesma comanda.
   */
  /*
   * Da conferência à gravação, tudo sob a trava da comanda.
   *
   * É o mesmo cuidado do pagamento em `conta.ts`, e pelo mesmo motivo: sem a
   * trava, dois reenvios simultâneos da mesma rodada liam que a referência
   * ainda não existia e os dois gravavam. O segundo agora espera o primeiro e
   * encontra a linha pronta. Serve também ao agrupamento do PDV, onde dois
   * toques no "+" liam a mesma linha pendente e somavam por cima um do outro.
   */
  // Quem chama precisa saber se a linha entrou agora ou já estava lá: é a
  // diferença entre "lancei 3 itens" e "o reenvio não repetiu nada".
  let jaExistia = false;

  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM comandas WHERE id = ${dados.comandaId} FOR UPDATE`;

    /*
     * Já lançado é sucesso, não erro.
     *
     * Quem reenvia é a maquininha que não recebeu a resposta — a rodada pode
     * ter entrado inteira, ou pela metade se a rede caiu no meio. Conferindo
     * linha por linha, o reenvio completa o que falta em vez de duplicar o
     * que já está lá.
     */
    if (referencia) {
      const jaLancado = await tx.comandaItem.findFirst({
        where: { tenantId: quem.tenantId, referenciaExterna: referencia },
        select: { id: true },
      });
      if (jaLancado) {
        jaExistia = true;
        return;
      }
    }

    if (!referencia && !item.produto.exigePontoCarne && !observacao && opcionais.length === 0) {
      const existente = await tx.comandaItem.findFirst({
        where: {
          comandaId: dados.comandaId,
          produtoId: item.produtoId,
          status: "PENDENTE",
          pontoCarne: null,
          observacao: null,
          // E sem escolhas: senão a picanha sem bacon somaria na linha da
          // picanha com bacon, e a segunda sairia cobrada pelo preço da
          // primeira.
          opcionais: { none: {} },
        },
      });

      if (existente) {
        const somada = Number(existente.quantidade) + quantidade;
        await limitarQuantidade(comanda.unidadeId, somada);
        await tx.comandaItem.update({
          where: { id: existente.id },
          data: { quantidade: somada, precoTotal: somada * Number(existente.precoUnitario) },
        });
        return;
      }
    }

    await limitarQuantidade(comanda.unidadeId, quantidade);
    await tx.comandaItem.create({
      data: {
        tenantId: comanda.tenantId,
        comandaId: dados.comandaId,
        produtoId: item.produtoId,
        cardapioItemId: dados.cardapioItemId,
        quantidade,
        precoUnitario,
        precoTotal: precoUnitario * quantidade,
        observacao,
        referenciaExterna: referencia,
        status: "PENDENTE",
        lancadoPorId: quem.usuarioId,
        // Título e preço congelados: o histórico não muda quando a casa
        // renomeia "bacon" ou sobe o preço dele semana que vem.
        opcionais: {
          create: opcionais.map((o) => ({
            opcionalId: o.opcionalId,
            titulo: o.titulo,
            preco: o.preco,
            quantidade: o.quantidade,
          })),
        },
      },
    });
  });

  // Fora da transação: avisar o salão é efeito externo, e uma falha no aviso
  // não pode desfazer o item que já está no carrinho. No reenvio não há nada
  // de novo para avisar.
  if (!jaExistia) await publicar(comanda.unidadeId, "carrinho");
  return { jaExistia };
}

/**
 * A observação vai para o papel da cozinha, então passa pelo mesmo crivo do
 * nome do cliente: caractere de controle fora (o byte zero chega à térmica
 * como comando) e tamanho de observação, não de redação.
 *
 * Exportada porque o PDV anota a linha depois de ela existir, por uma action
 * própria, e o crivo tem de ser este mesmo: duas limpezas diferentes deixariam
 * o tablet gravar o que a maquininha recusa no lançamento.
 */
export function limparObservacao(texto: string | null | undefined) {
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
      select: {
        id: true,
        produtoId: true,
        quantidade: true,
        /*
         * O adicional que aponta para um produto também sai do estoque: duas
         * picanhas com bacon consomem dois bacons. Sem isto, o adicional era
         * cobrado do cliente e nunca dava baixa — e o inventário ia furando
         * um pouco por noite, sem ninguém achar a causa.
         */
        opcionais: {
          select: { quantidade: true, opcional: { select: { produtoId: true } } },
        },
      },
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
      itens: pendentes.flatMap((i) => [
        { produtoId: i.produtoId, quantidade: Number(i.quantidade), comandaItemId: i.id },
        // O opcional de texto solto ("sem cebola") não tem produto e não
        // consome nada; o que aponta para um produto consome por unidade do
        // item: 2 picanhas × 1 bacon = 2 bacons.
        ...i.opcionais
          .filter((o) => o.opcional?.produtoId)
          .map((o) => ({
            produtoId: o.opcional!.produtoId!,
            quantidade: Number(i.quantidade) * o.quantidade,
            comandaItemId: i.id,
          })),
      ]),
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
