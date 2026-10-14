import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { abrirMesa, mesasLivres } from "@/lib/abertura";
import { criarRestaurante, limpar } from "./fixtures";

/**
 * A regra de abrir mesa, que o PDV e a maquininha compartilham.
 *
 * O que estes testes protegem é a numeração da comanda e a conta única por
 * mesa. Os dois já quebraram: antes da trava, o dia simulado de 180 comandas
 * perdeu 50 de 222 aberturas por número repetido, e dois garçons na mesma mesa
 * abriam duas contas. A conferência disso era um script de carga rodado à
 * mão — que não protege a próxima alteração, e muito menos a segunda porta.
 */

const SLUG = "teste-abertura";

let tenantId: string;
let unidadeId: string;
let usuarioId: string;
let quem: { usuarioId: string; tenantId: string; unidadeId: string };

beforeAll(async () => {
  const r = await criarRestaurante(SLUG);
  tenantId = r.tenant.id;
  unidadeId = r.unidade.id;
  usuarioId = r.usuario.id;
  quem = { usuarioId, tenantId, unidadeId };
});

afterAll(async () => {
  await limpar(SLUG);
  await db.$disconnect();
});

let proxima = 1;

async function criarMesa(status: "LIVRE" | "OCUPADA" = "LIVRE") {
  return db.mesa.create({
    data: {
      tenantId,
      unidadeId,
      numero: String(proxima++),
      capacidade: 4,
      status,
      qrToken: `qr-${SLUG}-${proxima}`,
    },
  });
}

async function contasDa(mesaId: string) {
  return db.comanda.findMany({ where: { mesaId }, orderBy: { abertaEm: "asc" } });
}

