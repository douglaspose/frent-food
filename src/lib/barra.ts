import "server-only";
import { db } from "./db";
import { temPermissao, type Sessao } from "./session";

export type DadosBarra = {
  unidade: string;
  usuario: { nome: string; cargo: string; podeGerir: boolean };
  caixaAberto: boolean;
  /** Tickets que precisam de alguém: atrasados na cozinha + prontos parados. */
  cozinhaAlertas: number;
  cozinhaDetalhe: string;
};

/**
 * Alimenta a barra de ambientes.
 *
 * Os contadores são o que transforma a navegação em informação: o garçom vê
 * "Cozinha 3" e sabe que tem prato esperando sem precisar ir lá; o caixa vê
 * "fechado" antes de tentar receber e descobrir do jeito difícil.
 */
export async function dadosDaBarra(sessao: Sessao): Promise<DadosBarra> {
  /**
   * Duas consultas, não quatro.
   *
   * A barra aparece em toda tela de operação: cada consulta extra aqui é paga
   * em todo carregamento, por todo tablet do salão. Caixa e parâmetros vêm
   * aninhados na unidade em vez de irem por fora.
   */
  const [unidade, pedidos] = await Promise.all([
    db.unidade.findUniqueOrThrow({
      where: { id: sessao.unidadeId },
      select: {
        nome: true,
        caixas: {
          where: { tipo: "GERAL", status: "ABERTO" },
          select: { id: true },
          take: 1,
        },
        parametros: {
          where: { chave: { in: ["kds.alertaAtrasoMin", "kds.alertaRetiradaMin"] } },
          select: { chave: true, valor: true },
        },
      },
    }),
    db.pedido.findMany({
      where: {
        unidadeId: sessao.unidadeId,
        status: { in: ["AGUARDANDO", "EM_PREPARO", "PRONTO"] },
      },
      select: { status: true, criadoEm: true, prontoEm: true },
    }),
  ]);

  const limite = (chave: string, padrao: number) =>
    Number(unidade.parametros.find((p) => p.chave === chave)?.valor ?? padrao);

  const agora = Date.now();
  const minutos = (data: Date) => (agora - data.getTime()) / 60000;

  const atrasados = pedidos.filter(
    (p) => p.status !== "PRONTO" && minutos(p.criadoEm) >= limite("kds.alertaAtrasoMin", 20)
  ).length;

  const esperando = pedidos.filter(
    (p) =>
      p.status === "PRONTO" &&
      p.prontoEm &&
      minutos(p.prontoEm) >= limite("kds.alertaRetiradaMin", 5)
  ).length;

  const partes = [
    atrasados > 0 ? `${atrasados} atrasado(s)` : null,
    esperando > 0 ? `${esperando} pronto(s) esperando` : null,
  ].filter(Boolean);

  return {
    unidade: unidade.nome,
    usuario: {
      nome: sessao.nome,
      cargo: sessao.cargo,
      podeGerir: temPermissao(sessao, "produto.editar"),
    },
    caixaAberto: unidade.caixas.length > 0,
    cozinhaAlertas: atrasados + esperando,
    cozinhaDetalhe: partes.length > 0 ? partes.join(" · ") : "Nada pendente na cozinha",
  };
}
