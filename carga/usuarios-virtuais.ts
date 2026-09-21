import { AsyncLocalStorage } from "node:async_hooks";
import { SignJWT } from "jose";

/**
 * Gente trabalhando ao mesmo tempo, sem navegador.
 *
 * Cada pessoa virtual tem o próprio pote de cookies e o próprio IP. O que se
 * simula é só isso — qual cookie esta requisição carrega. Todo o resto roda o
 * código de verdade: o login pelo PIN grava o JWT no pote, `exigirSessao`
 * verifica a assinatura e confere no banco se o usuário continua ativo,
 * `exigirPermissao` barra quem não pode, e o adaptador de RLS descobre o
 * restaurante pelo mesmo cookie.
 *
 * O `AsyncLocalStorage` é o que permite oito garçons ao mesmo tempo: cada
 * chamada enxerga o pote de quem a fez, mesmo intercaladas no mesmo processo.
 */

export type Pessoa = {
  nome: string;
  pin: string;
  ip: string;
  /** De onde a pessoa acessa: o subdomínio é o que diz de qual restaurante é a tela. */
  host: string;
  cookies: Map<string, string>;
};

const contexto = new AsyncLocalStorage<Pessoa>();

export function pessoa(nome: string, pin: string, ip: string, host: string): Pessoa {
  return { nome, pin, ip, host, cookies: new Map() };
}

/** Roda `fn` como se a requisição viesse do navegador desta pessoa. */
export function como<T>(quem: Pessoa, fn: () => Promise<T>): Promise<T> {
  return contexto.run(quem, fn);
}

/**
 * O que substitui `next/headers` durante o dia simulado.
 *
 * Sem pessoa no contexto — um passo de preparação, uma conferência no fim —
 * o pote vem vazio, exatamente como uma requisição sem cookie.
 */
export function substitutoDeHeaders() {
  return {
    cookies: async () => {
      const quem = contexto.getStore();
      return {
        get: (nome: string) => {
          const valor = quem?.cookies.get(nome);
          return valor === undefined ? undefined : { name: nome, value: valor };
        },
        set: (nome: string, valor: string) => {
          quem?.cookies.set(nome, valor);
        },
        delete: (nome: string) => {
          quem?.cookies.delete(nome);
        },
      };
    },
    headers: async () => {
      const quem = contexto.getStore();
      return new Headers(
        quem ? { host: quem.host, "x-forwarded-for": quem.ip, "user-agent": "carga" } : {}
      );
    },
  };
}

/**
 * O `redirect()` do Next lança um erro marcado para interromper a action. No
 * navegador ele vira navegação; aqui é o sinal de que o login deu certo.
 */
export function ehRedirecionamento(e: unknown) {
  return (
    typeof e === "object" &&
    e !== null &&
    "digest" in e &&
    typeof (e as { digest: unknown }).digest === "string" &&
    (e as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

/**
 * Um cookie de sessão assinado à mão, para quem o login de verdade não
 * alcança — o restaurante do vizinho, nos ataques. Mesmo formato e mesma
 * chave de `criarSessao`: para o sistema, é indistinguível de um login.
 */
export async function sessaoAssinada(
  quem: Pessoa,
  dados: {
    usuarioId: string;
    tenantId: string;
    unidadeId: string;
    nome: string;
    cargo: string;
    permissoes: string[];
  }
) {
  const segredo = process.env.AUTH_SECRET;
  if (!segredo) throw new Error("AUTH_SECRET ausente: o simulador assina a sessão com ela.");
  const token = await new SignJWT({ ...dados })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(new TextEncoder().encode(segredo));
  quem.cookies.set("sessao", token);
}
