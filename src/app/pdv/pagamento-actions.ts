"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { CONSUMO } from "@/lib/itens";
import { calcularTotais, centavos, TOLERANCIA } from "@/lib/comanda";
import { exigirPermissao, exigirSessao } from "@/lib/session";
import { enfileirarConferencia } from "@/lib/fila-impressao";
import { marcarFechando, reabrirConta } from "@/lib/fechamento";
import { finalizarConta, receberPagamento } from "@/lib/conta";
import { publicar } from "@/lib/eventos";
import { auditoria } from "@/lib/auditoria-servidor";
import { dinheiroNaGaveta } from "@/lib/caixa";
import { porQueOCaixaNaoFecha } from "@/lib/comandas-abertas";
import { ajusteBooleano } from "@/lib/parametros-servidor";
import { liberar } from "@/lib/autorizacao-servidor";
import type { PrecisaAutorizacao } from "@/lib/autorizacao";
import { emResultado, ErroDeOperacao, type ComErro } from "@/lib/erro-de-operacao";

type Turno = "DIA" | "INTERMEDIARIO" | "NOITE" | "MADRUGADA";

/**
 * Abre o caixa da unidade de quem está logado.
 *
 * A unidade vem da sessão, e não de um parâmetro. Antes ela vinha do
 * navegador: a conferência pegava unidade de outro restaurante, mas não
 * unidade de outra filial do mesmo — e server action é endpoint público,
 * chamável com o argumento que se quiser. Numa casa com duas unidades, o caixa
 * de uma podia abrir o caixa da outra. A sessão já sabe onde a pessoa está.
 */
export async function abrirCaixa(turno: Turno, fundoCaixa: number) {
  return emResultado(async () => {
    const sessao = await exigirPermissao("caixa.abrir");
    const unidadeId = sessao.unidadeId;

    const aberto = await db.caixa.findFirst({
      where: { unidadeId, tipo: "GERAL", status: "ABERTO" },
    });
    if (aberto) return { caixaId: aberto.id };

    // Abrir com zero faz o primeiro cliente que pagar em dinheiro ficar sem troco.
    if (fundoCaixa <= 0 && (await ajusteBooleano(unidadeId, "caixa.exigirFundoNaAbertura"))) {
      throw new ErroDeOperacao("Informe o fundo de troco para abrir o caixa.");
    }

    // A data do caixa é o dia da operação, não o instante — um caixa de
    // madrugada aberto às 00:30 ainda pertence ao movimento da noite anterior.
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    const caixa = await db.caixa.create({
      data: {
        tenantId: sessao.tenantId,
        unidadeId,
        tipo: "GERAL",
        data: hoje,
        turno,
        fundoCaixa,
        abertoPorId: sessao.usuarioId,
      },
    });

    revalidatePath("/pdv");
    // A barra mostra "Caixa fechado" em todo tablet: abrir o caixa apaga o aviso
    // nos aparelhos de todo mundo, não só no de quem abriu.
    await publicar(sessao.unidadeId, "caixa");
    return { caixaId: caixa.id };
  });
}

