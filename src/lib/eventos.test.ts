import { describe, expect, it } from "vitest";
import { lerPayload, montarPayload, registrarEntrega } from "./eventos";

/**
 * O payload atravessa o Postgres como texto solto. Se `lerPayload` lançasse,
 * um aviso malformado derrubaria o ouvinte — e com ele o tempo real de todos
 * os tablets da unidade, até alguém reiniciar a aplicação.
 */
describe("payload de evento", () => {
  it("vai e volta inteiro", () => {
    const evento = { id: "e1", unidadeId: "u1", motivo: "pedido-enviado" };
    expect(lerPayload(montarPayload(evento))).toEqual(evento);
  });

  it.each([
    ["vazio", ""],
    ["indefinido", undefined],
    ["não é JSON", "{isto não fecha"],
    ["não é objeto", '"só um texto"'],
    ["nulo", "null"],
    ["sem id", '{"unidadeId":"u1","motivo":"conta"}'],
    ["sem unidade", '{"id":"e1","motivo":"conta"}'],
    ["unidade vazia", '{"id":"e1","unidadeId":"","motivo":"conta"}'],
    ["unidade não é texto", '{"id":"e1","unidadeId":123,"motivo":"conta"}'],
    ["sem motivo", '{"id":"e1","unidadeId":"u1"}'],
    ["motivo vazio", '{"id":"e1","unidadeId":"u1","motivo":""}'],
  ])("devolve null quando %s", (_caso, bruto) => {
    expect(lerPayload(bruto)).toBeNull();
  });

  it("ignora campos a mais em vez de recusar o aviso", () => {
    // Versão nova do servidor publicando para uma instância velha durante um
    // deploy: perder o aviso seria pior que ignorar o campo desconhecido.
    expect(lerPayload('{"id":"e1","unidadeId":"u1","motivo":"conta","extra":true}')).toEqual({
      id: "e1",
      unidadeId: "u1",
      motivo: "conta",
    });
  });
});

/**
 * Quem publica entrega o aviso em memória e ainda o recebe de volta pelo
 * Postgres. Sem o crivo, toda ação recarregaria a tela duas vezes.
 */
describe("entrega repetida", () => {
  it("aceita o primeiro e recusa a cópia", () => {
    expect(registrarEntrega("a")).toBe(true);
    expect(registrarEntrega("a")).toBe(false);
  });

  it("não confunde eventos diferentes", () => {
    expect(registrarEntrega("b")).toBe(true);
    expect(registrarEntrega("c")).toBe(true);
  });

  it("esquece os antigos em vez de crescer sem fim", () => {
    // Um processo de plantão por semanas não pode acumular um id por evento:
    // é vazamento de memória lento, do tipo que só aparece no sábado cheio.
    const antigo = "velho";
    expect(registrarEntrega(antigo)).toBe(true);
    for (let i = 0; i < 250; i++) registrarEntrega(`enchendo-${i}`);
    expect(registrarEntrega(antigo)).toBe(true);
  });
});
