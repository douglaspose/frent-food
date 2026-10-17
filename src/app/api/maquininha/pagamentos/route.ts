import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { declararTenant } from "@/lib/tenant-atual";
import { centavos, TOLERANCIA } from "@/lib/comanda";
import { contaDaComanda, finalizarConta, receberPagamento } from "@/lib/conta";
import { comandaDeBalcao } from "@/lib/balcao";
import {
  operadorDaRequisicao,
  unidadeDoAparelho,
  podeNoAparelho,
  referenciaCabe,
} from "@/lib/maquininha";
import { temErro } from "@/lib/erro-de-operacao";
import { emResultado } from "@/lib/erro-de-operacao";

export const dynamic = "force-dynamic";

const emCentavos = (v: number) => Math.round(centavos(v) * 100);

/**
 * O teto de uma venda, que é o da coluna: `Decimal(10,2)` guarda até
 * R$ 99.999.999,99.
 *
 * Na conta de mesa um valor absurdo já morria numa recusa legível, porque
 * ninguém recebe mais do que a conta deve ("falta receber só R$ 12,30"). A
 * venda de balcão **é** o valor que recebe, e sem teto ela levava o número
 * direto para a coluna: o Postgres estourava o campo, o Prisma lançava, e o
 * que chegava ao aparelho era erro de sistema. A fila do aparelho trata erro
 * de sistema como rede ruim — então ela reenviava a mesma venda a noite
 * inteira, e parava atrás dela todas as outras que esperavam para sair.
 */
const TETO_EM_CENTAVOS = 9_999_999_999;

/**
 * O que a maquininha cobrou e a forma cadastrada no restaurante.
 *
 * A maquininha fala em crédito, débito, Pix e voucher; o restaurante cadastra
 * formas com nome próprio ("Cartão de Crédito", "Pix Itaú"). O encontro é pelo
 * tipo, que é o que a forma tem de fixo — o nome cada casa escolhe o seu.
 */
const TIPO_DA_FORMA: Record<string, string> = {
  CREDITO: "CREDITO",
  CREDITO_PARCELADO: "CREDITO",
  DEBITO: "DEBITO",
  PIX: "PIX",
  VOUCHER: "VOUCHER",
};

/**
 * POST /api/maquininha/pagamentos — registra o que a maquininha já cobrou.
 *
 * Chega **depois** de a credenciadora aprovar: aqui não se cobra nada, só se
 * conta o que aconteceu. Por isso a `referencia` é obrigatória — a maquininha
 * reenvia este mesmo corpo quando a rede cai, e o servidor precisa reconhecer
 * o reenvio em vez de registrar um segundo pagamento.
 *
 * Sem comanda é venda de balcão: o cliente em pé que não abriu conta. Ela abre
 * a própria comanda e segue por este mesmo caminho — ver `lib/balcao`.
 */