export async function fecharCaixa(caixaId: string, valorInformado: number) {
  return emResultado(async () => {
    const sessao = await exigirPermissao("caixa.fechar");

    const caixa = await db.caixa.findUniqueOrThrow({
      where: { id: caixaId },
      include: {
        pagamentos: { include: { formaPagamento: { select: { tipo: true } } } },
        movimentos: true,
      },
    });
    if (caixa.tenantId !== sessao.tenantId) throw new ErroDeOperacao("Caixa de outro restaurante.");
    /**
     * E a unidade, não só o restaurante.
     *
     * O `caixaId` vem do navegador e o RLS é por **restaurante**: a gaveta da
     * filial existe para a sessão da matriz. Fechar é assinar um número — o
     * valor contado, a divergência e o nome de quem fechou —, e assinar o
     * turno de outra cidade, que nem acabou, é o estrago. `receberPagamento` e
     * `finalizarConta` já conferem as duas coisas; aqui faltava a segunda.
     */
    if (caixa.unidadeId !== sessao.unidadeId) throw new ErroDeOperacao("Caixa de outra unidade.");
    /**
     * Caixa fechado é número assinado. Fechar de novo regravava o valor
     * informado, a divergência e quem fechou — uma falta de ontem sumia com
     * um toque, e o diário ficava com dois fechamentos do mesmo caixa.
     */
    if (caixa.status !== "ABERTO") throw new ErroDeOperacao("Este caixa já foi fechado.");
    if (!Number.isFinite(valorInformado) || valorInformado < 0) {
      throw new ErroDeOperacao("Informe o valor contado na gaveta.");
    }

    /*
     * Quais, e não quantas.
     *
     * "Ainda há 1 comanda(s) aberta(s)" mandava o caixa procurar no mapa do
     * salão — e a comanda de balcão não está lá, porque o mapa só monta as que
     * têm mesa. A noite acabava sem fechar por causa de uma comanda que
     * ninguém conseguia achar.
     */
    const abertas = await db.comanda.findMany({
      where: { unidadeId: caixa.unidadeId, status: { in: ["ABERTA", "FECHANDO"] } },
      orderBy: { numero: "asc" },
      select: { numero: true, mesa: { select: { numero: true } } },
    });
    if (abertas.length > 0) {
      throw new ErroDeOperacao(
        porQueOCaixaNaoFecha(
          abertas.map((c) => ({ numero: c.numero, mesa: c.mesa?.numero ?? null }))
        )
      );
    }

    const { valorApurado, divergencia } = await db.$transaction(async (tx) => {
      /**
       * O caixa travado, e relido dentro da trava.
       *
       * Lido antes, sem trava: dois toques em "fechar" passavam os dois pela
       * conferência de "ainda aberto" e o segundo regravava o valor contado e
       * a divergência do primeiro; e uma sangria no mesmo instante entrava num
       * caixa já apurado sem ela — a gaveta fechava com R$ 100 a menos que o
       * número assinado. A sangria trava a mesma linha.
       */
      await tx.$queryRaw`SELECT id FROM caixas WHERE id = ${caixaId} FOR UPDATE`;
      const atual = await tx.caixa.findUniqueOrThrow({
        where: { id: caixaId },
        include: {
          pagamentos: { include: { formaPagamento: { select: { tipo: true } } } },
          movimentos: true,
        },
      });
      if (atual.status !== "ABERTO") throw new ErroDeOperacao("Este caixa já foi fechado.");

      // A mesma função que a tela usa para mostrar "esperado na gaveta" durante o
      // turno. Duas contas separadas acabariam divergindo, e a divergência do
      // fechamento passaria a medir o desencontro entre elas, não a da gaveta.
      const valorApurado = gavetaDoCaixa(atual);
      const divergencia = centavos(valorInformado - valorApurado);

      await tx.caixa.update({
        where: { id: caixaId },
        data: {
          status: "FECHADO",
          valorInformado,
          valorApurado,
          divergencia,
          fechadoPorId: sessao.usuarioId,
          fechadoEm: new Date(),
        },
      });
      await tx.auditLog.create({
        data: await auditoria(sessao, {
          entidade: "Caixa",
          entidadeId: caixaId,
          acao: "CAIXA_FECHADO",
          // A divergência do turno é o número que o dono compara entre pessoas:
          // uma falta de R$ 5 é contagem, todo sábado é outra conversa.
          depois: { valorApurado, valorInformado, divergencia, turno: atual.turno },
        }),
      });
      return { valorApurado, divergencia };
    });

    revalidatePath("/pdv");
    await publicar(sessao.unidadeId, "caixa");
    return { valorApurado, divergencia };
  });
}

type TipoMovimentoCaixa = "SANGRIA" | "SUPRIMENTO" | "PAGAMENTO" | "RECEBIMENTO";

/** Movimento que tira dinheiro da gaveta. Os outros dois põem. */
const RETIRA: Record<TipoMovimentoCaixa, boolean> = {
  SANGRIA: true,
  PAGAMENTO: true,
  SUPRIMENTO: false,
  RECEBIMENTO: false,
};

const ACAO_DO_MOVIMENTO = {
  SANGRIA: "CAIXA_SANGRIA",
  SUPRIMENTO: "CAIXA_SUPRIMENTO",
  PAGAMENTO: "CAIXA_PAGAMENTO",
  RECEBIMENTO: "CAIXA_RECEBIMENTO",
} as const;

/**
 * Dinheiro que entra ou sai da gaveta fora da venda.
 *
 * Sangria é o gerente levando o dinheiro para o cofre no meio do turno — sem
 * registrar, o caixa fecha faltando dois mil reais todo sábado e a divergência
 * deixa de significar qualquer coisa, que é o pior destino de um número de
 * conferência. Suprimento é troco entrando; pagamento é o gás e o gelo pagos
 * da gaveta; recebimento é o resto.
 *
 * O fechamento já sabia somar isto desde o começo — era o registro que
 * faltava.
 */
