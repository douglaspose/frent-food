/**
 * Autorização gerencial — o vocabulário, sem nada de servidor.
 *
 * No salão, a alternativa a isto é o garçom procurar o gerente, entregar o
 * tablet, o gerente sair da própria conta, entrar, fazer, sair, e o garçom
 * entrar de novo. Na prática ninguém faz isso: ou o gerente empresta o PIN —
 * e aí todo desconto fica no nome dele — ou a regra é contornada por fora do
 * sistema. Um teclado de PIN na hora resolve em cinco segundos e deixa o
 * registro certo: feito por quem fez, liberado por quem liberou.
 */

export const TIPOS_DE_AUTORIZACAO = {
  DESCONTO: {
    permissao: "comanda.aplicarDesconto",
    titulo: "Desconto precisa de autorização",
  },
  CANCELAMENTO_ITEM: {
    permissao: "comanda.cancelarItem",
    titulo: "Cancelar item precisa de autorização",
  },
  SANGRIA: {
    permissao: "caixa.sangria",
    titulo: "Movimento de gaveta precisa de autorização",
  },
} as const;

export type TipoAutorizacao = keyof typeof TIPOS_DE_AUTORIZACAO;

/**
 * Quanto tempo a liberação vale.
 *
 * Curto de propósito: o gerente digitou o PIN e foi embora. Se o garçom
 * abandonar a tela e voltar dez minutos depois, é outra decisão — e merece
 * outra autorização.
 */
export const VALIDADE_MS = 3 * 60_000;

/**
 * O que uma ação responde quando falta permissão.
 *
 * Resultado, não exceção. Em produção o Next troca a mensagem de erro de uma
 * server action por um texto genérico, então sinalizar "precisa de aprovação"
 * por `throw` funcionaria em desenvolvimento e falharia no restaurante.
 */
export type PrecisaAutorizacao = { precisaAutorizacao: TipoAutorizacao };

export function precisaAutorizacao(r: unknown): r is PrecisaAutorizacao {
  return typeof r === "object" && r !== null && "precisaAutorizacao" in r;
}
