import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { COOKIE_DA_SESSAO, chaveDaSessao } from "./tenant-da-sessao";
import { db } from "./db";

const COOKIE = COOKIE_DA_SESSAO;
const DURACAO_HORAS = 12; // um turno inteiro, sem obrigar o garçom a relogar no meio

export type Sessao = {
  usuarioId: string;
  tenantId: string;
  unidadeId: string;
  nome: string;
  cargo: string;
  permissoes: string[];
};

// O nome do cookie e a chave moram em `tenant-da-sessao` porque o adapter do
// banco também precisa deles, e ele não pode depender deste arquivo — este
// importa o `db`, e a volta seria um ciclo.
const chave = chaveDaSessao;

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
 * Apagar o cookie quando dá, sem derrubar a página quando não dá.
 *
 * O Next só permite mexer em cookie dentro de server action ou route handler.
 * O `exigirSessao` roda também na renderização de página, e ali a tentativa
 * lança — transformando "seu acesso foi encerrado" num erro 500 sem
 * explicação, que foi como este caso apareceu.
 *
 * Não apagar não deixa ninguém entrar: quem manda no acesso é a checagem no
 * banco logo abaixo, que roda em toda requisição. O cookie some no próximo
 * login ou quando expira.
 */
async function tentarEncerrarSessao() {
  try {
    await encerrarSessao();
  } catch {
    // Renderização de página: o cookie fica, o acesso continua negado.
  }
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
    await tentarEncerrarSessao();
    throw new Error("Seu acesso foi encerrado. Faça login novamente.");
  }

  return sessao;
}

export function temPermissao(sessao: Sessao, chave: string) {
  return sessao.permissoes.includes("*") || sessao.permissoes.includes(chave);
}

/** Basta uma. Serve para telas que reúnem operações de permissões diferentes. */
export function temAlgumaPermissao(sessao: Sessao, chaves: string[]) {
  return chaves.some((chave) => temPermissao(sessao, chave));
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
