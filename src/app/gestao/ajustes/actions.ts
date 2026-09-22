"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { exigirPermissao } from "@/lib/session";
import { POR_CHAVE, valorDoParametro } from "@/lib/parametros";
import { auditoria } from "@/lib/auditoria-servidor";
import { publicar } from "@/lib/eventos";
import { emResultado, ErroDeOperacao } from "@/lib/erro-de-operacao";
import { CHAVE_DIVISAO_DA_TAXA, validarDivisao, type AreaDaTaxa } from "@/lib/divisao-da-taxa";
import { divisaoDaTaxa } from "@/lib/parametros-servidor";

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

/**
 * Grava como a casa reparte a taxa de serviço.
 *
 * A lista inteira de uma vez, ao contrário dos outros ajustes: as partes só
 * fazem sentido somando 100, e salvar área por área deixaria a divisão torta
 * entre um toque e outro. Lista vazia é "não dividir".
 */
export async function salvarDivisaoDaTaxa(areas: AreaDaTaxa[]) {
  return emResultado(async () => {
    const sessao = await exigirPermissao("unidade.configurar");

    // O que chega do navegador é conferido aqui, não na tela: a action é um
    // endereço público.
    if (!Array.isArray(areas)) throw new ErroDeOperacao("Divisão inválida.");
    const limpas = areas.map((a) => ({
      nome: typeof a?.nome === "string" ? a.nome.trim() : "",
      pct: typeof a?.pct === "number" ? a.pct : Number.NaN,
    }));
    const motivo = validarDivisao(limpas);
    if (motivo) throw new ErroDeOperacao(motivo);

    const antes = await divisaoDaTaxa(sessao.unidadeId);
    if (JSON.stringify(antes) === JSON.stringify(limpas)) return { areas: limpas };

    await db.$transaction([
      db.parametroUnidade.upsert({
        where: { unidadeId_chave: { unidadeId: sessao.unidadeId, chave: CHAVE_DIVISAO_DA_TAXA } },
        create: {
          tenantId: sessao.tenantId,
          unidadeId: sessao.unidadeId,
          grupo: "CAIXA",
          chave: CHAVE_DIVISAO_DA_TAXA,
          valor: limpas,
        },
        update: { valor: limpas },
      }),
      db.auditLog.create({
        data: await auditoria(sessao, {
          entidade: "ParametroUnidade",
          entidadeId: CHAVE_DIVISAO_DA_TAXA,
          acao: "AJUSTE_ALTERADO",
          antes: { ajuste: "Divisão da taxa de serviço", valor: antes },
          depois: { ajuste: "Divisão da taxa de serviço", valor: limpas },
        }),
      }),
    ]);

    revalidatePath("/gestao/ajustes");
    revalidatePath("/gestao/caixas");
    return { areas: limpas };
  });
}
