import { AsyncLocalStorage } from "node:async_hooks";

/**
 * De qual restaurante é a requisição que está rodando agora.
 *
 * A alternativa seria passar `tenantId` por parâmetro da página até a última
 * consulta — em trinta arquivos, e bastaria um esquecimento. Aqui o valor
 * viaja junto com a requisição, sem aparecer na assinatura de ninguém, e o
 * adapter do banco o lê na hora de montar cada consulta (`adaptador-rls.ts`).
 *
 * Quem consome isto não é o código de negócio: é a camada de conexão. O código
 * de negócio continua escrevendo `db.mesa.findMany(...)` como antes.
 */

export type ContextoDeTenant =
  /** O caso comum: a requisição pertence a um restaurante. */
  | { tipo: "restaurante"; tenantId: string }
  /**
   * A exceção declarada. Login e resolução de subdomínio acontecem antes de
   * existir um restaurante conhecido, e rotinas de manutenção varrem todos de
   * propósito. O `motivo` existe para que essa travessia apareça no log em vez
   * de virar hábito silencioso.
   */
  | { tipo: "atravessa"; motivo: string };

const contexto = new AsyncLocalStorage<ContextoDeTenant>();

/**
 * Declara o restaurante daqui até o fim da função que chamou — e só dela.
 *
 * **O alcance é o detalhe que importa.** `enterWith` marca o contexto
 * assíncrono atual: vale para o resto deste corpo de função e para tudo que
 * ele chamar, mas **não sobe** para quem o chamou. Uma função que faz `await`
 * e só então declara não afeta nada fora de si — e a falha é silenciosa, com
 * as consultas voltando vazias como se o restaurante não tivesse dados.
 *
 * Por isso os dois usos que existem declaram e consultam no mesmo corpo: o
 * login, depois de descobrir o restaurante pelo endereço, e a rota do agente
 * de impressão, depois de identificar a unidade pelo token.
 *
 * Quem tem sessão não precisa disto: o adapter lê o restaurante do cookie
 * sozinho (`tenant-da-sessao.ts`). E onde couber envolver o trecho numa
 * função, `comTenant` é melhor — o alcance dele é a indentação.
 */
export function declararTenant(tenantId: string) {
  contexto.enterWith({ tipo: "restaurante", tenantId });
}

/** Escopo explícito. É o que jobs, scripts e testes devem usar. */
export function comTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return rodarDentro({ tipo: "restaurante", tenantId }, fn);
}

/**
 * Marca um trecho que atravessa restaurantes de propósito.
 *
 * Sem esta marca, uma consulta sem tenant é indistinguível de um esquecimento
 * — e as duas coisas merecem tratamento oposto: uma é correta, a outra é bug.
 */
export function atravessandoRestaurantes<T>(motivo: string, fn: () => Promise<T>): Promise<T> {
  return rodarDentro({ tipo: "atravessa", motivo }, fn);
}

/**
 * O `await` aqui não é enfeite, e tirá-lo quebra o sistema em silêncio.
 *
 * `db.mesa.count()` devolve uma promessa preguiçosa: ela não consulta nada
 * enquanto ninguém chamar `.then()`. Com `contexto.run(ctx, fn)` puro, um
 * `comTenant(id, () => db.mesa.count())` criaria a promessa dentro do contexto
 * e a devolveria parada — quem a dispara é o `await` de quem chamou, já fora.
 * O adapter leria "nenhum restaurante declarado" e o Postgres devolveria zero
 * linhas, sem erro nenhum, como se o restaurante estivesse vazio.
 *
 * Com o `await` dentro, o `.then()` acontece aqui, e o contexto acompanha a
 * consulta até o banco. Custa um tique de microtask e dispensa o chamador de
 * saber disto.
 */
function rodarDentro<T>(valor: ContextoDeTenant, fn: () => Promise<T>): Promise<T> {
  return contexto.run(valor, async () => await fn());
}

/**
 * O escopo em vigor, ou `undefined` quando ninguém declarou nada.
 *
 * `undefined` não significa "pode tudo": significa "o adapter que pergunte ao
 * cookie", e se nem o cookie souber, o RLS devolve vazio.
 */
export function contextoAtual(): ContextoDeTenant | undefined {
  return contexto.getStore();
}

/** O id do restaurante do escopo em vigor, se houver um. */
export function tenantAtual(): string | undefined {
  const atual = contextoAtual();
  return atual?.tipo === "restaurante" ? atual.tenantId : undefined;
}

/**
 * Só para os testes: roda sem contexto nenhum, simulando o esquecimento.
 *
 * `AsyncLocalStorage` não tem "sair do escopo", e depois de um `enterWith` o
 * contexto acompanha o resto do teste — contaminando o seguinte. `exit` é a
 * única saída, e o motivo de este arquivo expor algo que o sistema não usa.
 */
export function semContexto<T>(fn: () => T): T {
  return contexto.exit(fn);
}