export async function registrarMovimentoCaixa(
  caixaId: string,
  tipo: TipoMovimentoCaixa,
  valor: number,
  descricao: string,
  autorizacaoId?: string | null
): Promise<{ ok: true } | PrecisaAutorizacao | ComErro> {
  return emResultado(async () => {
    const liberacao = await liberar(
      await exigirSessao(),
      "caixa.sangria",
      "SANGRIA",
      caixaId,
      autorizacaoId
    );
    if (!liberacao) return { precisaAutorizacao: "SANGRIA" };
    const { sessao, aprovadoPor } = liberacao;

    if (!Number.isFinite(valor) || valor <= 0) throw new ErroDeOperacao("Informe um valor maior que zero.");

    const limpo = descricao.trim();
    // Sem descrição, "sangria de R$ 2.000" não responde nada a quem conferir
    // depois — e é justamente aí que alguém vai querer conferir.
    if (!limpo) throw new ErroDeOperacao("Descreva o movimento (para onde foi, quem levou).");

    const caixa = await db.caixa.findUniqueOrThrow({
      where: { id: caixaId },
      include: {
        pagamentos: { include: { formaPagamento: { select: { tipo: true } } } },
        movimentos: true,
      },
    });
    if (caixa.tenantId !== sessao.tenantId) throw new ErroDeOperacao("Caixa de outro restaurante.");
    if (caixa.unidadeId !== sessao.unidadeId) throw new ErroDeOperacao("Caixa de outra unidade.");
    if (caixa.status !== "ABERTO") throw new ErroDeOperacao("Este caixa já foi fechado.");

    const naGaveta = gavetaDoCaixa(caixa);

    // Não dá para tirar o que não está lá. Bloquear aqui transforma um erro de
    // digitação — um zero a mais — em aviso na hora, em vez de uma gaveta
    // negativa que ninguém entende no fechamento.
    if (RETIRA[tipo] && valor > naGaveta + TOLERANCIA) {
      throw new ErroDeOperacao(
        `A gaveta tem ${naGaveta.toFixed(2).replace(".", ",")} em dinheiro. Não dá para retirar mais que isso.`
      );
    }

    const registro = await auditoria(sessao, {
      entidade: "Caixa",
      entidadeId: caixaId,
      acao: ACAO_DO_MOVIMENTO[tipo],
      depois: {
        valor,
        descricao: limpo,
        turno: caixa.turno,
        ...(aprovadoPor ? { autorizadoPor: aprovadoPor.nome } : {}),
      },
    });

    await db.$transaction(async (tx) => {
      // O fechamento trava a mesma linha: ou a sangria entra antes e é
      // apurada, ou encontra o caixa fechado. A gaveta é conferida de novo,
      // porque outra retirada pode ter passado na frente.
      await tx.$queryRaw`SELECT id FROM caixas WHERE id = ${caixaId} FOR UPDATE`;
      const atual = await tx.caixa.findUniqueOrThrow({
        where: { id: caixaId },
        include: {
          pagamentos: { include: { formaPagamento: { select: { tipo: true } } } },
          movimentos: true,
        },
      });
      if (atual.status !== "ABERTO") throw new ErroDeOperacao("Este caixa já foi fechado.");
      const agoraNaGaveta = gavetaDoCaixa(atual);
      if (RETIRA[tipo] && valor > agoraNaGaveta + TOLERANCIA) {
        throw new ErroDeOperacao(
          `A gaveta tem ${agoraNaGaveta.toFixed(2).replace(".", ",")} em dinheiro. Não dá para retirar mais que isso.`
        );
      }

      await tx.movimentoCaixa.create({
        data: {
          tenantId: caixa.tenantId,
          caixaId,
          tipo,
          valor,
          descricao: limpo,
          usuarioId: sessao.usuarioId,
        },
      });
      await tx.auditLog.create({ data: registro });
      await liberacao.consumir(tx);
    });

    revalidatePath("/pdv");
    await publicar(sessao.unidadeId, "caixa");
    return { ok: true };
  });
}

/** Traduz as linhas do banco para a conta pura de `lib/caixa`. */
function gavetaDoCaixa(caixa: {
  fundoCaixa: unknown;
  pagamentos: { valor: unknown; troco: unknown; formaPagamento: { tipo: string } }[];
  movimentos: { tipo: string; valor: unknown }[];
}) {
  return dinheiroNaGaveta({
    fundoCaixa: Number(caixa.fundoCaixa),
    // Só dinheiro é conferido na gaveta; cartão e Pix não passam por ela.
    recebidoEmEspecie: caixa.pagamentos
      .filter((p) => p.formaPagamento.tipo === "DINHEIRO")
      .reduce((soma, p) => soma + Number(p.valor) - Number(p.troco), 0),
    movimentos: caixa.movimentos.map((m) => ({ tipo: m.tipo, valor: Number(m.valor) })),
  });
}