export async function POST(request: NextRequest) {
  const unidade = await unidadeDoAparelho(request);
  if (!unidade?.ativo) {
    return NextResponse.json({ erro: "Token do aparelho inválido." }, { status: 401 });
  }
  declararTenant(unidade.tenantId);

  const operador = await operadorDaRequisicao(request, unidade);
  if (!operador) {
    return NextResponse.json({ erro: "Sessão do operador expirada." }, { status: 401 });
  }

  /*
   * Receber pagamento é conferido aqui, e não só na porta do turno.
   *
   * Enquanto o aparelho só cobrava, bastava o PIN: entrar era poder receber.
   * Agora o garçom também entra — para lançar a rodada e abrir mesa —, e sem
   * esta conferência o turno dele passaria a registrar pagamento, que é a
   * permissão que o cargo dele não tem no salão.
   */
  const podeReceber = podeNoAparelho(operador.permissoes, "comanda.receberPagamento");
  if (!podeReceber) {
    return NextResponse.json(
      { erro: "Seu acesso não permite receber pagamento." },
      { status: 403 }
    );
  }

  let corpo: {
    comandaId?: string;
    referencia?: string;
    forma?: string;
    valorEmCentavos?: number;
    nsu?: string;
    bandeira?: string;
    finalizar?: boolean;
  };
  try {
    corpo = (await request.json()) as typeof corpo;
  } catch {
    return NextResponse.json({ erro: "Corpo inválido: envie JSON." }, { status: 400 });
  }

  const daMesa = typeof corpo.comandaId === "string" ? corpo.comandaId : "";
  const referencia = typeof corpo.referencia === "string" ? corpo.referencia.trim() : "";
  const tipo = TIPO_DA_FORMA[String(corpo.forma ?? "")];
  const valorEmCentavos = corpo.valorEmCentavos;

  if (!referencia) return NextResponse.json({ erro: "Informe a referência." }, { status: 400 });
  if (!referenciaCabe(referencia)) {
    return NextResponse.json({ erro: "Referência comprida demais." }, { status: 400 });
  }
  if (!tipo) return NextResponse.json({ erro: "Forma de pagamento desconhecida." }, { status: 400 });
  if (!Number.isSafeInteger(valorEmCentavos) || (valorEmCentavos as number) <= 0) {
    return NextResponse.json({ erro: "Valor inválido." }, { status: 400 });
  }
  if ((valorEmCentavos as number) > TETO_EM_CENTAVOS) {
    return NextResponse.json({ erro: "Valor alto demais para uma venda." }, { status: 400 });
  }

  /*
   * Qual forma é esta, quando a casa tem mais de uma do mesmo tipo.
   *
   * O aparelho manda o tipo, que é o que a credenciadora precisa saber para
   * passar o cartão; a forma é a escrituração — nome, taxa e prazo. Uma casa
   * com "Cartão de Crédito" a 3,2% no balcão e "Crédito Stone" a 1,9% na
   * maquininha tinha todas as vendas do aparelho caindo na primeira por ordem
   * alfabética, com a taxa errada **congelada** no pagamento: o custo do mês
   * sai torto e não há como corrigir depois.
   *
   * A marcada ganha; sem marcação, a única do tipo; e só então a ordem
   * alfabética, que ao menos é estável. A tela de formas avisa quando há mais
   * de uma ativa sem ninguém marcado.
   */
  const candidatas = await db.formaPagamento.findMany({
    where: { tenantId: unidade.tenantId, tipo: tipo as never, ativo: true },
    orderBy: { nome: "asc" },
    select: { id: true, nome: true, naMaquininha: true },
  });
  const forma = candidatas.find((f) => f.naMaquininha) ?? candidatas[0];
  if (!forma) {
    return NextResponse.json(
      { erro: `Nenhuma forma de pagamento do tipo ${tipo} cadastrada no restaurante.` },
      { status: 409 }
    );
  }

  /*
   * Sem comanda, a venda abre a dela — depois de a forma estar resolvida.
   *
   * A comanda vem antes do pagamento de propósito: se a rede cair entre as
   * duas, fica uma comanda de balcão aberta, com valor, que o reenvio da fila
   * completa quando o caixa abrir. Na ordem inversa ficaria um pagamento sem
   * onde morar, que é o buraco que esta rota veio tapar.
   *
   * Mas só depois da forma. A casa que nunca cadastrou vale-refeição e recebe
   * um no aparelho é recusada aqui, e a recusa não espera nada: abrindo a
   * comanda antes, ela ficaria para trás **aberta** — e comanda de balcão não
   * tem mesa, então nenhuma tela a mostra (o mapa do salão só monta as que
   * têm mesa) e ninguém consegue fechá-la. Como `fecharCaixa` recusa
   * enquanto houver comanda aberta na unidade, a noite acabava sem fechar por
   * causa de uma comanda invisível.
   */
  const ehDeBalcao = !daMesa;
  let comandaId = daMesa;
  if (ehDeBalcao) {
    const aberta = await emResultado(() =>
      comandaDeBalcao(operador, {
        referencia,
        valorEmCentavos: valorEmCentavos as number,
      })
    );
    if (temErro(aberta)) return NextResponse.json({ erro: aberta.erro }, { status: 409 });
    comandaId = aberta.comandaId;
  }

  const conta = await contaDaComanda(comandaId);
  if (!conta || conta.comanda.unidadeId !== unidade.id) {
    return NextResponse.json({ erro: "Conta não encontrada." }, { status: 404 });
  }

  const resposta = await emResultado(async () => {
    const { falta, jaRegistrado } = await receberPagamento(operador, {
      comandaId,
      formaPagamentoId: forma.id,
      valor: (valorEmCentavos as number) / 100,
      troco: 0,
      nsu: corpo.nsu ?? null,
      bandeira: corpo.bandeira ?? null,
      referenciaExterna: referencia,
    });

    /*
     * Quitou: a conta fecha aqui mesmo, e não numa segunda chamada. Entre uma
     * e outra a rede pode cair, e a mesa ficaria paga e aberta no mapa — que
     * é o estado que faz o salão cobrar o cliente duas vezes.
     *
     * Quem não pode fechar conta recebe assim mesmo; só não fecha. É o caso
     * de quem só tem `comanda.receberPagamento`.
     */
    /*
     * A venda de balcão fecha sempre, sem pedir `comanda.fechar`.
     *
     * Fechar a conta de uma mesa é decidir que o cliente terminou, e por isso
     * é permissão de quem decide. A venda de balcão já nasceu terminada: o
     * cliente pagou e foi embora. Deixá-la aberta porque o cargo não fecha
     * mesa poria uma comanda sem mesa no mapa do salão, com tudo já pago,
     * esperando alguém entender o que é aquilo.
     */
    const podeFechar = ehDeBalcao || podeNoAparelho(operador.permissoes, "comanda.fechar");
    /*
     * `finalizar: false` é da conta de mesa: o caixa recebe uma parte e a
     * conta continua aberta para o resto da noite. A venda de balcão não tem
     * essa escolha — pelo mesmo motivo que não pede `comanda.fechar`. Aberta,
     * ela é uma comanda sem mesa, tudo pago, que nenhuma tela mostra e que
     * tranca o fechamento do caixa no fim da noite.
     */
    const deixarAberta = !ehDeBalcao && corpo.finalizar === false;
    const quitada = falta <= TOLERANCIA;
    const finalizada = quitada && podeFechar && !deixarAberta
      ? await finalizarConta(operador, comandaId)
      : false;

    return {
      ok: true as const,
      jaRegistrado,
      deBalcao: ehDeBalcao,
      forma: forma.nome,
      faltaEmCentavos: emCentavos(falta),
      quitada,
      finalizada,
    };
  });

  // Regra de negócio recusada volta como 409 com a mensagem: é o que a
  // maquininha mostra ao operador, que está com o cliente na frente.
  if (temErro(resposta)) return NextResponse.json({ erro: resposta.erro }, { status: 409 });
  return NextResponse.json(resposta);
}
