import { describe, expect, it } from "vitest";
import {
  atravessandoRestaurantes,
  comTenant,
  contextoAtual,
  declararTenant,
  semContexto,
  tenantAtual,
} from "./tenant-atual";

describe("contexto de tenant", () => {
  it("fora de qualquer escopo, não há restaurante", () => {
    semContexto(() => {
      expect(tenantAtual()).toBeUndefined();
      expect(contextoAtual()).toBeUndefined();
    });
  });

  it("comTenant vale dentro e não vaza para fora", async () => {
    await semContexto(async () => {
      await comTenant("lipao", async () => {
        expect(tenantAtual()).toBe("lipao");
      });

      expect(tenantAtual()).toBeUndefined();
    });
  });

  it("um escopo dentro do outro devolve o de dentro", async () => {
    await comTenant("lipao", async () => {
      await comTenant("boteco", async () => {
        expect(tenantAtual()).toBe("boteco");
      });

      // E o de fora volta intacto: o de dentro não o sobrescreveu.
      expect(tenantAtual()).toBe("lipao");
    });
  });

  it("sobrevive ao await — é o ponto de usar AsyncLocalStorage", async () => {
    /**
     * Uma variável de módulo passaria neste teste por acaso e falharia com
     * duas requisições simultâneas. Aqui o que se verifica é que o valor
     * acompanha a continuação, não que ele foi guardado em algum lugar.
     */
    await comTenant("lipao", async () => {
      await new Promise((r) => setTimeout(r, 5));
      expect(tenantAtual()).toBe("lipao");
    });
  });

  it("duas requisições simultâneas não se contaminam", async () => {
    const visto: string[] = [];

    const um = comTenant("lipao", async () => {
      await new Promise((r) => setTimeout(r, 10));
      visto.push(`lipao viu ${tenantAtual()}`);
    });

    const dois = comTenant("boteco", async () => {
      await new Promise((r) => setTimeout(r, 1));
      visto.push(`boteco viu ${tenantAtual()}`);
    });

    await Promise.all([um, dois]);

    expect(visto.sort()).toEqual(["boteco viu boteco", "lipao viu lipao"]);
  });

  it("segura o contexto até uma promessa preguiçosa decidir rodar", async () => {
    /**
     * A armadilha que quase passou. `db.mesa.count()` não consulta nada
     * enquanto ninguém chamar `.then()` — e num `comTenant(id, () =>
     * db.mesa.count())` quem chama é o `await` de fora, já sem contexto. O
     * banco devolvia zero linhas, sem erro, como se o restaurante fosse vazio.
     *
     * Este dublê é a promessa preguiçosa do Prisma reduzida ao osso: ele
     * anota qual era o restaurante no instante em que foi disparado.
     */
    let tenantNaHoraDeRodar: string | undefined = "ninguém perguntou";

    const preguicosa = {
      then(resolver: (v: string) => void) {
        tenantNaHoraDeRodar = tenantAtual();
        resolver("pronto");
      },
    };

    await comTenant("lipao", () => preguicosa as unknown as Promise<string>);

    expect(tenantNaHoraDeRodar).toBe("lipao");
  });

  it("atravessar restaurantes é um contexto, não a ausência de um", async () => {
    /**
     * A diferença que o adapter usa para decidir entre avisar e ficar quieto:
     * `undefined` é esquecimento, `atravessa` é decisão.
     */
    await atravessandoRestaurantes("login", async () => {
      expect(tenantAtual()).toBeUndefined();
      expect(contextoAtual()).toEqual({ tipo: "atravessa", motivo: "login" });
    });
  });

  it("declararTenant vale para baixo: quem é chamado depois enxerga", async () => {
    await semContexto(async () => {
      declararTenant("lipao");

      async function consultar() {
        await new Promise((r) => setTimeout(r, 1));
        return tenantAtual();
      }

      expect(await consultar()).toBe("lipao");
    });
  });

  it("declararTenant NÃO sobe para quem chamou, depois de um await", async () => {
    /**
     * O limite que custou caro descobrir, e que é a razão de o adapter ler o
     * restaurante do cookie em vez de esperar que alguém o declare.
     *
     * `enterWith` marca o contexto assíncrono atual. Numa função que dá
     * `await` antes de declarar — como o `lerSessao`, que espera o cookie —
     * quem a chamou já retomou num contexto criado antes da marca, e não
     * enxerga nada. Sem erro, sem aviso: as consultas só voltam vazias.
     *
     * Este teste existe para que a limitação seja um fato registrado, e não
     * uma surpresa que se repita. Se um dia ele falhar, o Node mudou e o
     * desenho pode ser simplificado.
     */
    await semContexto(async () => {
      async function autenticar() {
        await new Promise((r) => setTimeout(r, 1));
        declararTenant("lipao");
      }

      await autenticar();

      expect(tenantAtual()).toBeUndefined();
    });
  });
});