/** Imprime a conta para o cliente conferir antes de pagar. */
export async function imprimirConferencia(comandaId: string, segundaVia = false) {
  return emResultado(async () => {
    const sessao = await exigirSessao();

    const comanda = await db.comanda.findUniqueOrThrow({ where: { id: comandaId } });
    if (comanda.tenantId !== sessao.tenantId) throw new ErroDeOperacao("Comanda de outro restaurante.");

    await enfileirarConferencia(comandaId, segundaVia);
    revalidatePath("/pdv");
    revalidatePath("/gestao/impressao");
  });
}

/**
 * Marca a comanda como em fechamento.
 *
 * A regra mora em `@/lib/fechamento`, compartilhada com a maquininha — lá o
 * garçom pede a conta de pé na mesa, e o que acontece com a comanda é o mesmo.
 * O que sobra aqui é a sessão e a tela.
 */
export async function iniciarFechamento(comandaId: string) {
  return emResultado(async () => {
    const sessao = await exigirSessao();
    await marcarFechando(sessao, comandaId);

    revalidatePath("/pdv");
    revalidatePath("/kds");
  });
}

/** Devolve a comanda para aberta. O porquê está em `@/lib/fechamento`. */
export async function reabrirComanda(comandaId: string) {
  return emResultado(async () => {
    const sessao = await exigirPermissao("comanda.lancarItem");
    await reabrirConta(sessao, comandaId);

    revalidatePath("/pdv");
    revalidatePath("/kds");
  });
}

/**
 * Corrige o número de pessoas na hora de pagar.
 *
 * O garçom informa na abertura e o grupo cresce: chegaram mais dois depois da
 * primeira rodada. Sem corrigir, a divisão por pessoa sai errada justamente na
 * tela em que o cliente está olhando.
 */
export async function definirPessoas(comandaId: string, pessoas: number) {
  return emResultado(async () => {
    const sessao = await exigirPermissao("comanda.fechar");

    if (!Number.isInteger(pessoas) || pessoas < 1 || pessoas > 99) {
      throw new ErroDeOperacao("Informe de 1 a 99 pessoas.");
    }

    const comanda = await db.comanda.findUniqueOrThrow({
      where: { id: comandaId },
      select: { tenantId: true },
    });
    if (comanda.tenantId !== sessao.tenantId) throw new ErroDeOperacao("Comanda de outro restaurante.");

    await db.comanda.update({ where: { id: comandaId }, data: { pessoas } });
    revalidatePath("/pdv");
    await publicar(sessao.unidadeId, "conta");
  });
}

export async function definirTaxaServico(comandaId: string, pct: number) {
  return emResultado(async () => {
    // Retirar a taxa é dinheiro a menos para o restaurante — mesma permissão do desconto.
    const sessao = await exigirPermissao("comanda.aplicarDesconto");

    // Taxa negativa é desconto sem PIN e sem motivo: -100% zerava a conta.
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      throw new ErroDeOperacao("A taxa de serviço vai de 0% a 100%.");
    }

    const antes = await db.comanda.findUniqueOrThrow({
      where: { id: comandaId },
      select: { tenantId: true, unidadeId: true, taxaServicoPct: true },
    });
    if (antes.tenantId !== sessao.tenantId) throw new ErroDeOperacao("Comanda de outro restaurante.");
    if (antes.unidadeId !== sessao.unidadeId) throw new ErroDeOperacao("Comanda de outra unidade.");

    await db.$transaction([
      db.comanda.update({ where: { id: comandaId }, data: { taxaServicoPct: pct } }),
      db.auditLog.create({
        data: await auditoria(sessao, {
          entidade: "Comanda",
          entidadeId: comandaId,
          acao: "TAXA_SERVICO",
          antes: { pct: Number(antes.taxaServicoPct) },
          depois: { pct },
        }),
      }),
    ]);

    revalidatePath("/pdv");
    await publicar(sessao.unidadeId, "conta");
  });
}

