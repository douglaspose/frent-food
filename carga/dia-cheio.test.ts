import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { centavos } from "@/lib/comanda";
import { abrirComanda, enviarCarrinho } from "@/app/pdv/actions";
import { adicionarAoCarrinho, definirPontoCarne } from "@/app/pdv/carrinho-actions";
import { cancelarItem } from "@/app/pdv/cancelamento-actions";
import { avancarPedido } from "@/app/kds/actions";
import {
  abrirCaixa,
  aplicarDesconto,
  definirTaxaServico,
  fecharCaixa,
  finalizarComanda,
  iniciarFechamento,
  registrarMovimentoCaixa,
  registrarPagamento,
} from "@/app/pdv/pagamento-actions";
import { admin } from "./admin";
import { montarRestaurante, type Membro, type Restaurante } from "./cenario";
import { gravarResultado, tempos } from "./medicao";
import { comAutorizacao, entrar, ocorrencias, passo, quantoDeve, sorteador } from "./operacao";

vi.mock("next/headers", async () => (await import("./usuarios-virtuais")).substitutoDeHeaders());
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

/**
 * Um sábado de movimento fora do normal.
 *
 * Oito garçons atendendo ao mesmo tempo, dois caixas fechando contas, a
 * cozinha tocando os pedidos e o gerente liberando desconto, cancelamento e
 * sangria — tudo pelas server actions de verdade, sob RLS, como no servidor.
 * No fim, confere-se o que num dia real ninguém confere: se cada centavo, cada
 * garrafa e cada liberação fecham.
 *
 * `CARGA_COMANDAS` e `CARGA_SEMENTE` mudam o tamanho do dia e o sorteio. A
 * semente vai no relatório: um dia que falhou pode ser repetido igual.
 */

const META = Number(process.env.CARGA_COMANDAS ?? 180);
const SEMENTE = Number(process.env.CARGA_SEMENTE ?? Date.now() % 1_000_000);
const FUNDO = 300;
const SANGRIA = 400;
const ESTOQUE_INICIAL = 2000;

const sorte = sorteador(SEMENTE);
let r: Restaurante;
let caixaId: string;

/** O que o simulador fez, para conferir contra o que o sistema gravou. */
const livro = {
  comandas: [] as string[],
  /** Comandas que ficaram pelo caminho por erro: não se exige delas o fechamento. */
  abandonadas: new Set<string>(),
  enviadoPorProduto: new Map<string, number>(),
  canceladoEnviadoPorProduto: new Map<string, number>(),
  pagoPorComanda: new Map<string, number>(),
  dinheiroLiquido: 0,
  sangrias: 0,
  cancelamentos: 0,
  descontos: 0,
  semTaxa: 0,
  envios: 0,
  /** Liberações por PIN efetivamente pedidas — quem tem a permissão não pede. */
  pins: 0,
};

/** Mesas livres. `shift` e `push` são atômicos no JavaScript: não há disputa. */
const livres: string[] = [];
/** Contas prontas para o caixa fechar. */
const paraFechar: { comandaId: string; mesaId: string }[] = [];
let atendidas = 0;
let garconsAtivos = 0;
let fimDoSalao = false;

const esperar = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const somar = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);
const itemDo = (produtoId: string) => r.itens.find((i) => i.produtoId === produtoId)!;

beforeAll(async () => {
  r = await montarRestaurante({
    slug: "demo",
    nome: "Restaurante do Dia Cheio",
    mesas: 60,
    garcons: 8,
    caixas: 2,
    gerentes: 2,
    estoqueInicial: ESTOQUE_INICIAL,
    redeIp: 1,
  });
  livres.push(...r.mesas.map((m) => m.id));

  // Todo mundo bate o ponto: o login é pela action de verdade, com PIN.
  await Promise.all(r.equipe.map((m) => entrar(m)));
});

afterAll(async () => {
  await admin.$disconnect();
});

