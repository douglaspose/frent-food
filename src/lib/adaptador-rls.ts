import type { PrismaPg } from "@prisma/adapter-pg";
import { contextoAtual } from "./tenant-atual";

/**
 * Faz cada consulta declarar de qual restaurante ela é, antes de rodar.
 *
 * O RLS do Postgres lê `app.tenant_id` da conexão. O pool não garante que a
 * mesma conexão atenda duas consultas seguidas, então declarar uma vez por
 * requisição não bastaria: a segunda consulta poderia sair por outra conexão,
 * sem a variável, e voltar vazia.
 *
 * Havia duas saídas. Uma transação por requisição declara uma vez e roda tudo
 * dentro — mas transação tem uma conexão só, então as consultas que hoje saem
 * em paralelo virariam fila, e a conexão ficaria presa do começo ao fim da
 * requisição. A outra, que é esta, dá a cada consulta a sua transação curta.
 * Medidas lado a lado, empataram (~3,4 ms por tela); esta preserva o
 * paralelismo e devolve a conexão na hora.
 *
 * Por que aqui embaixo, no adapter, e não numa extensão do Prisma: dentro de
 * `$allOperations` o `query(args)` roda no cliente de onde veio, e não há como
 * redirecioná-lo para uma transação criada ali. No adapter a consulta ainda é
 * SQL, e embrulhá-la é trivial.
 *
 * O efeito é que nenhuma server action muda. O isolamento vira propriedade da
 * conexão, não disciplina de quem escreve a consulta.
 */

type Adaptador = Awaited<ReturnType<PrismaPg["connect"]>>;
type Consulta = Parameters<Adaptador["queryRaw"]>[0];
type Transacao = Awaited<ReturnType<Adaptador["startTransaction"]>>;
type Nivel = Parameters<Adaptador["startTransaction"]>[0];

/** O mínimo que o Prisma exige de uma fábrica de adapter. */
export type FabricaDeAdaptador = {
  readonly provider: PrismaPg["provider"];
  readonly adapterName: PrismaPg["adapterName"];
  connect(): Promise<Adaptador>;
};

/**
 * `set_config(..., true)` é o equivalente de `SET LOCAL`: vale até o fim da
 * transação e some no commit. Com `false`, a variável ficaria grudada na
 * conexão e o próximo a pegá-la no pool herdaria o restaurante do anterior —
 * que é exatamente o vazamento que este arquivo existe para impedir.
 *
 * `SET LOCAL` não aceita parâmetro; `set_config` aceita. É por isso que o id
 * do restaurante nunca é concatenado no SQL.
 */
function declaracao(tenantId: string): Consulta {
  return {
    sql: "select set_config('app.tenant_id', $1, true)",
    args: [tenantId],
    argTypes: [{ scalarType: "string", arity: "scalar" }],
  };
}

const jaAvisado = new Set<string>();

/**
 * Sem tenant declarado e com RLS ligado, a consulta volta vazia — a falha é do
 * lado seguro, mas aparece como tela em branco sem explicação. Este aviso
 * transforma isso em uma linha de log que diz onde procurar.
 *
 * Só em desenvolvimento: em produção seria ruído, e na suíte de testes, que
 * roda como dono do banco, seriam centenas de linhas por execução.
 */
function avisarSemTenant(consulta: Consulta) {
  if (process.env.NODE_ENV !== "development") return;

  const resumo = consulta.sql.replace(/\s+/g, " ").slice(0, 90);
  if (jaAvisado.has(resumo)) return;
  jaAvisado.add(resumo);

  console.warn(
    `[isolamento] consulta sem restaurante declarado — sob RLS ela volta vazia.\n` +
      `            ${resumo}\n` +
      `            Chame declararTenant() antes, ou marque com atravessandoRestaurantes().`
  );
}

/**
 * Embrulha a fábrica do `@prisma/adapter-pg`.
 *
 * Uma consulta solta vira: abre transação, declara o restaurante, roda,
 * confirma. Uma transação que o código abre de propósito (fechar comanda,
 * receber pagamento) recebe a declaração como primeiro comando dentro dela —
 * uma ida a mais na transação inteira, não por consulta.
 */
