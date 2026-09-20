import { describe, expect, it } from "vitest";
import { tituloDeTodasAsEstacoes } from "./estacoes";

describe("título do KDS sem filtro", () => {
  it("junta duas com &", () => {
    // O caso do Lipão: bar e cozinha.
    expect(tituloDeTodasAsEstacoes(["Bar", "Cozinha"])).toBe("Bar & Cozinha");
  });

  it("usa vírgula até a penúltima quando são três", () => {
    expect(tituloDeTodasAsEstacoes(["Bar", "Chapa", "Fritura"])).toBe("Bar, Chapa & Fritura");
  });

  it("troca os nomes pela contagem quando não cabem", () => {
    /**
     * Cinco nomes emendados viram uma faixa de texto que ninguém lê de longe,
     * e a tela do KDS é lida de longe.
     */
    expect(tituloDeTodasAsEstacoes(["Chapa", "Fritura", "Saladas", "Sobremesas", "Bar"])).toBe(
      "5 estações"
    );
  });

  it("com uma só, o nome dela basta", () => {
    expect(tituloDeTodasAsEstacoes(["Cozinha"])).toBe("Cozinha");
  });

  it("sem estação nenhuma, volta ao nome do ambiente", () => {
    // Unidade recém-criada, antes de alguém cadastrar as estações.
    expect(tituloDeTodasAsEstacoes([])).toBe("Cozinha");
  });

  it("ignora nome em branco em vez de deixar um '&' solto", () => {
    expect(tituloDeTodasAsEstacoes(["Bar", "  ", "Cozinha"])).toBe("Bar & Cozinha");
  });
});