describe("abrir", () => {
  it("a mesa vira conta, e a mesa fica ocupada", async () => {
    const mesa = await criarMesa();

    const { comandaId, jaEstavaAberta } = await abrirMesa(quem, { mesaId: mesa.id, pessoas: 4 });

    expect(jaEstavaAberta).toBe(false);
    const conta = await db.comanda.findUniqueOrThrow({ where: { id: comandaId } });
    expect(conta.pessoas).toBe(4);
    expect(conta.abertaPorId).toBe(usuarioId);
    expect(Number(conta.taxaServicoPct)).toBe(10);
    expect((await db.mesa.findUniqueOrThrow({ where: { id: mesa.id } })).status).toBe("OCUPADA");
  });

  it("mesa já aberta devolve a conta que existe", async () => {
    const mesa = await criarMesa();

    const primeira = await abrirMesa(quem, { mesaId: mesa.id, pessoas: 2 });
    const segunda = await abrirMesa(quem, { mesaId: mesa.id, pessoas: 6 });

    expect(segunda.comandaId).toBe(primeira.comandaId);
    expect(segunda.jaEstavaAberta).toBe(true);
    expect(await contasDa(mesa.id)).toHaveLength(1);
  });

  it("dois garçons na mesma mesa ao mesmo tempo abrem uma conta só", async () => {
    const mesa = await criarMesa();

    /*
     * A corrida é armada, e não torcida.
     *
     * Dois `abrirMesa` soltos em paralelo quase sempre se enfileiram sozinhos
     * — o primeiro termina antes de o segundo começar a conferir — e o teste
     * passava mesmo com a conferência de dentro da trava removida. Segurando a
     * trava da unidade por fora, os dois chegam a conferir "a mesa está livre"
     * antes de qualquer um gravar, que é exatamente a sequência do salão: dois
     * garçons tocando na mesma mesa no mesmo instante.
     */
    const destravar = await new Promise<() => void>((pronto) => {
      db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM unidades WHERE id = ${unidadeId} FOR NO KEY UPDATE`;
        await new Promise<void>((solta) => pronto(solta));
      });
    });

    const corrida = Promise.all([
      abrirMesa(quem, { mesaId: mesa.id, pessoas: 2 }),
      abrirMesa(quem, { mesaId: mesa.id, pessoas: 2 }),
    ]);
    // Tempo de as duas lerem a mesa livre e pararem na trava.
    await new Promise((r) => setTimeout(r, 300));
    destravar();

    const [a, b] = await corrida;
    expect(a.comandaId).toBe(b.comandaId);
    expect(await contasDa(mesa.id)).toHaveLength(1);
  });

  it("aberturas ao mesmo tempo não repetem o número da comanda", async () => {
    const mesas = await Promise.all([
      criarMesa(),
      criarMesa(),
      criarMesa(),
      criarMesa(),
      criarMesa(),
    ]);

    const abertas = await Promise.all(
      mesas.map((m) => abrirMesa(quem, { mesaId: m.id, pessoas: 2 }))
    );

    const numeros = await db.comanda.findMany({
      where: { id: { in: abertas.map((a) => a.comandaId) } },
      select: { numero: true },
    });
    expect(new Set(numeros.map((n) => n.numero)).size).toBe(mesas.length);
  });

  it("mesa de outra unidade é recusada", async () => {
    const outra = await db.unidade.create({
      data: { tenantId, codigo: "002", nome: "Filial", taxaServicoPct: 10 },
    });
    const mesa = await db.mesa.create({
      data: {
        tenantId,
        unidadeId: outra.id,
        numero: "900",
        capacidade: 2,
        qrToken: `qr-${SLUG}-filial`,
      },
    });

    // O id vem do navegador ou da porta da maquininha; nenhum dos dois decide
    // de que unidade é a mesa.
    await expect(abrirMesa(quem, { mesaId: mesa.id, pessoas: 2 })).rejects.toThrow(
      "Mesa de outra unidade"
    );
  });

  it("pessoas fora de 1 a 99 é recusado", async () => {
    const mesa = await criarMesa();

    // Negativo estragava a divisão da conta por pessoa na hora de pagar.
    await expect(abrirMesa(quem, { mesaId: mesa.id, pessoas: -3 })).rejects.toThrow("1 a 99");
    await expect(abrirMesa(quem, { mesaId: mesa.id, pessoas: 2.5 })).rejects.toThrow("1 a 99");
    expect(await contasDa(mesa.id)).toHaveLength(0);
  });
});

describe("o nome do cliente", () => {
  it("caractere de controle não chega à térmica", async () => {
    const mesa = await criarMesa();

    const { comandaId } = await abrirMesa(quem, {
      mesaId: mesa.id,
      pessoas: 2,
      nomeCliente: "Dona\u0000 Marta ",
    });

    const conta = await db.comanda.findUniqueOrThrow({ where: { id: comandaId } });
    expect(conta.nomeCliente).toBe("Dona Marta");
  });

  it("acima de 80 caracteres é recusado", async () => {
    const mesa = await criarMesa();

    await expect(
      abrirMesa(quem, { mesaId: mesa.id, pessoas: 2, nomeCliente: "a".repeat(81) })
    ).rejects.toThrow("80 caracteres");
  });

  it("a casa que o exige não abre sem ele", async () => {
    const mesa = await criarMesa();
    await db.parametroUnidade.create({
      data: {
        tenantId,
        unidadeId,
        grupo: "MESAS",
        chave: "mesa.exigirIdentificacaoCliente",
        valor: true,
      },
    });

    try {
      await expect(abrirMesa(quem, { mesaId: mesa.id, pessoas: 2 })).rejects.toThrow(
        "exige o nome do cliente"
      );
      // Com o nome, a mesma mesa abre.
      const { comandaId } = await abrirMesa(quem, {
        mesaId: mesa.id,
        pessoas: 2,
        nomeCliente: "Seu Antônio",
      });
      expect(comandaId).toBeTruthy();
    } finally {
      await db.parametroUnidade.deleteMany({
        where: { unidadeId, chave: "mesa.exigirIdentificacaoCliente" },
      });
    }
  });
});

describe("as mesas livres", () => {
  it("mesa com conta aberta sai da lista e volta quando a conta fecha", async () => {
    const mesa = await criarMesa();

    expect((await mesasLivres(unidadeId)).map((m) => m.mesaId)).toContain(mesa.id);

    const { comandaId } = await abrirMesa(quem, { mesaId: mesa.id, pessoas: 2 });
    expect((await mesasLivres(unidadeId)).map((m) => m.mesaId)).not.toContain(mesa.id);

    await db.comanda.update({ where: { id: comandaId }, data: { status: "PAGA" } });
    expect((await mesasLivres(unidadeId)).map((m) => m.mesaId)).toContain(mesa.id);
  });

  it("mesa marcada como ocupada sem conta nenhuma continua na lista", async () => {
    // O `status` da mesa é cache do mapa do salão: um fechamento interrompido
    // deixa OCUPADA sem conta, e essa mesa sumiria do aparelho do garçom que
    // está de pé na frente dela.
    const mesa = await criarMesa("OCUPADA");

    expect((await mesasLivres(unidadeId)).map((m) => m.mesaId)).toContain(mesa.id);
  });

  it("vêm em ordem de número, e não de texto", async () => {
    const livres = (await mesasLivres(unidadeId)).map((m) => Number(m.numero));

    // "10" antes de "2" é o que o banco faria ordenando texto.
    expect(livres).toEqual([...livres].sort((a, b) => a - b));
  });
});
