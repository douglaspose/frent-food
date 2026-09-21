import { db } from "./db";
import { centavos } from "./comanda";

/**
 * O histórico dos turnos de caixa.
 *
 * A tela do salão só enxerga o caixa **aberto** — fechou, some. O que o dono
 * pergunta depois ("quanto deu sábado?", "de quem foi a falta de R$ 12?") não
 * tinha onde ser respondido: o Diário guarda os números do fechamento, mas
 * misturados a todas as outras ações e sem a quebra por forma de pagamento.
 *
 * Os totais vêm somados pelo banco, e não trazendo os pagamentos para contar em
 * JavaScript. Um ano de operação são centenas de turnos e dezenas de milhares
 * de pagamentos; a lista precisa abrir rápido mesmo assim.
 */

/** Soma que o Postgres devolve como texto quando a coluna é `numeric`. */
type Soma = string | number | null;

const num = (v: Soma | undefined) => Number(v ?? 0);

export type TurnoDeCaixa = {
  id: string;
  /** "2026-09-20", o dia local — a coluna é `date`, sem hora para converter. */
  data: string;
  turno: string;
  status: string;
  abertoPor: string;
  fechadoPor: string | null;
  fechadoEm: Date | null;
  fundo: number;
  /** Tudo que entrou no turno, em qualquer forma. */
  recebido: number;
  /** Só o que passou pela gaveta, já sem o troco devolvido. */
  recebidoEmEspecie: number;
  sangrias: number;
  suprimentos: number;
  comandas: number;
  /** `null` enquanto o caixa está aberto: ninguém contou ainda. */
  valorApurado: number | null;
  valorInformado: number | null;
  divergencia: number | null;
};

/**
 * Quantos turnos a lista carrega de uma vez.
 *
 * Sessenta cobre dois meses de operação diária, que é o horizonte em que se
 * procura um fechamento ("foi no mês passado"). Mais que isso é trabalho de
 * relatório, não de conferência.
 */
export const TURNOS_POR_PAGINA = 60;

type LinhaDeTurno = {
  id: string;
  data: string;
  turno: string;
  status: string;
  aberto_por: string;
  fechado_por: string | null;
  fechado_em: Date | null;
  fundo: Soma;
  recebido: Soma;
  especie: Soma;
  sangrias: Soma;
  suprimentos: Soma;
  comandas: number;
  apurado: Soma;
  informado: Soma;
  divergencia: Soma;
};

/**
 * A lista de turnos, ou um só quando `apenas` vem preenchido.
 *
 * O filtro por id entra na mesma consulta em vez de numa segunda: buscar a
 * página inteira para depois achar um turno dentro dela traria milhares de
 * linhas para descartar todas menos uma.
 */
