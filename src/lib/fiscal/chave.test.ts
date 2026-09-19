import { describe, expect, it } from "vitest";
import {
  chaveValida,
  digitoVerificador,
  formatarChave,
  gerarCodigoNumerico,
  montarChave,
} from "./chave";

/**
 * Segunda implementação do módulo 11, escrita de outra forma de propósito:
 * pesos numa lista fixa em vez de contador girando. Se as duas concordam em
 * milhares de chaves, o erro teria que estar nas duas ao mesmo tempo.
 */
function dvReferencia(chave43: string) {
  const pesos = [2, 3, 4, 5, 6, 7, 8, 9];
  const soma = chave43
    .split("")
    .reverse()
    .reduce((total, digito, i) => total + Number(digito) * pesos[i % 8], 0);

  const resto = soma % 11;
  return resto === 0 || resto === 1 ? "0" : String(11 - resto);
}

describe("dígito verificador", () => {
  it("concorda com uma implementação independente", () => {
    for (let i = 0; i < 2000; i++) {
      const chave43 = Array.from({ length: 43 }, () =>
        String(Math.floor(Math.random() * 10))
      ).join("");
      expect(digitoVerificador(chave43)).toBe(dvReferencia(chave43));
    }
  });

  it("rejeita entrada com tamanho errado", () => {
    expect(() => digitoVerificador("123")).toThrow();
  });

  it("devolve 0 quando o resto é 0 ou 1", () => {
    // O manual manda usar 0 nesses dois casos, em vez de 11 ou 10.
    const dv = digitoVerificador("0".repeat(43));
    expect(dv).toBe("0");
  });
});

describe("montagem da chave", () => {
  const base = {
    uf: "GO",
    emissao: new Date(2026, 8, 19), // setembro/2026
    cnpj: "41.277.512/0001-87",
    serie: 1,
    numero: 42,
    codigoNumerico: 12345678,
  };

  it("monta 44 dígitos", () => {
    expect(montarChave(base)).toHaveLength(44);
  });

  it("começa com o código da UF e a competência", () => {
    const chave = montarChave(base);
    expect(chave.slice(0, 2)).toBe("52"); // Goiás
    expect(chave.slice(2, 6)).toBe("2609"); // ano 26, mês 09
  });

  it("carrega CNPJ, modelo, série e número nas posições certas", () => {
    const chave = montarChave(base);
    expect(chave.slice(6, 20)).toBe("41277512000187");
    expect(chave.slice(20, 22)).toBe("65"); // modelo NFC-e
    expect(chave.slice(22, 25)).toBe("001");
    expect(chave.slice(25, 34)).toBe("000000042");
  });

  it("gera chave que passa na própria validação", () => {
    expect(chaveValida(montarChave(base))).toBe(true);
  });

  it("marca contingência no tipo de emissão", () => {
    const normal = montarChave(base);
    const contingencia = montarChave({ ...base, tipoEmissao: "9" });

    expect(normal[34]).toBe("1");
    expect(contingencia[34]).toBe("9");
    // Chaves diferentes: a mesma nota reemitida em contingência não colide.
    expect(normal).not.toBe(contingencia);
  });

  it("recusa UF inexistente e CNPJ inválido", () => {
    expect(() => montarChave({ ...base, uf: "XX" })).toThrow(/UF/);
    expect(() => montarChave({ ...base, cnpj: "123" })).toThrow(/CNPJ/);
  });

  it("detecta chave adulterada", () => {
    const chave = montarChave(base);
    // Troca um dígito do meio — é o caso que o DV existe para pegar.
    const adulterada = chave.slice(0, 30) + (Number(chave[30]) === 9 ? "0" : "9") + chave.slice(31);
    expect(chaveValida(adulterada)).toBe(false);
  });

  it("formata em blocos de 4 para o cliente digitar", () => {
    const formatada = formatarChave(montarChave(base));
    expect(formatada.split(" ")).toHaveLength(11); // 44 / 4
  });
});

describe("código numérico", () => {
  it("fica na faixa de 8 dígitos", () => {
    for (let i = 0; i < 50; i++) {
      const codigo = gerarCodigoNumerico();
      expect(codigo).toBeGreaterThanOrEqual(0);
      expect(codigo).toBeLessThan(100_000_000);
    }
  });

  it("não é sequencial", () => {
    // Sequencial permitiria adivinhar a chave da próxima nota.
    const amostra = new Set(Array.from({ length: 30 }, () => gerarCodigoNumerico()));
    expect(amostra.size).toBeGreaterThan(25);
  });
});
