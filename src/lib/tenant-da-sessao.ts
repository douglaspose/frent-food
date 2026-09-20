import "server-only";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";

/**
 * De qual restaurante é esta requisição, perguntando ao cookie de sessão.
 *
 * É a reserva do `adaptador-rls.ts`: quando nenhum escopo foi declarado, em vez
 * de desistir e devolver vazio, ele pergunta aqui.
 *
 * Por que perguntar em vez de o sistema avisar. Tentei os dois jeitos de
 * empurrar o valor para frente e nenhum cobre o Next inteiro:
 *
 *   - `AsyncLocalStorage.enterWith` não sobe para quem chamou. Como o
 *     `lerSessao()` dá `await` antes de declarar, a continuação de quem o
 *     chamou já tinha um contexto próprio, criado antes da marca.
 *   - O `cache()` do React resolve isso na renderização de página, mas o
 *     escopo dele é a renderização: numa server action, cada chamada devolve
 *     uma caixa nova, e o que foi guardado some.
 *
 * O cookie não tem esse problema porque não depende de contexto nenhum:
 * `cookies()` funciona em renderização, em server action e em route handler,
 * que são os três lugares de onde uma consulta pode sair.
 *
 * Custa verificar um JWT por consulta — HS256 sobre algumas centenas de bytes,
 * ordem de dezenas de microssegundos, contra os ~3 ms que a consulta já custa.
 */

export const COOKIE_DA_SESSAO = "sessao";

export function chaveDaSessao() {
  const segredo = process.env.AUTH_SECRET;
  if (!segredo) {
    throw new Error("AUTH_SECRET não definido. Gere um com: openssl rand -base64 32");
  }
  return new TextEncoder().encode(segredo);
}

export async function tenantDaSessao(): Promise<string | undefined> {
  try {
    const jar = await cookies();
    const token = jar.get(COOKIE_DA_SESSAO)?.value;
    if (!token) return undefined;

    const { payload } = await jwtVerify(token, chaveDaSessao());
    const tenantId = (payload as { tenantId?: unknown }).tenantId;

    return typeof tenantId === "string" && tenantId.length > 0 ? tenantId : undefined;
  } catch {
    /**
     * Cai aqui quando não há requisição (script, teste, job), quando o token
     * expirou e quando ele foi adulterado. Nos três casos a resposta certa é a
     * mesma: não sei de quem é, e o RLS devolve vazio — fecha, não abre.
     */
    return undefined;
  }
}
