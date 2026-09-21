import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { temErro } from "@/lib/erro-de-operacao";
import { abrirComanda, enviarCarrinho } from "@/app/pdv/actions";
import { adicionarAoCarrinho, alterarQuantidade } from "@/app/pdv/carrinho-actions";
import { cancelarItem } from "@/app/pdv/cancelamento-actions";
import { pedirAutorizacao } from "@/app/pdv/autorizacao-actions";
import { avancarPedido } from "@/app/kds/actions";
import { chamarGarcomPeloQr } from "@/app/mesa/[token]/actions";
import {
  abrirCaixa,
  aplicarDesconto,
  finalizarComanda,
  iniciarFechamento,
  registrarMovimentoCaixa,
  registrarPagamento,
} from "@/app/pdv/pagamento-actions";
import { admin } from "./admin";
import { montarRestaurante, type Membro, type Restaurante } from "./cenario";
import { entrar, quantoDeve } from "./operacao";
import { como, pessoa, sessaoAssinada } from "./usuarios-virtuais";

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
    mesas: 30,
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
