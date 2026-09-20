import type { PrismaPg } from "@prisma/adapter-pg";
import { describe, expect, it } from "vitest";
import { comIsolamentoDeTenant } from "./adaptador-rls";
import { atravessandoRestaurantes, comTenant, semContexto } from "./tenant-atual";

/**
 * Estes testes usam um adapter de mentira, e não o Postgres, de propósito.
 *
 * O que precisa ser provado aqui é a coreografia — abriu transação, declarou o
 * restaurante, rodou, confirmou; e desfez quando deu errado. Com banco de
 * verdade isso só apareceria indiretamente, como "a consulta voltou vazia", e
 * um erro na ordem dos comandos seria quase impossível de localizar.
 *
 * Que o Postgres respeita a declaração é assunto de `npm run rls:verificar`.
 */

const RESULTADO = { columnTypes: [], columnNames: [], rows: [] };

function adaptadorFalso() {
  const registro: string[] = [];

  const tx = {
    /**
     * `usePhantomQuery: false` é o que o `@prisma/adapter-pg` de verdade
     * declara: o `COMMIT` é responsabilidade de quem abriu a transação, não do
     * `commit()` — que só devolve a conexão ao pool.
     */
    options: { usePhantomQuery: false },
    queryRaw: async (c: { sql: string }) => {
      registro.push(`tx.consulta(${c.sql})`);
      return RESULTADO;
    },
    executeRaw: async (c: { sql: string; args: unknown[] }) => {
      const parametro = c.args.length > 0 ? ` <- ${String(c.args[0])}` : "";
      registro.push(`tx.comando(${c.sql}${parametro})`);
      return 1;
    },
    commit: async () => void registro.push("solta a conexão"),
    rollback: async () => void registro.push("solta a conexão"),
  };

  const adaptador = {
    provider: "postgres",
    adapterName: "@prisma/adapter-pg",
    queryRaw: async (c: { sql: string }) => {
      registro.push(`consulta(${c.sql})`);
      return RESULTADO;
    },
    executeRaw: async (c: { sql: string }) => {
      registro.push(`comando(${c.sql})`);
      return 1;
    },
    startTransaction: async () => {
      registro.push("abre");
      return tx;
    },
    executeScript: async () => {},
    dispose: async () => {},
  };

  // O adapter real tem membros privados; um dublê só consegue vestir a forma.
  const fabrica = {
    provider: "postgres",
    adapterName: "@prisma/adapter-pg",
    connect: async () => adaptador,
  } as unknown as PrismaPg;

  return { fabrica, registro, tx };
}

