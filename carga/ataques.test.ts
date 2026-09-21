import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { temErro } from "@/lib/erro-de-operacao";
import { abrirComanda, enviarCarrinho } from "@/app/pdv/actions";
import { adicionarAoCarrinho, alterarQuantidade } from "@/app/pdv/carrinho-actions";
import { cancelarItem } from "@/app/pdv/cancelamento-actions";
import { pedirAutorizacao } from "@/app/pdv/autorizacao-actions";
import { avancarPedido } from "@/app/kds/actions";
import LoginPage from "@/app/login/page";
import PdvMesasPage from "@/app/pdv/page";
import GestaoLayout from "@/app/gestao/layout";
import MesaPublicaPage from "@/app/mesa/[token]/page";
import { POST as POSTImpressao } from "@/app/api/impressao/route";
import { NextRequest } from "next/server";
import { chamarGarcomPeloQr } from "@/app/mesa/[token]/actions";
import {
  abrirCaixa,
  aplicarDesconto,
  definirTaxaServico,
  estornarPagamento,
  fecharCaixa,
  finalizarComanda,
  iniciarFechamento,
  registrarMovimentoCaixa,
  registrarPagamento,
} from "@/app/pdv/pagamento-actions";
import { admin } from "./admin";
import { montarRestaurante, type Membro, type Restaurante } from "./cenario";
import { entrar, quantoDeve } from "./operacao";
import bcrypt from "bcryptjs";
import { como, ehRedirecionamento, pessoa, sessaoAssinada } from "./usuarios-virtuais";

vi.mock("next/headers", async () => (await import("./usuarios-virtuais")).substitutoDeHeaders());
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

/**
 * O que alguém mal-intencionado — ou só azarado — faria.
 *
 * Cada teste afirma o comportamento **seguro**. Enquanto a brecha existir, o
 * teste falha, e a mensagem diz o que o sistema aceitou. Nada aqui passa pela
 * tela: server action é endpoint público, e é chamando-a direto, com o
 * argumento adulterado, que um atacante agiria.
 *
 * Dois restaurantes: o "demo", onde a equipe entra pelo PIN de verdade, e o
 * "vizinho", cujo acesso é usado para tentar atravessar a fronteira.
 */

let A: Restaurante;
let B: Restaurante;

/** O que uma chamada devolveu — ou o erro que lançou, sem derrubar o teste. */
async function tentar<T>(quem: Membro, fn: () => Promise<T>) {
  try {
    return { resposta: await como(quem, fn), lancou: null as string | null };
  } catch (e) {
    return { resposta: null as T | null, lancou: e instanceof Error ? e.message : String(e) };
  }
}

const recusou = (t: { resposta: unknown; lancou: string | null }) =>
  t.lancou !== null || temErro(t.resposta);

/** Uma mesa aberta pelo garçom, com itens honestos já mandados à cozinha. */
async function comandaPronta(g: Membro, mesaIndice: number, itens = 3) {
  const aberta = await como(g, () => abrirComanda(A.mesas[mesaIndice]!.id, 2));
  if (!aberta || temErro(aberta)) throw new Error(`não abriu a mesa: ${JSON.stringify(aberta)}`);
  const naoCarne = A.itens.filter((i) => !i.exigePontoCarne);
  for (let k = 0; k < itens; k++) {
    const item = naoCarne[k % naoCarne.length]!;
    await como(g, () =>
      adicionarAoCarrinho({
        comandaId: aberta.comandaId,
        produtoId: item.produtoId,
        cardapioItemId: item.cardapioItemId,
        precoUnitario: item.preco,
        exigePontoCarne: false,
      })
    );
  }
  await como(g, () => enviarCarrinho(aberta.comandaId));
  return aberta.comandaId;
}

async function pagarTudo(caixa: Membro, comandaId: string) {
  await como(caixa, () => iniciarFechamento(comandaId));
  const { falta } = await quantoDeve(comandaId);
  await como(caixa, () => registrarPagamento(comandaId, A.formas.pix.id, falta, 0));
  await como(caixa, () => finalizarComanda(comandaId));
}

