import "server-only";
import bcrypt from "bcryptjs";
import { db, type Tx } from "./db";
import { exigirSessao, temPermissao, type Sessao } from "./session";
import { registrarFalha, verificar } from "./limite-tentativas";
import { TIPOS_DE_AUTORIZACAO, VALIDADE_MS, type TipoAutorizacao } from "./autorizacao";
import { ErroDeOperacao } from "./erro-de-operacao";

export type Aprovador = { id: string; nome: string };

export type Liberacao = {
  sessao: Sessao;
  /** Quem liberou, quando a ação não era do cargo de quem executou. */
  aprovadoPor: Aprovador | null;
  /** Marca a autorização como gasta. Chame dentro da transação da ação. */
  consumir: (tx: Tx) => Promise<void>;
};

/**
 * Deixa passar por cargo ou por aprovação.
 *
 * Quem tem a permissão segue direto. Quem não tem precisa apresentar uma
 * autorização — criada segundos antes com o PIN de alguém que tem, presa a
 * esta ação e a este alvo.
 *
 * Devolve `null` quando falta os dois, em vez de lançar: cabe à action
 * transformar isso no resultado que a tela entende.
 */
export async function liberar(
  chave: string,
  tipo: TipoAutorizacao,
  referenciaId: string,
  autorizacaoId?: string | null
): Promise<Liberacao | null> {
  const sessao = await exigirSessao();

  if (temPermissao(sessao, chave)) {
    return { sessao, aprovadoPor: null, consumir: async () => {} };
  }

  if (!autorizacaoId) return null;

  const autorizacao = await db.autorizacao.findUnique({
    where: { id: autorizacaoId },
    include: { aprovadoPor: { select: { id: true, nome: true } } },
  });

  /**
   * Toda condição abaixo é uma forma de reaproveitar uma liberação:
   * usar a de outro restaurante, a de outro garçom, a de outra mesa, a de
   * outro tipo de ação, a de ontem, ou a mesma duas vezes.
   */
  const valida =
    autorizacao &&
    autorizacao.tenantId === sessao.tenantId &&
    autorizacao.unidadeId === sessao.unidadeId &&
    autorizacao.solicitadoPorId === sessao.usuarioId &&
    autorizacao.tipo === tipo &&
    autorizacao.referenciaId === referenciaId &&
    autorizacao.status === "APROVADA" &&
    autorizacao.usadoEm === null &&
    Date.now() - autorizacao.criadoEm.getTime() <= VALIDADE_MS;

  if (!valida) return null;

  return {
    sessao,
    aprovadoPor: autorizacao.aprovadoPor,
    /**
     * Gasta só se ainda não foi gasta. A conferência de `usadoEm` acima é
     * lida antes da ação: dois toques com a mesma liberação passavam os dois,
     * e um PIN de gerente virava duas sangrias. Aqui a gravação é condicional
     * — o segundo não acha a liberação livre, lança, e a transação da ação
     * inteira volta atrás.
     */
    consumir: async (tx) => {
      const gasta = await tx.autorizacao.updateMany({
        where: { id: autorizacaoId, usadoEm: null },
        data: { usadoEm: new Date() },
      });
      if (gasta.count !== 1) throw new ErroDeOperacao("Esta liberação já foi usada. Peça o PIN de novo.");
    },
  };
}

export type ResultadoDaAprovacao =
  | { ok: true; id: string; aprovador: string }
  | { ok: false; motivo: string };

/**
 * Valida o PIN de quem tem a permissão e registra a liberação.
 *
 * O PIN não é comparado contra um usuário escolhido na tela — não há lista de
 * gerentes para o garçom apontar. Ele é conferido contra todo mundo da unidade
 * que tem a permissão, e o dono do PIN é descoberto pela conferência. Mostrar
 * quem pode aprovar já seria informação demais para quem está pedindo.
 */
export async function aprovarComPin(
  tipo: TipoAutorizacao,
  referenciaId: string,
  pin: string,
  motivo?: string
): Promise<ResultadoDaAprovacao> {
  const sessao = await exigirSessao();
  const { permissao } = TIPOS_DE_AUTORIZACAO[tipo];

  // O freio é por usuário solicitante, não por PIN: chavear pelo PIN diria a
  // quem tenta se aquele PIN existe.
  const chaveDoFreio = `autorizacao:${sessao.usuarioId}`;
  const freio = await verificar(chaveDoFreio);
  if (freio.bloqueado) {
    return { ok: false, motivo: `Muitas tentativas. Tente de novo em ${Math.ceil(freio.segundosRestantes / 60)} min.` };
  }

  if (!/^\d{4}$/.test(pin)) return { ok: false, motivo: "O PIN tem 4 dígitos." };

  const candidatos = await db.usuario.findMany({
    where: {
      tenantId: sessao.tenantId,
      ativo: true,
      pinHash: { not: null },
      unidades: {
        some: {
          unidadeId: sessao.unidadeId,
          cargo: { permissoes: { some: { chave: { in: [permissao, "*"] }, permitido: true } } },
        },
      },
    },
    select: { id: true, nome: true, pinHash: true },
  });

  let aprovador: { id: string; nome: string } | null = null;
  for (const u of candidatos) {
    if (await bcrypt.compare(pin, u.pinHash!)) {
      aprovador = { id: u.id, nome: u.nome };
      break;
    }
  }

  if (!aprovador) {
    const veredito = await registrarFalha(chaveDoFreio);
    return {
      ok: false,
      motivo: veredito.bloqueado
        ? `Muitas tentativas. Tente de novo em ${Math.ceil(veredito.segundosRestantes / 60)} min.`
        : "PIN não confere, ou quem digitou não tem essa permissão.",
    };
  }

  /**
   * Aprovar a própria solicitação não é aprovação.
   *
   * Só acontece se alguém com a permissão chegar aqui — o que não deveria,
   * porque `liberar` teria deixado passar direto. Barrar mesmo assim evita
   * que uma mudança futura no fluxo transforme isso num caminho silencioso.
   */
  if (aprovador.id === sessao.usuarioId) {
    return { ok: false, motivo: "Você mesmo não pode aprovar o próprio pedido." };
  }

  const autorizacao = await db.autorizacao.create({
    data: {
      tenantId: sessao.tenantId,
      unidadeId: sessao.unidadeId,
      tipo,
      referenciaId,
      motivo: motivo?.trim() || null,
      status: "APROVADA",
      solicitadoPorId: sessao.usuarioId,
      aprovadoPorId: aprovador.id,
      resolvidoEm: new Date(),
    },
  });

  return { ok: true, id: autorizacao.id, aprovador: aprovador.nome };
}