async function buscar(unidadeId: string, quantos: number, apenas: string | null) {
  const linhas = await db.$queryRaw<LinhaDeTurno[]>`
    SELECT c.id,
           to_char(c.data, 'YYYY-MM-DD') AS data,
           c.turno::text AS turno,
           c.status::text AS status,
           ab.nome AS aberto_por,
           fe.nome AS fechado_por,
           c."fechadoEm" AS fechado_em,
           c."fundoCaixa" AS fundo,
           c."valorApurado" AS apurado,
           c."valorInformado" AS informado,
           c.divergencia,
           COALESCE(p.recebido, 0) AS recebido,
           COALESCE(p.especie, 0) AS especie,
           COALESCE(p.comandas, 0)::int AS comandas,
           COALESCE(m.sangrias, 0) AS sangrias,
           COALESCE(m.suprimentos, 0) AS suprimentos
      FROM caixas c
      JOIN usuarios ab ON ab.id = c."abertoPorId"
      LEFT JOIN usuarios fe ON fe.id = c."fechadoPorId"
      /*
        Agregados em subconsultas laterais, e não num JOIN com GROUP BY no fim:
        juntar pagamentos e movimentos na mesma consulta multiplicaria as linhas
        de um pelo outro, e as sangrias sairiam contadas uma vez por pagamento
        do turno.
      */
      LEFT JOIN LATERAL (
        SELECT SUM(pg.valor - pg.troco) AS recebido,
               SUM(pg.valor - pg.troco) FILTER (WHERE fp.tipo = 'DINHEIRO') AS especie,
               COUNT(DISTINCT pg."comandaId") AS comandas
          FROM pagamentos pg
          JOIN formas_pagamento fp ON fp.id = pg."formaPagamentoId"
         WHERE pg."caixaId" = c.id
      ) p ON true
      LEFT JOIN LATERAL (
        SELECT SUM(mv.valor) FILTER (WHERE mv.tipo = 'SANGRIA') AS sangrias,
               SUM(mv.valor) FILTER (WHERE mv.tipo = 'SUPRIMENTO') AS suprimentos
          FROM movimentos_caixa mv
         WHERE mv."caixaId" = c.id
      ) m ON true
     WHERE c."unidadeId" = ${unidadeId}
       AND (${apenas}::text IS NULL OR c.id = ${apenas})
     ORDER BY c.data DESC, c."abertoEm" DESC
     LIMIT ${quantos}
  `;

  return linhas.map(
    (l): TurnoDeCaixa => ({
      id: l.id,
      data: l.data,
      turno: l.turno,
      status: l.status,
      abertoPor: l.aberto_por,
      fechadoPor: l.fechado_por,
      fechadoEm: l.fechado_em,
      fundo: centavos(num(l.fundo)),
      recebido: centavos(num(l.recebido)),
      recebidoEmEspecie: centavos(num(l.especie)),
      sangrias: centavos(num(l.sangrias)),
      suprimentos: centavos(num(l.suprimentos)),
      comandas: l.comandas,
      // Nulo de verdade, e não zero: caixa aberto ainda não foi contado, e
      // "R$ 0,00 de diferença" diria que bateu.
      valorApurado: l.apurado === null ? null : centavos(num(l.apurado)),
      valorInformado: l.informado === null ? null : centavos(num(l.informado)),
      divergencia: l.divergencia === null ? null : centavos(num(l.divergencia)),
    })
  );
}

export function historicoDeCaixa(unidadeId: string, quantos = TURNOS_POR_PAGINA) {
  return buscar(unidadeId, quantos, null);
}

export type DetalheDoTurno = {
  turno: TurnoDeCaixa;
  porForma: { nome: string; tipo: string; valor: number; pagamentos: number }[];
  movimentos: {
    id: string;
    tipo: string;
    valor: number;
    descricao: string | null;
    usuario: string;
    criadoEm: Date;
  }[];
};

/** O turno por inteiro: o que entrou por forma e o que saiu da gaveta. */
export async function detalheDoTurno(
  unidadeId: string,
  caixaId: string
): Promise<DetalheDoTurno | null> {
  // O filtro por unidade está dentro da consulta: turno de outra unidade
  // responde como id inventado, para a tela não virar detector de ids válidos.
  const [turno] = await buscar(unidadeId, 1, caixaId);
  if (!turno) return null;

  const porForma = await db.$queryRaw<
    { nome: string; tipo: string; valor: Soma; pagamentos: number }[]
  >`
    SELECT fp.nome,
           fp.tipo::text AS tipo,
           SUM(pg.valor - pg.troco) AS valor,
           COUNT(*)::int AS pagamentos
      FROM pagamentos pg
      JOIN formas_pagamento fp ON fp.id = pg."formaPagamentoId"
     WHERE pg."caixaId" = ${caixaId}
     GROUP BY fp.nome, fp.tipo
     ORDER BY 3 DESC
  `;

  const movimentos = await db.movimentoCaixa.findMany({
    where: { caixaId },
    orderBy: { criadoEm: "asc" },
    include: { usuario: { select: { nome: true } } },
  });

  return {
    turno,
    porForma: porForma.map((f) => ({
      nome: f.nome,
      tipo: f.tipo,
      valor: centavos(num(f.valor)),
      pagamentos: f.pagamentos,
    })),
    movimentos: movimentos.map((m) => ({
      id: m.id,
      tipo: m.tipo,
      valor: centavos(Number(m.valor)),
      descricao: m.descricao,
      usuario: m.usuario.nome,
      criadoEm: m.criadoEm,
    })),
  };
}