beforeAll(async () => {
  A = await montarRestaurante({
    slug: "demo",
    nome: "Restaurante Atacado",
    mesas: 60,
    garcons: 3,
    caixas: 1,
    gerentes: 1,
    estoqueInicial: 500,
    redeIp: 2,
  });
  B = await montarRestaurante({
    slug: "vizinho",
    nome: "Restaurante Vizinho",
    mesas: 5,
    garcons: 1,
    caixas: 1,
    gerentes: 1,
    estoqueInicial: 500,
    redeIp: 3,
  });

  await Promise.all(A.equipe.map((m) => entrar(m)));

  // O vizinho entra com sessão assinada: o que se testa com ele é a fronteira,
  // não o login (que tem teste próprio abaixo).
  for (const m of B.equipe) {
    const cargo = await admin.cargo.findUniqueOrThrow({
      where: { id: B.cargos[m.cargo]! },
      include: { permissoes: true },
    });
    await sessaoAssinada(m, {
      usuarioId: m.usuarioId,
      tenantId: B.tenant.id,
      unidadeId: B.unidade.id,
      nome: m.nome,
      cargo: m.cargo,
      permissoes: cargo.permissoes.map((p) => p.chave),
    });
  }

  await como(A.caixas[0]!, () => abrirCaixa("NOITE", 200));
  await como(B.caixas[0]!, () => abrirCaixa("NOITE", 200));
});

afterAll(async () => {
  await admin.$disconnect();
});

describe("preço e produto vindos do navegador", () => {
  const picanha = () => A.itens.find((i) => i.titulo === "Picanha na Chapa")!;

  async function lancarAdulterado(precoUnitario: number, mesa: number) {
    const g = A.garcons[0]!;
    const { comandaId } = (await como(g, () => abrirComanda(A.mesas[mesa]!.id, 2))) as { comandaId: string };
    const t = await tentar(g, () =>
      adicionarAoCarrinho({
        comandaId,
        produtoId: picanha().produtoId,
        cardapioItemId: picanha().cardapioItemId,
        precoUnitario,
        exigePontoCarne: false,
      })
    );
    const gravado = await admin.comandaItem.findFirst({ where: { comandaId }, orderBy: { lancadoEm: "desc" } });
    return { t, gravado };
  }

  it("não aceita a picanha a um centavo", async () => {
    const { t, gravado } = await lancarAdulterado(0.01, 0);
    if (!recusou(t)) {
      expect(Number(gravado?.precoUnitario), "preço gravado para a Picanha (cardápio: 129,90)").toBe(
        picanha().preco
      );
    }
  });

  it("não aceita preço negativo para abater a conta", async () => {
    const { t, gravado } = await lancarAdulterado(-500, 1);
    if (!recusou(t)) {
      expect(Number(gravado?.precoUnitario), "preço negativo gravado").toBeGreaterThan(0);
    }
  });

  it("não aceita item do cardápio de outro restaurante", async () => {
    const g = A.garcons[0]!;
    const { comandaId } = (await como(g, () => abrirComanda(A.mesas[2]!.id, 2))) as { comandaId: string };
    const alheio = B.itens[0]!;
    const t = await tentar(g, () =>
      adicionarAoCarrinho({
        comandaId,
        produtoId: alheio.produtoId,
        cardapioItemId: alheio.cardapioItemId,
        precoUnitario: alheio.preco,
        exigePontoCarne: false,
      })
    );
    const gravados = await admin.comandaItem.count({ where: { comandaId } });
    expect({ recusou: recusou(t), gravados }).toEqual({ recusou: true, gravados: 0 });
  });

  it("não aceita produto que não é o do item de cardápio", async () => {
    const g = A.garcons[0]!;
    const { comandaId } = (await como(g, () => abrirComanda(A.mesas[3]!.id, 2))) as { comandaId: string };
    const agua = A.itens.find((i) => i.titulo === "Água Mineral")!;
    // Cobra o preço da água, mas manda a picanha para a cozinha.
    const t = await tentar(g, () =>
      adicionarAoCarrinho({
        comandaId,
        produtoId: picanha().produtoId,
        cardapioItemId: agua.cardapioItemId,
        precoUnitario: agua.preco,
        exigePontoCarne: false,
      })
    );
    const gravado = await admin.comandaItem.findFirst({ where: { comandaId } });
    if (!recusou(t)) {
      expect(gravado?.produtoId === picanha().produtoId && Number(gravado.precoUnitario) === agua.preco, "picanha lançada a preço de água").toBe(false);
    }
  });

  it("não deixa a quantidade ficar negativa", async () => {
    const g = A.garcons[0]!;
    const { comandaId } = (await como(g, () => abrirComanda(A.mesas[4]!.id, 2))) as { comandaId: string };
    const agua = A.itens.find((i) => i.titulo === "Água Mineral")!;
    await como(g, () =>
      adicionarAoCarrinho({
        comandaId,
        produtoId: agua.produtoId,
        cardapioItemId: agua.cardapioItemId,
        precoUnitario: agua.preco,
        exigePontoCarne: false,
      })
    );
    const item = await admin.comandaItem.findFirstOrThrow({ where: { comandaId } });
    await tentar(g, () => alterarQuantidade(item.id, -5));
    const depois = await admin.comandaItem.findUnique({ where: { id: item.id } });
    expect(depois === null || Number(depois.quantidade) > 0, "quantidade depois de -5").toBe(true);
  });
});

