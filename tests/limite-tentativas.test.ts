import { beforeEach, describe, expect, it } from "vitest";
import { limparFalhas, registrarFalha, verificar, zerarTudo } from "@/lib/limite-tentativas";

/**
 * O freio é o que separa um PIN de 4 dígitos de uma senha adivinhável: são 10
 * mil combinações, e sem freio um script as percorre em minutos.
 *
 * Estes testes moram em `tests/` e não mais em `src/lib/` porque o estado saiu
 * da memória do processo e foi para o Postgres — que é o ponto da mudança.
 */
beforeEach(() => zerarTudo());

describe("limite de tentativas", () => {
  it("começa liberado", async () => {
    expect(await verificar("ip-1")).toEqual({ bloqueado: false, restantes: 5 });
  });

  it("conta as falhas e avisa quantas faltam", async () => {
    expect(await registrarFalha("ip-1")).toEqual({ bloqueado: false, restantes: 4 });
    expect(await registrarFalha("ip-1")).toEqual({ bloqueado: false, restantes: 3 });
  });

  it("bloqueia na quinta tentativa", async () => {
    for (let i = 0; i < 4; i++) await registrarFalha("ip-1");
    const veredito = await registrarFalha("ip-1");

    expect(veredito.bloqueado).toBe(true);
    if (veredito.bloqueado) expect(veredito.segundosRestantes).toBeGreaterThan(0);
  });

  it("não contamina outra origem", async () => {
    for (let i = 0; i < 5; i++) await registrarFalha("ip-1");
    expect((await verificar("ip-2")).bloqueado).toBe(false);
  });

  it("libera quando a janela vence", async () => {
    const agora = Date.now();
    for (let i = 0; i < 5; i++) await registrarFalha("ip-1", agora);
    expect((await verificar("ip-1", agora)).bloqueado).toBe(true);

    const depois = agora + 16 * 60 * 1000;
    expect((await verificar("ip-1", depois)).bloqueado).toBe(false);
  });

  it("volta a contar do um depois da janela vencida", async () => {
    /**
     * A linha não é apagada quando a janela vence — ela é reaproveitada. Se o
     * `CASE` do upsert errasse, a tentativa seguinte continuaria de onde a
     * anterior parou e bloquearia alguém que já cumpriu o castigo.
     */
    const agora = Date.now();
    for (let i = 0; i < 5; i++) await registrarFalha("ip-1", agora);

    const depois = agora + 16 * 60 * 1000;
    expect(await registrarFalha("ip-1", depois)).toEqual({ bloqueado: false, restantes: 4 });
  });

  it("zera o contador no acerto", async () => {
    for (let i = 0; i < 3; i++) await registrarFalha("ip-1");
    await limparFalhas("ip-1");
    expect(await verificar("ip-1")).toEqual({ bloqueado: false, restantes: 5 });
  });

  it("cinco tentativas ao mesmo tempo custam cinco, não uma", async () => {
    /**
     * A razão de a contagem ter saído da memória.
     *
     * Ler-somar-gravar em três passos deixaria as cinco lerem zero e gravarem
     * um: cinco tentativas pelo preço de uma, que é o que um ataque em
     * paralelo procura. O upsert atômico faz o banco serializar no bloqueio da
     * linha, e a quinta chega bloqueada mesmo saindo todas juntas.
     */
    const simultaneas = await Promise.all(
      Array.from({ length: 5 }, () => registrarFalha("ip-paralelo"))
    );

    const restantes = simultaneas
      .map((v) => (v.bloqueado ? -1 : v.restantes))
      .sort((a, b) => b - a);

    // Cada uma recebeu um veredito diferente: 4, 3, 2, 1 e a última bloqueada.
    expect(restantes).toEqual([4, 3, 2, 1, -1]);
    expect((await verificar("ip-paralelo")).bloqueado).toBe(true);
  });
});
