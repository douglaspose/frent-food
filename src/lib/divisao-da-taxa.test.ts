import { describe, expect, it } from "vitest";
import { centavos } from "./comanda";
import { dividirTaxa, lerDivisao, validarDivisao } from "./divisao-da-taxa";

describe("divisão da taxa de serviço", () => {
  it("atendimento e cozinha: 4% e 6% da conta, com a taxa de 10%", () => {
    // Conta de R$ 200 com 10%: R$ 20 de taxa.
    const areas = [
      { nome: "Cozinha", pct: 40 },
      { nome: "Atendimento", pct: 60 },
    ];
    expect(dividirTaxa(20, areas).map((a) => a.valor)).toEqual([8, 12]);
  });

  it("uma área só leva tudo", () => {
    expect(dividirTaxa(35.5, [{ nome: "Atendimento", pct: 100 }])).toEqual([
      { nome: "Atendimento", pct: 100, valor: 35.5 },
    ]);
  });

  it("as partes somam exatamente o que entrou, mesmo com centavo quebrado", () => {
    const tres = [
      { nome: "Atendimento", pct: 34 },
      { nome: "Cozinha", pct: 33 },
      { nome: "Gerência", pct: 33 },
    ];
    for (const total of [0.01, 0.05, 4.17, 13.33, 999.99, 4524.59]) {
      const soma = dividirTaxa(total, tres).reduce((s, a) => s + a.valor, 0);
      expect(centavos(soma), `total ${total}`).toBe(total);
    }
  });

  it("sem áreas, não divide", () => {
    expect(dividirTaxa(100, [])).toEqual([]);
    expect(validarDivisao([])).toBeNull();
  });
});

describe("o que a casa pode salvar", () => {
  it.each([
    ["soma abaixo de 100", [{ nome: "Cozinha", pct: 40 }], /somam 40%/],
    ["soma acima de 100", [{ nome: "A", pct: 60 }, { nome: "B", pct: 60 }], /somam 120%/],
    ["nome vazio", [{ nome: "  ", pct: 100 }], /nome/],
    ["nome repetido", [{ nome: "Cozinha", pct: 50 }, { nome: "cozinha ", pct: 50 }], /duas vezes/],
    ["parte quebrada", [{ nome: "A", pct: 50.5 }, { nome: "B", pct: 49.5 }], /inteiro/],
    ["parte zero", [{ nome: "A", pct: 0 }, { nome: "B", pct: 100 }], /inteiro/],
    ["NaN", [{ nome: "A", pct: Number.NaN }], /inteiro/],
    ["nome enorme", [{ nome: "x".repeat(41), pct: 100 }], /40 letras/],
    [
      "áreas demais",
      Array.from({ length: 11 }, (_, i) => ({ nome: `Área ${i}`, pct: i === 0 ? 90 : 1 })),
      /No máximo/,
    ],
  ])("recusa %s", (_caso, areas, motivo) => {
    expect(validarDivisao(areas)).toMatch(motivo);
  });

  it("aceita três áreas que somam 100", () => {
    expect(
      validarDivisao([
        { nome: "Atendimento", pct: 50 },
        { nome: "Cozinha", pct: 40 },
        { nome: "Gerência", pct: 10 },
      ])
    ).toBeNull();
  });
});

describe("leitura do banco", () => {
  it("valor torto vira sem divisão, nunca uma repartição inventada", () => {
    expect(lerDivisao(null)).toEqual([]);
    expect(lerDivisao("40")).toEqual([]);
    expect(lerDivisao([{ nome: "Cozinha", pct: 40 }])).toEqual([]);
    expect(lerDivisao([{ nome: "Cozinha" }, { pct: 100 }])).toEqual([]);
  });

  it("divisão válida volta como foi salva", () => {
    const salva = [
      { nome: "Cozinha", pct: 40 },
      { nome: "Atendimento", pct: 60 },
    ];
    expect(lerDivisao(salva)).toEqual(salva);
  });
});
