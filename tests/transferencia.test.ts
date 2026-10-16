import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { avisoDeTransferencia, COLUNAS } from "@/lib/impressao";
import { transferirMesa } from "@/lib/transferencia";
import { criarProduto, criarRestaurante, limpar } from "./fixtures";

/**
 * Transferir mesa mexe em duas mesas, na comanda e nos tickets da cozinha ao
 * mesmo tempo. O erro caro aqui é silencioso: a mesa de origem fica ocupada
 * para sempre no mapa, ou a de destino recebe duas contas.
 */
describe("transferência de mesa", () => {
  let tenantId: string;
  let unidadeId: string;
  let usuarioId: string;
  let areaId: string;

  beforeAll(async () => {
    const r = await criarRestaurante("transferencia");
    tenantId = r.tenant.id;
    unidadeId = r.unidade.id;
    usuarioId = r.usuario.id;

    const area = await db.area.create({
      data: { tenantId, unidadeId, nome: "Salão", ordem: 1 },
    });
    areaId = area.id;
  });

  afterAll(async () => {
    await limpar("transferencia");
  });

  async function criarMesa(numero: string, status = "LIVRE") {
    return db.mesa.create({
      data: {
        tenantId,
        unidadeId,
        areaId,
        numero,
        capacidade: 4,
        status: status as "LIVRE" | "OCUPADA" | "FECHANDO" | "SUJA" | "RESERVADA",
      },
    });
  }

  async function abrirComanda(mesaId: string, numero: number, status = "ABERTA") {
    return db.comanda.create({
      data: {
        tenantId,
        unidadeId,
        mesaId,
        numero,
        abertaPorId: usuarioId,
        status: status as "ABERTA" | "FECHANDO",
      },
    });
  }

  it("mesa livre não aparece duas vezes: só uma comanda aberta por mesa", async () => {
    // A regra que a transferência tem que respeitar. Se a mesa de destino já
    // tem conta, mover para lá criaria duas contas na mesma mesa e o mapa
    // mostraria só uma delas.
    const mesa = await criarMesa("100", "OCUPADA");
    await abrirComanda(mesa.id, 100);

    const ocupadas = await db.comanda.count({
      where: { mesaId: mesa.id, status: { in: ["ABERTA", "FECHANDO"] } },
    });
    expect(ocupadas).toBe(1);
  });

  it("a comanda muda de mesa e as duas mesas trocam de estado", async () => {
    const origem = await criarMesa("101", "OCUPADA");
    const destino = await criarMesa("102");
    const comanda = await abrirComanda(origem.id, 101);

    await db.$transaction(async (tx) => {
      await tx.comanda.update({ where: { id: comanda.id }, data: { mesaId: destino.id } });
      await tx.mesa.update({ where: { id: destino.id }, data: { status: "OCUPADA" } });
      await tx.mesa.update({ where: { id: origem.id }, data: { status: "LIVRE" } });
    });

    expect((await db.mesa.findUniqueOrThrow({ where: { id: origem.id } })).status).toBe("LIVRE");
    expect((await db.mesa.findUniqueOrThrow({ where: { id: destino.id } })).status).toBe("OCUPADA");
    expect((await db.comanda.findUniqueOrThrow({ where: { id: comanda.id } })).mesaId).toBe(
      destino.id
    );
  });

  it("os itens e o total acompanham a comanda, sem relançar nada", async () => {
    // O motivo de existir a transferência: fechar e reabrir perderia isto.
    const origem = await criarMesa("103", "OCUPADA");
    const destino = await criarMesa("104");
    const comanda = await abrirComanda(origem.id, 103);
    const produto = await criarProduto(tenantId, "Espeto");

    await db.comandaItem.create({
      data: {
        tenantId,
        comandaId: comanda.id,
        produtoId: produto.id,
        quantidade: 2,
        precoUnitario: 17.5,
        precoTotal: 35,
        status: "ENVIADO",
        lancadoPorId: usuarioId,
      },
    });

    await db.comanda.update({ where: { id: comanda.id }, data: { mesaId: destino.id } });

    const depois = await db.comanda.findUniqueOrThrow({
      where: { id: comanda.id },
      include: { itens: true, mesa: { select: { numero: true } } },
    });

    expect(depois.mesa?.numero).toBe("104");
    expect(depois.itens).toHaveLength(1);
    expect(Number(depois.itens[0]!.precoTotal)).toBe(35);
    // O relógio da mesa não reinicia: é a mesma conta, noutro lugar.
    expect(depois.abertaEm).toEqual(comanda.abertaEm);
  });

  it("os tickets da cozinha seguem a comanda sem tocar em PedidoItem", async () => {
    const origem = await criarMesa("105", "OCUPADA");
    const destino = await criarMesa("106");
    const comanda = await abrirComanda(origem.id, 105);
    const produto = await criarProduto(tenantId, "Espeto do ticket");
    const estacao = await db.estacao.findFirstOrThrow({ where: { unidadeId } });

    const item = await db.comandaItem.create({
      data: {
        tenantId,
        comandaId: comanda.id,
        produtoId: produto.id,
        quantidade: 1,
        precoUnitario: 10,
        precoTotal: 10,
        status: "ENVIADO",
        lancadoPorId: usuarioId,
      },
    });

    const pedido = await db.pedido.create({
      data: {
        tenantId,
        unidadeId,
        comandaId: comanda.id,
        estacaoId: estacao.id,
        numero: 500,
        itens: { create: { comandaItemId: item.id } },
      },
    });

    await db.comanda.update({ where: { id: comanda.id }, data: { mesaId: destino.id } });

    // O KDS lê o número da mesa pela comanda, então o ticket acompanha sozinho.
    const noKds = await db.pedido.findUniqueOrThrow({
      where: { id: pedido.id },
      include: { comanda: { select: { mesa: { select: { numero: true } } } } },
    });
    expect(noKds.comanda.mesa?.numero).toBe("106");
  });

  it("a mesa de destino herda o estado de conta em fechamento", async () => {
    // Uma mesa que pediu a conta continua laranja no mapa depois de mudar de
    // lugar — senão o caixa perde de vista quem está esperando para pagar.
    const origem = await criarMesa("107", "FECHANDO");
    const destino = await criarMesa("108");
    const comanda = await abrirComanda(origem.id, 107, "FECHANDO");

    await db.$transaction(async (tx) => {
      await tx.comanda.update({ where: { id: comanda.id }, data: { mesaId: destino.id } });
      await tx.mesa.update({ where: { id: destino.id }, data: { status: "FECHANDO" } });
      await tx.mesa.update({ where: { id: origem.id }, data: { status: "LIVRE" } });
    });

    expect((await db.mesa.findUniqueOrThrow({ where: { id: destino.id } })).status).toBe("FECHANDO");
  });
});

