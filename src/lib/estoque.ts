import "server-only";
import { db, type Tx } from "./db";

export type TipoMovimento = "ENTRADA" | "SAIDA_VENDA" | "PERDA" | "AJUSTE" | "DEVOLUCAO";

type Movimento = {
  tenantId: string;
  unidadeId: string;
  produtoId: string;
  tipo: TipoMovimento;
  /// Positiva em entrada, negativa em saída.
  quantidade: number;
  custoUnitario?: number;
  motivo?: string;
  referenciaId?: string;
  usuarioId?: string;
};

function arredondar(valor: number, casas = 4) {
  const fator = 10 ** casas;
  return Math.round(valor * fator) / fator;
}

/**
 * Aplica um movimento e recalcula o saldo.
 *
 * O custo é **médio ponderado**: uma entrada mistura o preço novo com o que já
 * estava em casa. É assim que o custo real se comporta — se você tinha 10 kg a
 * R$ 40 e comprou 10 kg a R$ 50, sua picanha passou a custar R$ 45, não R$ 50.
 *
 * Saída não mexe no custo médio, só no saldo.
 */
export async function movimentar(tx: Tx, mov: Movimento) {
  /**
   * Trava a linha do saldo antes de ler.
   *
   * O saldo era lido e regravado sem trava: dois garçons mandando a mesma
   * cerveja no mesmo instante liam 1982, os dois gravavam 1981, e uma baixa
   * sumia — o saldo deixava de bater com a soma dos movimentos. Travado, o
   * segundo espera o primeiro e lê o saldo já baixado. (Saldo que ainda não
   * existe não tem o que travar; o upsert abaixo o cria.)
   */
  await tx.$queryRaw`SELECT 1 FROM estoque_saldos WHERE "unidadeId" = ${mov.unidadeId} AND "produtoId" = ${mov.produtoId} FOR UPDATE`;

  const atual = await tx.estoqueSaldo.findUnique({
    where: { unidadeId_produtoId: { unidadeId: mov.unidadeId, produtoId: mov.produtoId } },
  });

  const quantidadeAtual = Number(atual?.quantidade ?? 0);
  const custoAtual = Number(atual?.custoMedio ?? 0);
  const novaQuantidade = arredondar(quantidadeAtual + mov.quantidade);

  let novoCusto = custoAtual;
  if (mov.quantidade > 0 && mov.custoUnitario !== undefined) {
    const valorEmCasa = quantidadeAtual * custoAtual;
    const valorEntrando = mov.quantidade * mov.custoUnitario;
    // Com saldo negativo o médio ponderado não faz sentido: adota o preço novo.
    novoCusto =
      novaQuantidade > 0 && quantidadeAtual > 0
        ? arredondar((valorEmCasa + valorEntrando) / novaQuantidade)
        : mov.custoUnitario;
  }

  await tx.estoqueSaldo.upsert({
    where: { unidadeId_produtoId: { unidadeId: mov.unidadeId, produtoId: mov.produtoId } },
    create: {
      tenantId: mov.tenantId,
      unidadeId: mov.unidadeId,
      produtoId: mov.produtoId,
      quantidade: novaQuantidade,
      custoMedio: novoCusto,
    },
    update: { quantidade: novaQuantidade, custoMedio: novoCusto },
  });

  await tx.movimentoEstoque.create({
    data: {
      tenantId: mov.tenantId,
      unidadeId: mov.unidadeId,
      produtoId: mov.produtoId,
      tipo: mov.tipo,
      quantidade: mov.quantidade,
      custoUnitario: mov.custoUnitario ?? custoAtual,
      saldoDepois: novaQuantidade,
      motivo: mov.motivo,
      referenciaId: mov.referenciaId,
      usuarioId: mov.usuarioId,
    },
  });

  return { quantidade: novaQuantidade, custoMedio: novoCusto };
}

export type ItemVendido = { produtoId: string; quantidade: number; comandaItemId: string };

/**
 * Traduz itens de venda em consumo de estoque.
 *
 * Um prato consome os insumos da ficha técnica; uma bebida consome ela mesma.
 * Produto sem ficha e sem controle de estoque não move nada — é o caso de quem
 * ainda não cadastrou a ficha, e não pode travar a venda por isso.
 *
 * Junta antes de gravar: dois espetos na mesma rodada viram um único movimento
 * de carne, em vez de dois lançamentos quase idênticos.
 */
