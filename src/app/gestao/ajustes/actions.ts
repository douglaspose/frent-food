"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { exigirPermissao } from "@/lib/session";
import { POR_CHAVE, valorDoParametro } from "@/lib/parametros";
import { auditoria } from "@/lib/auditoria-servidor";
import { publicar } from "@/lib/eventos";
import { emResultado, ErroDeOperacao } from "@/lib/erro-de-operacao";

/**
 * Grava um parâmetro de comportamento da unidade.
 *
 * Um por vez, não o formulário inteiro: o gerente mexe num interruptor e vê o
 * efeito: salvar tudo junto obrigaria um botão "salvar" e a dúvida sobre o que
 * ficou pendente. O registro no diário é o que responde depois "quem desligou
 * a exigência de motivo no desconto?".
 */
export async function salvarAjuste(chave: string, valor: boolean | number) {
  return emResultado(async () => {
    const sessao = await exigirPermissao("unidade.configurar");

    const def = POR_CHAVE.get(chave);
    // Chave fora do catálogo não entra: sem isto, a tela viraria porta para
    // gravar qualquer coisa na tabela de parâmetros.
    if (!def) throw new ErroDeOperacao("Parâmetro desconhecido.");

    const limpo = valorDoParametro(chave, valor);

    const atual = await db.parametroUnidade.findUnique({
      where: { unidadeId_chave: { unidadeId: sessao.unidadeId, chave } },
      select: { valor: true },
    });
    const antes = atual ? valorDoParametro(chave, atual.valor) : def.padrao;

    if (antes === limpo) return { valor: limpo };

    await db.$transaction([
      db.parametroUnidade.upsert({
        where: { unidadeId_chave: { unidadeId: sessao.unidadeId, chave } },
        create: {
          tenantId: sessao.tenantId,
          unidadeId: sessao.unidadeId,
          grupo: def.grupo,
          chave,
          valor: limpo,
        },
        update: { valor: limpo },
      }),
      db.auditLog.create({
        data: await auditoria(sessao, {
          entidade: "ParametroUnidade",
          entidadeId: chave,
          acao: "AJUSTE_ALTERADO",
          antes: { ajuste: def.rotulo, valor: antes },
          depois: { ajuste: def.rotulo, valor: limpo },
        }),
      }),
    ]);

    // Os ajustes mudam o comportamento do salão e da cozinha: os tablets
    // precisam recarregar, senão continuam com a regra antiga até a próxima
    // sincronização.
    revalidatePath("/pdv");
    revalidatePath("/kds");
    revalidatePath("/gestao/ajustes");
    await publicar(sessao.unidadeId, "ajustes");

    return { valor: limpo };
  });
}
