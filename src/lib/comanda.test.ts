import { describe, expect, it } from "vitest";
import { calcularTotais, centavos, dividirTaxaDeServico } from "./comanda";

describe("centavos", () => {
  it("arredonda para duas casas", () => {
    expect(centavos(10.004)).toBe(10);
    expect(centavos(10.005)).toBe(10.01);
    expect(centavos(178.09 / 4)).toBe(44.52);
  });

  it("não acumula erro de ponto flutuante", () => {
    // 0.1 + 0.2 = 0.30000000000000004 em float; somando preços isso vira
    // diferença de centavo no fechamento do caixa.
    expect(centavos(0.1 + 0.2)).toBe(0.3);
  });
});

describe("calcularTotais", () => {
  const itens = [{ precoTotal: 119.9 }, { precoTotal: 35 }, { precoTotal: 7 }];

  it("soma o consumo e aplica a taxa de serviço", () => {
    const t = calcularTotais({ itens, taxaServicoPct: 10, descontoValor: 0 });
    expect(t.subtotal).toBe(161.9);
    expect(t.taxaServico).toBe(16.19);
    expect(t.total).toBe(178.09);
  });

  it("cobra a taxa sobre o valor já descontado, não sobre o cheio", () => {
    const t = calcularTotais({ itens: [{ precoTotal: 43.8 }], taxaServicoPct: 10, descontoValor: 3.8 });
    expect(t.base).toBe(40);
    expect(t.taxaServico).toBe(4); // e não 4,38
    expect(t.total).toBe(44);
  });

  it("não cobra taxa quando ela é retirada", () => {
    const t = calcularTotais({ itens, taxaServicoPct: 0, descontoValor: 0 });
    expect(t.taxaServico).toBe(0);
    expect(t.total).toBe(161.9);
  });

  it("limita o desconto ao valor do consumo", () => {
    // Desconto maior que a conta não pode gerar total negativo — o restaurante
    // não paga o cliente para comer.
    const t = calcularTotais({ itens, taxaServicoPct: 10, descontoValor: 500 });
    expect(t.desconto).toBe(161.9);
    expect(t.total).toBe(0);
  });

  it("devolve zero para comanda sem itens", () => {
    const t = calcularTotais({ itens: [], taxaServicoPct: 10, descontoValor: 0 });
    expect(t.total).toBe(0);
  });

  it("mantém o total exato com muitos itens de centavo quebrado", () => {
    const muitos = Array.from({ length: 30 }, () => ({ precoTotal: 12.33 }));
    const t = calcularTotais({ itens: muitos, taxaServicoPct: 10, descontoValor: 0 });
    expect(t.subtotal).toBe(369.9);
    expect(t.total).toBe(406.89);
  });
});

describe("divisão da taxa de serviço", () => {
  it("4% da conta para a cozinha e 6% para o atendimento, com a taxa de 10%", () => {
    // Conta de R$ 200 com 10%: R$ 20 de taxa.
    expect(dividirTaxaDeServico(20, 40)).toEqual({ cozinha: 8, atendimento: 12 });
  });

  it("as duas partes somam exatamente o que entrou, mesmo com centavo quebrado", () => {
    for (const total of [0.01, 0.05, 4.17, 13.33, 999.99]) {
      const { cozinha, atendimento } = dividirTaxaDeServico(total, 40);
      expect(centavos(cozinha + atendimento)).toBe(total);
    }
  });

  it("zero para a cozinha deixa tudo no atendimento", () => {
    expect(dividirTaxaDeServico(35.5, 0)).toEqual({ cozinha: 0, atendimento: 35.5 });
  });
});
