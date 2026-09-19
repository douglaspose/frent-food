"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { exigirPermissao } from "@/lib/session";
import { enfileirar } from "@/lib/fila-impressao";
import { centro, linha } from "@/lib/impressao";
import { emResultado, ErroDeOperacao } from "@/lib/erro-de-operacao";

export async function gerarTokenImpressao() {
  return emResultado(async () => {
    const sessao = await exigirPermissao("produto.editar");

    const token = randomBytes(24).toString("base64url");
    await db.unidade.update({ where: { id: sessao.unidadeId }, data: { tokenImpressao: token } });

    revalidatePath("/gestao/impressao");
    return token;
  });
}

/** Reimprime enfileirando de novo, sem mexer no registro original. */
export async function reimprimir(filaId: string) {
  return emResultado(async () => {
    const sessao = await exigirPermissao("produto.editar");

    const original = await db.filaImpressao.findUnique({ where: { id: filaId } });
    if (!original || original.tenantId !== sessao.tenantId) throw new ErroDeOperacao("Não encontrado.");

    await enfileirar({
      tenantId: original.tenantId,
      unidadeId: original.unidadeId,
      impressoraId: original.impressoraId,
      tipo: original.tipo,
      titulo: `${original.titulo} (2ª via)`,
      conteudo: original.conteudo,
      referenciaId: original.referenciaId ?? undefined,
    });

    revalidatePath("/gestao/impressao");
  });
}

/** Marca como resolvido sem imprimir — para limpar fila de impressora removida. */
export async function descartar(filaId: string) {
  return emResultado(async () => {
    const sessao = await exigirPermissao("produto.editar");

    const trabalho = await db.filaImpressao.findUnique({ where: { id: filaId } });
    if (!trabalho || trabalho.tenantId !== sessao.tenantId) throw new ErroDeOperacao("Não encontrado.");

    await db.filaImpressao.update({
      where: { id: filaId },
      data: { status: "ERRO", erro: "descartado manualmente" },
    });

    revalidatePath("/gestao/impressao");
  });
}

export async function imprimirTeste() {
  return emResultado(async () => {
    const sessao = await exigirPermissao("produto.editar");

    const conteudo = [
      linha("="),
      centro("TESTE DE IMPRESSAO"),
      linha("="),
      `Unidade: ${sessao.unidadeId}`,
      `Emitido por: ${sessao.nome}`,
      `Em: ${new Date().toLocaleString("pt-BR")}`,
      linha(),
      "Acentuacao: aeiou ACENTO ção não",
      "0123456789 ABCDEFGHIJ abcdefghij",
      // 48 colunas cheias: se a régua sair quebrada, a impressora não está em 80mm.
      linha("."),
      "",
      centro("Se voce esta lendo isto, funcionou."),
      linha("="),
    ].join("\n");

    await enfileirar({
      tenantId: sessao.tenantId,
      unidadeId: sessao.unidadeId,
      tipo: "CONFERENCIA",
      titulo: "Teste de impressão",
      conteudo,
    });

    revalidatePath("/gestao/impressao");
  });
}