describe("pagamento", () => {
  it("dois toques em 'receber' ao mesmo tempo não cobram duas vezes", async () => {
    const comandaId = await comandaPronta(A.garcons[1]!, 5);
    const caixa = A.caixas[0]!;
    await como(caixa, () => iniciarFechamento(comandaId));
    const { total } = await quantoDeve(comandaId);

    await Promise.all([
      tentar(caixa, () => registrarPagamento(comandaId, A.formas.pix.id, total, 0)),
      tentar(caixa, () => registrarPagamento(comandaId, A.formas.pix.id, total, 0)),
    ]);

    const { pago } = await quantoDeve(comandaId);
    expect(pago, `recebido numa conta de ${total}`).toBeLessThanOrEqual(total + 0.004);
  });

  it("não aceita pagamento negativo", async () => {
    const comandaId = await comandaPronta(A.garcons[1]!, 6);
    const t = await tentar(A.caixas[0]!, () => registrarPagamento(comandaId, A.formas.pix.id, -50, 0));
    const negativos = await admin.pagamento.count({ where: { comandaId, valor: { lt: 0 } } });
    expect({ recusou: recusou(t), negativos }).toEqual({ recusou: true, negativos: 0 });
  });

  it("não aceita troco maior que o valor entregue", async () => {
    const comandaId = await comandaPronta(A.garcons[1]!, 7);
    const t = await tentar(A.caixas[0]!, () => registrarPagamento(comandaId, A.formas.dinheiro.id, 10, 50));
    const gravados = await admin.pagamento.count({ where: { comandaId } });
    expect({ recusou: recusou(t), gravados }).toEqual({ recusou: true, gravados: 0 });
  });

  it("valor inválido vira mensagem, não erro de sistema", async () => {
    const comandaId = await comandaPronta(A.garcons[1]!, 8);
    const t = await tentar(A.caixas[0]!, () => registrarPagamento(comandaId, A.formas.pix.id, Number.NaN, 0));
    expect({ lancou: t.lancou, comMensagem: temErro(t.resposta) }).toEqual({ lancou: null, comMensagem: true });
  });

  it("desconto maior que a conta é recusado ou limitado ao subtotal", async () => {
    const comandaId = await comandaPronta(A.garcons[1]!, 9);
    const gerente = A.gerentes[0]!;
    await como(gerente, () => iniciarFechamento(comandaId));
    const { subtotal } = await quantoDeve(comandaId);
    const t = await tentar(gerente, () => aplicarDesconto(comandaId, subtotal * 10, "teste"));
    const comanda = await admin.comanda.findUniqueOrThrow({ where: { id: comandaId } });
    if (!recusou(t)) {
      expect(Number(comanda.descontoValor), "desconto gravado").toBeLessThanOrEqual(subtotal);
    }
  });

  it("não lança item em conta já paga", async () => {
    const comandaId = await comandaPronta(A.garcons[1]!, 10);
    await pagarTudo(A.caixas[0]!, comandaId);
    const agua = A.itens.find((i) => i.titulo === "Água Mineral")!;
    const t = await tentar(A.garcons[1]!, () =>
      adicionarAoCarrinho({
        comandaId,
        produtoId: agua.produtoId,
        cardapioItemId: agua.cardapioItemId,
        precoUnitario: agua.preco,
        exigePontoCarne: false,
      })
    );
    expect(recusou(t)).toBe(true);
  });
});

