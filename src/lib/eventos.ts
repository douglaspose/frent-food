import "server-only";
import pg from "pg";
import { db } from "./db";

/**
 * Avisos de mudança entre telas, via LISTEN/NOTIFY do Postgres.
 *
 * O KDS e o mapa de mesas recarregavam sozinhos a cada 10-15 segundos. Isso
 * custa uma rodada de consultas por tablet por intervalo — num salão com dez
 * aparelhos, o banco leva uma rajada a cada dez segundos mesmo quando nada
 * aconteceu, e a tela ainda assim demora até dez segundos para mostrar um
 * pedido que já saiu.
 *
 * Por que o Postgres e não um EventEmitter em memória: o emissor só funciona
 * enquanto houver um processo. Dois contêineres, ou o PM2 em modo cluster, e
 * metade dos tablets deixa de receber aviso — uma falha silenciosa, que só
 * aparece no serviço cheio. O banco já é o ponto comum de todos os processos.
 */
export const CANAL = "gestao_eventos";

/** O `id` existe só para não entregar duas vezes o mesmo aviso. */
export type Evento = { id: string; unidadeId: string; motivo: string };

/**
 * Sem tópicos, de propósito.
 *
 * Um restaurante gera poucos eventos por minuto, e quase todos interessam às
 * duas telas: um ticket pronto muda a cozinha e o contador da barra no salão;
 * uma conta pedida muda o salão e marca o ticket na cozinha. Filtrar por
 * assunto renderia quase nada e custaria uma taxonomia para manter em dia
 * toda vez que uma tela passasse a mostrar mais um dado.
 */
export function montarPayload(evento: Evento): string {
  return JSON.stringify(evento);
}

/** Devolve `null` em vez de lançar: payload torto não pode derrubar o ouvinte. */
export function lerPayload(bruto: string | undefined): Evento | null {
  if (!bruto) return null;
  try {
    const dado: unknown = JSON.parse(bruto);
    if (typeof dado !== "object" || dado === null) return null;
    const { id, unidadeId, motivo } = dado as Record<string, unknown>;
    if (typeof id !== "string" || !id) return null;
    if (typeof unidadeId !== "string" || !unidadeId) return null;
    if (typeof motivo !== "string" || !motivo) return null;
    return { id, unidadeId, motivo };
  } catch {
    return null;
  }
}

/**
 * Quantos ids guardar para reconhecer repetição. Um restaurante cheio faz
 * dezenas de eventos por minuto; duzentos cobrem folgadamente a janela em que
 * a cópia de um aviso ainda poderia chegar.
 */
const LEMBRAR = 200;

/**
 * Diz se este aviso é novo. O mesmo evento chega duas vezes no processo que o
 * publicou — uma pela entrega local, outra de volta pelo Postgres — e sem isto
 * a tela recarregaria em dobro a cada ação.
 */
export function registrarEntrega(id: string): boolean {
  const vistos = estado.vistos;
  if (vistos.has(id)) return false;
  vistos.add(id);
  // Set em JavaScript preserva a ordem de inserção: o primeiro da iteração é
  // sempre o mais antigo.
  if (vistos.size > LEMBRAR) vistos.delete(vistos.values().next().value as string);
  return true;
}

/**
 * Anuncia uma mudança.
 *
 * Duas entregas, de propósito. A de memória atende quem está neste mesmo
 * processo e funciona sempre — inclusive no banco de desenvolvimento do
 * `prisma dev`, que aceita o NOTIFY e não entrega a ninguém. A do Postgres
 * alcança os outros processos, que é o caso de um deploy com mais de uma
 * instância. O `id` impede que o processo que publicou recarregue duas vezes.
 *
 * Nunca lança: avisar as telas é conveniência, não parte da operação. Se o
 * aviso se perde, o pedido já foi gravado e a tela se corrige na próxima
 * sincronização periódica — perder a venda porque o NOTIFY falhou seria um
 * péssimo negócio.
 */
