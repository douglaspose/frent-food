"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { exigirPermissao } from "@/lib/session";
import { auditoria } from "@/lib/auditoria-servidor";
import { emResultado, ErroDeOperacao } from "@/lib/erro-de-operacao";

/**
 * Mexer na equipe é do proprietário: quem cria usuário define quem pode dar
 * desconto e fechar caixa. Só o cargo com permissão total ("*") passa daqui.
 */
const PERMISSAO = "usuario.editar";

export type DadosUsuario = {
  nome: string;
  email: string;
  cargoId: string;
  pin: string;
  senha: string;
};

function validar(dados: DadosUsuario) {
  if (!dados.nome.trim()) throw new ErroDeOperacao("Informe o nome.");
  if (!dados.email.trim()) throw new ErroDeOperacao("Informe o e-mail.");
  if (!dados.cargoId) throw new ErroDeOperacao("Escolha o cargo.");
  if (dados.pin && !/^\d{4}$/.test(dados.pin)) throw new ErroDeOperacao("O PIN deve ter 4 dígitos.");
}

/**
 * O diário guarda o nome do cargo, não o id.
 *
 * "cargo: GERENTE → PROPRIETARIO" responde a pergunta; "cargo: cmu7dva..."
 * obriga quem lê a ir consultar outra tabela, e ninguém vai.
 */
async function nomeDoCargo(cargoId: string | null | undefined) {
  if (!cargoId) return null;
  const cargo = await db.cargo.findUnique({ where: { id: cargoId }, select: { nome: true } });
  return cargo?.nome ?? null;
}

/** Dois PINs iguais fariam o login por PIN entrar na conta errada. */
async function pinJaUsado(tenantId: string, pin: string, ignorarUsuarioId?: string) {
  const usuarios = await db.usuario.findMany({
    where: { tenantId, ativo: true, pinHash: { not: null }, id: { not: ignorarUsuarioId } },
    select: { pinHash: true },
  });
  for (const u of usuarios) {
    if (await bcrypt.compare(pin, u.pinHash!)) return true;
  }
  return false;
}

export async function criarUsuario(dados: DadosUsuario) {
  return emResultado(async () => {
    const sessao = await exigirPermissao(PERMISSAO);
    validar(dados);
    if (!dados.senha) throw new ErroDeOperacao("Defina uma senha inicial.");

    const email = dados.email.trim().toLowerCase();
    const existente = await db.usuario.findFirst({ where: { tenantId: sessao.tenantId, email } });
    if (existente) throw new ErroDeOperacao("Já existe um usuário com esse e-mail.");

    if (dados.pin && (await pinJaUsado(sessao.tenantId, dados.pin))) {
      throw new ErroDeOperacao("Esse PIN já está em uso por outra pessoa.");
    }

    const criado = await db.usuario.create({
      data: {
        tenantId: sessao.tenantId,
        nome: dados.nome.trim(),
        email,
        senhaHash: await bcrypt.hash(dados.senha, 10),
        pinHash: dados.pin ? await bcrypt.hash(dados.pin, 10) : null,
        unidades: { create: { unidadeId: sessao.unidadeId, cargoId: dados.cargoId } },
      },
    });

    // Fora da transação porque o id só existe depois do create. Um registro
    // perdido aqui seria ruim, mas o usuário novo aparece na tela de equipe de
    // qualquer forma — diferente de um desconto, que some sem deixar rastro.
    await db.auditLog.create({
      data: await auditoria(sessao, {
        entidade: "Usuario",
        entidadeId: criado.id,
        acao: "USUARIO_CRIADO",
        // Nunca o PIN nem a senha, nem o hash: o diário é lido por gente.
        depois: {
          nome: criado.nome,
          email: criado.email,
          cargo: await nomeDoCargo(dados.cargoId),
        },
      }),
    });

    revalidatePath("/gestao/equipe");
  });
}

export async function atualizarUsuario(usuarioId: string, dados: DadosUsuario) {
  return emResultado(async () => {
    const sessao = await exigirPermissao(PERMISSAO);
    validar(dados);

    const usuario = await db.usuario.findUnique({ where: { id: usuarioId } });
    if (!usuario || usuario.tenantId !== sessao.tenantId) throw new ErroDeOperacao("Usuário não encontrado.");

    if (dados.pin && (await pinJaUsado(sessao.tenantId, dados.pin, usuarioId))) {
      throw new ErroDeOperacao("Esse PIN já está em uso por outra pessoa.");
    }

    const cargoAtual = await db.usuarioUnidade.findFirst({
      where: { usuarioId, unidadeId: sessao.unidadeId },
      select: { cargoId: true },
    });

    const registro = await auditoria(sessao, {
      entidade: "Usuario",
      entidadeId: usuarioId,
      acao: "USUARIO_EDITADO",
      antes: {
        nome: usuario.nome,
        email: usuario.email,
        cargo: await nomeDoCargo(cargoAtual?.cargoId),
      },
      depois: {
        nome: dados.nome.trim(),
        email: dados.email.trim().toLowerCase(),
        cargo: await nomeDoCargo(dados.cargoId),
        // Não se guarda a senha, mas guarda-se que ela mudou: é a pergunta que
        // aparece quando alguém não consegue mais entrar.
        trocouSenha: Boolean(dados.senha),
        trocouPin: Boolean(dados.pin),
      },
    });

    await db.$transaction(async (tx) => {
      await tx.usuario.update({
        where: { id: usuarioId },
        data: {
          nome: dados.nome.trim(),
          email: dados.email.trim().toLowerCase(),
          // Campos em branco mantêm o que já existe — não é para limpar senha sem querer.
          ...(dados.senha ? { senhaHash: await bcrypt.hash(dados.senha, 10) } : {}),
          ...(dados.pin ? { pinHash: await bcrypt.hash(dados.pin, 10) } : {}),
        },
      });
      await tx.usuarioUnidade.updateMany({
        where: { usuarioId, unidadeId: sessao.unidadeId },
        data: { cargoId: dados.cargoId },
      });
      await tx.auditLog.create({ data: registro });
    });

    revalidatePath("/gestao/equipe");
  });
}

export async function alternarUsuarioAtivo(usuarioId: string, ativo: boolean) {
  return emResultado(async () => {
    const sessao = await exigirPermissao(PERMISSAO);

    const usuario = await db.usuario.findUnique({ where: { id: usuarioId } });
    if (!usuario || usuario.tenantId !== sessao.tenantId) throw new ErroDeOperacao("Usuário não encontrado.");
    if (usuarioId === sessao.usuarioId) throw new ErroDeOperacao("Você não pode desativar a própria conta.");

    // Nunca excluído: o nome dele está em comandas, pagamentos e no log.
    await db.$transaction([
      db.usuario.update({ where: { id: usuarioId }, data: { ativo } }),
      db.auditLog.create({
        data: await auditoria(sessao, {
          entidade: "Usuario",
          entidadeId: usuarioId,
          acao: ativo ? "USUARIO_REATIVADO" : "USUARIO_DESATIVADO",
          depois: { nome: usuario.nome, ativo },
        }),
      }),
    ]);

    revalidatePath("/gestao/equipe");
  });
}
