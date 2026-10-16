"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { exigirPermissao } from "@/lib/session";
import { auditoria } from "@/lib/auditoria-servidor";
import { aparelhoDaUnidade, sortearToken } from "@/lib/aparelhos";
import { emResultado, ErroDeOperacao } from "@/lib/erro-de-operacao";

/**
 * O cadastro dos aparelhos da casa.
 *
 * Cadastrar não é só organização: é o que permite cortar um aparelho sozinho.
 * Enquanto a credencial era a da unidade, a maquininha esquecida no táxi só
 * saía do ar junto com o agente de impressão do balcão.
 */

const NOME_MAXIMO = 60;

function limparNome(nome: string) {
  const limpo = nome.replace(/[\x00-\x1f\x7f]/g, "").trim();
  if (!limpo) throw new ErroDeOperacao("Dê um nome ao aparelho.");
  if (limpo.length > NOME_MAXIMO) {
    throw new ErroDeOperacao(`O nome vai até ${NOME_MAXIMO} caracteres.`);
  }
  return limpo;
}

export async function cadastrarAparelho(nome: string, tipo: "MAQUININHA" | "AGENTE_IMPRESSAO") {
  return emResultado(async () => {
    const sessao = await exigirPermissao("unidade.configurar");
    const limpo = limparNome(nome);

    const aparelho = await db.aparelho.create({
      data: {
        tenantId: sessao.tenantId,
        unidadeId: sessao.unidadeId,
        nome: limpo,
        tipo,
        token: sortearToken(),
      },
      select: { id: true, token: true },
    });

    await db.auditLog.create({
      data: await auditoria(sessao, {
        entidade: "Aparelho",
        entidadeId: aparelho.id,
        acao: "APARELHO_CADASTRADO",
        // O token não entra no diário: ele é credencial, e o diário é lido por
        // quem audita, não por quem opera.
        depois: { nome: limpo, tipo },
      }),
    });

    revalidatePath("/gestao/aparelhos");
    return { id: aparelho.id };
  });
}

/**
 * Corta o aparelho.
 *
 * Não apaga: o que ele fez continua no diário e na fila, e um cadastro apagado
 * deixaria o histórico apontando para o nada. O token revogado passa a
 * responder como token inventado.
 */
export async function revogarAparelho(id: string) {
  return emResultado(async () => {
    const sessao = await exigirPermissao("unidade.configurar");

    const aparelho = await aparelhoDaUnidade(id, sessao);
    if (!aparelho.ativo) return;

    await db.$transaction(async (tx) => {
      await tx.aparelho.update({
        where: { id },
        data: { ativo: false, revogadoEm: new Date() },
      });
      await tx.auditLog.create({
        data: await auditoria(sessao, {
          entidade: "Aparelho",
          entidadeId: id,
          acao: "APARELHO_REVOGADO",
          antes: { nome: aparelho.nome, ativo: true },
          depois: { ativo: false },
        }),
      });
    });

    revalidatePath("/gestao/aparelhos");
  });
}

/**
 * Troca a credencial sem trocar o cadastro.
 *
 * É o que se faz quando o aparelho continua na casa mas o token vazou — num
 * print mandado no grupo do WhatsApp, por exemplo. O aparelho para até alguém
 * digitar o novo, e é por isso que o botão avisa.
 */
export async function trocarToken(id: string) {
  return emResultado(async () => {
    const sessao = await exigirPermissao("unidade.configurar");

    const aparelho = await aparelhoDaUnidade(id, sessao);

    await db.$transaction(async (tx) => {
      await tx.aparelho.update({
        where: { id },
        data: { token: sortearToken(), ativo: true, revogadoEm: null },
      });
      await tx.auditLog.create({
        data: await auditoria(sessao, {
          entidade: "Aparelho",
          entidadeId: id,
          acao: "APARELHO_TOKEN_TROCADO",
          depois: { nome: aparelho.nome },
        }),
      });
    });

    revalidatePath("/gestao/aparelhos");
  });
}