/** Atende uma mesa do "abrir" ao "mandar para o caixa". */
async function atenderMesa(g: Membro, mesaId: string) {
  const gerente = r.gerentes[0]!;
  const { comandaId } = await passo(g, "abrir mesa", () => abrirComanda(mesaId, sorte.inteiro(1, 6)));
  livro.comandas.push(comandaId);

  try {
    for (let rodada = 0, rodadas = sorte.inteiro(1, 3); rodada < rodadas; rodada++) {
      for (let n = 0, itens = sorte.inteiro(2, 7); n < itens; n++) {
        const item = sorte.um(r.itens);
        await passo(g, "lançar item", () =>
          adicionarAoCarrinho({
            comandaId,
            produtoId: item.produtoId,
            cardapioItemId: item.cardapioItemId,
            precoUnitario: item.preco,
            exigePontoCarne: item.exigePontoCarne,
          })
        );

        if (item.exigePontoCarne) {
          const pendente = await admin.comandaItem.findFirst({
            where: { comandaId, produtoId: item.produtoId, status: "PENDENTE", pontoCarne: null },
            orderBy: { lancadoEm: "desc" },
          });
          if (pendente) {
            await passo(g, "ponto da carne", () =>
              definirPontoCarne(pendente.id, sorte.um(["MAL", "AO_PONTO", "BEM"]))
            );
          }
        }
      }

      const pendentes = await admin.comandaItem.findMany({ where: { comandaId, status: "PENDENTE" } });
      await passo(g, "enviar à cozinha", () => enviarCarrinho(comandaId));
      livro.envios++;
      for (const p of pendentes) {
        if (itemDo(p.produtoId).controlaEstoque) {
          somar(livro.enviadoPorProduto, p.produtoId, Number(p.quantidade));
        }
      }

      // Cliente desistiu de um prato que já foi para a cozinha.
      if (sorte.chance(0.05)) {
        const enviado = await admin.comandaItem.findFirst({
          where: { comandaId, status: { notIn: ["CANCELADO", "PENDENTE"] } },
        });
        if (enviado) {
          const { pediuPin } = await comAutorizacao(
            g,
            gerente,
            "CANCELAMENTO_ITEM",
            enviado.id,
            "cancelar item enviado",
            (aut) => cancelarItem(enviado.id, "cliente desistiu", aut)
          );
          if (pediuPin) livro.pins++;
          livro.cancelamentos++;
          if (itemDo(enviado.produtoId).controlaEstoque) {
            somar(livro.canceladoEnviadoPorProduto, enviado.produtoId, Number(enviado.quantidade));
          }
        }
      }
    }
    paraFechar.push({ comandaId, mesaId });
  } catch {
    // Mesa que empacou no meio: fica anotada, a mesa volta e o salão segue.
    livro.abandonadas.add(comandaId);
    livres.push(mesaId);
  }
}

/** Um garçom trabalhando até o salão encerrar. */
async function garcom(g: Membro) {
  garconsAtivos++;
  try {
    while (atendidas < META) {
      const mesaId = livres.shift();
      if (!mesaId) {
        await esperar(15);
        continue;
      }
      atendidas++;
      try {
        await atenderMesa(g, mesaId);
      } catch {
        // Nem abrir a mesa conseguiu. Já está anotado; a mesa volta.
        livres.push(mesaId);
      }
    }
  } finally {
    garconsAtivos--;
    if (garconsAtivos === 0) fimDoSalao = true;
  }
}

