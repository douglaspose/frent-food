import { beforeEach, describe, expect, it } from "vitest";
import { limparFalhas, registrarFalha, verificar, zerarTudo } from "./limite-tentativas";

beforeEach(() => zerarTudo());

describe("limite de tentativas", () => {
  it("começa liberado", () => {
    expect(verificar("ip-1")).toEqual({ bloqueado: false, restantes: 5 });
  });

  it("conta as falhas e avisa quantas faltam", () => {
    expect(registrarFalha("ip-1")).toEqual({ bloqueado: false, restantes: 4 });
    expect(registrarFalha("ip-1")).toEqual({ bloqueado: false, restantes: 3 });
  });

  it("bloqueia na quinta tentativa", () => {
    for (let i = 0; i < 4; i++) registrarFalha("ip-1");
    const veredito = registrarFalha("ip-1");

    expect(veredito.bloqueado).toBe(true);
    if (veredito.bloqueado) expect(veredito.segundosRestantes).toBeGreaterThan(0);
  });

  it("não contamina outra origem", () => {
    for (let i = 0; i < 5; i++) registrarFalha("ip-1");
    expect(verificar("ip-2").bloqueado).toBe(false);
  });

  it("libera quando a janela vence", () => {
    const agora = Date.now();
    for (let i = 0; i < 5; i++) registrarFalha("ip-1", agora);
    expect(verificar("ip-1", agora).bloqueado).toBe(true);

    const depois = agora + 16 * 60 * 1000;
    expect(verificar("ip-1", depois).bloqueado).toBe(false);
  });

  it("zera o contador no acerto", () => {
    for (let i = 0; i < 3; i++) registrarFalha("ip-1");
    limparFalhas("ip-1");
    expect(verificar("ip-1")).toEqual({ bloqueado: false, restantes: 5 });
  });
});