/**
 * Os testes acima conferem o que a transferência deixa no banco, montada à
 * mão. Estes chamam a regra de verdade — a que o PDV e a maquininha dividem
 * desde que o garçom passou a transferir de pé no salão.
 */
describe("a regra de transferir", () => {
  let tenantId: string;
  let unidadeId: string;
  let usuarioId: string;
  let quem: { usuarioId: string; tenantId: string; unidadeId: string; nome: string };
  let proxima = 500;

  beforeAll(async () => {
    const r = await criarRestaurante("regra-transferencia");
    tenantId = r.tenant.id;
    unidadeId = r.unidade.id;
    usuarioId = r.usuario.id;
    quem = { usuarioId, tenantId, unidadeId, nome: "Maria do teste" };
  });

  afterAll(async () => {
    await limpar("regra-transferencia");
  });

  async function mesa(status = "LIVRE") {
    return db.mesa.create({
      data: {
        tenantId,
        unidadeId,
        numero: String(proxima++),
        capacidade: 4,
        status: status as "LIVRE" | "OCUPADA" | "FECHANDO" | "SUJA",
        qrToken: `qr-regra-${proxima}`,
      },
    });
  }

  async function contaNa(mesaId: string, status = "ABERTA") {
    return db.comanda.create({
      data: {
        tenantId,
        unidadeId,
        mesaId,
        numero: proxima++,
        pessoas: 2,
        abertaPorId: usuarioId,
        status: status as "ABERTA" | "FECHANDO",
      },
    });
  }

  it("a conta muda de mesa, e as duas mesas trocam de estado", async () => {
    const origem = await mesa("OCUPADA");
    const destino = await mesa();
    const conta = await contaNa(origem.id);

    const r = await transferirMesa(quem, conta.id, destino.id);

    expect(r.mudou).toBe(true);
    expect((await db.comanda.findUniqueOrThrow({ where: { id: conta.id } })).mesaId).toBe(
      destino.id
    );
    expect((await db.mesa.findUniqueOrThrow({ where: { id: destino.id } })).status).toBe("OCUPADA");
    // A de origem some do mapa como ocupada: é o que libera o lugar.
    expect((await db.mesa.findUniqueOrThrow({ where: { id: origem.id } })).status).toBe("LIVRE");
  });

  it("fica registrado quem mudou a conta de lugar", async () => {
    const origem = await mesa("OCUPADA");
    const destino = await mesa();
    const conta = await contaNa(origem.id);

    await transferirMesa(quem, conta.id, destino.id);

    const registros = await db.auditLog.findMany({
      where: { tenantId, entidadeId: conta.id, acao: "MESA_TRANSFERIDA" },
    });
    expect(registros).toHaveLength(1);
    expect(registros[0].usuarioId).toBe(usuarioId);
  });

  /** Uma rodada já na praça, que é o que faz o aviso valer a pena. */
  async function pratoEmPreparo(comandaId: string) {
    const produto = await criarProduto(tenantId, `Espeto ${proxima++}`);
    const estacao = await db.estacao.findFirstOrThrow({ where: { unidadeId } });
    const item = await db.comandaItem.create({
      data: {
        tenantId,
        comandaId,
        produtoId: produto.id,
        quantidade: 1,
        precoUnitario: 10,
        precoTotal: 10,
        status: "ENVIADO",
        lancadoPorId: usuarioId,
      },
    });
    return db.pedido.create({
      data: {
        tenantId,
        unidadeId,
        comandaId,
        estacaoId: estacao.id,
        numero: proxima++,
        itens: { create: { comandaItemId: item.id } },
      },
    });
  }

  it("a cozinha recebe o aviso de que a mesa mudou", async () => {
    const origem = await mesa("OCUPADA");
    const destino = await mesa();
    const conta = await contaNa(origem.id);
    const pedido = await pratoEmPreparo(conta.id);

    await transferirMesa(quem, conta.id, destino.id);

    // Um papel por ticket na praça — é a folha que vai junto da comanda que
    // já está lá dentro. Sem ela, o prato sai para a mesa que o grupo deixou.
    const papeis = await db.filaImpressao.findMany({
      where: { tenantId, referenciaId: pedido.id, tipo: "TRANSFERENCIA" },
    });
    expect(papeis).toHaveLength(1);
    expect(papeis[0].conteudo).toContain(destino.numero);
    expect(papeis[0].conteudo).toContain("Maria do teste");
  });

  it("sem nada na praça, não sai papel nenhum", async () => {
    const origem = await mesa("OCUPADA");
    const destino = await mesa();
    const conta = await contaNa(origem.id);
    const antes = await db.filaImpressao.count({ where: { tenantId, tipo: "TRANSFERENCIA" } });

    // Mesa aberta e ainda sem pedido: avisar a cozinha de uma mudança que não
    // muda nada para ela é papel jogado fora a cada engano de abertura.
    await transferirMesa(quem, conta.id, destino.id);

    expect(await db.filaImpressao.count({ where: { tenantId, tipo: "TRANSFERENCIA" } })).toBe(antes);
  });

  it("mesa ocupada recusa, com o número da comanda que está lá", async () => {
    const origem = await mesa("OCUPADA");
    const destino = await mesa("OCUPADA");
    const conta = await contaNa(origem.id);
    const jaLa = await contaNa(destino.id);

    /*
     * Transferir para uma mesa ocupada juntaria duas contas sem ninguém
     * decidir de quem é a taxa de serviço — e a mensagem precisa dizer qual
     * comanda está lá, senão o garçom fica procurando.
     */
    await expect(transferirMesa(quem, conta.id, destino.id)).rejects.toThrow(
      `comanda #${jaLa.numero}`
    );
    expect((await db.comanda.findUniqueOrThrow({ where: { id: conta.id } })).mesaId).toBe(origem.id);
  });

  it("transferir para a mesma mesa não faz nada, e não é erro", async () => {
    const origem = await mesa("OCUPADA");
    const conta = await contaNa(origem.id);

    // O toque repetido, ou o reenvio de uma resposta perdida na rede.
    const r = await transferirMesa(quem, conta.id, origem.id);

    expect(r.mudou).toBe(false);
    expect(
      await db.auditLog.count({
        where: { tenantId, entidadeId: conta.id, acao: "MESA_TRANSFERIDA" },
      })
    ).toBe(0);
  });

  it("conta paga não muda de mesa", async () => {
    const origem = await mesa("OCUPADA");
    const destino = await mesa();
    const conta = await contaNa(origem.id);
    await db.comanda.update({ where: { id: conta.id }, data: { status: "PAGA" } });

    await expect(transferirMesa(quem, conta.id, destino.id)).rejects.toThrow("já paga");
  });

  it("duas contas disputando a mesma mesa livre: só uma vai", async () => {
    const destino = await mesa();
    const primeira = await contaNa((await mesa("OCUPADA")).id);
    const segunda = await contaNa((await mesa("OCUPADA")).id);

    /*
     * A corrida é armada como a da abertura: segurando a trava da unidade por
     * fora, as duas chegam a ver a mesa livre antes de qualquer uma gravar.
     * Soltas, elas se enfileiram sozinhas e o teste passaria sem a trava.
     */
    const destravar = await new Promise<() => void>((pronto) => {
      db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM unidades WHERE id = ${unidadeId} FOR NO KEY UPDATE`;
        await new Promise<void>((solta) => pronto(solta));
      });
    });

    const corrida = Promise.allSettled([
      transferirMesa(quem, primeira.id, destino.id),
      transferirMesa(quem, segunda.id, destino.id),
    ]);
    await new Promise((r) => setTimeout(r, 300));
    destravar();

    const resultados = await corrida;
    expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      await db.comanda.count({
        where: { tenantId, mesaId: destino.id, status: { in: ["ABERTA", "FECHANDO"] } },
      })
    ).toBe(1);
  });

  it("onde a limpeza não é automática, a mesa de origem fica suja", async () => {
    await db.parametroUnidade.create({
      data: {
        tenantId,
        unidadeId,
        grupo: "MESAS",
        chave: "mesa.limparAutomaticamente",
        valor: false,
      },
    });

    try {
      const origem = await mesa("OCUPADA");
      const destino = await mesa();
      const conta = await contaNa(origem.id);

      await transferirMesa(quem, conta.id, destino.id);

      // O grupo que saiu de lá deixou a mesa do mesmo jeito de sempre.
      expect((await db.mesa.findUniqueOrThrow({ where: { id: origem.id } })).status).toBe("SUJA");
    } finally {
      await db.parametroUnidade.deleteMany({
        where: { unidadeId, chave: "mesa.limparAutomaticamente" },
      });
    }
  });
});

describe("aviso de transferência impresso", () => {
  const papel = avisoDeTransferencia({
    estacao: "CHURRASQUEIRA",
    pedidoNumero: 77,
    de: "5",
    para: "12",
    comandaNumero: 9,
    transferidoPor: "João Garçom",
    transferidoEm: new Date("2026-09-19T21:30:00"),
    itens: [
      { titulo: "Espeto de Alcatra", quantidade: 2 },
      { titulo: "Espeto de Queijo Coalho com nome bem comprido para quebrar", quantidade: 1 },
    ],
  });

  it("cabe na bobina", () => {
    for (const l of papel.split("\n")) expect(l.length).toBeLessThanOrEqual(COLUNAS);
  });

  it("mostra de onde para onde, que é o que a cozinha precisa ler", () => {
    expect(papel).toContain("*** MUDOU DE MESA ***");
    expect(papel).toContain("MESA 5  >>>  MESA 12");
  });

  it("lista os itens e quem transferiu", () => {
    expect(papel).toContain("2x Espeto de Alcatra");
    expect(papel).toContain("João Garçom");
    expect(papel).toContain("Comanda #9");
  });
});