/** Fecha uma conta: taxa, desconto, pagamento dividido, finalização. */
async function fecharConta(c: Membro, comandaId: string) {
  const gerente = r.gerentes[1] ?? r.gerentes[0]!;
  await passo(c, "iniciar fechamento", () => iniciarFechamento(comandaId));

  // Mesa que não quer os 10%: é o gerente que tira.
  if (sorte.chance(0.1)) {
    await passo(gerente, "tirar taxa de serviço", () => definirTaxaServico(comandaId, 0));
    livro.semTaxa++;
  }

  // Desconto: o caixa não pode sozinho, pede o PIN do gerente.
  if (sorte.chance(0.08)) {
    const { subtotal } = await quantoDeve(comandaId);
    const valor = centavos(subtotal * (sorte.inteiro(5, 15) / 100));
    const { pediuPin } = await comAutorizacao(c, gerente, "DESCONTO", comandaId, "aplicar desconto", (aut) =>
      aplicarDesconto(comandaId, valor, "cliente frequente", aut)
    );
    if (pediuPin) livro.pins++;
    livro.descontos++;
  }

  // Conta dividida em até três formas; dinheiro vem arredondado, com troco.
  let { falta } = await quantoDeve(comandaId);
  const partes = sorte.inteiro(1, 3);
  for (let p = 0; p < partes && falta > 0.004; p++) {
    const ultima = p === partes - 1;
    const valor = ultima ? falta : centavos(falta * (sorte.inteiro(20, 70) / 100));
    const forma = sorte.um([r.formas.dinheiro, r.formas.pix, r.formas.debito, r.formas.credito]);
    const entregue = forma.tipo === "DINHEIRO" ? Math.ceil(valor / 10) * 10 : valor;
    const troco = centavos(entregue - valor);

    // Um só toque: pagamento repetido por insistência é justamente o que não
    // se quer — se falhou, fica anotado e a conta é abandonada.
    await passo(c, "registrar pagamento", () => registrarPagamento(comandaId, forma.id, entregue, troco), 1);
    somar(livro.pagoPorComanda, comandaId, valor);
    if (forma.tipo === "DINHEIRO") livro.dinheiroLiquido = centavos(livro.dinheiroLiquido + valor);
    falta = centavos(falta - valor);
  }

  await passo(c, "finalizar comanda", () => finalizarComanda(comandaId));
}

/** Um caixa fechando contas até o salão encerrar e a fila esvaziar. */
async function caixa(c: Membro) {
  while (!fimDoSalao || paraFechar.length) {
    const conta = paraFechar.shift();
    if (!conta) {
      await esperar(15);
      continue;
    }
    try {
      await fecharConta(c, conta.comandaId);
    } catch {
      livro.abandonadas.add(conta.comandaId);
    } finally {
      // Mesa volta para o salão: é assim que um sábado gira mesa.
      livres.push(conta.mesaId);
    }
  }
}

/** A cozinha tocando o que chega, do "aguardando" ao "entregue". */
async function cozinha(quem: Membro) {
  const proximo = { AGUARDANDO: "EM_PREPARO", EM_PREPARO: "PRONTO", PRONTO: "ENTREGUE" } as const;
  // A cozinha só vai embora com a fila vazia. Parando junto com o salão, ela
  // deixava centenas de tickets "na fila" — e o KDS do dia simulado mostrava
  // uma cozinha que nenhum sábado de verdade tem.
  for (;;) {
    const fila = await admin.pedido.findMany({
      where: { unidadeId: r.unidade.id, status: { in: ["AGUARDANDO", "EM_PREPARO", "PRONTO"] } },
      orderBy: { criadoEm: "asc" },
      take: 20,
    });
    if (!fila.length) {
      if (fimDoSalao && !paraFechar.length) break;
      await esperar(20);
      continue;
    }
    for (const p of fila) {
      try {
        await passo(quem, "cozinha avança pedido", () =>
          avancarPedido(p.id, proximo[p.status as keyof typeof proximo])
        );
      } catch {
        // Anotado. A cozinha segue para o próximo ticket.
      }
    }
  }
}

