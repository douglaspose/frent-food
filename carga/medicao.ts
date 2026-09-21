import fs from "node:fs";
import path from "node:path";

/**
 * Quanto cada operação levou, sob a carga do dia.
 *
 * O número que importa é o p95, não a média. A média de 120 ms esconde o
 * garçom que esperou 3 segundos para a cerveja entrar na comanda — e é esse
 * que reclama. O máximo fica junto porque um único travamento de 10 s num
 * pagamento é o tipo de coisa que faz o dono desistir do sistema.
 */

type Amostra = { ms: number; ok: boolean };
const amostras = new Map<string, Amostra[]>();

export async function medir<T>(operacao: string, fn: () => Promise<T>): Promise<T> {
  const inicio = performance.now();
  let ok = true;
  try {
    const r = await fn();
    // Erro de regra de negócio volta como valor, não como exceção.
    if (r && typeof r === "object" && "erro" in r) ok = false;
    return r;
  } catch (e) {
    ok = false;
    throw e;
  } finally {
    const lista = amostras.get(operacao) ?? [];
    lista.push({ ms: performance.now() - inicio, ok });
    amostras.set(operacao, lista);
  }
}

function percentil(ordenados: number[], p: number) {
  if (!ordenados.length) return 0;
  const i = Math.min(ordenados.length - 1, Math.ceil((p / 100) * ordenados.length) - 1);
  return ordenados[Math.max(0, i)]!;
}

export type Tempo = {
  operacao: string;
  chamadas: number;
  recusadas: number;
  p50: number;
  p95: number;
  max: number;
};

export function tempos(): Tempo[] {
  return [...amostras.entries()]
    .map(([operacao, lista]) => {
      const ms = lista.map((a) => a.ms).sort((a, b) => a - b);
      return {
        operacao,
        chamadas: lista.length,
        recusadas: lista.filter((a) => !a.ok).length,
        p50: Math.round(percentil(ms, 50)),
        p95: Math.round(percentil(ms, 95)),
        max: Math.round(ms[ms.length - 1] ?? 0),
      };
    })
    .sort((a, b) => b.p95 - a.p95);
}

/**
 * Onde o agente lê o que aconteceu. Fora do git (`relatorios/` está no
 * `.gitignore`): é o rastro de uma rodada, não parte do código.
 */
export function gravarResultado(arquivo: string, conteudo: unknown) {
  const pasta = path.join(process.cwd(), "relatorios", "teste-do-dia");
  fs.mkdirSync(pasta, { recursive: true });
  fs.writeFileSync(path.join(pasta, arquivo), JSON.stringify(conteudo, null, 2));
}
