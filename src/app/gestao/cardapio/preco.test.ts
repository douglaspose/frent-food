import { describe, expect, it } from "vitest";
import { lerPreco } from "./cardapio-editor";

/**
 * Este campo grava preço de venda. Errar a leitura por um fator de cem não dá
 * erro em lugar nenhum — vira uma conta absurda no caixa, horas depois.
 */
describe("leitura do preço digitado", () => {
  it.each([
    ["17,50", 17.5],
    ["1.890,00", 1890],
    ["1.234.567,89", 1234567.89],
    ["0,90", 0.9],
  ])("notação brasileira: %s", (texto, esperado) => {
    expect(lerPreco(texto)).toBe(esperado);
  });

  it.each([
    // O caso que quebrou: teclado numérico manda ponto no lugar da vírgula.
    ["18.90", 18.9],
    ["7.5", 7.5],
    ["119.99", 119.99],
  ])("ponto como decimal: %s", (texto, esperado) => {
    expect(lerPreco(texto)).toBe(esperado);
  });

  it.each([
    // Três casas depois do ponto não é centavo: é separador de milhar.
    ["1.890", 1890],
    ["12.000", 12000],
  ])("ponto como milhar: %s", (texto, esperado) => {
    expect(lerPreco(texto)).toBe(esperado);
  });

  it.each([
    ["inteiro", "25", 25],
    ["com R$", "R$ 17,50", 17.5],
    ["com espaços", "  18.90  ", 18.9],
  ])("aceita %s", (_caso, texto, esperado) => {
    expect(lerPreco(texto)).toBe(esperado);
  });

  it.each([["", ""], ["só espaço", " "], ["texto", "abc"]])(
    "devolve NaN para %s",
    (_caso, texto) => {
      // NaN barra a gravação lá em cima: preço em branco não vira zero.
      expect(lerPreco(texto)).toBeNaN();
    }
  );
});
