"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { exigirPermissao } from "@/lib/session";
import { movimentar } from "@/lib/estoque";
import { emResultado, ErroDeOperacao } from "@/lib/erro-de-operacao";

const PERMISSAO = "produto.editar";

async function produtoDoTenant(produtoId: string, tenantId: string) {
  const produto = await db.produto.findUnique({ where: { id: produtoId } });
  if (!produto || produto.tenantId !== tenantId) throw new ErroDeOperacao("Produto não encontrado.");
  return produto;
}

/**
 * Quantidade vinda da tela, conferida antes de chegar ao banco.
 *
 * NaN e Infinity passavam pelas comparações (`NaN <= 0` é falso) e morriam no
 * Prisma como erro de sistema. O teto fica bem abaixo do que a coluna guarda
 * (14 dígitos, 4 decimais): um milhão de unidades num lançamento só já é erro
 * de digitação.
 */
const MAXIMO = 1_000_000;

function quantidadeValida(valor: number, rotulo = "Quantidade", { zero = false } = {}) {
  if (typeof valor !== "number" || !Number.isFinite(valor)) {
    throw new ErroDeOperacao(`${rotulo} inválida.`);
  }
  if (zero ? valor < 0 : valor <= 0) {
    throw new ErroDeOperacao(
      zero ? `${rotulo} não pode ser negativa.` : `${rotulo} deve ser maior que zero.`
    );
  }
  if (valor > MAXIMO) throw new ErroDeOperacao(`${rotulo} acima do permitido.`);
}

/** Compra recebida: soma ao saldo e recalcula o custo médio. */
export async function registrarEntrada(dados: {
  produtoId: string;
  quantidade: number;
  custoTotal: number;
  motivo: string;
}) {
  return emResultado(async () => {
    const sessao = await exigirPermissao(PERMISSAO);
    quantidadeValida(dados.quantidade);
    if (typeof dados.custoTotal !== "number" || !Number.isFinite(dados.custoTotal)) {
      throw new ErroDeOperacao("Custo inválido.");
    }
    if (dados.custoTotal < 0) throw new ErroDeOperacao("Custo não pode ser negativo.");
    // O custo unitário mora numa coluna menor (12 dígitos, 4 decimais).
    if (dados.custoTotal / dados.quantidade > MAXIMO) {
      throw new ErroDeOperacao("Custo por unidade acima do permitido.");
    }

    await produtoDoTenant(dados.produtoId, sessao.tenantId);

    await db.$transaction(async (tx) => {
      await movimentar(tx, {
        tenantId: sessao.tenantId,
        unidadeId: sessao.unidadeId,
        produtoId: dados.produtoId,
        tipo: "ENTRADA",
        quantidade: dados.quantidade,
        // O usuário informa o valor da nota; o unitário é o que interessa ao custo.
        custoUnitario: dados.custoTotal / dados.quantidade,
        motivo: dados.motivo.trim() || "Entrada de compra",
        usuarioId: sessao.usuarioId,
      });
    });

    revalidatePath("/gestao/estoque");
  });
}

/** Perda, quebra, vencimento. Sai do saldo e fica registrado com o motivo. */
export async function registrarPerda(dados: {
  produtoId: string;
  quantidade: number;
  motivo: string;
}) {
  return emResultado(async () => {
    const sessao = await exigirPermissao(PERMISSAO);
    quantidadeValida(dados.quantidade);
    if (!dados.motivo.trim()) throw new ErroDeOperacao("Informe o motivo da perda.");

    await produtoDoTenant(dados.produtoId, sessao.tenantId);

    await db.$transaction(async (tx) => {
      await movimentar(tx, {
        tenantId: sessao.tenantId,
        unidadeId: sessao.unidadeId,
        produtoId: dados.produtoId,
        tipo: "PERDA",
        quantidade: -dados.quantidade,
        motivo: dados.motivo.trim(),
        usuarioId: sessao.usuarioId,
      });
    });

    revalidatePath("/gestao/estoque");
  });
}

/**
 * Contagem de inventário: o operador informa o que contou, e o sistema lança a
 * diferença. Registrar o ajuste em vez de sobrescrever o saldo é o que deixa a
 * divergência visível — é ali que aparece desvio e erro de ficha.
 */
export async function registrarContagem(dados: {
  produtoId: string;
  quantidadeContada: number;
  motivo: string;
}) {
  return emResultado(async () => {
    const sessao = await exigirPermissao(PERMISSAO);
    quantidadeValida(dados.quantidadeContada, "Quantidade contada", { zero: true });
    await produtoDoTenant(dados.produtoId, sessao.tenantId);

    const saldo = await db.estoqueSaldo.findUnique({
      where: { unidadeId_produtoId: { unidadeId: sessao.unidadeId, produtoId: dados.produtoId } },
    });

    const diferenca = dados.quantidadeContada - Number(saldo?.quantidade ?? 0);
    if (Math.abs(diferenca) < 0.0001) return { diferenca: 0 };

    await db.$transaction(async (tx) => {
      await movimentar(tx, {
        tenantId: sessao.tenantId,
        unidadeId: sessao.unidadeId,
        produtoId: dados.produtoId,
        tipo: "AJUSTE",
        quantidade: diferenca,
        motivo: dados.motivo.trim() || "Contagem de inventário",
        usuarioId: sessao.usuarioId,
      });
    });

    revalidatePath("/gestao/estoque");
    return { diferenca };
  });
}

/** Marca o produto como item de estoque e define o mínimo para alerta. */
export async function configurarProdutoEstoque(dados: {
  produtoId: string;
  controlaEstoque: boolean;
  estoqueMinimo: number | null;
}) {
  return emResultado(async () => {
    const sessao = await exigirPermissao(PERMISSAO);
    if (dados.estoqueMinimo !== null) {
      quantidadeValida(dados.estoqueMinimo, "Estoque mínimo", { zero: true });
    }
    await produtoDoTenant(dados.produtoId, sessao.tenantId);

    await db.produto.update({
      where: { id: dados.produtoId },
      data: {
        controlaEstoque: dados.controlaEstoque,
        estoqueMinimo: dados.estoqueMinimo,
      },
    });

    revalidatePath("/gestao/estoque");
  });
}

export async function salvarComposicao(
  produtoId: string,
  partes: { insumoId: string; quantidade: number }[]
) {
  return emResultado(async () => {
    const sessao = await exigirPermissao(PERMISSAO);
    await produtoDoTenant(produtoId, sessao.tenantId);

    if (partes.some((p) => p.insumoId === produtoId)) {
      throw new ErroDeOperacao("Um produto não pode ser insumo de si mesmo.");
    }

    const validas = partes.filter((p) => p.insumoId && p.quantidade > 0);
    for (const parte of validas) quantidadeValida(parte.quantidade, "Quantidade do insumo");

    await db.$transaction(async (tx) => {
      // Substitui a ficha inteira: é mais previsível que calcular a diferença,
      // e a ficha é editada por completo na tela.
      await tx.composicao.deleteMany({ where: { produtoId } });
      for (const parte of validas) {
        await tx.composicao.create({
          data: { produtoId, insumoId: parte.insumoId, quantidade: parte.quantidade },
        });
      }
    });

    revalidatePath("/gestao/estoque");
    revalidatePath(`/gestao/estoque/ficha/${produtoId}`);
  });
}
