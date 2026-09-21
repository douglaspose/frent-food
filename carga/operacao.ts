import { calcularTotais, centavos } from "@/lib/comanda";
import { entrarComPin } from "@/app/login/actions";
import { pedirAutorizacao } from "@/app/pdv/autorizacao-actions";
import { admin } from "./admin";
import { medir } from "./medicao";
import { como, ehRedirecionamento, type Pessoa } from "./usuarios-virtuais";

/**
 * Os gestos de quem trabalha no salão, feitos pelas server actions de verdade.
 *
 * Cada função aqui é o que uma tela faz quando alguém toca num botão — com a
 * mesma sequência de chamadas, a mesma resposta a "precisa de autorização" e a
 * mesma medição de tempo. O simulador escreve o dia em termos disto, e não em
 * chamadas soltas.
 */

/** Sorteio com semente: um dia que falhou pode ser repetido igual. */
export function sorteador(semente: number) {
  let s = semente >>> 0;
  const proximo = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    numero: proximo,
    inteiro: (min: number, max: number) => min + Math.floor(proximo() * (max - min + 1)),
    chance: (p: number) => proximo() < p,
    um: <T>(lista: readonly T[]) => lista[Math.floor(proximo() * lista.length)]!,
  };
}

export type Sorteio = ReturnType<typeof sorteador>;

/**
 * Tudo o que deu errado no dia, agrupado por gesto e por motivo.
 *
 * Existe porque o primeiro bug achado pelo simulador — dois garçons abrindo
 * mesa no mesmo instante — derrubava o dia inteiro e escondia todos os outros.
 * Caçador de bugs não pode parar no primeiro: anota, segue, e no fim mostra a
 * lista toda com quantas vezes cada coisa aconteceu.
 */
export const ocorrencias = new Map<string, { vezes: number; onde: string; exemplo: string }>();

/**
 * A linha que diz o que aconteceu, não o romance.
 *
 * Erro do Prisma vem com a consulta inteira, o trecho de código e o caminho do
 * arquivo gerado; o que importa costuma ser a última linha ("Unique
 * constraint failed on ..."). E o primeiro ponto do `src/` na pilha diz onde
 * olhar — é por ali que o agente começa a procurar a causa.
 */
function resumir(e: unknown) {
  const texto = e instanceof Error ? e.message : String(e);
  const linhas = texto.split("\n").map((l) => l.trim()).filter(Boolean);
  const motivo = (linhas[linhas.length - 1] ?? texto).slice(0, 200);
  const pilha = e instanceof Error ? (e.stack ?? "") : "";
  const onde = pilha.split("\n").find((l) => /src[\\/](app|lib)/.test(l))?.trim() ?? "";
  return { motivo, onde: onde.replace(/^at\s+/, "").slice(0, 160) };
}

function anotar(gesto: string, motivo: string, onde: string) {
  const chave = `${gesto} — ${motivo}`;
  const atual = ocorrencias.get(chave);
  if (atual) atual.vezes++;
  else ocorrencias.set(chave, { vezes: 1, onde, exemplo: motivo });
}

/** Recusa de regra de negócio: tentar de novo não muda a resposta. */
export class Recusa extends Error {}

/**
 * Um gesto de alguém no salão: a action de verdade, como aquela pessoa,
 * medida — e com a insistência de quem está trabalhando.
 *
 * Se a tela der erro de sistema, a pessoa toca de novo, como faria de verdade;
 * cada tentativa que falhou fica anotada. Recusa de regra ("comanda já paga")
 * não se repete: é resposta, não falha — e num fluxo honesto não deveria
 * aparecer, então também é anotada.
 */
export async function passo<T>(
  quem: Pessoa,
  gesto: string,
  fn: () => Promise<T>,
  tentativas = 3
): Promise<Exclude<T, { erro: string }>> {
  for (let t = 1; ; t++) {
    let r: T;
    try {
      r = await como(quem, () => medir(gesto, fn));
    } catch (e) {
      const { motivo, onde } = resumir(e);
      anotar(gesto, motivo, onde);
      if (t >= tentativas) throw e;
      continue;
    }
    if (r && typeof r === "object" && "erro" in r) {
      const motivo = (r as { erro: string }).erro;
      anotar(gesto, `recusado: ${motivo}`, "");
      throw new Recusa(`${gesto}: ${motivo}`);
    }
    return r as Exclude<T, { erro: string }>;
  }
}

/** Login pelo PIN, pela action de verdade. O cookie fica no pote da pessoa. */
export async function entrar(quem: Pessoa) {
  await como(quem, () =>
    medir("login por PIN", async () => {
      try {
        const r = await entrarComPin(quem.pin);
        if (r?.erro) throw new Error(`login de ${quem.nome} recusado: ${r.erro}`);
      } catch (e) {
        // O redirect para /pdv é o sinal de sucesso.
        if (!ehRedirecionamento(e)) throw e;
      }
    })
  );
  if (!quem.cookies.get("sessao")) throw new Error(`login de ${quem.nome} não gravou a sessão`);
}

/**
 * Faz uma operação que pode pedir PIN de gerente, e dá o PIN quando pede —
 * exatamente o fluxo da tela: tenta, recebe "precisa de autorização", o
 * gerente digita o PIN no aparelho do garçom, a operação é refeita com a
 * liberação.
 */
export async function comAutorizacao<T>(
  quem: Pessoa,
  aprovador: Pessoa,
  tipo: "DESCONTO" | "CANCELAMENTO_ITEM" | "SANGRIA",
  referenciaId: string,
  gesto: string,
  operacao: (autorizacaoId?: string) => Promise<T>
): Promise<{ resultado: Exclude<T, { erro: string }>; pediuPin: boolean }> {
  const pedePin = (r: unknown) => Boolean(r && typeof r === "object" && "precisaAutorizacao" in r);

  const primeira = await passo(quem, gesto, () => operacao());
  if (!pedePin(primeira)) return { resultado: primeira, pediuPin: false };

  const aprovacao = await passo(quem, "aprovação por PIN", () =>
    pedirAutorizacao(tipo, referenciaId, aprovador.pin)
  );
  if (!aprovacao.ok) {
    anotar("aprovação por PIN", `recusada: ${aprovacao.motivo}`, "");
    throw new Recusa(`PIN de ${aprovador.nome} recusado: ${aprovacao.motivo}`);
  }

  const segunda = await passo(quem, gesto, () => operacao(aprovacao.id));
  if (pedePin(segunda)) {
    anotar(gesto, "pediu PIN de novo com a liberação em mãos", "");
    throw new Recusa(`${gesto}: a liberação aprovada não foi aceita`);
  }
  return { resultado: segunda, pediuPin: true };
}

/**
 * Quanto a comanda deve, pela mesma regra da tela de fechamento.
 *
 * Lido como dono do banco, porque é a conta que o simulador confere — não a
 * que o sistema diz. Se as duas divergirem, o erro aparece na conferência.
 */
export async function quantoDeve(comandaId: string) {
  const comanda = await admin.comanda.findUniqueOrThrow({
    where: { id: comandaId },
    include: {
      itens: { where: { status: { not: "CANCELADO" } } },
      pagamentos: true,
    },
  });
  const totais = calcularTotais({
    itens: comanda.itens.map((i) => ({ precoTotal: Number(i.precoTotal) })),
    taxaServicoPct: Number(comanda.taxaServicoPct),
    descontoValor: Number(comanda.descontoValor),
  });
  const pago = centavos(
    comanda.pagamentos.reduce((s, p) => s + Number(p.valor) - Number(p.troco), 0)
  );
  return { ...totais, pago, falta: centavos(totais.total - pago) };
}
