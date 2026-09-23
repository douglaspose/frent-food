import "server-only";
import { SignJWT, jwtVerify } from "jose";
import type { NextRequest } from "next/server";
import { dbSemRls } from "./db";
import { atravessandoRestaurantes } from "./tenant-atual";
import type { QuemRecebe } from "./conta";

/**
 * Quem é quem na porta da maquininha.
 *
 * São duas credenciais, e cada uma responde uma pergunta diferente:
 *
 *   - o **token da unidade** (o mesmo do agente de impressão) diz de qual
 *     restaurante é o aparelho. É o endereço da chamada;
 *   - o **PIN do operador** diz quem está recebendo. Sem ele, quem achasse uma
 *     maquininha perdida fecharia contas, e o diário não saberia dizer quem
 *     recebeu o dinheiro.
 *
 * O PIN é digitado uma vez e vira um token de turno, que a maquininha guarda.
 */

const DURACAO_HORAS = 12; // um turno inteiro, como a sessão do salão

/**
 * Chave própria, derivada do mesmo segredo.
 *
 * Assinado com a chave da sessão, o token do operador viraria um cookie de
 * navegador válido: quem copiasse o da maquininha entrava na gestão pelo
 * navegador. Com o sufixo, uma assinatura não vale na outra porta.
 */
function chaveDaMaquininha() {
  const segredo = process.env.AUTH_SECRET;
  if (!segredo) {
    throw new Error("AUTH_SECRET não definido. Gere um com: openssl rand -base64 32");
  }
  return new TextEncoder().encode(`${segredo}:maquininha`);
}

export type Operador = QuemRecebe & { cargo: string; permissoes: string[] };

export async function criarTokenDeOperador(operador: Operador) {
  return new SignJWT({ ...operador })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${DURACAO_HORAS}h`)
    .sign(chaveDaMaquininha());
}

export async function lerTokenDeOperador(token: string): Promise<Operador | null> {
  try {
    const { payload } = await jwtVerify(token, chaveDaMaquininha());
    return payload as unknown as Operador;
  } catch {
    // Expirado ou adulterado: a maquininha pede o PIN de novo.
    return null;
  }
}

export type UnidadeDoAparelho = {
  id: string;
  nome: string;
  ativo: boolean;
  tenantId: string;
};

/**
 * A unidade do token do aparelho.
 *
 * O token é a credencial e o endereço ao mesmo tempo: é ele que diz de qual
 * restaurante é esta chamada. Como a pergunta vem antes da resposta, ela
 * atravessa o isolamento — e o que vem depois já roda declarado.
 */
export async function unidadeDoAparelho(request: NextRequest): Promise<UnidadeDoAparelho | null> {
  const cabecalho = request.headers.get("authorization") ?? "";
  const token = cabecalho.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;

  return atravessandoRestaurantes("aparelho da casa: identificar pelo token", () =>
    dbSemRls.unidade.findUnique({
      where: { tokenImpressao: token },
      select: { id: true, nome: true, ativo: true, tenantId: true },
    })
  );
}

/** O operador do cabeçalho, se ele for desta unidade. */
export async function operadorDaRequisicao(
  request: NextRequest,
  unidade: UnidadeDoAparelho
): Promise<Operador | null> {
  const token = (request.headers.get("x-operador") ?? "").trim();
  if (!token) return null;

  const operador = await lerTokenDeOperador(token);
  if (!operador) return null;
  /*
   * O token diz a que unidade pertence, e a unidade vem do token do aparelho.
   * Sem esta conferência, um operador de uma filial receberia pela maquininha
   * da outra — e o pagamento entraria no caixa errado.
   */
  if (operador.tenantId !== unidade.tenantId || operador.unidadeId !== unidade.id) return null;
  return operador;
}
