import { describe, expect, it } from "vitest";
import { emResultado, ErroDeOperacao, temErro } from "./erro-de-operacao";

/**
 * O que está em jogo: em produção, a mensagem de uma exceção lançada dentro de
 * uma server action não chega ao navegador — vira um código minificado do
 * React. Regra de negócio precisa voltar como valor.
 */
describe("erro de operação", () => {
  it("deixa o resultado passar quando nada falha", async () => {
    expect(await emResultado(async () => ({ ok: true }))).toEqual({ ok: true });
  });

  it("transforma a regra violada em valor de retorno", async () => {
    const r = await emResultado(async () => {
      throw new ErroDeOperacao("A gaveta tem 200,00 em dinheiro.");
    });

    expect(temErro(r)).toBe(true);
    expect(temErro(r) && r.erro).toBe("A gaveta tem 200,00 em dinheiro.");
  });

  it("deixa bug de programação subir", async () => {
    /**
     * A mensagem de um erro do Prisma traz consulta e nome de coluna. Isso não
     * vai para a tela de ninguém — o destino correto é o log do servidor e o
     * código minificado na tela.
     */
    await expect(
      emResultado(async () => {
        throw new TypeError("Cannot read properties of undefined (reading 'findMany')");
      })
    ).rejects.toThrow(TypeError);
  });

  it("não confunde resultado legítimo com erro", async () => {
    // Uma ação pode devolver qualquer objeto; só a chave `erro` com texto
    // significa falha.
    expect(temErro({ valor: 10 })).toBe(false);
    expect(temErro({ erro: 123 })).toBe(false);
    expect(temErro(null)).toBe(false);
    expect(temErro(undefined)).toBe(false);
    expect(temErro("erro")).toBe(false);
    expect(temErro({ erro: "faltou o motivo" })).toBe(true);
  });

  it("preserva o valor de retorno de uma ação que devolve dados", async () => {
    const r = await emResultado(async () => ({ caixaId: "abc" }));
    expect(temErro(r)).toBe(false);
    expect(r).toEqual({ caixaId: "abc" });
  });
});
