"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { exigirPermissao } from "@/lib/session";
import { auditoria } from "@/lib/auditoria-servidor";
import { emResultado, ErroDeOperacao } from "@/lib/erro-de-operacao";
import { CODIGO_FISCAL, TIPOS, type DadosDaForma } from "./tipos";

/**
 * Quem mexe aqui mexe em contrato, não em operação.
 *
 * A taxa da maquininha é o que o dono negociou com a adquirente, e o prazo é
 * quando o dinheiro cai. Gerente fecha caixa e dá desconto; renegociar
 * adquirente é do dono — a mesma permissão dos Ajustes.
 */
const PERMISSAO = "unidade.configurar";

function revalidar() {
  revalidatePath("/gestao/formas-pagamento");
  // O PDV monta a lista de escolha a partir daqui, e a tela de fechar conta
  // fica em cache: sem isto, a forma nova só apareceria no próximo deploy.
  revalidatePath("/pdv");
}

/**
 * Valida o que a tela mandou.
 *
 * A taxa é `Decimal(5,2)`: acima de 999,99 o banco recusa com uma mensagem que
 * não serve para ninguém. E taxa acima de 100% não existe — quem digitar 320
 * em vez de 3,20 merece ser avisado, não ter o número gravado.
 */
function limpar(dados: DadosDaForma) {
  const nome = dados.nome.trim();
  if (!nome) throw new ErroDeOperacao("Informe o nome da forma de pagamento.");
  if (nome.length > 40) throw new ErroDeOperacao("O nome precisa ter até 40 caracteres.");

  if (!TIPOS.includes(dados.tipo)) throw new ErroDeOperacao("Tipo de pagamento inválido.");

  const taxaPct = Number(dados.taxaPct);
  if (!Number.isFinite(taxaPct) || taxaPct < 0 || taxaPct > 100) {
    throw new ErroDeOperacao("A taxa precisa estar entre 0% e 100%.");
  }

  const prazoDias = Math.trunc(Number(dados.prazoDias));
  if (!Number.isFinite(prazoDias) || prazoDias < 0 || prazoDias > 365) {
    throw new ErroDeOperacao("O prazo precisa estar entre 0 e 365 dias.");
  }

  return {
    nome,
    tipo: dados.tipo,
    taxaPct: Math.round(taxaPct * 100) / 100,
    prazoDias,
    codigoFiscal: CODIGO_FISCAL[dados.tipo],
  };
}

async function nomeLivre(tenantId: string, nome: string, exceto?: string) {
  const igual = await db.formaPagamento.findFirst({
    where: { tenantId, nome: { equals: nome, mode: "insensitive" }, id: { not: exceto } },
    select: { id: true },
  });
  if (igual) throw new ErroDeOperacao(`Já existe uma forma chamada "${nome}".`);
}

export async function criarForma(dados: DadosDaForma) {
  return emResultado(async () => {
    const sessao = await exigirPermissao(PERMISSAO);
    const limpo = limpar(dados);
    await nomeLivre(sessao.tenantId, limpo.nome);

    const criada = await db.formaPagamento.create({
      data: { tenantId: sessao.tenantId, ...limpo },
    });

    await db.auditLog.create({
      data: await auditoria(sessao, {
        entidade: "FormaPagamento",
        entidadeId: criada.id,
        acao: "FORMA_PAGAMENTO_CRIADA",
        depois: { nome: limpo.nome, tipo: limpo.tipo, taxaPct: limpo.taxaPct, prazoDias: limpo.prazoDias },
      }),
    });

    revalidar();
  });
}

async function daCasa(id: string, tenantId: string) {
  const forma = await db.formaPagamento.findUnique({ where: { id } });
  if (!forma || forma.tenantId !== tenantId) {
    throw new ErroDeOperacao("Forma de pagamento não encontrada.");
  }
  return forma;
}

export async function editarForma(id: string, dados: DadosDaForma) {
  return emResultado(async () => {
    const sessao = await exigirPermissao(PERMISSAO);
    const antes = await daCasa(id, sessao.tenantId);
    const limpo = limpar(dados);
    await nomeLivre(sessao.tenantId, limpo.nome, id);

    await db.formaPagamento.update({ where: { id }, data: limpo });

    /**
     * O diário guarda o antes e o depois.
     *
     * Mudar a taxa muda o custo estimado de todo o histórico no painel — é
     * exatamente o tipo de alteração que, sem registro, faz o número de ontem
     * parecer outro hoje sem explicação.
     */
    await db.auditLog.create({
      data: await auditoria(sessao, {
        entidade: "FormaPagamento",
        entidadeId: id,
        acao: "FORMA_PAGAMENTO_EDITADA",
        antes: {
          nome: antes.nome,
          tipo: antes.tipo,
          taxaPct: Number(antes.taxaPct),
          prazoDias: antes.prazoDias,
        },
        depois: {
          nome: limpo.nome,
          tipo: limpo.tipo,
          taxaPct: limpo.taxaPct,
          prazoDias: limpo.prazoDias,
        },
      }),
    });

    revalidar();
  });
}

export async function alternarAtiva(id: string) {
  return emResultado(async () => {
    const sessao = await exigirPermissao(PERMISSAO);
    const forma = await daCasa(id, sessao.tenantId);

    /**
     * Não dá para desligar a última.
     *
     * O PDV monta a lista de escolha só com as ativas — verificado em
     * `pdv/mesa/[id]/fechar`. Sem nenhuma, o caixa abre a tela de fechar conta
     * e não tem em que clicar, no meio do movimento.
     */
    if (forma.ativo) {
      const outrasAtivas = await db.formaPagamento.count({
        where: { tenantId: sessao.tenantId, ativo: true, id: { not: id } },
      });
      if (outrasAtivas === 0) {
        throw new ErroDeOperacao(
          "Esta é a única forma ativa. Ative outra antes, senão o caixa fica sem como receber."
        );
      }
    }

    await db.formaPagamento.update({ where: { id }, data: { ativo: !forma.ativo } });

    await db.auditLog.create({
      data: await auditoria(sessao, {
        entidade: "FormaPagamento",
        entidadeId: id,
        acao: forma.ativo ? "FORMA_PAGAMENTO_DESATIVADA" : "FORMA_PAGAMENTO_REATIVADA",
        antes: { nome: forma.nome, ativo: forma.ativo },
        depois: { nome: forma.nome, ativo: !forma.ativo },
      }),
    });

    revalidar();
  });
}

export async function excluirForma(id: string) {
  return emResultado(async () => {
    const sessao = await exigirPermissao(PERMISSAO);
    const forma = await daCasa(id, sessao.tenantId);

    /**
     * Excluir só serve para desfazer um cadastro errado.
     *
     * Forma já usada não sai: os pagamentos apontam para ela, e apagá-la
     * levaria junto o registro de como o dinheiro entrou. Para tirar do uso
     * existe o desativar, que some do PDV e mantém o histórico de pé.
     */
    const usos = await db.pagamento.count({ where: { formaPagamentoId: id } });
    if (usos > 0) {
      throw new ErroDeOperacao(
        `"${forma.nome}" já recebeu ${usos} pagamento(s) e não pode ser excluída. Desative-a.`
      );
    }

    await db.formaPagamento.delete({ where: { id } });

    await db.auditLog.create({
      data: await auditoria(sessao, {
        entidade: "FormaPagamento",
        entidadeId: id,
        acao: "FORMA_PAGAMENTO_DESATIVADA",
        antes: { nome: forma.nome, tipo: forma.tipo, excluida: false },
        depois: { nome: forma.nome, excluida: true },
      }),
    });

    revalidar();
  });
}
