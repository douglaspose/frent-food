"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { exigirPermissao } from "@/lib/session";
import { emResultado, ErroDeOperacao } from "@/lib/erro-de-operacao";

/**
 * Os grupos de opcionais: ponto da carne, adicionais, acompanhamento.
 *
 * Quem edita cardápio edita isto: é a mesma decisão comercial ("a picanha
 * pede ponto", "bacon custa oito reais"), e separar a permissão só criaria um
 * cargo que mexe no preço do prato mas não no do adicional.
 */
const PERMISSAO = "cardapio.editar";

/** O PDV, a maquininha e esta tela leem os mesmos grupos. */
function revalidar() {
  revalidatePath("/gestao/opcionais");
  revalidatePath("/gestao/cardapio");
  revalidatePath("/pdv");
}

/** Confere que o grupo é do restaurante da sessão antes de mexer. */
async function grupoDoTenant(grupoId: string, tenantId: string) {
  const grupo = await db.grupoOpcional.findUnique({ where: { id: grupoId } });
  if (!grupo || grupo.tenantId !== tenantId) throw new ErroDeOperacao("Grupo não encontrado.");
  return grupo;
}

/**
 * O título passa pelo mesmo crivo do nome do cliente: ele vai para o papel da
 * cozinha, e caractere de controle chega à térmica como comando.
 */
function limparTitulo(texto: string, o_que: string) {
  const limpo = texto.replace(/[\x00-\x1f\x7f]/g, "").trim();
  if (!limpo) throw new ErroDeOperacao(`Informe o ${o_que}.`);
  if (limpo.length > 60) throw new ErroDeOperacao(`O ${o_que} vai até 60 caracteres.`);
  return limpo;
}

export type DadosDoGrupo = {
  titulo: string;
  minEscolhas: number;
  maxEscolhas: number;
  obrigatorio: boolean;
};

/**
 * Confere a regra do grupo.
 *
 * Um mínimo acima do máximo é um grupo que nunca pode ser lançado: o garçom
 * fica preso na tela da maquininha sem conseguir atender a exigência, e o
 * prato some do cardápio na prática.
 */
function conferirRegra(dados: DadosDoGrupo) {
  const min = Math.trunc(dados.minEscolhas);
  const max = Math.trunc(dados.maxEscolhas);
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    throw new ErroDeOperacao("Mínimo e máximo precisam ser números.");
  }
  if (max < 1) throw new ErroDeOperacao("O máximo tem de ser pelo menos 1.");
  if (min < 0) throw new ErroDeOperacao("O mínimo não pode ser negativo.");
  if (min > max) throw new ErroDeOperacao("O mínimo não pode passar do máximo.");
  if (max > 20) throw new ErroDeOperacao("O máximo vai até 20 opções.");
  return { min, max };
}

export async function criarGrupo(dados: DadosDoGrupo) {
  return emResultado(async () => {
    const sessao = await exigirPermissao(PERMISSAO);
    const titulo = limparTitulo(dados.titulo, "título do grupo");
    const { min, max } = conferirRegra(dados);

    const ultimo = await db.grupoOpcional.findFirst({
      where: { tenantId: sessao.tenantId },
      orderBy: { ordem: "desc" },
      select: { ordem: true },
    });

    const grupo = await db.grupoOpcional.create({
      data: {
        tenantId: sessao.tenantId,
        titulo,
        minEscolhas: min,
        maxEscolhas: max,
        obrigatorio: dados.obrigatorio,
        ordem: (ultimo?.ordem ?? -1) + 1,
      },
    });

    revalidar();
    return { id: grupo.id };
  });
}

export async function atualizarGrupo(grupoId: string, dados: DadosDoGrupo) {
  return emResultado(async () => {
    const sessao = await exigirPermissao(PERMISSAO);
    await grupoDoTenant(grupoId, sessao.tenantId);
    const titulo = limparTitulo(dados.titulo, "título do grupo");
    const { min, max } = conferirRegra(dados);

    await db.grupoOpcional.update({
      where: { id: grupoId },
      data: { titulo, minEscolhas: min, maxEscolhas: max, obrigatorio: dados.obrigatorio },
    });

    revalidar();
  });
}

/**
 * Apaga o grupo, com as opções e os vínculos.
 *
 * O histórico sobrevive: cada escolha já lançada guarda título e preço
 * próprios na comanda, então a conta de ontem continua dizendo "bacon 8,00"
 * mesmo depois de o adicional deixar de existir. É para isso que eles são
 * congelados no lançamento.
 */
export async function excluirGrupo(grupoId: string) {
  return emResultado(async () => {
    const sessao = await exigirPermissao(PERMISSAO);
    await grupoDoTenant(grupoId, sessao.tenantId);

    await db.grupoOpcional.delete({ where: { id: grupoId } });
    revalidar();
  });
}

export type DadosDaOpcao = {
  titulo: string;
  preco: number;
  /** Quando a opção é algo que sai do estoque, aponta para o produto. */
  produtoId: string | null;
};

