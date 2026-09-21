import { describe, expect, it } from "vitest";
import { mascarar, paraBr, paraIso } from "./campo-de-data";

describe("máscara de data", () => {
  it("põe as barras conforme a pessoa digita", () => {
    expect(mascarar("1")).toBe("1");
    expect(mascarar("11")).toBe("11");
    expect(mascarar("110")).toBe("11/0");
    expect(mascarar("1109")).toBe("11/09");
    expect(mascarar("11092026")).toBe("11/09/2026");
  });

  it("ignora o que já está escrito e reconstrói pelos dígitos", () => {
    // É o que faz o backspace funcionar sem caso especial: some um dígito e a
    // máscara se refaz, em vez de a barra virar uma âncora que não se apaga.
    expect(mascarar("11/09/202")).toBe("11/09/202");
    expect(mascarar("11/0")).toBe("11/0");
    expect(mascarar("11/")).toBe("11");
  });

  it("aceita data colada com outro separador", () => {
    expect(mascarar("11-09-2026")).toBe("11/09/2026");
    expect(mascarar("11.09.2026")).toBe("11/09/2026");
  });

  it("não deixa passar de oito dígitos", () => {
    expect(mascarar("110920261234")).toBe("11/09/2026");
  });
});

describe("conversão entre formatos", () => {
  it("vai e volta sem trocar dia por mês", () => {
    /**
     * O erro que este arquivo existe para impedir: 11 de setembro virando 9 de
     * novembro. Num relatório, dia e mês trocados passam despercebidos até o
     * fechamento não bater.
     */
    expect(paraBr("2026-09-11")).toBe("11/09/2026");
    expect(paraIso("11/09/2026")).toBe("2026-09-11");
  });

  it("data vazia não vira texto nenhum", () => {
    expect(paraBr("")).toBe("");
  });

  it("data pela metade ainda não é data", () => {
    expect(paraIso("11/09")).toBe("");
    expect(paraIso("11/09/20")).toBe("");
    expect(paraIso("")).toBe("");
  });

  it("data impossível não vira outro dia", () => {
    // `new Date(2026, 1, 31)` viraria 3 de março sem reclamar.
    expect(paraIso("31/02/2026")).toBe("");
    expect(paraIso("31/04/2026")).toBe("");
    expect(paraIso("00/09/2026")).toBe("");
    expect(paraIso("11/13/2026")).toBe("");
  });

  it("29 de fevereiro só existe em ano bissexto", () => {
    expect(paraIso("29/02/2028")).toBe("2028-02-29");
    expect(paraIso("29/02/2026")).toBe("");
  });
});