export async function aplicarDesconto(
  comandaId: string,
  valor: number,
  motivo: string,
  autorizacaoId?: string | null
): Promise<{ ok: true } | PrecisaAutorizacao | ComErro> {
  return emResultado(async () => {
    const liberacao = await liberar(
      await exigirSessao(),
      "comanda.aplicarDesconto",
      "DESCONTO",
      comandaId,
      autorizacaoId
    );
    // Nem o cargo nem uma liberação: a tela pede o PIN de quem pode.
    if (!liberacao) return { precisaAutorizacao: "DESCONTO" };
    const { sessao, aprovadoPor } = liberacao;

    const comanda = await db.comanda.findUniqueOrThrow({
      where: { id: comandaId },
      include: { itens: { where: CONSUMO, select: { precoTotal: true } } },
    });
    // Faltava aqui: todas as outras ações conferem o tenant, esta não conferia.
    if (comanda.tenantId !== sessao.tenantId) throw new ErroDeOperacao("Comanda de outro restaurante.");
    if (comanda.unidadeId !== sessao.unidadeId) throw new ErroDeOperacao("Comanda de outra unidade.");

    /**
     * O total já limitava o desconto ao subtotal, mas o valor gravado não:
     * R$ 417 de desconto numa conta de R$ 41,70 ficava na comanda e no diário,
     * e qualquer relatório de descontos somaria os R$ 417.
     */
    if (!Number.isFinite(valor) || valor < 0) throw new ErroDeOperacao("Informe um desconto válido.");
    const { subtotal } = calcularTotais({
      itens: comanda.itens.map((i) => ({ precoTotal: Number(i.precoTotal) })),
      taxaServicoPct: 0,
      descontoValor: 0,
    });
    if (valor > subtotal + TOLERANCIA) {
      throw new ErroDeOperacao(
        `O desconto não pode passar do consumo (R$ ${subtotal.toFixed(2).replace(".", ",")}).`
      );
    }

    if (valor > 0 && (await ajusteBooleano(comanda.unidadeId, "caixa.exigirMotivoDesconto")) && !motivo.trim()) {
      throw new ErroDeOperacao("Informe o motivo do desconto.");
    }

    const registro = await auditoria(sessao, {
      entidade: "Comanda",
      entidadeId: comandaId,
      acao: "DESCONTO",
      antes: { valor: Number(comanda.descontoValor), motivo: comanda.descontoMotivo },
      // A comanda guarda o desconto atual; o diário guarda cada tentativa.
      // Dois descontos de R$ 20 seguidos deixam a mesma linha na comanda e
      // duas no diário — é a diferença entre saber e supor.
      depois: {
        valor,
        motivo: valor > 0 ? motivo.trim() : null,
        comanda: comanda.numero,
        // O nome de quem liberou vai no diário junto com o de quem fez. Sem
        // isso, o desconto do garçom apareceria como se ele pudesse dar.
        ...(aprovadoPor ? { autorizadoPor: aprovadoPor.nome } : {}),
      },
    });

    await db.$transaction(async (tx) => {
      await tx.comanda.update({
        where: { id: comandaId },
        data: { descontoValor: valor, descontoMotivo: valor > 0 ? motivo.trim() : null },
      });
      await tx.auditLog.create({ data: registro });
      // A liberação é gasta na mesma transação do desconto: falhou o desconto,
      // a autorização continua valendo para a próxima tentativa.
      await liberacao.consumir(tx);
    });

    revalidatePath("/pdv");
    await publicar(sessao.unidadeId, "conta");
    return { ok: true };
  });
}

export async function registrarPagamento(
  comandaId: string,
  formaPagamentoId: string,
  valor: number,
  troco: number
) {
  return emResultado(async () => {
    const sessao = await exigirPermissao("comanda.receberPagamento");

    // A regra mora em `lib/conta`: a maquininha recebe pela mesma função, com
    // o operador do PIN no lugar da sessão do navegador.
    await receberPagamento(sessao, { comandaId, formaPagamentoId, valor, troco });

    revalidatePath("/pdv");
  });
}

