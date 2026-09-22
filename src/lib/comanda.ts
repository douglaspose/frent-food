/** Arredonda para centavos. Trabalhar com float em dinheiro sem isso acumula erro. */
export function centavos(valor: number) {
  return Math.round(valor * 100) / 100;
}

export type TotaisEntrada = {
  itens: { precoTotal: number }[];
  taxaServicoPct: number;
  descontoValor: number;
};

/**
 * Ordem do cálculo: desconto sai do consumo, e a taxa de serviço incide sobre
 * o que sobrou. Cobrar 10% sobre um valor que o cliente não vai pagar seria
 * errado — e é uma discussão que ninguém quer ter no caixa.
 */
export function calcularTotais({ itens, taxaServicoPct, descontoValor }: TotaisEntrada) {
  const subtotal = centavos(itens.reduce((soma, i) => soma + i.precoTotal, 0));
  const desconto = centavos(Math.min(descontoValor, subtotal));
  const base = centavos(subtotal - desconto);
  const taxaServico = centavos(base * (taxaServicoPct / 100));
  const total = centavos(base + taxaServico);

  return { subtotal, desconto, base, taxaServico, total };
}

/**
 * A taxa de serviço repartida entre cozinha e atendimento.
 *
 * A cozinha leva a sua porcentagem arredondada ao centavo e o atendimento leva
 * o resto — e não a porcentagem dele arredondada também: arredondando as duas,
 * a soma podia sair um centavo acima ou abaixo do que entrou.
 */
export function dividirTaxaDeServico(total: number, parteCozinhaPct: number) {
  const cozinha = centavos(total * (parteCozinhaPct / 100));
  return { cozinha, atendimento: centavos(total - cozinha) };
}

/** Diferença tolerada ao conferir se a conta foi quitada (arredondamento de centavo). */
export const TOLERANCIA = 0.005;
