"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { db, dbSemRls } from "@/lib/db";
import { atravessandoRestaurantes, declararTenant } from "@/lib/tenant-atual";
import { criarSessao, encerrarSessao, type Sessao } from "@/lib/session";
import { limparFalhas, registrarFalha, verificar } from "@/lib/limite-tentativas";

/**
 * Identifica quem está tentando entrar. Atrás do Caddy o IP real vem no
 * cabeçalho; sem ele, todo mundo contaria no mesmo balde e o primeiro erro
 * de digitação de um garçom travaria o salão inteiro.
 */
async function origem(prefixo: string) {
  const cabecalhos = await headers();
  const ip =
    cabecalhos.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    cabecalhos.get("x-real-ip") ??
    "desconhecido";
  return `${prefixo}:${ip}`;
}

function mensagemDeBloqueio(segundos: number) {
  const minutos = Math.ceil(segundos / 60);
  return `Muitas tentativas. Tente de novo em ${minutos} minuto(s).`;
}

/**
 * Qual restaurante está sendo acessado. Hoje há um só; quando o SaaS tiver
 * vários, o slug vem do subdomínio (lipao.meusistema.com.br) e é só trocar
 * esta função.
 *
 * É a única pergunta do sistema que precisa ser respondida sem saber de qual
 * restaurante ela é — por isso o `dbSemRls`, e por isso marcada. Sob o cliente
 * normal ela voltaria vazia e ninguém conseguiria entrar, inclusive quem tem a
 * senha certa.
 */
async function restauranteDoEndereco() {
  return atravessandoRestaurantes("login: descobrir o restaurante pelo endereço", () =>
    dbSemRls.tenant.findFirst({ where: { slug: "demo", ativo: true } })
  );
}

async function montarSessao(usuarioId: string): Promise<Sessao | null> {
  const usuario = await db.usuario.findUnique({
    where: { id: usuarioId },
    include: {
      unidades: {
        include: { cargo: { include: { permissoes: true } }, unidade: true },
      },
    },
  });

  const vinculo = usuario?.unidades[0];
  if (!usuario || !vinculo) return null;

  return {
    usuarioId: usuario.id,
    tenantId: usuario.tenantId,
    unidadeId: vinculo.unidadeId,
    nome: usuario.nome,
    cargo: vinculo.cargo.nome,
    permissoes: vinculo.cargo.permissoes.filter((p) => p.permitido).map((p) => p.chave),
  };
}

export async function entrarComSenha(email: string, senha: string) {
  const chave = await origem("senha");
  const freio = await verificar(chave);
  if (freio.bloqueado) return { erro: mensagemDeBloqueio(freio.segundosRestantes) };

  const tenant = await restauranteDoEndereco();
  if (!tenant) return { erro: "Restaurante não encontrado." };

  /**
   * Descoberto o restaurante, acaba a exceção: a busca do usuário e tudo o que
   * vem depois já rodam sob o RLS, como qualquer outra consulta do sistema.
   */
  declararTenant(tenant.id);

  const usuario = await db.usuario.findFirst({
    where: { tenantId: tenant.id, email: email.trim().toLowerCase(), ativo: true },
  });

  // Mensagem genérica de propósito: dizer "usuário não existe" entrega quais
  // e-mails estão cadastrados para quem estiver tentando adivinhar.
  if (!usuario?.senhaHash || !(await bcrypt.compare(senha, usuario.senhaHash))) {
    const veredito = await registrarFalha(chave);
    return {
      erro: veredito.bloqueado
        ? mensagemDeBloqueio(veredito.segundosRestantes)
        : "E-mail ou senha incorretos.",
    };
  }

  const sessao = await montarSessao(usuario.id);
  if (!sessao) return { erro: "Usuário sem unidade ou cargo vinculado." };

  await limparFalhas(chave);
  await criarSessao(sessao);
  redirect("/pdv");
}

export async function entrarComPin(pin: string) {
  const chave = await origem("pin");
  const freio = await verificar(chave);
  if (freio.bloqueado) return { erro: mensagemDeBloqueio(freio.segundosRestantes) };

  const tenant = await restauranteDoEndereco();
  if (!tenant) return { erro: "Restaurante não encontrado." };

  declararTenant(tenant.id);

  // O PIN é hash, então não dá para consultar por igualdade: compara contra a
  // equipe ativa. É uma lista pequena (a escala de um restaurante).
  const usuarios = await db.usuario.findMany({
    where: { tenantId: tenant.id, ativo: true, pinHash: { not: null } },
    select: { id: true, pinHash: true },
  });

  for (const usuario of usuarios) {
    if (await bcrypt.compare(pin, usuario.pinHash!)) {
      const sessao = await montarSessao(usuario.id);
      if (!sessao) return { erro: "Usuário sem unidade ou cargo vinculado." };

      await limparFalhas(chave);
      await criarSessao(sessao);
      redirect("/pdv");
    }
  }

  const veredito = await registrarFalha(chave);
  return {
    erro: veredito.bloqueado
      ? mensagemDeBloqueio(veredito.segundosRestantes)
      : "PIN não reconhecido.",
  };
}

export async function sair() {
  await encerrarSessao();
  redirect("/login");
}
