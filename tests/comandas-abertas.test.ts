import { describe, expect, it } from "vitest";
import { listaDeComandas, nomeDaComanda, porQueOCaixaNaoFecha } from "@/lib/comandas-abertas";

/**
 * O caixa que não fechava.
 *
 * "Ainda há 1 comanda(s) aberta(s). Feche todas antes de fechar o caixa."
 * estava certo e era inútil: a comanda que travava era de **balcão** — sem
 * mesa, e por isso ausente do mapa do salão, que só monta as que têm mesa. O
 * caixa procurava no salão inteiro uma comanda que nenhuma tela mostrava.
 */
describe("o nome de uma comanda aberta", () => {
  it("a de mesa diz a mesa", () => {
    expect(nomeDaComanda({ numero: 281, mesa: "9" })).toBe("mesa 9 (#281)");
  });

  it("a sem mesa é do balcão, e não uma mesa sem número", () => {
    expect(nomeDaComanda({ numero: 282, mesa: null })).toBe("balcão (#282)");
  });

  it("a mesa com letra sai como a casa a chama", () => {
    expect(nomeDaComanda({ numero: 283, mesa: "12A" })).toBe("mesa 12A (#283)");
  });
});

/**
 * O corte vale nos dois lugares que dizem o que falta fechar.
 *
 * A recusa do `fecharCaixa` cortava em cinco; o aviso na tela do caixa
 * juntava **todas** numa linha só. Numa casa com sessenta contas abertas, a
 * tela ficava ilegível justamente quando o caixa mais precisa dela — e as duas
 * contavam a mesma coisa de formas diferentes, que é como uma delas fica para
 * trás na próxima mudança.
 */
describe("a lista das comandas abertas", () => {
  const tantas = (quantas: number) =>
    Array.from({ length: quantas }, (_, i) => ({ numero: 300 + i, mesa: String(i + 1) }));

  it("até cinco saem todas, sem contagem", () => {
    const lista = listaDeComandas(tantas(5));

    expect(lista).toBe(
      "mesa 1 (#300), mesa 2 (#301), mesa 3 (#302), mesa 4 (#303), mesa 5 (#304)"
    );
    expect(lista).not.toContain("e mais");
  });

  it("acima de cinco, o resto vira contagem", () => {
    expect(listaDeComandas(tantas(60))).toBe(
      "mesa 1 (#300), mesa 2 (#301), mesa 3 (#302), mesa 4 (#303), mesa 5 (#304) e mais 55"
    );
  });

  /** O aviso da tela e a recusa do servidor dizem a mesma coisa. */
  it("é a mesma lista que entra na recusa do caixa", () => {
    const muitas = tantas(60);

    expect(porQueOCaixaNaoFecha(muitas)).toContain(listaDeComandas(muitas));
  });

  it("sem comanda aberta, não há lista", () => {
    expect(listaDeComandas([])).toBe("");
  });
});

describe("por que o caixa não fecha", () => {
  it("sem comanda aberta, não há o que dizer", () => {
    expect(porQueOCaixaNaoFecha([])).toBe("");
  });

  /** O caso que motivou tudo: uma só, e invisível no mapa. */
  it("uma comanda de balcão aparece pelo número", () => {
    const frase = porQueOCaixaNaoFecha([{ numero: 282, mesa: null }]);

    expect(frase).toContain("1 comanda aberta");
    expect(frase).toContain("balcão (#282)");
    expect(frase).toContain("Feche todas antes de fechar o caixa.");
  });

  it("várias saem nomeadas, na ordem em que vieram", () => {
    const frase = porQueOCaixaNaoFecha([
      { numero: 281, mesa: "9" },
      { numero: 282, mesa: null },
    ]);

    expect(frase).toContain("2 comandas abertas");
    expect(frase).toContain("mesa 9 (#281), balcão (#282)");
  });

  /**
   * Casa cheia não ganha nada com a lista inteira numa linha de aviso: as
   * primeiras cinco mostram onde procurar, e o resto vira contagem.
   */
  it("acima de cinco, o resto vira contagem", () => {
    const muitas = Array.from({ length: 8 }, (_, i) => ({
      numero: 300 + i,
      mesa: String(i + 1),
    }));

    const frase = porQueOCaixaNaoFecha(muitas);

    expect(frase).toContain("8 comandas abertas");
    expect(frase).toContain("mesa 1 (#300)");
    expect(frase).toContain("mesa 5 (#304)");
    expect(frase).toContain("e mais 3");
    expect(frase).not.toContain("#305");
  });
});