export async function criarOpcao(grupoId: string, dados: DadosDaOpcao) {
  return emResultado(async () => {
    const sessao = await exigirPermissao(PERMISSAO);
    await grupoDoTenant(grupoId, sessao.tenantId);
    const titulo = limparTitulo(dados.titulo, "título da opção");

    if (!Number.isFinite(dados.preco) || dados.preco < 0) {
      throw new ErroDeOperacao("Preço inválido.");
    }
    await conferirProduto(dados.produtoId, sessao.tenantId);

    const ultima = await db.opcionalItem.findFirst({
      where: { grupoId },
      orderBy: { ordem: "desc" },
      select: { ordem: true },
    });

    await db.opcionalItem.create({
      data: {
        grupoId,
        titulo,
        preco: dados.preco,
        produtoId: dados.produtoId,
        ordem: (ultima?.ordem ?? -1) + 1,
      },
    });

    revalidar();
  });
}

export async function atualizarOpcao(opcionalId: string, dados: DadosDaOpcao) {
  return emResultado(async () => {
    const sessao = await exigirPermissao(PERMISSAO);
    await opcaoDoTenant(opcionalId, sessao.tenantId);
    const titulo = limparTitulo(dados.titulo, "título da opção");

    if (!Number.isFinite(dados.preco) || dados.preco < 0) {
      throw new ErroDeOperacao("Preço inválido.");
    }
    await conferirProduto(dados.produtoId, sessao.tenantId);

    await db.opcionalItem.update({
      where: { id: opcionalId },
      data: { titulo, preco: dados.preco, produtoId: dados.produtoId },
    });

    revalidar();
  });
}

/**
 * Tira a opção da tela sem apagá-la.
 *
 * É o caminho normal para "acabou a cebola empanada": desativada, ela sai da
 * maquininha na hora e volta quando a casa quiser, sem mexer no que já foi
 * lançado.
 */
export async function alternarOpcaoAtiva(opcionalId: string, ativo: boolean) {
  return emResultado(async () => {
    const sessao = await exigirPermissao(PERMISSAO);
    await opcaoDoTenant(opcionalId, sessao.tenantId);

    await db.opcionalItem.update({ where: { id: opcionalId }, data: { ativo } });
    revalidar();
  });
}

export async function excluirOpcao(opcionalId: string) {
  return emResultado(async () => {
    const sessao = await exigirPermissao(PERMISSAO);
    await opcaoDoTenant(opcionalId, sessao.tenantId);

    await db.opcionalItem.delete({ where: { id: opcionalId } });
    revalidar();
  });
}

/** Liga o grupo a um produto: é isto que faz a picanha pedir o ponto. */
export async function vincularProduto(grupoId: string, produtoId: string) {
  return emResultado(async () => {
    const sessao = await exigirPermissao(PERMISSAO);
    await grupoDoTenant(grupoId, sessao.tenantId);
    await conferirProduto(produtoId, sessao.tenantId);

    const ultimo = await db.produtoGrupoOpcional.findFirst({
      where: { grupoId },
      orderBy: { ordem: "desc" },
      select: { ordem: true },
    });

    /*
     * Já vinculado não é erro: dois cliques no mesmo produto, ou duas abas
     * abertas, não deveriam dar susto no gerente. A chave composta recusaria
     * o insert, então o caminho é sair calado.
     */
    const jaTem = await db.produtoGrupoOpcional.findUnique({
      where: { produtoId_grupoId: { produtoId, grupoId } },
      select: { grupoId: true },
    });
    if (jaTem) return;

    await db.produtoGrupoOpcional.create({
      data: { grupoId, produtoId, ordem: (ultimo?.ordem ?? -1) + 1 },
    });

    revalidar();
  });
}

export async function desvincularProduto(grupoId: string, produtoId: string) {
  return emResultado(async () => {
    const sessao = await exigirPermissao(PERMISSAO);
    await grupoDoTenant(grupoId, sessao.tenantId);

    await db.produtoGrupoOpcional.deleteMany({ where: { grupoId, produtoId } });
    revalidar();
  });
}

/** Chave estrangeira ignora o RLS: a conferência do dono é aqui, no código. */
async function conferirProduto(produtoId: string | null, tenantId: string) {
  if (!produtoId) return;
  const produto = await db.produto.findUnique({
    where: { id: produtoId },
    select: { tenantId: true },
  });
  if (!produto || produto.tenantId !== tenantId) {
    throw new ErroDeOperacao("Produto não encontrado.");
  }
}

async function opcaoDoTenant(opcionalId: string, tenantId: string) {
  const opcao = await db.opcionalItem.findUnique({
    where: { id: opcionalId },
    include: { grupo: { select: { tenantId: true } } },
  });
  if (!opcao || opcao.grupo.tenantId !== tenantId) {
    throw new ErroDeOperacao("Opção não encontrada.");
  }
  return opcao;
}