describe("permissões e sessão", () => {
  it("garçom não recebe pagamento", async () => {
    const comandaId = await comandaPronta(A.garcons[2]!, 11);
    const t = await tentar(A.garcons[2]!, () => registrarPagamento(comandaId, A.formas.pix.id, 10, 0));
    const gravados = await admin.pagamento.count({ where: { comandaId } });
    expect({ recusou: recusou(t), gravados }).toEqual({ recusou: true, gravados: 0 });
  });

  it("garçom não faz sangria sem o PIN do gerente", async () => {
    const caixa = await admin.caixa.findFirstOrThrow({ where: { unidadeId: A.unidade.id, status: "ABERTO" } });
    const t = await tentar(A.garcons[2]!, () => registrarMovimentoCaixa(caixa.id, "SANGRIA", 100, "teste"));
    expect(t.resposta).toEqual({ precisaAutorizacao: "SANGRIA" });
  });

  it("PIN errado repetido trava — e trava até o PIN certo", async () => {
    const comandaId = await comandaPronta(A.garcons[2]!, 12);
    const g = A.garcons[2]!;
    for (let i = 0; i < 10; i++) {
      await tentar(g, () => pedirAutorizacao("DESCONTO", comandaId, "0000"));
    }
    const certo = await tentar(g, () => pedirAutorizacao("DESCONTO", comandaId, A.gerentes[0]!.pin));
    expect((certo.resposta as { ok: boolean } | null)?.ok, "PIN certo depois de 10 errados").toBe(false);
  });

  it("quem foi desligado no meio do turno para de conseguir agir", async () => {
    const g = A.garcons[2]!;
    await admin.usuario.update({ where: { id: g.usuarioId }, data: { ativo: false } });
    const t = await tentar(g, () => abrirComanda(A.mesas[13]!.id, 2));
    await admin.usuario.update({ where: { id: g.usuarioId }, data: { ativo: true } });
    // A recusa apaga o cookie (é o comportamento certo). Readmitido, ele entra
    // de novo — senão os testes seguintes que usam este garçom falhariam por
    // "sessão expirada", um defeito do teste e não do sistema.
    await entrar(g);
    expect(recusou(t)).toBe(true);
  });

  it("cookie adulterado vale como deslogado", async () => {
    const falso = pessoa("falsário", "0000", "10.9.9.9", "demo.frentfood.test");
    const segredo = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = "chave-que-o-servidor-nao-conhece-0123456789";
    await sessaoAssinada(falso, {
      usuarioId: A.proprietario.usuarioId,
      tenantId: A.tenant.id,
      unidadeId: A.unidade.id,
      nome: "falsário",
      cargo: "PROPRIETARIO",
      permissoes: ["*"],
    });
    process.env.AUTH_SECRET = segredo;
    const t = await tentar({ ...falso, usuarioId: "", cargo: "" }, () => abrirComanda(A.mesas[14]!.id, 2));
    expect(recusou(t)).toBe(true);
  });

  it("o caixa do vizinho não recebe numa comanda do demo", async () => {
    const comandaId = await comandaPronta(A.garcons[0]!, 15);
    const t = await tentar(B.caixas[0]!, () => registrarPagamento(comandaId, B.formas.pix.id, 10, 0));
    const gravados = await admin.pagamento.count({ where: { comandaId } });
    expect({ recusou: recusou(t), gravados }).toEqual({ recusou: true, gravados: 0 });
  });

  /**
   * O restaurante é descoberto pelo endereço: vizinho.frentfood.test é o
   * vizinho. Um SaaS em que só um cliente consegue entrar não é um SaaS.
   *
   * Confere **em qual** restaurante a pessoa entrou, e não só se entrou. A
   * primeira versão deste teste passava pelo motivo errado: PIN é por
   * restaurante, os dois gerentes têm 2001, e o login — ignorando o endereço e
   * procurando sempre no "demo" — achava o PIN igual e entregava ao gerente do
   * vizinho a sessão do gerente do demo. Pior que não entrar: entrar na casa
   * errada.
   */
  it("o gerente do vizinho entra no restaurante dele, e não no demo", async () => {
    const gerente = B.gerentes[0]!;
    const visitante = pessoa(gerente.nome, gerente.pin, "10.3.9.9", "vizinho.frentfood.test");
    let erro: string | null = null;
    try {
      await entrar(visitante);
    } catch (e) {
      erro = e instanceof Error ? e.message : String(e);
    }
    const cookie = visitante.cookies.get("sessao");
    const sessao = cookie
      ? (JSON.parse(Buffer.from(cookie.split(".")[1]!, "base64url").toString()) as { tenantId: string; nome: string })
      : null;
    expect({ erro, restaurante: sessao?.tenantId === B.tenant.id ? "vizinho" : sessao?.tenantId === A.tenant.id ? "demo" : null }).toEqual({
      erro: null,
      restaurante: "vizinho",
    });
  });
});

