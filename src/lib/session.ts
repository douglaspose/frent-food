import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import { COOKIE_DA_SESSAO, chaveDaSessao } from "./tenant-da-sessao";
import { db } from "./db";
import { ErroDeOperacao } from "./erro-de-operacao";

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
  /*
   * `ErroDeOperacao`, e não um `Error` qualquer: sessão vencida é coisa que o
   * operador precisa ler para saber o que fazer. Como exceção, a mensagem
   * virava um código minificado do React em produção, e a tela mostrava o
   * texto cru — que não explica que basta entrar de novo.
   */
  const sessao = await lerSessao();
  if (!sessao) throw new ErroDeOperacao("Sessão expirada. Faça login novamente.");

  const valida = await conferirNoBanco(sessao);
  if (!valida) {
    await tentarEncerrarSessao();
    throw new ErroDeOperacao("Seu acesso foi encerrado. Faça login novamente.");
  }

  return valida;
}

/**
 * A sessão do cookie, só se ela ainda vale no banco — sem lançar.
 *
 * É o que a tela de login usa para decidir se manda para o PDV. Ela olhava só
 * a assinatura do cookie: com a pessoa desligada, o login mandava para o PDV,
 * o PDV recusava, e ninguém mais entrava naquele tablet até o cookie vencer.
 */
export async function sessaoAtiva(): Promise<Sessao | null> {
  const sessao = await lerSessao();
  return sessao ? conferirNoBanco(sessao) : null;
}

/**
 * A sessão para uma tela — páginas e layouts. Sem sessão válida, vai para o
 * login.
 *
 * `exigirSessao` lança, e numa tela o erro vira a tela de erro. Com a pessoa
 * desligada no meio do turno, o PDV e a gestão mostravam essa tela em vez do
 * login; no tablet com o app instalado não há barra de endereço onde digitar
 * /login, e ninguém mais entrava naquele aparelho até o cookie vencer.
 *
 * As server actions continuam com `exigirSessao`: `redirect()` funciona
 * lançando um erro especial que todo `try/catch` no caminho precisa deixar
 * passar, e as actions passam por vários. Numa tela não há nenhum.
 *
 * Não apaga o cookie — numa tela o Next não deixa. Nem precisa: a tela de
 * login confere no banco (`sessaoAtiva`) e mostra o teclado mesmo com ele lá.
 */
export async function sessaoDaTela(): Promise<Sessao> {
  const sessao = await sessaoAtiva();
  if (!sessao) redirect("/login");
  return sessao;
}

/**
 * Ativo, do mesmo restaurante, ainda vinculado à unidade — e com o cargo de
 * hoje, não o do login.
 *
 * O cargo e as permissões iam no cookie e valiam as 12 horas dele: o gerente
 * rebaixado a garçom no meio do turno continuava dando desconto sem PIN até o
 * cookie vencer. Na mesma consulta que confere se a pessoa está ativa, o cargo
 * é relido e substitui o do cookie.
 */
async function conferirNoBanco(sessao: Sessao): Promise<Sessao | null> {
  const usuario = await db.usuario.findUnique({
    where: { id: sessao.usuarioId },
    select: {
      ativo: true,
      tenantId: true,
      unidades: {
        where: { unidadeId: sessao.unidadeId },
        select: {
          cargo: { select: { nome: true, permissoes: { where: { permitido: true }, select: { chave: true } } } },
        },
      },
    },
  });
  const vinculo = usuario?.unidades[0];
  if (!usuario?.ativo || usuario.tenantId !== sessao.tenantId || !vinculo) return null;
  return {
    ...sessao,
    cargo: vinculo.cargo.nome,
    permissoes: vinculo.cargo.permissoes.map((p) => p.chave),
  };
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
    throw new ErroDeOperacao(`Seu cargo (${sessao.cargo}) não tem permissão para: ${chave}`);
  }
  return sessao;
}
