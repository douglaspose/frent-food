import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { comandaDeBalcao, receberBalcaoPelaRetaguarda } from "@/lib/balcao";
import { receberPagamento } from "@/lib/conta";
import { precisaAutorizacao } from "@/lib/autorizacao";
import { aprovarComPin } from "@/lib/autorizacao-servidor";
import type { Sessao } from "@/lib/session";
import { criarRestaurante, limpar } from "./fixtures";

/**
 * A saída da venda de balcão que ficou presa.
 *
 * Ela nasce quando a maquininha cobra sem mesa e o pagamento não chega — caixa
 * fechado na hora, ou o servidor recusou aquele envio de vez. Sem mesa, ela
 * fica fora do mapa do salão; e como `fecharCaixa` recusa enquanto houver
 * comanda aberta, a casa termina a noite sem conseguir fechar.
 *
 * Receber à mão é dinheiro entrando pela palavra de quem opera, com a prova em
 * papel: por isso pede a autorização de quem responde pela gaveta, e por isso
 * fica no diário com o nome de quem liberou.
 */

const SLUG = "teste-balcao-retaguarda";

let tenantId: string;
let unidadeId: string;
let formaId: string;
let donoId: string;

/** O caixa: recebe pagamento, mas não mexe na gaveta. */
let sessaoDoCaixa: Sessao;
/** O gerente: responde pela gaveta. */
let sessaoDoGerente: Sessao;

async function criarPessoa(nome: string, chaves: string[], pin: string): Promise<Sessao> {
  const cargo = await db.cargo.create({
    data: { tenantId, nome, permissoes: { create: chaves.map((chave) => ({ chave })) } },
  });
  const usuario = await db.usuario.create({
    data: {
      tenantId,
      nome,
      email: `${nome.toLowerCase().replace(/ /g, ".")}@${SLUG}.com`,
      pinHash: await bcrypt.hash(pin, 10),
      unidades: { create: { unidadeId, cargoId: cargo.id } },
    },
  });
  return {
    usuarioId: usuario.id,
    tenantId,
    unidadeId,
    nome,
    cargo: nome,
    permissoes: chaves,
  };
}

async function abrirOCaixa() {
  await db.caixa.create({
    data: {
      tenantId,
      unidadeId,
      data: new Date(),
      tipo: "GERAL",
      turno: "NOITE",
      status: "ABERTO",
      fundoCaixa: 100,
      abertoPorId: donoId,
    },
  });
}

/** Uma venda de balcão aberta, como a maquininha a deixa quando não consegue pagar. */
async function vendaPresa(referencia: string, valorEmCentavos: number) {
  const { comandaId } = await comandaDeBalcao(
    { usuarioId: donoId, tenantId, unidadeId },
    { referencia, valorEmCentavos }
  );
  return comandaId;
}

beforeAll(async () => {
  const r = await criarRestaurante(SLUG);
  tenantId = r.tenant.id;
  unidadeId = r.unidade.id;
  donoId = r.usuario.id;

  const forma = await db.formaPagamento.create({
    data: { tenantId, nome: "Cartão de Crédito", tipo: "CREDITO", taxaPct: 3.2 },
  });
  formaId = forma.id;

  sessaoDoCaixa = await criarPessoa("CAIXA DO TESTE", ["comanda.receberPagamento", "comanda.fechar"], "1111");
  sessaoDoGerente = await criarPessoa("GERENTE DA GAVETA", ["caixa.sangria", "comanda.fechar"], "2222");
});

beforeEach(async () => {
  await db.pagamento.deleteMany({ where: { tenantId } });
  await db.comanda.deleteMany({ where: { tenantId } });
  await db.autorizacao.deleteMany({ where: { tenantId } });
  await db.caixa.deleteMany({ where: { tenantId } });
  await abrirOCaixa();
});

afterAll(async () => {
  await limpar(SLUG);
  await db.$disconnect();
});