describe("cozinha, salão e cliente ao mesmo tempo", () => {
  /**
   * Achado pelo dia simulado: o cliente desistiu, o prato foi cancelado com o
   * PIN do gerente — e quando a cozinha tocou "em preparo" no ticket, o item
   * voltou para a conta.
   */
  it("a cozinha não ressuscita item cancelado", async () => {
    const comandaId = await comandaPronta(A.garcons[0]!, 16, 2);
    const itens = await admin.comandaItem.findMany({ where: { comandaId } });
    const pedido = await admin.pedido.findFirstOrThrow({ where: { comandaId } });

    await como(A.gerentes[0]!, () => cancelarItem(itens[0]!.id, "cliente desistiu"));
    await como(A.gerentes[0]!, () => avancarPedido(pedido.id, "EM_PREPARO"));

    const depois = await admin.comandaItem.findUniqueOrThrow({ where: { id: itens[0]!.id } });
    expect(depois.status).toBe("CANCELADO");
  });

  it("dois garçons abrindo a mesma mesa no mesmo instante geram uma comanda só", async () => {
    const mesaId = A.mesas[17]!.id;
    await Promise.all([
      tentar(A.garcons[0]!, () => abrirComanda(mesaId, 2)),
      tentar(A.garcons[1]!, () => abrirComanda(mesaId, 2)),
    ]);
    const abertas = await admin.comanda.count({ where: { mesaId, status: { in: ["ABERTA", "FECHANDO"] } } });
    expect(abertas).toBe(1);
  });

  it("dois garçons abrindo mesas diferentes no mesmo instante não dão erro", async () => {
    const resultados = await Promise.all(
      [18, 19, 20, 21].map((i, k) => tentar(A.garcons[k % 3]!, () => abrirComanda(A.mesas[i]!.id, 2)))
    );
    expect(resultados.filter(recusou).map((r) => r.lancou ?? JSON.stringify(r.resposta))).toEqual([]);
  });

  /** A única tela sem sessão: roda sob RLS sem saber o restaurante. */
  it("o cliente chama o garçom pelo QR da mesa", async () => {
    const mesa = A.mesas[22]!;
    await como(A.garcons[0]!, () => abrirComanda(mesa.id, 2));
    const cliente = pessoa("cliente na mesa", "", "189.1.1.1", "demo.frentfood.test");
    const t = await tentar({ ...cliente, usuarioId: "", cargo: "" }, () => chamarGarcomPeloQr(mesa.qrToken!));
    expect(t.lancou ?? (temErro(t.resposta) ? t.resposta : null)).toBeNull();
  });
});

/**
 * Rodada de 21/09/2026 do testador de operação: sequências que ainda não
 * estavam aqui. Mesmo contrato do resto do arquivo — cada teste afirma o
 * comportamento seguro e falha enquanto a brecha existir.
 */