describe("adapter com isolamento por tenant", () => {
  it("com restaurante declarado, cada consulta ganha sua transação", async () => {
    const { fabrica, registro } = adaptadorFalso();
    const adaptador = await comIsolamentoDeTenant(fabrica).connect();

    await comTenant("lipao", () => adaptador.queryRaw({ sql: "select 1", args: [], argTypes: [] }));

    expect(registro).toEqual([
      "abre",
      "tx.comando(select set_config('app.tenant_id', $1, true) <- lipao)",
      "tx.consulta(select 1)",
      "tx.comando(COMMIT)",
      "solta a conexão",
    ]);
  });

  it("o id do restaurante vai como parâmetro, nunca concatenado no SQL", async () => {
    /**
     * Um id vindo de subdomínio é entrada de fora. Concatenar seria injeção de
     * SQL no lugar mais sensível do sistema — a linha que decide de quem são
     * os dados.
     */
    const { fabrica, registro } = adaptadorFalso();
    const adaptador = await comIsolamentoDeTenant(fabrica).connect();

    const malicioso = "x'; drop table comandas; --";
    await comTenant(malicioso, () =>
      adaptador.queryRaw({ sql: "select 1", args: [], argTypes: [] })
    );

    const declaracao = registro.find((l) => l.includes("set_config"))!;
    expect(declaracao).toContain("$1");
    expect(declaracao).toContain(`<- ${malicioso}`);
    expect(declaracao).not.toContain("drop table comandas;'");
  });

  it("declara com set_config local, que morre no commit", async () => {
    /**
     * Com `false` no terceiro argumento a variável ficaria grudada na conexão,
     * e o próximo a pegá-la no pool herdaria o restaurante do anterior. É o
     * vazamento exato que este arquivo existe para impedir.
     */
    const { fabrica, registro } = adaptadorFalso();
    const adaptador = await comIsolamentoDeTenant(fabrica).connect();

    await comTenant("lipao", () => adaptador.queryRaw({ sql: "select 1", args: [], argTypes: [] }));

    expect(registro.some((l) => l.includes("set_config('app.tenant_id', $1, true)"))).toBe(true);
  });

  it("consulta que falha desfaz a transação e deixa o erro subir", async () => {
    const { fabrica, registro, tx } = adaptadorFalso();
    tx.queryRaw = async () => {
      throw new Error("coluna inexistente");
    };
    const adaptador = await comIsolamentoDeTenant(fabrica).connect();

    await expect(
      comTenant("lipao", () => adaptador.queryRaw({ sql: "select nada", args: [], argTypes: [] }))
    ).rejects.toThrow("coluna inexistente");

    expect(registro).toContain("tx.comando(ROLLBACK)");
    expect(registro).not.toContain("tx.comando(COMMIT)");
  });

  it("escrita também roda declarada", async () => {
    const { fabrica, registro } = adaptadorFalso();
    const adaptador = await comIsolamentoDeTenant(fabrica).connect();

    await comTenant("lipao", () =>
      adaptador.executeRaw({ sql: "insert into mesas", args: [], argTypes: [] })
    );

    expect(registro).toEqual([
      "abre",
      "tx.comando(select set_config('app.tenant_id', $1, true) <- lipao)",
      "tx.comando(insert into mesas)",
      "tx.comando(COMMIT)",
      "solta a conexão",
    ]);
  });

  it("transação aberta pelo código recebe a declaração como primeiro comando", async () => {
    /**
     * Fechar comanda grava pagamento e atualiza a comanda juntos. Aí a
     * declaração acontece uma vez, no começo — não uma vez por consulta.
     */
    const { fabrica, registro } = adaptadorFalso();
    const adaptador = await comIsolamentoDeTenant(fabrica).connect();

    await comTenant("lipao", async () => {
      const tx = await adaptador.startTransaction();
      await tx.queryRaw({ sql: "insert into pagamentos", args: [], argTypes: [] });
      // Aqui quem fecha é o motor do Prisma, papel que este teste está fazendo.
      await tx.commit();
    });

    /**
     * Repare que não há `COMMIT` no registro: o embrulho só manda o comando
     * nas transações que ele mesmo abre. Nesta, quem manda é o motor do
     * Prisma — mandar também seria mandar duas vezes.
     */
    expect(registro).toEqual([
      "abre",
      "tx.comando(select set_config('app.tenant_id', $1, true) <- lipao)",
      "tx.consulta(insert into pagamentos)",
      "solta a conexão",
    ]);
  });

  it("se a declaração falhar, a transação não é entregue pela metade", async () => {
    /**
     * Uma transação sem declaração é pior que um erro: toda consulta dentro
     * dela voltaria vazia e o código concluiria que a comanda não existe.
     */
    const { fabrica, registro, tx } = adaptadorFalso();
    const original = tx.executeRaw;
    tx.executeRaw = async (c) => {
      // Só a declaração falha: o ROLLBACK precisa continuar podendo sair.
      if (c.sql.includes("set_config")) throw new Error("conexão caiu");
      return original(c);
    };
    const adaptador = await comIsolamentoDeTenant(fabrica).connect();

    await expect(comTenant("lipao", () => adaptador.startTransaction())).rejects.toThrow(
      "conexão caiu"
    );

    expect(registro).toContain("tx.comando(ROLLBACK)");
    expect(registro).toContain("solta a conexão");
  });

  it("sem restaurante declarado, a consulta passa direto", async () => {
    /**
     * Passar direto não significa passar aberta: com RLS ligado, é o Postgres
     * que devolve vazio. O adapter não inventa um tenant para tapar o buraco —
     * inventar seria escolher de quem são os dados, e essa escolha não é dele.
     */
    const { fabrica, registro } = adaptadorFalso();
    const adaptador = await comIsolamentoDeTenant(fabrica).connect();

    await semContexto(() => adaptador.queryRaw({ sql: "select 1", args: [], argTypes: [] }));

    expect(registro).toEqual(["consulta(select 1)"]);
  });

  it("travessia declarada também passa direto", async () => {
    const { fabrica, registro } = adaptadorFalso();
    const adaptador = await comIsolamentoDeTenant(fabrica).connect();

    await atravessandoRestaurantes("login", () =>
      adaptador.queryRaw({ sql: "select 1 from usuarios", args: [], argTypes: [] })
    );

    expect(registro).toEqual(["consulta(select 1 from usuarios)"]);
  });

  it("sem escopo declarado, a reserva diz de quem é a requisição", async () => {
    /**
     * É como o sistema funciona na maior parte do tempo: ninguém declara nada,
     * e o adapter pergunta ao cookie de sessão quem está logado. Foi a saída
     * depois de descobrir que nem `enterWith` nem o `cache()` do React
     * atravessam os três contextos do Next.
     */
    const { fabrica, registro } = adaptadorFalso();
    const adaptador = await comIsolamentoDeTenant(fabrica, async () => "lipao").connect();

    await semContexto(() => adaptador.queryRaw({ sql: "select 1", args: [], argTypes: [] }));

    expect(registro).toEqual([
      "abre",
      "tx.comando(select set_config('app.tenant_id', $1, true) <- lipao)",
      "tx.consulta(select 1)",
      "tx.comando(COMMIT)",
      "solta a conexão",
    ]);
  });

  it("o escopo declarado ganha da reserva", async () => {
    /**
     * Sem esta ordem, `atravessandoRestaurantes` seria inútil dentro de uma
     * requisição com sessão — e o login, que roda logo depois de alguém sair,
     * herdaria o restaurante do usuário anterior.
     */
    const { fabrica, registro } = adaptadorFalso();
    const adaptador = await comIsolamentoDeTenant(fabrica, async () => "do-cookie").connect();

    await comTenant("do-escopo", () =>
      adaptador.queryRaw({ sql: "select 1", args: [], argTypes: [] })
    );

    expect(registro.find((l) => l.includes("set_config"))).toContain("<- do-escopo");
  });

  it("travessia declarada ignora a reserva em vez de cair nela", async () => {
    /**
     * O login procura o restaurante pelo endereço antes de saber qual é. Se a
     * travessia caísse na reserva, ela herdaria o cookie de quem estava logado
     * antes — e procuraria no restaurante errado.
     */
    const { fabrica, registro } = adaptadorFalso();
    const adaptador = await comIsolamentoDeTenant(fabrica, async () => "do-cookie").connect();

    await atravessandoRestaurantes("login", () =>
      adaptador.queryRaw({ sql: "select 1 from tenants", args: [], argTypes: [] })
    );

    expect(registro).toEqual(["consulta(select 1 from tenants)"]);
  });

  it("sem reserva nenhuma, a consulta passa direto e o RLS resolve", async () => {
    const { fabrica, registro } = adaptadorFalso();
    const adaptador = await comIsolamentoDeTenant(fabrica, async () => undefined).connect();

    await semContexto(() => adaptador.queryRaw({ sql: "select 1", args: [], argTypes: [] }));

    expect(registro).toEqual(["consulta(select 1)"]);
  });

  it("o que não foi sobrescrito continua chegando no adapter de baixo", async () => {
    const { fabrica } = adaptadorFalso();
    const adaptador = await comIsolamentoDeTenant(fabrica).connect();

    expect(adaptador.provider).toBe("postgres");
    await expect(adaptador.dispose()).resolves.toBeUndefined();
  });
});