async function consumoDosItens(tx: Tx, itens: ItemVendido[]) {
  const produtos = await tx.produto.findMany({
    where: { id: { in: itens.map((i) => i.produtoId) } },
    select: {
      id: true,
      controlaEstoque: true,
      composicao: { select: { insumoId: true, quantidade: true } },
    },
  });
  const porId = new Map(produtos.map((p) => [p.id, p]));

  const consumo = new Map<string, number>();
  for (const item of itens) {
    const produto = porId.get(item.produtoId);
    if (!produto) continue;

    if (produto.composicao.length > 0) {
      for (const parte of produto.composicao) {
        const total = Number(parte.quantidade) * item.quantidade;
        consumo.set(parte.insumoId, (consumo.get(parte.insumoId) ?? 0) + total);
      }
    } else if (produto.controlaEstoque) {
      consumo.set(item.produtoId, (consumo.get(item.produtoId) ?? 0) + item.quantidade);
    }
  }

  // Sempre na mesma ordem: duas rodadas com chopp e refrigerante travando os
  // saldos em ordens opostas se esperariam para sempre (deadlock).
  return new Map([...consumo].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** Dá baixa do que foi vendido. */
export async function baixarVenda(
  tx: Tx,
  dados: {
    tenantId: string;
    unidadeId: string;
    usuarioId: string;
    itens: ItemVendido[];
  }
) {
  if (dados.itens.length === 0) return;

  for (const [produtoId, quantidade] of await consumoDosItens(tx, dados.itens)) {
    await movimentar(tx, {
      tenantId: dados.tenantId,
      unidadeId: dados.unidadeId,
      produtoId,
      tipo: "SAIDA_VENDA",
      quantidade: -arredondar(quantidade),
      usuarioId: dados.usuarioId,
      referenciaId: dados.itens[0]?.comandaItemId,
    });
  }
}

/**
 * Devolve ao estoque o que foi cancelado.
 *
 * Sem isto, cancelar um item deixaria a carne baixada para sempre: o saldo
 * mandaria comprar o que ainda está na câmara, e o CMV contaria o custo de um
 * prato que ninguém vendeu.
 *
 * Não informa custo unitário de propósito — devolução não é compra e não pode
 * mexer no custo médio. O insumo volta valendo o que já valia.
 */
export async function estornarVenda(
  tx: Tx,
  dados: {
    tenantId: string;
    unidadeId: string;
    usuarioId: string;
    motivo?: string;
    itens: ItemVendido[];
  }
) {
  if (dados.itens.length === 0) return;

  for (const [produtoId, quantidade] of await consumoDosItens(tx, dados.itens)) {
    await movimentar(tx, {
      tenantId: dados.tenantId,
      unidadeId: dados.unidadeId,
      produtoId,
      tipo: "DEVOLUCAO",
      quantidade: arredondar(quantidade),
      usuarioId: dados.usuarioId,
      motivo: dados.motivo,
      referenciaId: dados.itens[0]?.comandaItemId,
    });
  }
}

/**
 * Custo de um produto de venda pela ficha técnica, usando o custo médio atual
 * de cada insumo. É o número que diz se o prato dá lucro.
 */
export async function custoDaFicha(produtoId: string, unidadeId: string) {
  const composicao = await db.composicao.findMany({
    where: { produtoId },
    include: { insumo: { select: { id: true, titulo: true, unidadeMedida: true } } },
  });

  if (composicao.length === 0) return { custo: 0, partes: [] };

  const saldos = await db.estoqueSaldo.findMany({
    where: { unidadeId, produtoId: { in: composicao.map((c) => c.insumoId) } },
    select: { produtoId: true, custoMedio: true },
  });
  const custoPorInsumo = new Map(saldos.map((s) => [s.produtoId, Number(s.custoMedio)]));

  const partes = composicao.map((c) => {
    const custoUnitario = custoPorInsumo.get(c.insumoId) ?? 0;
    const quantidade = Number(c.quantidade);
    return {
      insumoId: c.insumoId,
      titulo: c.insumo.titulo,
      unidadeMedida: c.insumo.unidadeMedida,
      quantidade,
      custoUnitario,
      custo: arredondar(quantidade * custoUnitario, 2),
    };
  });

  return { custo: arredondar(partes.reduce((s, p) => s + p.custo, 0), 2), partes };
}
