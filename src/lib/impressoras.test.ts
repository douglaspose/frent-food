import { describe, expect, it } from "vitest";
import { conexaoValida, conferirEndereco, precisaEndereco } from "./impressoras";

/**
 * O endereço que o agente vai usar.
 *
 * Ele faz `endereco.split(":")` e cai na porta 9100 quando não há número. O
 * que o cadastro aceitar errado não aparece no cadastro: aparece como papel
 * que não sai, num sábado, sem ninguém ligar uma coisa à outra.
 */
describe("o endereço da impressora de rede", () => {
  it("aceita IP, com e sem porta", () => {
    expect(conferirEndereco("192.168.0.10")).toEqual({ endereco: "192.168.0.10" });
    expect(conferirEndereco(" 192.168.0.10:9100 ")).toEqual({ endereco: "192.168.0.10:9100" });
  });

  /** Algumas térmicas aparecem por nome no roteador da casa. */
  it("aceita nome de máquina", () => {
    expect(conferirEndereco("elgin-cozinha")).toEqual({ endereco: "elgin-cozinha" });
    expect(conferirEndereco("elgin.local:9100")).toEqual({ endereco: "elgin.local:9100" });
  });

  it("recusa o que o agente não saberia usar", () => {
    const erroDe = (v: string) => {
      const r = conferirEndereco(v);
      return "erro" in r ? r.erro : null;
    };

    expect(erroDe("")).toContain("Informe o endereço");
    expect(erroDe("http://192.168.0.10")).toContain("sem http://");
    expect(erroDe("192.168.0.10/fila")).toContain("sem http://");
    expect(erroDe("192.168.0.10:9100:1")).toContain("host ou host:porta");
    expect(erroDe("192.168.0.300")).toContain("até 255");
    expect(erroDe("192.168.0.10:99999")).toContain("1 a 65535");
    expect(erroDe("impressora da cozinha")).toContain("não leva espaços");
  });
});

describe("a conexão", () => {
  it("é uma das três, e só a de rede pede endereço", () => {
    expect(conexaoValida("rede")).toBe(true);
    expect(conexaoValida("bluetooth")).toBe(false);
    expect(precisaEndereco("rede")).toBe(true);
    expect(precisaEndereco("usb")).toBe(false);
    // Conexão desconhecida não pede endereço: quem a recusa é o `conexaoValida`,
    // e duas recusas para o mesmo erro só confundem quem lê a tela.
    expect(precisaEndereco("bluetooth")).toBe(false);
  });
});
