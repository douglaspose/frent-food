import { describe, expect, it } from "vitest";
import { dinheiroNaGaveta, saldoDeMovimentos } from "./caixa";

/**
 * Este é o número que o operador confere contando cédula no fim do turno. Se
 * ele estiver errado, a divergência do fechamento deixa de significar o que
 * promete — e aí não adianta mais nada: ninguém confia num caixa que acusa
 * falta todo dia.
 */
describe("dinheiro na gaveta", () => {
  it("é o fundo mais o que entrou em dinheiro", () => {
    expect(
      dinheiroNaGaveta({ fundoCaixa: 200, recebidoEmEspecie: 316.39, movimentos: [] })
    ).toBe(516.39);
  });

  it("a sangria sai da gaveta", () => {
    // O caso que motivou tudo: gerente leva R$ 2.000 para o cofre no meio do
    // turno. Sem registrar, o fechamento acusaria falta de dois mil reais.
    expect(
      dinheiroNaGaveta({
        fundoCaixa: 200,
        recebidoEmEspecie: 2500,
        movimentos: [{ tipo: "SANGRIA", valor: 2000 }],
      })
    ).toBe(700);
  });

  it("o suprimento entra", () => {
    expect(
      dinheiroNaGaveta({
        fundoCaixa: 200,
        recebidoEmEspecie: 0,
        movimentos: [{ tipo: "SUPRIMENTO", valor: 150 }],
      })
    ).toBe(350);
  });

  it("pagamento pela gaveta sai; recebimento entra", () => {
    expect(
      dinheiroNaGaveta({
        fundoCaixa: 100,
        recebidoEmEspecie: 0,
        movimentos: [
          { tipo: "PAGAMENTO", valor: 80 },
          { tipo: "RECEBIMENTO", valor: 30 },
        ],
      })
    ).toBe(50);
  });

  it("cartão e Pix não passam pela gaveta", () => {
    // Quem chama já entrega só o líquido em espécie — este teste trava o
    // contrato: a função não tem como saber a forma de pagamento.
    expect(dinheiroNaGaveta({ fundoCaixa: 200, recebidoEmEspecie: 0, movimentos: [] })).toBe(200);
  });

  it("não acumula erro de float somando muitos movimentos", () => {
    const movimentos = Array.from({ length: 30 }, () => ({ tipo: "SANGRIA", valor: 0.1 }));
    expect(
      dinheiroNaGaveta({ fundoCaixa: 10, recebidoEmEspecie: 0, movimentos })
    ).toBe(7);
  });
});

describe("saldo dos movimentos", () => {
  it("é zero quando não houve nenhum", () => {
    expect(saldoDeMovimentos([])).toBe(0);
  });

  it("compensa entrada e saída do mesmo valor", () => {
    expect(
      saldoDeMovimentos([
        { tipo: "SANGRIA", valor: 500 },
        { tipo: "SUPRIMENTO", valor: 500 },
      ])
    ).toBe(0);
  });

  it("tipo desconhecido entra como crédito, não derruba a conta", () => {
    // Um tipo novo no enum que ninguém ligou aqui não pode fazer o caixa
    // parar de fechar; o pior caso é aparecer como entrada e ser corrigido.
    expect(saldoDeMovimentos([{ tipo: "TIPO_QUE_NAO_EXISTE", valor: 10 }])).toBe(10);
  });
});