describe("exploração de 21/09", () => {
  /** A conta pela regra do sistema: sem carrinho e sem cancelado. */
  async function totalConsumido(comandaId: string) {
    const c = await admin.comanda.findUniqueOrThrow({
      where: { id: comandaId },
      include: { itens: { where: { status: { notIn: ["PENDENTE", "CANCELADO"] } } }, pagamentos: true },
    });
    const subtotal = c.itens.reduce((s, i) => s + Number(i.precoTotal), 0);
    const base = Math.max(0, subtotal - Number(c.descontoValor));
    const total = Math.round(base * (1 + Number(c.taxaServicoPct) / 100) * 100) / 100;
    const pago = c.pagamentos.reduce((s, p) => s + Number(p.valor) - Number(p.troco), 0);
    return { total, pago: Math.round(pago * 100) / 100 };
  }

  async function lancar(g: Membro, comandaId: string, item: Restaurante["itens"][number]) {
    await como(g, () =>
      adicionarAoCarrinho({
        comandaId,
        produtoId: item.produtoId,
        cardapioItemId: item.cardapioItemId,
        precoUnitario: item.preco,
        exigePontoCarne: false,
      })
    );
  }

  it("dois toques em 'enviar' não mandam a rodada duas vezes nem baixam o estoque em dobro", async () => {
    const g = A.garcons[0]!;
    const aberta = (await como(g, () => abrirComanda(A.mesas[30]!.id, 2))) as { comandaId: string };
    const bebida = A.itens.find((i) => i.controlaEstoque)!;
    const saldo = () =>
      admin.estoqueSaldo.findUniqueOrThrow({
        where: { unidadeId_produtoId: { unidadeId: A.unidade.id, produtoId: bebida.produtoId } },
      });
    const antes = Number((await saldo()).quantidade);
    await lancar(g, aberta.comandaId, bebida);
    await Promise.all([
      tentar(g, () => enviarCarrinho(aberta.comandaId)),
      tentar(g, () => enviarCarrinho(aberta.comandaId)),
    ]);
    const tickets = await admin.pedido.count({ where: { comandaId: aberta.comandaId } });
    const depois = Number((await saldo()).quantidade);
    expect({ tickets, baixa: antes - depois }).toEqual({ tickets: 1, baixa: 1 });
  });

  it("finalizar a conta não transforma o carrinho esquecido em item vendido", async () => {
    const g = A.garcons[1]!;
    const comandaId = await comandaPronta(g, 31, 2);
    // Lançado e nunca enviado: a cozinha não fez, o cliente não recebeu, não está na conta.
    await lancar(g, comandaId, A.itens.find((i) => i.titulo === "Água Mineral")!);
    const esquecido = await admin.comandaItem.findFirstOrThrow({ where: { comandaId, status: "PENDENTE" } });
    const caixa = A.caixas[0]!;
    await como(caixa, () => iniciarFechamento(comandaId));
    const { total } = await totalConsumido(comandaId);
    await como(caixa, () => registrarPagamento(comandaId, A.formas.pix.id, total, 0));
    const fim = await tentar(caixa, () => finalizarComanda(comandaId));
    const depois = await admin.comandaItem.findUnique({ where: { id: esquecido.id } });
    const conta = await totalConsumido(comandaId);
    expect({
      finalizou: !recusou(fim),
      esquecidoVirouVenda: depois !== null && depois.status !== "PENDENTE" && depois.status !== "CANCELADO",
      contaFecha: Math.abs(conta.total - conta.pago) < 0.005,
    }).toEqual({ finalizou: true, esquecidoVirouVenda: false, contaFecha: true });
  });

  it("a mesma liberação por PIN não vale para duas sangrias ao mesmo tempo", async () => {
    const g = A.garcons[1]!;
    const caixa = await admin.caixa.findFirstOrThrow({ where: { unidadeId: A.unidade.id, status: "ABERTO" } });
    const aprovacao = (await como(g, () => pedirAutorizacao("SANGRIA", caixa.id, A.gerentes[0]!.pin))) as {
      ok: boolean;
      id: string;
    };
    expect(aprovacao.ok).toBe(true);
    await Promise.all([
      tentar(g, () => registrarMovimentoCaixa(caixa.id, "SANGRIA", 7, "cofre", aprovacao.id)),
      tentar(g, () => registrarMovimentoCaixa(caixa.id, "SANGRIA", 7, "cofre", aprovacao.id)),
    ]);
    const sangrias = await admin.movimentoCaixa.count({
      where: { caixaId: caixa.id, tipo: "SANGRIA", usuarioId: g.usuarioId },
    });
    expect(sangrias, "sangrias feitas com uma única liberação").toBe(1);
  });

  it("taxa de serviço negativa ou inválida é recusada", async () => {
    const comandaId = await comandaPronta(A.garcons[1]!, 32);
    const gerente = A.gerentes[0]!;
    const negativa = await tentar(gerente, () => definirTaxaServico(comandaId, -100));
    const invalida = await tentar(gerente, () => definirTaxaServico(comandaId, Number.NaN));
    const comanda = await admin.comanda.findUniqueOrThrow({ where: { id: comandaId } });
    expect({
      negativaRecusada: recusou(negativa),
      invalidaViraMensagem: invalida.lancou === null && temErro(invalida.resposta),
      taxaGravada: Number(comanda.taxaServicoPct),
    }).toEqual({ negativaRecusada: true, invalidaViraMensagem: true, taxaGravada: 10 });
  });

  it("abrir mesa com número de pessoas absurdo é recusado", async () => {
    const t = await tentar(A.garcons[0]!, () => abrirComanda(A.mesas[33]!.id, -3));
    const abertas = await admin.comanda.count({ where: { mesaId: A.mesas[33]!.id } });
    expect({ recusou: recusou(t), abertas }).toEqual({ recusou: true, abertas: 0 });
  });

  /**
   * O cargo mora no cookie assinado, que vale 12 horas. `exigirSessao` confere
   * no banco se a pessoa continua ativa — mas não se continua com o mesmo cargo.
   */
  it("quem foi rebaixado no meio do turno perde as permissões do cargo antigo", async () => {
    const pin = "2999";
    const usuario = await admin.usuario.create({
      data: {
        tenantId: A.tenant.id,
        nome: "gerente rebaixado",
        email: "rebaixado@demo.com",
        pinHash: await bcrypt.hash(pin, 4),
        unidades: { create: { unidadeId: A.unidade.id, cargoId: A.cargos.GERENTE! } },
      },
    });
    const quem: Membro = {
      ...pessoa("gerente rebaixado", pin, "10.2.7.7", "demo.frentfood.test"),
      usuarioId: usuario.id,
      cargo: "GERENTE",
    };
    await entrar(quem);
    const comandaId = await comandaPronta(A.garcons[0]!, 34);
    await como(quem, () => iniciarFechamento(comandaId));

    await admin.usuarioUnidade.updateMany({ where: { usuarioId: usuario.id }, data: { cargoId: A.cargos.GARCOM! } });

    const t = await tentar(quem, () => aplicarDesconto(comandaId, 5, "amigo"));
    const comanda = await admin.comanda.findUniqueOrThrow({ where: { id: comandaId } });
    expect({ descontoGravado: Number(comanda.descontoValor), resposta: t.resposta }).toEqual({
      descontoGravado: 0,
      resposta: { precisaAutorizacao: "DESCONTO" },
    });
  });

  it("dois toques em 'finalizar' não emitem o cupom duas vezes", async () => {
    const comandaId = await comandaPronta(A.garcons[0]!, 35);
    const caixa = A.caixas[0]!;
    await como(caixa, () => iniciarFechamento(comandaId));
    const { total } = await totalConsumido(comandaId);
    await como(caixa, () => registrarPagamento(comandaId, A.formas.pix.id, total, 0));
    await Promise.all([
      tentar(caixa, () => finalizarComanda(comandaId)),
      tentar(caixa, () => finalizarComanda(comandaId)),
    ]);
    const cupons = await admin.filaImpressao.count({ where: { referenciaId: comandaId, tipo: "CUPOM" } });
    expect(cupons).toBe(1);
  });

  /**
   * O estorno apaga o pagamento. Numa conta já quitada, que saiu do mapa,
   * isso deixava uma comanda PAGA devendo: o dinheiro sai do caixa e a venda
   * continua no faturamento como recebida.
   *
   * A regra, decidida pelo dono em 21/09: conta paga não tem estorno — a
   * devolução sai como sangria. Então o teste exige a recusa, e que o
   * pagamento continue lá.
   */
  it("conta já paga não aceita estorno", async () => {
    const comandaId = await comandaPronta(A.garcons[0]!, 36);
    await pagarTudo(A.caixas[0]!, comandaId);
    const pagamento = await admin.pagamento.findFirstOrThrow({ where: { comandaId } });
    const t = await tentar(A.caixas[0]!, () => estornarPagamento(pagamento.id));
    const aindaLa = await admin.pagamento.count({ where: { id: pagamento.id } });
    const comanda = await admin.comanda.findUniqueOrThrow({ where: { id: comandaId } });
    expect({ recusou: recusou(t), aindaLa, status: comanda.status }).toEqual({
      recusou: true,
      aindaLa: 1,
      status: "PAGA",
    });
  });

  /**
   * O que continua permitido: corrigir um fechamento em andamento. Proibir o
   * estorno depois de pago não pode tirar do caixa o jeito de desfazer uma
   * forma de pagamento escolhida errado antes de finalizar.
   */
  it("antes de finalizar, o estorno continua corrigindo o fechamento", async () => {
    const comandaId = await comandaPronta(A.garcons[0]!, 50);
    const caixa = A.caixas[0]!;
    await como(caixa, () => iniciarFechamento(comandaId));
    const { total } = await totalConsumido(comandaId);
    await como(caixa, () => registrarPagamento(comandaId, A.formas.credito.id, total, 0));
    const pagamento = await admin.pagamento.findFirstOrThrow({ where: { comandaId } });
    const t = await tentar(caixa, () => estornarPagamento(pagamento.id));
    const restantes = await admin.pagamento.count({ where: { comandaId } });
    expect({ recusou: recusou(t), restantes }).toEqual({ recusou: false, restantes: 0 });
  });

  /**
   * Sessão válida no cookie, pessoa desligada no banco: a tela de login não
   * pode mandar para o PDV — que recusa —, senão ninguém mais entra naquele
   * tablet até o cookie vencer (linha de base, problema 9).
   */
  it("o tablet de quem foi desligado volta a mostrar o login", async () => {
    const g = A.garcons[2]!;
    // Cookie válido garantido: sem ele a tela mostraria o login por outro motivo.
    await entrar(g);
    expect(g.cookies.get("sessao")).toBeTruthy();
    await admin.usuario.update({ where: { id: g.usuarioId }, data: { ativo: false } });
    let destino: string | null = null;
    try {
      await como(g, () => LoginPage());
    } catch (e) {
      if (!ehRedirecionamento(e)) throw e;
      destino = String((e as { digest: string }).digest).split(";")[2] ?? "?";
    } finally {
      await admin.usuario.update({ where: { id: g.usuarioId }, data: { ativo: true } });
    }
    expect(destino, "a tela de login redirecionou para").toBeNull();
  });

  /**
   * A página que o cliente abre ao apontar a câmera para o QR. Sem sessão e
   * sob RLS, como o "chamar garçom" (linha de base, problema 8) — só que
   * ainda antes: se ela der 404, o botão nem aparece.
   */
  it("a página do QR da mesa abre para o cliente", async () => {
    const mesa = A.mesas[37]!;
    await como(A.garcons[0]!, () => abrirComanda(mesa.id, 2));
    const cliente = { ...pessoa("cliente na mesa", "", "189.1.1.2", "demo.frentfood.test"), usuarioId: "", cargo: "" };
    let erro: string | null = null;
    try {
      await como(cliente, () => MesaPublicaPage({ params: Promise.resolve({ token: mesa.qrToken! }) }));
    } catch (e) {
      erro = (e as { digest?: string }).digest ?? (e instanceof Error ? e.message : String(e));
    }
    expect(erro, "a página do QR respondeu").toBeNull();
  });

  /** O caixa fechado é um número assinado por alguém; nada pode mudá-lo depois. */
  it("depois do caixa fechado, estorno não reescreve o que foi apurado", async () => {
    const g = B.garcons[0]!;
    const c = B.caixas[0]!;
    const aberta = (await como(g, () => abrirComanda(B.mesas[0]!.id, 2))) as { comandaId: string };
    await lancar(g, aberta.comandaId, B.itens.find((i) => !i.exigePontoCarne)!);
    await como(g, () => enviarCarrinho(aberta.comandaId));
    await como(c, () => iniciarFechamento(aberta.comandaId));
    const { total } = await totalConsumido(aberta.comandaId);
    await como(c, () => registrarPagamento(aberta.comandaId, B.formas.dinheiro.id, total, 0));
    await como(c, () => finalizarComanda(aberta.comandaId));
    const caixa = await admin.caixa.findFirstOrThrow({ where: { unidadeId: B.unidade.id, status: "ABERTO" } });
    const fechado = await como(c, () => fecharCaixa(caixa.id, 200 + total));
    expect(temErro(fechado), JSON.stringify(fechado)).toBe(false);

    const pagamento = await admin.pagamento.findFirstOrThrow({ where: { comandaId: aberta.comandaId } });
    const t = await tentar(c, () => estornarPagamento(pagamento.id));
    const restantes = await admin.pagamento.count({ where: { caixaId: caixa.id } });
    expect({ recusou: recusou(t), restantes }).toEqual({ recusou: true, restantes: 1 });
  });

  /**
   * Fechar de novo um caixa já fechado regravava o valor informado, a
   * divergência e quem fechou: uma falta de ontem apagada com um toque.
   * Depende do teste anterior, que fecha o caixa do vizinho.
   */
  it("caixa fechado não se fecha de novo com outro valor", async () => {
    const caixa = await admin.caixa.findFirstOrThrow({
      where: { unidadeId: B.unidade.id, status: "FECHADO" },
      orderBy: { fechadoEm: "desc" },
    });
    const t = await tentar(B.caixas[0]!, () => fecharCaixa(caixa.id, 999999));
    const depois = await admin.caixa.findUniqueOrThrow({ where: { id: caixa.id } });
    expect({ recusou: recusou(t), valorInformado: Number(depois.valorInformado) }).toEqual({
      recusou: true,
      valorInformado: Number(caixa.valorInformado),
    });
  });

  /** O agente é um programa na rede do restaurante: corpo quebrado é erro dele, não do servidor. */
  it("o agente de impressão com corpo inválido recebe 400, não 500", async () => {
    const token = `agente-${A.unidade.id}`;
    await admin.unidade.update({ where: { id: A.unidade.id }, data: { tokenImpressao: token } });
    const resposta = await POSTImpressao(
      new NextRequest("http://demo.frentfood.test/api/impressao", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: "isto não é json",
      })
    );
    expect(resposta.status).toBe(400);
  });
});

