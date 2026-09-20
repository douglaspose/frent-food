import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { comIsolamentoDeTenant } from "./adaptador-rls";
import { verificarConsulta } from "./guarda-tenant";

/**
 * Pool explícito em vez de deixar o adapter montar o padrão.
 *
 * O padrão guarda conexões ociosas para sempre. Quando o Postgres reinicia ou
 * a rede pisca, o pool continua entregando conexões mortas e toda consulta
 * falha com "Server has closed the connection" — até alguém reiniciar a
 * aplicação. Numa VPS isso significa o restaurante parado no meio do serviço.
 */
function criarPool(url: string | undefined, max: number) {
  const pool = new pg.Pool({
    connectionString: url,
    // Devolve a conexão ociosa antes que o servidor a derrube por conta própria.
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // Detecta conexão morta em rede que cai sem avisar (NAT, wi-fi, firewall).
    keepAlive: true,
    max,
  });

  /**
   * Sem este ouvinte, um erro numa conexão ociosa derruba o processo inteiro —
   * o Node trata 'error' sem handler como exceção não capturada. Aqui ele só
   * vira log: o pool descarta a conexão ruim e abre outra na próxima consulta.
   */
  pool.on("error", (erro) => {
    console.error("[banco] conexão ociosa caiu, será substituída:", erro.message);
  });

  return pool;
}

/**
 * Em produção o guarda apenas registra: derrubar o pedido de um restaurante
 * por causa de um falso positivo seria pior que o risco que ele cobre. Em
 * desenvolvimento e nos testes ele lança, para o erro aparecer na hora em que
 * foi escrito.
 */
const GUARDA_LANCA = process.env.NODE_ENV !== "production";

function comGuarda(base: PrismaClient) {
  return base.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const resultado = verificarConsulta(model, operation, args);

          if (!resultado.permitido) {
            if (GUARDA_LANCA) throw new Error(`[isolamento] ${resultado.motivo}`);
            console.error(`[isolamento] ${resultado.motivo}`);
          }

          return query(args);
        },
      },
    },
  });
}

const registro = process.env.NODE_ENV === "development" ? (["warn", "error"] as const) : (["error"] as const);

/**
 * O cliente de todo dia.
 *
 * Cada consulta declara ao Postgres de qual restaurante ela é, e o RLS barra o
 * resto (`adaptador-rls.ts`). Quem escreve consulta não precisa saber disso: o
 * isolamento é propriedade da conexão, não disciplina de quem consulta.
 */
/**
 * A reserva do adapter: quando nenhum escopo foi declarado, quem responde de
 * quem é a requisição é o cookie de sessão.
 *
 * O import é dinâmico porque `tenant-da-sessao` usa `next/headers`, que não
 * existe fora do Next — nos testes e nos scripts o import falha, cai no
 * `catch` e o adapter segue sem reserva, que é o comportamento certo ali.
 */
async function restauranteDaSessao() {
  try {
    const { tenantDaSessao } = await import("./tenant-da-sessao");
    return await tenantDaSessao();
  } catch {
    return undefined;
  }
}

function criarCliente() {
  const adapter = comIsolamentoDeTenant(
    new PrismaPg(criarPool(process.env.DATABASE_URL, 10)),
    restauranteDaSessao
  );
  return comGuarda(new PrismaClient({ adapter, log: [...registro] }));
}

/**
 * O cliente que atravessa restaurantes. Use com relutância.
 *
 * Existem perguntas que precisam ser respondidas antes de existir um
 * restaurante conhecido — "de quem é este subdomínio?", "de que unidade é este
 * token de impressão?". Sob RLS elas voltariam vazias, e o sistema inteiro
 * ficaria inacessível, inclusive a tela de login.
 *
 * Em produção a `DATABASE_URL_SEM_RLS` aponta para uma role com `BYPASSRLS`
 * (ver `prisma/rls.sql`, seção 5). Em desenvolvimento, onde o banco não tem
 * política nenhuma, a `DATABASE_URL` já serve.
 *
 * O pool é pequeno de propósito: se este cliente começar a precisar de dez
 * conexões, ele deixou de ser exceção e virou caminho — e isso é bug, não
 * capacidade.
 */
function criarClienteSemRls() {
  const url = process.env.DATABASE_URL_SEM_RLS ?? process.env.DATABASE_URL;
  const adapter = new PrismaPg(criarPool(url, 3));
  return comGuarda(new PrismaClient({ adapter, log: [...registro] }));
}

type Cliente = ReturnType<typeof criarCliente>;

/**
 * Em desenvolvimento o Next recarrega os módulos a cada alteração. Sem este
 * cache, cada recarga abriria um pool novo e o Postgres recusaria conexões
 * depois de algumas dezenas de saves.
 */
const globalParaPrisma = globalThis as unknown as { prisma?: Cliente; prismaSemRls?: Cliente };

export const db = globalParaPrisma.prisma ?? criarCliente();
export const dbSemRls = globalParaPrisma.prismaSemRls ?? criarClienteSemRls();

if (process.env.NODE_ENV !== "production") {
  globalParaPrisma.prisma = db;
  globalParaPrisma.prismaSemRls = dbSemRls;
}

/**
 * Cliente de transação do cliente estendido. `Prisma.TransactionClient` não
 * serve aqui: a extensão muda o tipo, e usar o do Prisma puro quebra a
 * compilação de quem recebe um `tx`.
 */
export type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];