export async function publicar(unidadeId: string, motivo: string): Promise<void> {
  const evento: Evento = { id: crypto.randomUUID(), unidadeId, motivo };

  entregar(evento);

  // Banco que não entrega NOTIFY não ganha uma consulta a mais por ação.
  if (estado.bancoEntregaNotify === false) return;

  try {
    await db.$executeRaw`select pg_notify(${CANAL}, ${montarPayload(evento)})`;
  } catch (erro) {
    console.error("[eventos] não consegui publicar:", (erro as Error).message);
  }
}

type Assinante = (evento: Evento) => void;

type Estado = {
  cliente: pg.Client | null;
  conectando: boolean;
  tentativas: number;
  assinantes: Map<string, Set<Assinante>>;
  vistos: Set<string>;
  /** `null` enquanto não foi testado. */
  bancoEntregaNotify: boolean | null;
};

/**
 * O estado mora no globalThis, não no módulo.
 *
 * Não é só pelo HMR: em desenvolvimento o Next dá a cada rota e a cada server
 * action a sua própria cópia dos módulos compartilhados. Com o estado no
 * módulo, a ação que publica e a rota que transmite ficariam em universos
 * separados e a entrega local nunca chegaria em ninguém.
 */
const global = globalThis as unknown as { eventos?: Estado };

const estado: Estado = (global.eventos ??= {
  cliente: null,
  conectando: false,
  tentativas: 0,
  assinantes: new Map(),
  vistos: new Set(),
  bancoEntregaNotify: null,
});

function entregar(evento: Evento) {
  if (!registrarEntrega(evento.id)) return;

  for (const assinante of estado.assinantes.get(evento.unidadeId) ?? []) {
    try {
      assinante(evento);
    } catch (erro) {
      console.error("[eventos] assinante quebrou:", (erro as Error).message);
    }
  }
}

function derrubar() {
  estado.cliente?.removeAllListeners();
  estado.cliente = null;
  // Só vale reconectar se ainda há tela esperando.
  if (estado.assinantes.size > 0) void garantirOuvinte();
}

/**
 * Uma conexão dedicada para o LISTEN, fora do pool.
 *
 * Conexão em LISTEN fica ocupada: se saísse do pool do Prisma, seria uma das
 * dez conexões da aplicação presa para sempre.
 */
/**
 * Quantas falhas seguidas antes de parar de tentar ouvir. Com o recuo
 * progressivo, cinco cobrem uns quinze segundos — tempo de um banco reiniciar.
 */
const DESISTIR_APOS = 5;

/** Depois de desistir, volta a tentar daqui a cinco minutos. */
const REAVALIAR_MS = 5 * 60_000;

/**
 * Para de tentar, sem fechar a porta.
 *
 * Desistir para sempre deixaria a instância sem tempo real entre processos
 * até o próximo deploy só porque o banco reiniciou por trinta segundos. Ficar
 * tentando eternamente enche o diário e queima conexão contra um banco que
 * pode simplesmente não ter o recurso.
 */
function desistirPorEnquanto() {
  estado.bancoEntregaNotify = false;
  console.warn(
    `[eventos] sem ouvinte no banco após ${DESISTIR_APOS} tentativas: o tempo real vale ` +
      "só dentro deste processo. Nova tentativa em 5 minutos."
  );

  // unref: um temporizador pendente não pode segurar o processo de pé.
  setTimeout(() => {
    estado.bancoEntregaNotify = null;
    estado.tentativas = 0;
    if (estado.assinantes.size > 0) void garantirOuvinte();
  }, REAVALIAR_MS).unref();
}

/**
 * Pergunta ao banco, uma vez, se ele de fato entrega NOTIFY.
 *
 * O banco de desenvolvimento do `prisma dev` aceita `pg_notify` sem erro e
 * não entrega a ninguém — é um Postgres embarcado. Sem esta sondagem o
 * sistema ficaria com uma conexão parada para sempre esperando avisos que
 * nunca chegam, e ninguém saberia por quê.
 *
 * A sonda sai pelo pool e entra pelo ouvinte: são duas conexões, como num
 * publish de verdade. Mandar o aviso pela própria conexão que escuta daria
 * falso positivo — até o banco embarcado entrega para si mesmo.
 */
