import { describe, expect, it } from "vitest";
import { padroes, PARAMETROS, POR_CHAVE, valorDoParametro } from "./parametros";

/**
 * O catálogo é lido pelo seed, pela tela de ajustes e pelo código que decide
 * comportamento. Um valor torto aqui não dá erro em lugar nenhum — vira um
 * alerta que nunca acende ou um limite que barra tudo.
 */
describe("catálogo de parâmetros", () => {
  it("não tem chave repetida", () => {
    expect(POR_CHAVE.size).toBe(PARAMETROS.length);
  });

  it("todo número tem faixa declarada", () => {
    // Sem min/max, a tela aceitaria "0" no alerta de atraso e a cozinha
    // ficaria vermelha desde o primeiro segundo.
    for (const p of PARAMETROS.filter((x) => x.tipo === "inteiro")) {
      expect(p.min, p.chave).toBeTypeOf("number");
      expect(p.max, p.chave).toBeTypeOf("number");
      expect(p.padrao, p.chave).toBeGreaterThanOrEqual(p.min!);
      expect(p.padrao, p.chave).toBeLessThanOrEqual(p.max!);
    }
  });

  it("todo parâmetro explica o que muda", () => {
    // Um interruptor sem explicação vira adivinhação, e o gerente liga para
    // descobrir — no meio do serviço.
    for (const p of PARAMETROS) {
      expect(p.rotulo.length, p.chave).toBeGreaterThan(0);
      expect(p.explicacao.length, p.chave).toBeGreaterThan(20);
    }
  });

  it("o padrão bate com o tipo declarado", () => {
    for (const p of PARAMETROS) {
      expect(typeof p.padrao, p.chave).toBe(p.tipo === "bool" ? "boolean" : "number");
    }
  });

  it("padroes() devolve o catálogo inteiro", () => {
    expect(Object.keys(padroes())).toHaveLength(PARAMETROS.length);
  });
});

describe("leitura de valor gravado", () => {
  it("aceita o valor certo", () => {
    expect(valorDoParametro("kds.alertaAtrasoMin", 35)).toBe(35);
    expect(valorDoParametro("caixa.exigirMotivoDesconto", false)).toBe(false);
  });

  it.each([
    ["texto no lugar de booleano", "caixa.exigirMotivoDesconto", "sim", true],
    ["nulo", "caixa.exigirMotivoDesconto", null, true],
    ["número no lugar de booleano", "caixa.exigirMotivoDesconto", 1, true],
    ["texto não numérico", "kds.alertaAtrasoMin", "vinte", 20],
    ["nulo em número", "kds.alertaAtrasoMin", null, 20],
  ])("cai no padrão com %s", (_caso, chave, bruto, esperado) => {
    // O campo é Json: qualquer coisa pode ter sido gravada ali, inclusive por
    // uma versão anterior do sistema.
    expect(valorDoParametro(chave as string, bruto)).toBe(esperado);
  });

  it("prende o número na faixa em vez de aceitar absurdo", () => {
    expect(valorDoParametro("kds.alertaAtrasoMin", 0)).toBe(1);
    expect(valorDoParametro("kds.alertaAtrasoMin", 9999)).toBe(120);
    expect(valorDoParametro("cozinha.qtdMaximaPorLancamento", -5)).toBe(1);
  });

  it("arredonda fração: não existe meio minuto de alerta", () => {
    expect(valorDoParametro("kds.alertaAtrasoMin", 20.7)).toBe(21);
  });

  it("aceita texto numérico, que é o que vem de um campo de formulário", () => {
    expect(valorDoParametro("kds.alertaAtrasoMin", "35")).toBe(35);
  });

  it("chave fora do catálogo não derruba a leitura", () => {
    expect(valorDoParametro("inventada", true)).toBe(true);
    expect(valorDoParametro("inventada", { objeto: 1 })).toBe(false);
  });
});
