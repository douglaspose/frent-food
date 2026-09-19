"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { exigirPermissao } from "@/lib/session";
import { cancelarNfce, emitirNfce } from "@/lib/fiscal/emitir";
import { emResultado, ErroDeOperacao } from "@/lib/erro-de-operacao";

const PERMISSAO = "produto.editar";

export type ConfigFiscal = {
  inscricaoEstadual: string;
  regimeTributario: "SIMPLES_NACIONAL" | "NORMAL";
  serieNfce: number;
  ambienteFiscal: "HOMOLOGACAO" | "PRODUCAO";
  emiteNfce: boolean;
  cscId: string;
  /// Em branco mantém o que já está salvo — não é para apagar sem querer.
  csc: string;
  tokenEmissor: string;
};

export async function salvarConfigFiscal(dados: ConfigFiscal) {
  return emResultado(async () => {
    const sessao = await exigirPermissao(PERMISSAO);

    const unidade = await db.unidade.findUniqueOrThrow({ where: { id: sessao.unidadeId } });

    if (dados.emiteNfce) {
      // Ligar a emissão sem os dados obrigatórios geraria uma fila de rejeições
      // logo no primeiro movimento.
      if (!unidade.cnpj) throw new ErroDeOperacao("Cadastre o CNPJ da unidade antes de ligar a emissão.");
      if (!unidade.uf) throw new ErroDeOperacao("Cadastre a UF da unidade antes de ligar a emissão.");
      if (!dados.inscricaoEstadual.trim()) throw new ErroDeOperacao("Informe a Inscrição Estadual.");
    }

    if (dados.ambienteFiscal === "PRODUCAO" && unidade.emissorFiscal === "SIMULADO") {
      throw new ErroDeOperacao(
        "O emissor simulado não transmite à SEFAZ. Configure um emissor real antes de usar produção."
      );
    }

    await db.unidade.update({
      where: { id: sessao.unidadeId },
      data: {
        inscricaoEstadual: dados.inscricaoEstadual.trim() || null,
        regimeTributario: dados.regimeTributario,
        serieNfce: dados.serieNfce,
        ambienteFiscal: dados.ambienteFiscal,
        emiteNfce: dados.emiteNfce,
        cscId: dados.cscId.trim() || null,
        ...(dados.csc.trim() ? { csc: dados.csc.trim() } : {}),
        ...(dados.tokenEmissor.trim() ? { tokenEmissor: dados.tokenEmissor.trim() } : {}),
      },
    });

    revalidatePath("/gestao/fiscal");
  });
}

export type DadosPerfil = {
  nome: string;
  cfop: string;
  origemMercadoria: number;
  csosn: string;
  cstIcms: string;
  aliquotaIcms: number;
  cstPis: string;
  aliquotaPis: number;
  cstCofins: string;
  aliquotaCofins: number;
  padrao: boolean;
};

export async function salvarPerfil(dados: DadosPerfil, perfilId?: string) {
  return emResultado(async () => {
    const sessao = await exigirPermissao(PERMISSAO);
    if (!dados.nome.trim()) throw new ErroDeOperacao("Informe o nome do perfil.");

    await db.$transaction(async (tx) => {
      // Só um perfil padrão por unidade, senão o produto sem perfil não saberia
      // qual seguir.
      if (dados.padrao) {
        await tx.perfilFiscal.updateMany({
          where: { unidadeId: sessao.unidadeId },
          data: { padrao: false },
        });
      }

      const conteudo = {
        nome: dados.nome.trim(),
        cfop: dados.cfop.trim(),
        origemMercadoria: dados.origemMercadoria,
        csosn: dados.csosn.trim(),
        cstIcms: dados.cstIcms.trim(),
        aliquotaIcms: dados.aliquotaIcms,
        cstPis: dados.cstPis.trim(),
        aliquotaPis: dados.aliquotaPis,
        cstCofins: dados.cstCofins.trim(),
        aliquotaCofins: dados.aliquotaCofins,
        padrao: dados.padrao,
      };

      if (perfilId) {
        const existente = await tx.perfilFiscal.findUnique({ where: { id: perfilId } });
        if (!existente || existente.tenantId !== sessao.tenantId) {
          throw new ErroDeOperacao("Perfil não encontrado.");
        }
        await tx.perfilFiscal.update({ where: { id: perfilId }, data: conteudo });
      } else {
        await tx.perfilFiscal.create({
          data: { ...conteudo, tenantId: sessao.tenantId, unidadeId: sessao.unidadeId },
        });
      }
    });

    revalidatePath("/gestao/fiscal");
    revalidatePath("/gestao/produtos");
  });
}

/** Aplica um perfil a todos os produtos que ainda não têm nenhum. */
export async function aplicarPerfilAosSemPerfil(perfilId: string) {
  return emResultado(async () => {
    const sessao = await exigirPermissao(PERMISSAO);

    const perfil = await db.perfilFiscal.findUnique({ where: { id: perfilId } });
    if (!perfil || perfil.tenantId !== sessao.tenantId) throw new ErroDeOperacao("Perfil não encontrado.");

    const r = await db.produto.updateMany({
      where: { tenantId: sessao.tenantId, perfilFiscalId: null },
      data: { perfilFiscalId: perfilId },
    });

    revalidatePath("/gestao/fiscal");
    return { atualizados: r.count };
  });
}

export async function reemitirNota(comandaId: string) {
  return emResultado(async () => {
    const sessao = await exigirPermissao(PERMISSAO);

    const comanda = await db.comanda.findUniqueOrThrow({ where: { id: comandaId } });
    if (comanda.tenantId !== sessao.tenantId) throw new ErroDeOperacao("Comanda de outro restaurante.");

    const resultado = await emitirNfce(comandaId, sessao.usuarioId);
    revalidatePath("/gestao/fiscal");
    return resultado;
  });
}

export async function cancelarNota(notaId: string, motivo: string) {
  return emResultado(async () => {
    const sessao = await exigirPermissao(PERMISSAO);

    const nota = await db.notaFiscal.findUniqueOrThrow({ where: { id: notaId } });
    if (nota.tenantId !== sessao.tenantId) throw new ErroDeOperacao("Nota de outro restaurante.");

    await cancelarNfce(notaId, motivo);
    revalidatePath("/gestao/fiscal");
  });
}
