"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { CONSUMO } from "@/lib/itens";
import { calcularTotais, centavos, TOLERANCIA } from "@/lib/comanda";
import { exigirPermissao, exigirSessao } from "@/lib/session";
import { enfileirarConferencia, enfileirarCupom } from "@/lib/fila-impressao";
import { emitirNfce } from "@/lib/fiscal/emitir";
import { publicar } from "@/lib/eventos";
import { auditoria } from "@/lib/auditoria-servidor";
import { dinheiroNaGaveta } from "@/lib/caixa";
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

    const comandasAbertas = await db.comanda.count({
      where: { unidadeId: caixa.unidadeId, status: { in: ["ABERTA", "FECHANDO"] } },
    });
    if (comandasAbertas > 0) {
      throw new ErroDeOperacao(
        `Ainda há ${comandasAbertas} comanda(s) aberta(s). Feche todas antes de fechar o caixa.`
      );
    }

    // A mesma função que a tela usa para mostrar "esperado na gaveta" durante o
    // turno. Duas contas separadas acabariam divergindo, e a divergência do
    // fechamento passaria a medir o desencontro entre elas, não a da gaveta.
    const valorApurado = gavetaDoCaixa(caixa);

    const divergencia = centavos(valorInformado - valorApurado);

    await db.$transaction([
      db.caixa.update({
        where: { id: caixaId },
        data: {
          status: "FECHADO",
          valorInformado,
          valorApurado,
          divergencia,
          fechadoPorId: sessao.usuarioId,
          fechadoEm: new Date(),
        },
      }),
      db.auditLog.create({
        data: await auditoria(sessao, {
          entidade: "Caixa",
          entidadeId: caixaId,
          acao: "CAIXA_FECHADO",
          // A divergência do turno é o número que o dono compara entre pessoas:
          // uma falta de R$ 5 é contagem, todo sábado é outra conversa.
          depois: { valorApurado, valorInformado, divergencia, turno: caixa.turno },
        }),
      }),
    ]);

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
    const liberacao = await liberar("caixa.sangria", "SANGRIA", caixaId, autorizacaoId);
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
 * É o que acende a mesa em laranja no mapa: o salão inteiro passa a ver que
 * aquela mesa pediu a conta, e o caixa sabe onde vai precisar. Enquanto está
 * assim, ninguém lança item novo sem reabrir.
 */
export async function iniciarFechamento(comandaId: string) {
  return emResultado(async () => {
    const sessao = await exigirSessao();

    const comanda = await db.comanda.findUniqueOrThrow({ where: { id: comandaId } });
    if (comanda.tenantId !== sessao.tenantId) throw new ErroDeOperacao("Comanda de outro restaurante.");
    // Já fechando ou já paga: nada a fazer, e não é erro.
    if (comanda.status !== "ABERTA") return;

    await db.$transaction(async (tx) => {
      await tx.comanda.update({ where: { id: comandaId }, data: { status: "FECHANDO" } });
      if (comanda.mesaId) {
        await tx.mesa.update({ where: { id: comanda.mesaId }, data: { status: "FECHANDO" } });
      }
    });

    revalidatePath("/pdv");
    revalidatePath("/kds");
    // A cozinha marca o ticket dessa mesa: ou apressa o prato, ou cancela.
    await publicar(sessao.unidadeId, "conta-pedida");
  });
}

/**
 * Devolve a comanda para aberta.
 *
 * "Traz mais uma cerveja" depois de pedir a conta é a coisa mais comum do
 * mundo num restaurante. Travar isso faria o garçom burlar o sistema —
 * lançar na mesa do lado, anotar no papel. Por isso qualquer garçom reabre;
 * o que já foi pago continua registrado e entra no novo total.
 */