async function bancoEntregaNotify(cliente: pg.Client): Promise<boolean> {
  const marca = `sonda:${crypto.randomUUID()}`;

  return new Promise<boolean>((responder) => {
    const prazo = setTimeout(() => {
      cliente.removeListener("notification", ouvir);
      responder(false);
    }, 3_000);

    function ouvir(aviso: pg.Notification) {
      if (aviso.payload !== marca) return;
      clearTimeout(prazo);
      cliente.removeListener("notification", ouvir);
      responder(true);
    }

    cliente.on("notification", ouvir);

    db.$executeRaw`select pg_notify(${CANAL}, ${marca})`.catch(() => {
      clearTimeout(prazo);
      cliente.removeListener("notification", ouvir);
      responder(false);
    });
  });
}

async function garantirOuvinte(): Promise<void> {
  if (estado.cliente || estado.conectando) return;
  // Já sabemos que este banco não entrega: nada a ouvir.
  if (estado.bancoEntregaNotify === false) return;
  estado.conectando = true;

  // Recuo progressivo até 30s: o banco pode estar reiniciando, e martelar a
  // reconexão a cada 100ms só atrasa o momento em que ele volta.
  const espera = Math.min(30_000, 500 * 2 ** estado.tentativas);
  if (estado.tentativas > 0) await new Promise((ok) => setTimeout(ok, espera));

  const cliente = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 10_000,
    keepAlive: true,
  });

  try {
    await cliente.connect();
    await cliente.query(`listen ${CANAL}`);

    if (estado.bancoEntregaNotify === null) {
      estado.bancoEntregaNotify = await bancoEntregaNotify(cliente);
      if (!estado.bancoEntregaNotify) {
        console.warn(
          "[eventos] este banco não entrega NOTIFY: o tempo real vale só dentro deste processo. " +
            "Num deploy com mais de uma instância, use Postgres de verdade."
        );
        await cliente.end().catch(() => {});
        estado.conectando = false;
        return;
      }
    }

    cliente.on("notification", (aviso) => {
      const evento = lerPayload(aviso.payload);
      if (evento) entregar(evento);
    });
    cliente.on("error", (erro) => {
      console.error("[eventos] ouvinte caiu:", erro.message);
      derrubar();
    });
    cliente.on("end", derrubar);

    estado.cliente = cliente;
    estado.tentativas = 0;
  } catch (erro) {
    estado.tentativas += 1;
    // Só o primeiro erro vira log: com recuo progressivo, repetir a mesma
    // linha só esconde o resto do diário.
    if (estado.tentativas === 1) {
      console.error("[eventos] não consegui ouvir:", (erro as Error).message);
    }
    await cliente.end().catch(() => {});
    estado.conectando = false;

    if (estado.tentativas >= DESISTIR_APOS) {
      desistirPorEnquanto();
      return;
    }

    if (estado.assinantes.size > 0) void garantirOuvinte();
    return;
  } finally {
    estado.conectando = false;
  }
}

/** Assina as mudanças de uma unidade. Devolve a função que cancela. */
export function assinar(unidadeId: string, assinante: Assinante): () => void {
  const grupo = estado.assinantes.get(unidadeId) ?? new Set<Assinante>();
  grupo.add(assinante);
  estado.assinantes.set(unidadeId, grupo);

  void garantirOuvinte();

  return () => {
    grupo.delete(assinante);
    if (grupo.size === 0) estado.assinantes.delete(unidadeId);
    // A conexão fica de pé: o salão esvazia entre um turno e outro, e reabrir
    // o LISTEN a cada tablet que dorme custa mais que manter uma conexão.
  };
}