/**
 * A outra metade do tablet preso (linha de base, problema 9).
 *
 * A primeira correção fez a tela de login parar de empurrar para o PDV. Mas o
 * PDV e a gestão, abertos com o cookie de quem foi desligado, **lançavam erro**
 * em vez de mandar para o login. No tablet com o app instalado não há barra de
 * endereço para digitar /login: a pessoa ficava na tela de erro até o cookie
 * vencer.
 *
 * Ficam no fim do arquivo porque desligam e religam gente que os outros testes
 * usam; o religamento refaz o login, para ninguém depois herdar um pote vazio.
 */
describe("sessão de quem foi desligado, nas telas", () => {
  async function abrirDesligado(quem: Membro, tela: () => Promise<unknown>) {
    await entrar(quem);
    await admin.usuario.update({ where: { id: quem.usuarioId }, data: { ativo: false } });
    let destino: string | null = null;
    let erro: string | null = null;
    try {
      await como(quem, tela);
    } catch (e) {
      if (ehRedirecionamento(e)) destino = String((e as { digest: string }).digest).split(";")[2] ?? "?";
      else erro = e instanceof Error ? e.message : String(e);
    } finally {
      await admin.usuario.update({ where: { id: quem.usuarioId }, data: { ativo: true } });
      await entrar(quem);
    }
    return { erro, destino };
  }

  it("o PDV manda para o login, e não para uma tela de erro", async () => {
    expect(await abrirDesligado(A.garcons[1]!, () => PdvMesasPage())).toEqual({
      erro: null,
      destino: "/login",
    });
  });

  it("a gestão manda para o login, e não para uma tela de erro", async () => {
    expect(await abrirDesligado(A.gerentes[0]!, () => GestaoLayout({ children: null }))).toEqual({
      erro: null,
      destino: "/login",
    });
  });
});