export async function estornarPagamento(pagamentoId: string) {
  return emResultado(async () => {
    const sessao = await exigirPermissao("comanda.receberPagamento");

    const pagamento = await db.pagamento.findUniqueOrThrow({
      where: { id: pagamentoId },
      include: {
        comanda: { select: { id: true, status: true, mesaId: true, tenantId: true } },
        caixa: { select: { status: true } },
      },
    });
    if (pagamento.comanda.tenantId !== sessao.tenantId) {
      throw new ErroDeOperacao("Pagamento de outro restaurante.");
    }

    /*
     * Estorno é para corrigir um fechamento em andamento — forma errada, valor
     * digitado errado, cliente que resolveu continuar. Depois disso, é
     * proibido, por decisão do dono:
     *
     * - Conta já paga: apagar o pagamento deixava a comanda PAGA e devendo — a
     *   venda seguia no faturamento como recebida, com o dinheiro fora.
     * - Caixa já fechado: o fechamento é um número assinado por alguém, com a
     *   contagem da gaveta. O estorno reescrevia o apurado de um turno que já
     *   foi conferido e entregue.
     *
     * Devolução ao cliente depois disso sai como sangria, com o motivo — fica
     * no caixa de hoje, e o de ontem continua sendo o de ontem.
     */
    if (pagamento.caixa?.status === "FECHADO") {
      throw new ErroDeOperacao(
        "O caixa deste pagamento já foi fechado. Para devolver ao cliente, registre uma sangria no caixa de hoje, com o motivo."
      );
    }
    if (pagamento.comanda.status === "PAGA") {
      throw new ErroDeOperacao(
        "Esta conta já foi paga e fechada. Para devolver ao cliente, registre uma sangria com o motivo."
      );
    }

    // O pagamento desaparece da tabela: se o diário não guardar o valor agora,
    // não sobra nenhum rastro de que R$ 300 entraram e saíram.
    const registro = await auditoria(sessao, {
      entidade: "Pagamento",
      entidadeId: pagamentoId,
      acao: "PAGAMENTO_ESTORNADO",
      antes: {
        valor: Number(pagamento.valor),
        troco: Number(pagamento.troco),
        comandaId: pagamento.comanda.id,
      },
    });

    await db.$transaction(async (tx) => {
      /**
       * As duas proibições acima, conferidas de novo dentro da trava.
       *
       * Conferidas só antes, um "finalizar" no mesmo instante fechava a conta
       * entre a conferência e a exclusão: a conta ficava PAGA sem o pagamento
       * — o que a proibição existe para impedir. A finalização trava a mesma
       * linha da comanda; o segundo a chegar encontra o que o primeiro fez.
       */
      await tx.$queryRaw`SELECT id FROM comandas WHERE id = ${pagamento.comanda.id} FOR UPDATE`;
      const atual = await tx.pagamento.findUnique({
        where: { id: pagamentoId },
        select: { comanda: { select: { status: true } }, caixa: { select: { status: true } } },
      });
      // Dois toques em "estornar": o primeiro já apagou.
      if (!atual) throw new ErroDeOperacao("Este pagamento já foi estornado.");
      if (atual.caixa?.status === "FECHADO") {
        throw new ErroDeOperacao(
          "O caixa deste pagamento já foi fechado. Para devolver ao cliente, registre uma sangria no caixa de hoje, com o motivo."
        );
      }
      if (atual.comanda.status === "PAGA") {
        throw new ErroDeOperacao(
          "Esta conta já foi paga e fechada. Para devolver ao cliente, registre uma sangria com o motivo."
        );
      }

      await tx.pagamento.delete({ where: { id: pagamentoId } });
      await tx.auditLog.create({ data: registro });

      /**
       * Estornar tudo é o sinal de que o fechamento foi desfeito — mesa errada,
       * ou o cliente resolveu continuar. A comanda volta a aceitar lançamento sem
       * exigir um clique a mais.
       *
       * Quando o caixa só troca a forma de pagamento, a mesa pisca azul por
       * alguns segundos e volta ao laranja no lançamento seguinte: inofensivo.
       */
      const restantes = await tx.pagamento.count({ where: { comandaId: pagamento.comanda.id } });
      if (restantes === 0 && atual.comanda.status === "FECHANDO") {
        await tx.comanda.update({
          where: { id: pagamento.comanda.id },
          data: { status: "ABERTA" },
        });
        if (pagamento.comanda.mesaId) {
          await tx.mesa.update({
            where: { id: pagamento.comanda.mesaId },
            data: { status: "OCUPADA" },
          });
        }
      }
    });

    revalidatePath("/pdv");
    await publicar(sessao.unidadeId, "pagamento");
  });
}

/**
 * Quita a comanda e devolve a mesa para o salão. Só passa se o recebido cobrir
 * o total — caso contrário a mesa sairia do mapa com dinheiro faltando.
 */
export async function finalizarComanda(comandaId: string) {
  return emResultado(async () => {
    const sessao = await exigirPermissao("comanda.fechar");
    await finalizarConta(sessao, comandaId);
    revalidatePath("/pdv");
  });
}
