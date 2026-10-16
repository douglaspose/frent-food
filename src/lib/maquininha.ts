import "server-only";
import { SignJWT, jwtVerify } from "jose";
import type { NextRequest } from "next/server";
import { reconhecerPeloToken } from "./aparelhos";
import { vinculoAtual } from "./session";
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
  /**
   * Qual aparelho é este, quando ele tem cadastro próprio. Nulo quando veio
   * com o token da unidade — o agente antigo, que continua valendo.
   */
  aparelho: { id: string; nome: string; tipo: string } | null;
};

/**
 * A unidade do token do aparelho.
 *
 * Dois tipos de token abrem esta porta: o do aparelho cadastrado, que se corta
 * sozinho quando ele some, e o da unidade, que todos usavam antes de haver
 * cadastro. A procura mora em `@/lib/aparelhos`, compartilhada com a porta do
 * agente de impressão — são a mesma pergunta feita por duas portas.
 */
export async function unidadeDoAparelho(request: NextRequest): Promise<UnidadeDoAparelho | null> {
  const cabecalho = request.headers.get("authorization") ?? "";
  const token = cabecalho.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;

  const reconhecido = await reconhecerPeloToken(token);
  if (!reconhecido) return null;
  return { ...reconhecido.unidade, aparelho: reconhecido.aparelho };
}

/**
 * O operador do cabeçalho, se ele for desta unidade **e ainda valer**.
 *
 * O crachá é um JWT de doze horas, e o que vem dentro dele é o que era verdade
 * quando o PIN foi digitado. Sem reler o banco, quem fosse desligado às vinte
 * horas continuaria abrindo mesa, cancelando com PIN de gerente e recebendo
 * pagamento até a meia-noite — o PDV barra no clique seguinte, porque relê a
 * cada ação (`vinculoAtual`), e a maquininha não pode ser a porta frouxa.
 *
 * O cargo e as permissões devolvidos são os de agora, não os do token: tirar
 * uma permissão de alguém passa a valer no aparelho sem esperar o turno virar.
 */
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

  const vinculo = await vinculoAtual(operador.usuarioId, unidade.tenantId, unidade.id);
  if (!vinculo) return null;
  return { ...operador, cargo: vinculo.cargo, permissoes: vinculo.permissoes };
}

/**
 * O operador pode isto, ou aquilo.
 *
 * A mesma conta estava escrita em cada rota do aparelho, e a porta do turno já
 * deixa entrar quem recebe pagamento **ou** quem lança pedido: é depois de
 * entrar que cada rota confere a sua permissão. Uma cópia a mais seria a que
 * esquece o `"*"` do proprietário.
 */
export function podeNoAparelho(permissoes: string[], ...chaves: string[]) {
  return permissoes.includes("*") || chaves.some((chave) => permissoes.includes(chave));
}
