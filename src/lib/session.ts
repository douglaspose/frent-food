import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { db } from "./db";

const COOKIE = "sessao";
const DURACAO_HORAS = 12; // um turno inteiro, sem obrigar o garçom a relogar no meio

export type Sessao = {
  usuarioId: string;
  tenantId: string;
  unidadeId: string;
  nome: string;
  cargo: string;
  permissoes: string[];
};

function chave() {
  const segredo = process.env.AUTH_SECRET;
  if (!segredo) {
    throw new Error("AUTH_SECRET não definido. Gere um com: openssl rand -base64 32");
  }
  return new TextEncoder().encode(segredo);
}

export async function criarSessao(sessao: Sessao) {
  const token = await new SignJWT({ ...sessao })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${DURACAO_HORAS}h`)
    .sign(chave());

  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: DURACAO_HORAS * 60 * 60,
  });
}

export async function lerSessao(): Promise<Sessao | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, chave());
    return payload as unknown as Sessao;
  } catch {
    // Token expirado ou adulterado — trata como deslogado, sem quebrar a página.
    return null;
  }
}

export async function encerrarSessao() {
  const jar = await cookies();
  jar.delete(COOKIE);
}

/**
 * Uso nas server actions: falha cedo e com mensagem clara.
 *
 * Confere no banco se o usuário continua ativo. O cookie vale 12 horas, e sem
 * esta checagem quem fosse desligado no meio do turno continuaria lançando
 * comanda e recebendo dinheiro até o cookie expirar.
 */
export async function exigirSessao(): Promise<Sessao> {
  const sessao = await lerSessao();
  if (!sessao) throw new Error("Sessão expirada. Faça login novamente.");

  const usuario = await db.usuario.findUnique({
    where: { id: sessao.usuarioId },
    select: { ativo: true, tenantId: true },
  });

  if (!usuario?.ativo || usuario.tenantId !== sessao.tenantId) {
    await encerrarSessao();
    throw new Error("Seu acesso foi encerrado. Faça login novamente.");
  }

  return sessao;
}

export function temPermissao(sessao: Sessao, chave: string) {
  return sessao.permissoes.includes("*") || sessao.permissoes.includes(chave);
}

/**
 * Barra a ação quando o cargo não tem a permissão. A mensagem diz qual é —
 * no salão isso vira "chama o gerente", que é exatamente o fluxo esperado.
 */
export async function exigirPermissao(chave: string): Promise<Sessao> {
  const sessao = await exigirSessao();
  if (!temPermissao(sessao, chave)) {
    throw new Error(`Seu cargo (${sessao.cargo}) não tem permissão para: ${chave}`);
  }
  return sessao;
}