describe(`dia cheio — ${META} comandas, semente ${SEMENTE}`, () => {
  it("atende o dia inteiro sem erro nenhum", async () => {
    const [abertura] = r.caixas;
    const aberto = await passo(abertura!, "abrir caixa", () => abrirCaixa("NOITE", FUNDO));
    caixaId = aberto.caixaId;

    // No meio da noite o gerente tira dinheiro da gaveta.
    const sangria = (async () => {
      while (atendidas < META / 2 && !fimDoSalao) await esperar(50);
      try {
        const { pediuPin } = await comAutorizacao(r.gerentes[0]!, r.proprietario, "SANGRIA", caixaId, "sangria", (aut) =>
          registrarMovimentoCaixa(caixaId, "SANGRIA", SANGRIA, "cofre", aut)
        );
        if (pediuPin) livro.pins++;
        livro.sangrias += SANGRIA;
      } catch {
        // Anotado.
      }
    })();

    const inicio = performance.now();
    await Promise.all([
      ...r.garcons.map((g) => garcom(g)),
      ...r.caixas.map((c) => caixa(c)),
      cozinha(r.gerentes[1] ?? r.gerentes[0]!),
      sangria,
    ]);
    const duracao = performance.now() - inicio;

    // O caixa fecha informando exatamente o que o simulador sabe que entrou.
    const esperado = centavos(FUNDO + livro.dinheiroLiquido - livro.sangrias);
    let fechamento: unknown = null;
    try {
      fechamento = await passo(abertura!, "fechar caixa", () => fecharCaixa(caixaId, esperado));
    } catch {
      // Anotado.
    }

    const lista = [...ocorrencias.entries()].map(([chave, o]) => ({ ...o, chave }));
    gravarResultado("ultimo-dia.json", {
      semente: SEMENTE,
      meta: META,
      duracaoSegundos: Math.round(duracao / 1000),
      livro: {
        comandas: livro.comandas.length,
        abandonadas: livro.abandonadas.size,
        envios: livro.envios,
        cancelamentos: livro.cancelamentos,
        descontos: livro.descontos,
        semTaxa: livro.semTaxa,
        dinheiroLiquido: livro.dinheiroLiquido,
        sangrias: livro.sangrias,
        pins: livro.pins,
      },
      caixaEsperado: esperado,
      fechamento,
      ocorrencias: lista,
      tempos: tempos(),
    });

    expect(lista.map((o) => `${o.vezes}x ${o.chave}${o.onde ? `  [${o.onde}]` : ""}`)).toEqual([]);
    expect(fechamento).toMatchObject({ divergencia: 0 });
  });
});