describe("receber uma venda de balcão pela retaguarda", () => {
  /**
   * Quem recebe pagamento a noite inteira não recebe esta sozinho: aqui não há
   * cartão passando, há um registro à mão do que já foi cobrado.
   */
  it("o caixa sozinho não recebe: pede autorização", async () => {
    const comandaId = await vendaPresa("venda-presa-1", 2_000);

    const r = await receberBalcaoPelaRetaguarda(sessaoDoCaixa, { comandaId, formaPagamentoId: formaId });

    expect(precisaAutorizacao(r)).toBe(true);
    // E nada aconteceu com a venda.
    const comanda = await db.comanda.findUniqueOrThrow({ where: { id: comandaId } });
    expect(comanda.status).toBe("ABERTA");
    expect(await db.pagamento.count({ where: { comandaId } })).toBe(0);
  });

  it("com o PIN do gerente, a venda entra e a comanda fecha", async () => {
    const comandaId = await vendaPresa("venda-presa-2", 2_000);

    const liberacao = await aprovarComPin(sessaoDoCaixa, "RECEBER_BALCAO", comandaId, "2222");
    expect(liberacao.ok).toBe(true);

    const r = await receberBalcaoPelaRetaguarda(sessaoDoCaixa, {
      comandaId,
      formaPagamentoId: formaId,
      autorizacaoId: liberacao.ok ? liberacao.id : null,
    });

    expect(precisaAutorizacao(r)).toBe(false);
    const comanda = await db.comanda.findUniqueOrThrow({
      where: { id: comandaId },
      include: { pagamentos: true },
    });
    expect(comanda.status).toBe("PAGA");
    expect(comanda.pagamentos).toHaveLength(1);
    expect(Number(comanda.pagamentos[0].valor)).toBe(20);
    // A taxa da forma entra congelada, como em qualquer venda.
    expect(Number(comanda.pagamentos[0].taxaPct)).toBe(3.2);
  });

  /** Quem responde pela gaveta não precisa pedir a ninguém. */
  it("o gerente recebe direto", async () => {
    const comandaId = await vendaPresa("venda-presa-3", 1_500);

    const r = await receberBalcaoPelaRetaguarda(sessaoDoGerente, { comandaId, formaPagamentoId: formaId });

    expect(precisaAutorizacao(r)).toBe(false);
    expect((await db.comanda.findUniqueOrThrow({ where: { id: comandaId } })).status).toBe("PAGA");
  });

  /** O diário responde "quem liberou aquela venda que ninguém achou no mapa". */
  it("fica no diário, com quem liberou", async () => {
    const comandaId = await vendaPresa("venda-presa-4", 3_000);
    const liberacao = await aprovarComPin(sessaoDoCaixa, "RECEBER_BALCAO", comandaId, "2222");

    await receberBalcaoPelaRetaguarda(sessaoDoCaixa, {
      comandaId,
      formaPagamentoId: formaId,
      autorizacaoId: liberacao.ok ? liberacao.id : null,
    });

    const registro = await db.auditLog.findFirstOrThrow({
      where: { tenantId, entidadeId: comandaId, acao: "BALCAO_RECEBIDO_PELA_RETAGUARDA" },
    });
    expect((registro.depois as Record<string, unknown>).aprovadoPor).toBe("GERENTE DA GAVETA");
    expect((registro.depois as Record<string, unknown>).valor).toBe(30);
  });

  /**
   * A conta de mesa tem a tela dela — com teclado, troco e divisão por pessoa.
   * Esta porta receberia sem nada disso, e com autorização de gaveta.
   */
  it("conta com mesa não entra por aqui", async () => {
    const mesa = await db.mesa.create({
      data: { tenantId, unidadeId, numero: "7", capacidade: 4, qrToken: `qr-${SLUG}-7` },
    });
    const comanda = await db.comanda.create({
      data: {
        tenantId,
        unidadeId,
        numero: 900,
        mesaId: mesa.id,
        pessoas: 2,
        abertaPorId: donoId,
        taxaServicoPct: 0,
      },
    });

    await expect(
      receberBalcaoPelaRetaguarda(sessaoDoGerente, {
        comandaId: comanda.id,
        formaPagamentoId: formaId,
      })
    ).rejects.toThrow("tem mesa");
  });

  it("venda já recebida não recebe de novo", async () => {
    const comandaId = await vendaPresa("venda-presa-5", 1_000);
    await receberBalcaoPelaRetaguarda(sessaoDoGerente, { comandaId, formaPagamentoId: formaId });

    await expect(
      receberBalcaoPelaRetaguarda(sessaoDoGerente, { comandaId, formaPagamentoId: formaId })
    ).rejects.toThrow("já foi recebida");
  });

  /**
   * Uma liberação, uma venda. Sem isto, o PIN que o gerente digitou para a
   * venda de R$ 20 receberia também a de R$ 300 que está ao lado na faixa.
   */
  it("a liberação não serve para a venda ao lado", async () => {
    const umaId = await vendaPresa("venda-presa-6", 2_000);
    const outraId = await vendaPresa("venda-presa-7", 30_000);
    const liberacao = await aprovarComPin(sessaoDoCaixa, "RECEBER_BALCAO", umaId, "2222");

    const r = await receberBalcaoPelaRetaguarda(sessaoDoCaixa, {
      comandaId: outraId,
      formaPagamentoId: formaId,
      autorizacaoId: liberacao.ok ? liberacao.id : null,
    });

    expect(precisaAutorizacao(r)).toBe(true);
    expect((await db.comanda.findUniqueOrThrow({ where: { id: outraId } })).status).toBe("ABERTA");
  });

  /**
   * O PIN do gerente não se gasta à toa.
   *
   * A liberação é gasta **antes** de o dinheiro entrar, de propósito (gastando
   * depois, o mesmo PIN receberia duas vezes). O preço disso é que qualquer
   * recusa posterior queima o PIN sem nada ter entrado, e o gerente tem de
   * voltar à faixa para digitar outro na mesma venda — com o caixa travado
   * enquanto isso, porque a venda sem mesa não tem outra porta.
   *
   * A forma de pagamento era o motivo mais provável: desativada pela
   * retaguarda no meio do turno, ou apagada entre a escolha e o clique. Agora
   * ela é perguntada antes.
   */
  it("forma desativada recusa sem gastar a liberação", async () => {
    const comandaId = await vendaPresa("venda-presa-11", 2_000);
    const liberacao = await aprovarComPin(sessaoDoCaixa, "RECEBER_BALCAO", comandaId, "2222");
    const autorizacaoId = liberacao.ok ? liberacao.id : "";

    await db.formaPagamento.update({ where: { id: formaId }, data: { ativo: false } });
    try {
      await expect(
        receberBalcaoPelaRetaguarda(sessaoDoCaixa, {
          comandaId,
          formaPagamentoId: formaId,
          autorizacaoId,
        })
      ).rejects.toThrow("desativada");
    } finally {
      await db.formaPagamento.update({ where: { id: formaId }, data: { ativo: true } });
    }

    // O PIN continua valendo: é só escolher outra forma e tocar de novo.
    const intacta = await db.autorizacao.findUniqueOrThrow({ where: { id: autorizacaoId } });
    expect(intacta.usadoEm).toBeNull();

    const r = await receberBalcaoPelaRetaguarda(sessaoDoCaixa, {
      comandaId,
      formaPagamentoId: formaId,
      autorizacaoId,
    });
    expect(precisaAutorizacao(r)).toBe(false);
    expect((await db.comanda.findUniqueOrThrow({ where: { id: comandaId } })).status).toBe("PAGA");
  });

  /** Forma apagada entre a escolha na tela e o clique: mesma conversa. */
  it("forma que não existe recusa sem gastar a liberação", async () => {
    const comandaId = await vendaPresa("venda-presa-12", 2_000);
    const liberacao = await aprovarComPin(sessaoDoCaixa, "RECEBER_BALCAO", comandaId, "2222");
    const autorizacaoId = liberacao.ok ? liberacao.id : "";

    await expect(
      receberBalcaoPelaRetaguarda(sessaoDoCaixa, {
        comandaId,
        formaPagamentoId: "forma-que-nao-existe",
        autorizacaoId,
      })
    ).rejects.toThrow("não encontrada");

    const intacta = await db.autorizacao.findUniqueOrThrow({ where: { id: autorizacaoId } });
    expect(intacta.usadoEm).toBeNull();
  });

  /**
   * A venda já quitada e aberta, que a faixa fecha sem receber nada.
   *
   * Aqui não há pagamento a registrar, então a forma não importa — e recusar
   * por causa dela trancaria a única porta que fecha a comanda, e com ela o
   * caixa da noite.
   */
  it("venda já quitada fecha mesmo com a forma desativada", async () => {
    const comandaId = await vendaPresa("venda-presa-13", 2_000);
    // O dinheiro já entrou por outro caminho; sobrou a comanda aberta.
    await receberPagamento(
      { usuarioId: donoId, tenantId, unidadeId, nome: "DONO" },
      { comandaId, formaPagamentoId: formaId, valor: 20, troco: 0 }
    );

    await db.formaPagamento.update({ where: { id: formaId }, data: { ativo: false } });
    try {
      const r = await receberBalcaoPelaRetaguarda(sessaoDoGerente, {
        comandaId,
        formaPagamentoId: formaId,
      });
      expect(precisaAutorizacao(r)).toBe(false);
    } finally {
      await db.formaPagamento.update({ where: { id: formaId }, data: { ativo: true } });
    }

    const comanda = await db.comanda.findUniqueOrThrow({
      where: { id: comandaId },
      include: { pagamentos: true },
    });
    expect(comanda.status).toBe("PAGA");
    // E não entrou pagamento nenhum a mais: o dinheiro já estava dentro.
    expect(comanda.pagamentos).toHaveLength(1);
  });

  /**
   * A liberação é gasta, e não só conferida.
   *
   * Aqui a venda recebida já fica `PAGA`, então o segundo toque bate nisso
   * antes de chegar na liberação — o que este teste prende é a marca, que é o
   * que impede o mesmo PIN de valer em qualquer outro caminho que venha
   * depois.
   */
  it("a liberação usada fica marcada como gasta", async () => {
    const comandaId = await vendaPresa("venda-presa-10", 2_000);
    const liberacao = await aprovarComPin(sessaoDoCaixa, "RECEBER_BALCAO", comandaId, "2222");
    const autorizacaoId = liberacao.ok ? liberacao.id : "";

    await receberBalcaoPelaRetaguarda(sessaoDoCaixa, {
      comandaId,
      formaPagamentoId: formaId,
      autorizacaoId,
    });

    const gasta = await db.autorizacao.findUniqueOrThrow({ where: { id: autorizacaoId } });
    expect(gasta.usadoEm).not.toBeNull();
  });

  it("a mesma liberação não recebe duas vezes", async () => {
    const umaId = await vendaPresa("venda-presa-8", 2_000);
    const liberacao = await aprovarComPin(sessaoDoCaixa, "RECEBER_BALCAO", umaId, "2222");
    const autorizacaoId = liberacao.ok ? liberacao.id : null;

    await receberBalcaoPelaRetaguarda(sessaoDoCaixa, {
      comandaId: umaId,
      formaPagamentoId: formaId,
      autorizacaoId,
    });

    // A segunda tentativa na mesma venda já bate em "já foi recebida"; o que
    // este teste prende é a liberação, que não volta a valer para nada.
    const outraId = await vendaPresa("venda-presa-9", 2_000);
    const r = await receberBalcaoPelaRetaguarda(sessaoDoCaixa, {
      comandaId: outraId,
      formaPagamentoId: formaId,
      autorizacaoId,
    });

    expect(precisaAutorizacao(r)).toBe(true);
  });
});
