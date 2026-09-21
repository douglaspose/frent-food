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
 * O cargo escolhido na tela, conferido antes de qualquer gravação.
 *
 * O id vem do navegador, e cargo carrega permissões. Sem esta conferência um
 * gerente podia pendurar num funcionário o cargo "Proprietário" **de outro
 * restaurante** — com permissão total — e ganhar acesso irrestrito no seu.
 *
 * O RLS não pegava isso: no Postgres a checagem de chave estrangeira ignora as
 * políticas por definição, roda com os privilégios do dono da tabela. O banco
 * aceitava a referência a um cargo que ele mesmo esconderia numa consulta. Por
 * isso a regra mora aqui, e não só lá.
 *
 * Devolve o nome junto porque o diário guarda o nome, não o id:
 * "GERENTE → PROPRIETARIO" responde a pergunta; "cmu7dva..." não.
 */
async function cargoDoTenant(cargoId: string, tenantId: string) {
  const cargo = await db.cargo.findFirst({
    where: { id: cargoId, tenantId },
    select: { id: true, nome: true },
  });
  if (!cargo) throw new ErroDeOperacao("Cargo não encontrado.");
  return cargo;
}

/** O nome do cargo que a pessoa já tem, para o "antes" do diário. */
async function nomeDoCargoAtual(cargoId: string | null | undefined, tenantId: string) {
  if (!cargoId) return null;
  const cargo = await db.cargo.findFirst({ where: { id: cargoId, tenantId }, select: { nome: true } });
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

    const cargo = await cargoDoTenant(dados.cargoId, sessao.tenantId);

    const criado = await db.usuario.create({
      data: {
        tenantId: sessao.tenantId,
        nome: dados.nome.trim(),
        email,
        senhaHash: await bcrypt.hash(dados.senha, 10),
        pinHash: dados.pin ? await bcrypt.hash(dados.pin, 10) : null,
        unidades: { create: { unidadeId: sessao.unidadeId, cargoId: cargo.id } },
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
          cargo: cargo.nome,
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

    const cargo = await cargoDoTenant(dados.cargoId, sessao.tenantId);

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
        cargo: await nomeDoCargoAtual(cargoAtual?.cargoId, sessao.tenantId),
      },
      depois: {
        nome: dados.nome.trim(),
        email: dados.email.trim().toLowerCase(),
        cargo: cargo.nome,
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
        data: { cargoId: cargo.id },
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