export function comIsolamentoDeTenant(
  interna: PrismaPg,
  /**
   * Quem responder "de quem é esta requisição?" quando ninguém declarou.
   *
   * O `db.ts` passa a leitura do cookie de sessão. Fica como parâmetro, e não
   * como import, para este arquivo continuar sem saber que existe Next: é o
   * que permite testá-lo com um adapter de mentira e usá-lo em script.
   */
  reserva?: () => Promise<string | undefined>
): FabricaDeAdaptador {
  return {
    provider: interna.provider,
    adapterName: interna.adapterName,

    async connect() {
      const adaptador = await interna.connect();
      return envolverAdaptador(adaptador, reserva);
    },
  };
}

function envolverAdaptador(
  interno: Adaptador,
  reserva?: () => Promise<string | undefined>
): Adaptador {
  /**
   * O escopo declarado ganha da reserva: `atravessandoRestaurantes` precisa
   * valer mesmo numa requisição com sessão, senão o login não conseguiria
   * procurar o restaurante e o freio de tentativas não conseguiria contar.
   */
  async function tenantDaVez(consulta: Consulta) {
    const contexto = contextoAtual();
    if (contexto?.tipo === "restaurante") return contexto.tenantId;
    if (contexto?.tipo === "atravessa") return undefined;

    const daSessao = await reserva?.();
    if (!daSessao) avisarSemTenant(consulta);

    return daSessao;
  }

  /**
   * `Object.create` em vez de um objeto novo: o adapter do Prisma tem membros
   * privados e métodos que não estão na interface pública (`underlyingDriver`,
   * por exemplo). Herdar dele e sobrescrever só os três métodos que importam
   * mantém o resto funcionando sem precisar saber o que é.
   */
  const envolvido: Adaptador = Object.create(interno);

  envolvido.queryRaw = async (consulta: Consulta) => {
    const tenantId = await tenantDaVez(consulta);
    if (!tenantId) return interno.queryRaw(consulta);

    return emTransacaoCurta(interno, tenantId, (tx) => tx.queryRaw(consulta));
  };

  envolvido.executeRaw = async (consulta: Consulta) => {
    const tenantId = await tenantDaVez(consulta);
    if (!tenantId) return interno.executeRaw(consulta);

    return emTransacaoCurta(interno, tenantId, (tx) => tx.executeRaw(consulta));
  };

  envolvido.startTransaction = async (nivel?: Nivel) => {
    const tx = await interno.startTransaction(nivel);
    const tenantId = await tenantDaVez({ sql: "BEGIN", args: [], argTypes: [] });

    if (tenantId) {
      try {
        await tx.executeRaw(declaracao(tenantId));
      } catch (erro) {
        /**
         * Devolver uma transação sem a declaração seria pior que falhar: todas
         * as consultas dentro dela voltariam vazias e o código concluiria que
         * a comanda não existe.
         */
        await encerrar(tx, "ROLLBACK").catch(() => {});
        throw erro;
      }
    }

    return tx;
  };

  return envolvido;
}

async function emTransacaoCurta<T>(
  interno: Adaptador,
  tenantId: string,
  rodar: (tx: Transacao) => Promise<T>
): Promise<T> {
  const tx = await interno.startTransaction();

  try {
    await tx.executeRaw(declaracao(tenantId));
    const resultado = await rodar(tx);
    await encerrar(tx, "COMMIT");
    return resultado;
  } catch (erro) {
    // O rollback pode falhar se a conexão já caiu; o erro que importa é o de cima.
    await encerrar(tx, "ROLLBACK").catch(() => {});
    throw erro;
  }
}

/**
 * Fecha a transação de verdade, e só então devolve a conexão.
 *
 * O `commit()` do `@prisma/adapter-pg` não manda `COMMIT` — ele faz limpeza e
 * chama `release()`. Quem manda o comando é o motor do Prisma, e é isso que
 * `usePhantomQuery: false` anuncia. Como aqui quem abriu a transação fui eu, o
 * papel do motor também é meu: sem este `COMMIT`, a conexão voltaria ao pool
 * com a transação aberta, segurando lock e snapshot até alguém reiniciar a
 * aplicação.
 *
 * O `usePhantomQuery` é respeitado em vez de assumido porque é o adapter quem
 * declara de quem é a responsabilidade — se um dia ele passar a mandar o
 * comando sozinho, mandar duas vezes seria erro.
 */
async function encerrar(tx: Transacao, comando: "COMMIT" | "ROLLBACK") {
  if (!tx.options.usePhantomQuery) {
    await tx.executeRaw({ sql: comando, args: [], argTypes: [] });
  }

  await (comando === "COMMIT" ? tx.commit() : tx.rollback());
}