describe("conferência do fim do dia", () => {
  const fechadas = () => livro.comandas.filter((id) => !livro.abandonadas.has(id));

  it("nenhuma comanda ficou aberta", async () => {
    const abertas = await admin.comanda.findMany({
      where: { unidadeId: r.unidade.id, status: { not: "PAGA" } },
      select: { numero: true, status: true },
    });
    expect(abertas).toEqual([]);
  });

  it("cada comanda paga recebeu exatamente o que devia", async () => {
    const erradas: string[] = [];
    for (const id of fechadas()) {
      const { total, pago } = await quantoDeve(id);
      if (Math.abs(total - pago) > 0.004) erradas.push(`${id}: devia ${total}, recebeu ${pago}`);
    }
    expect(erradas).toEqual([]);
  });

  it("nenhum pagamento sumiu nem dobrou", async () => {
    const gravados = await admin.pagamento.groupBy({
      by: ["comandaId"],
      where: { comanda: { unidadeId: r.unidade.id } },
      _sum: { valor: true, troco: true },
    });
    const divergentes = gravados
      .map((g) => ({
        comandaId: g.comandaId,
        gravado: centavos(Number(g._sum.valor ?? 0) - Number(g._sum.troco ?? 0)),
        pago: centavos(livro.pagoPorComanda.get(g.comandaId) ?? 0),
      }))
      .filter((d) => Math.abs(d.gravado - d.pago) > 0.004);
    expect(divergentes).toEqual([]);
    expect(gravados.length).toBe(livro.pagoPorComanda.size);
  });

  it("os números de comanda não se repetem", async () => {
    const comandas = await admin.comanda.findMany({
      where: { unidadeId: r.unidade.id },
      select: { numero: true },
    });
    const numeros = comandas.map((c) => c.numero);
    expect(new Set(numeros).size).toBe(numeros.length);
  });

  /**
   * O número é o que a cozinha grita e o que sai no papel pendurado na
   * chapa. Dois tickets com o mesmo número é prato na mesa errada.
   * (Acrescentado na rodada de 21/09: a tabela não tem unique, então a
   * repetição não dá erro nenhum — só aparece contando.)
   */
  it("os números de ticket da cozinha não se repetem", async () => {
    const repetidos = await admin.pedido.groupBy({
      by: ["numero"],
      where: { unidadeId: r.unidade.id },
      _count: { _all: true },
      having: { numero: { _count: { gt: 1 } } },
    });
    expect(repetidos.map((g) => `#${g.numero} x${g._count._all}`)).toEqual([]);
  });

  /**
   * A conferência mais sensível à concorrência: dois garçons mandando a mesma
   * cerveja no mesmo instante. Se o saldo é lido e regravado sem trava, uma
   * das saídas some e a geladeira não bate com o vendido.
   */
  it("o estoque bate com o que foi vendido e cancelado", async () => {
    const divergentes: string[] = [];
    for (const item of r.itens.filter((i) => i.controlaEstoque)) {
      const saldo = await admin.estoqueSaldo.findUniqueOrThrow({
        where: { unidadeId_produtoId: { unidadeId: r.unidade.id, produtoId: item.produtoId } },
      });
      const movimentos = await admin.movimentoEstoque.aggregate({
        where: { unidadeId: r.unidade.id, produtoId: item.produtoId },
        _sum: { quantidade: true },
      });
      const esperado =
        ESTOQUE_INICIAL -
        (livro.enviadoPorProduto.get(item.produtoId) ?? 0) +
        (livro.canceladoEnviadoPorProduto.get(item.produtoId) ?? 0);
      const atual = Number(saldo.quantidade);
      const peloDiario = Number(movimentos._sum.quantidade ?? 0);
      if (atual !== esperado || atual !== peloDiario) {
        divergentes.push(`${item.titulo}: saldo ${atual}, esperado ${esperado}, soma dos movimentos ${peloDiario}`);
      }
    }
    expect(divergentes).toEqual([]);
  });

  /**
   * Toda liberação pedida foi aprovada e gasta — e só as pedidas existem. A
   * sangria do gerente não conta: ele tem a permissão e não precisa de PIN.
   */
  it("toda liberação por PIN foi aprovada e gasta uma vez", async () => {
    const autorizacoes = await admin.autorizacao.findMany({ where: { unidadeId: r.unidade.id } });
    const soltas = autorizacoes.filter((a) => a.status !== "APROVADA" || a.usadoEm === null);
    expect(soltas.map((a) => `${a.tipo} ${a.status} usada=${Boolean(a.usadoEm)}`)).toEqual([]);
    expect(autorizacoes.length).toBe(livro.pins);
  });

  it("a taxa da maquininha foi congelada certa em cada pagamento", async () => {
    const pagamentos = await admin.pagamento.findMany({ where: { comanda: { unidadeId: r.unidade.id } } });
    const errados = pagamentos.filter((p) => {
      const esperado = centavos(((Number(p.valor) - Number(p.troco)) * Number(p.taxaPct)) / 100);
      return Math.abs(Number(p.taxaValor) - esperado) > 0.004;
    });
    expect(errados.map((p) => p.id)).toEqual([]);
  });

  it("toda mesa voltou para o salão", async () => {
    const presas = await admin.mesa.findMany({
      where: { unidadeId: r.unidade.id, status: { in: ["OCUPADA", "FECHANDO"] } },
      select: { numero: true, status: true },
    });
    expect(presas).toEqual([]);
  });

  it("cada envio à cozinha gerou ticket impresso", async () => {
    const tickets = await admin.filaImpressao.count({
      where: { unidadeId: r.unidade.id, tipo: "COMANDA_PRODUCAO" },
    });
    expect(tickets).toBeGreaterThanOrEqual(livro.envios);
  });
});