export async function reabrirComanda(comandaId: string) {
  return emResultado(async () => {
    const sessao = await exigirPermissao("comanda.lancarItem");

    const comanda = await db.comanda.findUniqueOrThrow({ where: { id: comandaId } });
    if (comanda.tenantId !== sessao.tenantId) throw new ErroDeOperacao("Comanda de outro restaurante.");
    if (comanda.status === "PAGA") throw new ErroDeOperacao("Comanda já paga. Abra uma nova.");
    if (comanda.status === "ABERTA") return;

    const registro = await auditoria(sessao, {
      entidade: "Comanda",
      entidadeId: comandaId,
      acao: "CONTA_REABERTA",
      antes: { status: comanda.status },
      depois: { status: "ABERTA", comanda: comanda.numero },
    });

    await db.$transaction(async (tx) => {
      await tx.comanda.update({ where: { id: comandaId }, data: { status: "ABERTA" } });
      if (comanda.mesaId) {
        await tx.mesa.update({ where: { id: comanda.mesaId }, data: { status: "OCUPADA" } });
      }
      await tx.auditLog.create({ data: registro });
    });

    revalidatePath("/pdv");
    revalidatePath("/kds");
    await publicar(sessao.unidadeId, "conta-reaberta");
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
      select: { tenantId: true, taxaServicoPct: true },
    });
    if (antes.tenantId !== sessao.tenantId) throw new ErroDeOperacao("Comanda de outro restaurante.");

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

    /**
     * Valor e troco chegam do navegador. Sem esta conferência, pagamento
     * negativo abatia a conta, troco maior que o valor virava dinheiro
     * negativo no Painel, e NaN estourava como erro de sistema expondo a
     * consulta inteira.
     */
    if (!Number.isFinite(valor) || valor <= 0) throw new ErroDeOperacao("Informe um valor maior que zero.");
    if (!Number.isFinite(troco) || troco < 0) throw new ErroDeOperacao("Troco inválido.");
    if (troco >= valor) throw new ErroDeOperacao("O troco não pode ser maior que o valor entregue.");

    const comanda = await db.comanda.findUniqueOrThrow({ where: { id: comandaId } });
    if (comanda.tenantId !== sessao.tenantId) throw new ErroDeOperacao("Comanda de outro restaurante.");
    if (comanda.status === "PAGA") throw new ErroDeOperacao("Comanda já está paga.");

    const caixa = await db.caixa.findFirst({
      where: { unidadeId: comanda.unidadeId, tipo: "GERAL", status: "ABERTO" },
    });
    if (!caixa) throw new ErroDeOperacao("Nenhum caixa aberto. Abra o caixa antes de receber.");

    /**
     * A taxa da adquirente é copiada para dentro do pagamento, não consultada
     * depois.
     *
     * O painel multiplicava cada pagamento pela taxa cadastrada hoje, e
     * renegociar com a maquininha reescrevia o custo de um mês já fechado: o
     * número de ontem virava outro hoje sem nada ter acontecido. Congelada
     * aqui, a conta do mês passado fica parada como deve.
     *
     * `findUnique` e não `findUniqueOrThrow`: forma apagada entre a escolha na
     * tela e o clique é caso de erro legível, não de exceção minificada.
     */
    const forma = await db.formaPagamento.findUnique({
      where: { id: formaPagamentoId },
      select: { tenantId: true, ativo: true, taxaPct: true, tipo: true },
    });
    if (!forma || forma.tenantId !== sessao.tenantId) {
      throw new ErroDeOperacao("Forma de pagamento não encontrada.");
    }
    if (!forma.ativo) throw new ErroDeOperacao("Esta forma de pagamento está desativada.");
    // Só dinheiro tem troco: cartão e Pix são cobrados no valor exato.
    if (troco > 0 && forma.tipo !== "DINHEIRO") throw new ErroDeOperacao("Só pagamento em dinheiro tem troco.");

    const taxaPct = Number(forma.taxaPct);
    // Troco fora da base: a adquirente cobra sobre o que passou na maquininha,
    // e o que voltou para a mão do cliente nunca passou.
    const taxaValor = centavos(((valor - troco) * taxaPct) / 100);

    /**
     * Dois toques em "receber" cobravam duas vezes: R$ 91,74 numa conta de
     * R$ 45,87. A comanda é travada para a conta e a gravação acontecerem
     * juntas — o segundo toque espera o primeiro e encontra a conta quitada.
     * E ninguém recebe mais do que falta: o que passar disso é troco, e troco
     * se lança como troco.
     */
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM comandas WHERE id = ${comandaId} FOR UPDATE`;
      const atual = await tx.comanda.findUniqueOrThrow({
        where: { id: comandaId },
        include: {
          itens: { where: CONSUMO, select: { precoTotal: true } },
          pagamentos: { select: { valor: true, troco: true } },
        },
      });
      if (atual.status === "PAGA") throw new ErroDeOperacao("Comanda já está paga.");

      const { total } = calcularTotais({
        itens: atual.itens.map((i) => ({ precoTotal: Number(i.precoTotal) })),
        taxaServicoPct: Number(atual.taxaServicoPct),
        descontoValor: Number(atual.descontoValor),
      });
      const recebido = centavos(atual.pagamentos.reduce((s, p) => s + Number(p.valor) - Number(p.troco), 0));
      const falta = centavos(total - recebido);
      if (falta <= TOLERANCIA) throw new ErroDeOperacao("Esta conta já está quitada.");
      if (valor - troco > falta + TOLERANCIA) {
        throw new ErroDeOperacao(`Falta receber só R$ ${falta.toFixed(2).replace(".", ",")}.`);
      }

      await tx.pagamento.create({
        data: {
          tenantId: comanda.tenantId,
          comandaId,
          caixaId: caixa.id,
          formaPagamentoId,
          valor,
          troco,
          taxaPct,
          taxaValor,
          usuarioId: sessao.usuarioId,
        },
      });
    });

    revalidatePath("/pdv");
    await publicar(sessao.unidadeId, "pagamento");
  });
}

export async function estornarPagamento(pagamentoId: string) {
  return emResultado(async () => {
    const sessao = await exigirPermissao("comanda.receberPagamento");

    const pagamento = await db.pagamento.findUniqueOrThrow({
      where: { id: pagamentoId },
      include: { comanda: { select: { id: true, status: true, mesaId: true, tenantId: true } } },
    });
    if (pagamento.comanda.tenantId !== sessao.tenantId) {
      throw new ErroDeOperacao("Pagamento de outro restaurante.");
    }

    // O pagamento desaparece da tabela: se o diário não guardar o valor agora,
    // não sobra nenhum rastro de que R$ 300 entraram e saíram.
    await db.$transaction([
      db.pagamento.delete({ where: { id: pagamentoId } }),
      db.auditLog.create({
        data: await auditoria(sessao, {
          entidade: "Pagamento",
          entidadeId: pagamentoId,
          acao: "PAGAMENTO_ESTORNADO",
          antes: {
            valor: Number(pagamento.valor),
            troco: Number(pagamento.troco),
            comandaId: pagamento.comanda.id,
          },
        }),
      }),
    ]);

    /**
     * Estornar tudo é o sinal de que o fechamento foi desfeito — mesa errada,
     * ou o cliente resolveu continuar. A comanda volta a aceitar lançamento sem
     * exigir um clique a mais.
     *
     * Quando o caixa só troca a forma de pagamento, a mesa pisca azul por
     * alguns segundos e volta ao laranja no lançamento seguinte: inofensivo.
     */
    const restantes = await db.pagamento.count({ where: { comandaId: pagamento.comanda.id } });
    if (restantes === 0 && pagamento.comanda.status === "FECHANDO") {
      await db.$transaction(async (tx) => {
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
      });
    }

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

    const comanda = await db.comanda.findUniqueOrThrow({
      where: { id: comandaId },
      include: {
        itens: { where: CONSUMO, select: { precoTotal: true } },
        pagamentos: { select: { valor: true, troco: true } },
      },
    });
    if (comanda.status === "PAGA") return;

    const { total } = calcularTotais({
      itens: comanda.itens.map((i) => ({ precoTotal: Number(i.precoTotal) })),
      taxaServicoPct: Number(comanda.taxaServicoPct),
      descontoValor: Number(comanda.descontoValor),
    });

    const recebido = centavos(
      comanda.pagamentos.reduce((soma, p) => soma + Number(p.valor) - Number(p.troco), 0)
    );

    if (recebido + TOLERANCIA < total) {
      throw new ErroDeOperacao(
        `Faltam R$ ${(total - recebido).toFixed(2).replace(".", ",")} para quitar a comanda.`
      );
    }

    const caixa = await db.caixa.findFirst({
      where: { unidadeId: comanda.unidadeId, tipo: "GERAL", status: "ABERTO" },
    });

    const limparAuto = await db.parametroUnidade.findUnique({
      where: {
        unidadeId_chave: { unidadeId: comanda.unidadeId, chave: "mesa.limparAutomaticamente" },
      },
    });

    await db.$transaction(async (tx) => {
      await tx.comanda.update({
        where: { id: comandaId },
        data: { status: "PAGA", fechadaEm: new Date(), caixaId: caixa?.id ?? null },
      });
      /**
       * Carrinho fica fora. O item PENDENTE nunca foi enviado nem cobrado —
       * o total acima o exclui —, mas virava ENTREGUE aqui: a conta paga
       * passava a ter um item não pago, que entrava no faturamento sem ter
       * baixado estoque.
       */
      await tx.comandaItem.updateMany({
        where: { comandaId, status: { notIn: ["CANCELADO", "ENTREGUE", "PENDENTE"] } },
        data: { status: "ENTREGUE" },
      });
      if (comanda.mesaId) {
        await tx.mesa.update({
          where: { id: comanda.mesaId },
          // Onde a limpeza não é automática, a mesa fica SUJA até alguém liberar.
          data: { status: limparAuto?.valor === false ? "SUJA" : "LIVRE" },
        });
      }
    });

    // A conta já foi paga; se o cupom falhar, ninguém segura o cliente na porta.
    try {
      await enfileirarCupom(comandaId, sessao.nome);
    } catch (e) {
      console.error("Falha ao enfileirar cupom", e);
    }

    // Mesma regra para a nota: problema fiscal vira pendência para a gestão
    // resolver, nunca venda travada com o cliente esperando no caixa.
    try {
      const nota = await emitirNfce(comandaId, sessao.usuarioId);
      if (!nota.ok) console.error("NFC-e não autorizada:", nota.motivo);
    } catch (e) {
      console.error("Falha ao emitir NFC-e", e);
    }

    revalidatePath("/pdv");
    await publicar(sessao.unidadeId, "mesa-liberada");
  });
}
