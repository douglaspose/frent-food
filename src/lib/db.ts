import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { verificarConsulta } from "./guarda-tenant";

/**
 * Pool explícito em vez de deixar o adapter montar o padrão.
 *
 * O padrão guarda conexões ociosas para sempre. Quando o Postgres reinicia ou
 * a rede pisca, o pool continua entregando conexões mortas e toda consulta
 * falha com "Server has closed the connection" — até alguém reiniciar a
 * aplicação. Numa VPS isso significa o restaurante parado no meio do serviço.
 */
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  // Devolve a conexão ociosa antes que o servidor a derrube por conta própria.
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  // Detecta conexão morta em rede que cai sem avisar (NAT, wi-fi, firewall).
  keepAlive: true,
  max: 10,
});

/**
 * Sem este ouvinte, um erro numa conexão ociosa derruba o processo inteiro —
 * o Node trata 'error' sem handler como exceção não capturada. Aqui ele só
 * vira log: o pool descarta a conexão ruim e abre outra na próxima consulta.
 */
pool.on("error", (erro) => {
  console.error("[banco] conexão ociosa caiu, será substituída:", erro.message);
});

// Prisma 7 usa driver adapters: a conexão é criada aqui, não no schema.
const adapter = new PrismaPg(pool);

/**
 * Em produção o guarda apenas registra: derrubar o pedido de um restaurante
 * por causa de um falso positivo seria pior que o risco que ele cobre. Em
 * desenvolvimento e nos testes ele lança, para o erro aparecer na hora em que
 * foi escrito.
 */
const GUARDA_LANCA = process.env.NODE_ENV !== "production";

function criarCliente() {
  const base = new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

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

type Cliente = ReturnType<typeof criarCliente>;

const globalForPrisma = globalThis as unknown as { prisma?: Cliente };

export const db = globalForPrisma.prisma ?? criarCliente();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

/**
 * Cliente de transação do cliente estendido. `Prisma.TransactionClient` não
 * serve aqui: a extensão muda o tipo, e usar o do Prisma puro quebra a
 * compilação de quem recebe um `tx`.
 */
export type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];
