import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { temErro } from "@/lib/erro-de-operacao";
import { abrirComanda, enviarCarrinho } from "@/app/pdv/actions";
import { adicionarAoCarrinho, alterarQuantidade, definirPontoCarne } from "@/app/pdv/carrinho-actions";
import { cancelarItem } from "@/app/pdv/cancelamento-actions";
import { receberBalcao } from "@/app/pdv/balcao-actions";
import { comandaDeBalcao } from "@/lib/balcao";
import { pedirAutorizacao } from "@/app/pdv/autorizacao-actions";
import { avancarPedido } from "@/app/kds/actions";
import { atenderChamado } from "@/app/pdv/carrinho-actions";
import {
  cancelarNota,
  reemitirNota,
  salvarConfigFiscal,
  salvarPerfil,
  transmitirContingencia,
} from "@/app/gestao/fiscal/actions";
import { emitirNfce } from "@/lib/fiscal/emitir";
import { POST as POSTContingencia } from "@/app/api/fiscal/contingencia/route";
import { transferirMesa } from "@/app/pdv/transferencia-actions";
import {
  registrarContagem,
  registrarEntrada,
  registrarPerda,
  salvarComposicao,
} from "@/app/gestao/estoque/actions";
import { atualizarProduto, criarProduto, type DadosProduto } from "@/app/gestao/actions";
import { atualizarMesa } from "@/app/gestao/mesas/actions";
import {
  descartar,
  excluirImpressora,
  ligarPracaNaImpressora,
  reimprimir,
} from "@/app/gestao/impressao/actions";
import { salvarDivisaoDaTaxa } from "@/app/gestao/ajustes/actions";
import { gerarTokenImpressao } from "@/app/gestao/impressao/actions";
import {
  alternarNaMaquininha,
  criarForma,
  editarForma,
} from "@/app/gestao/formas-pagamento/actions";
import LoginPage from "@/app/login/page";
import PdvMesasPage from "@/app/pdv/page";
import GestaoLayout from "@/app/gestao/layout";
import AparelhosPage from "@/app/gestao/aparelhos/page";
import ImpressaoPage from "@/app/gestao/impressao/page";
import KdsPage from "@/app/kds/page";
import MesaPublicaPage from "@/app/mesa/[token]/page";
import { GET as GETImpressao, POST as POSTImpressao } from "@/app/api/impressao/route";
import { POST as POSTEntrar } from "@/app/api/maquininha/entrar/route";
import { GET as GETMesas, POST as POSTAbrirMesa } from "@/app/api/maquininha/mesas/route";
import { POST as POSTPagamentos } from "@/app/api/maquininha/pagamentos/route";
import { POST as POSTItensNoAparelho } from "@/app/api/maquininha/comandas/[id]/itens/route";
import { POST as POSTReabrirNoAparelho } from "@/app/api/maquininha/comandas/[id]/reabrir/route";
import { POST as POSTTransferirNoAparelho } from "@/app/api/maquininha/comandas/[id]/transferir/route";
import { POST as POSTCancelarNoAparelho } from "@/app/api/maquininha/itens/[id]/cancelar/route";
import { POST as POSTAutorizacoesNoAparelho } from "@/app/api/maquininha/autorizacoes/route";
import { NextRequest } from "next/server";
import { chamarGarcomPeloQr } from "@/app/mesa/[token]/actions";
import {
  abrirCaixa,
  aplicarDesconto,
  definirTaxaServico,
  estornarPagamento,
  fecharCaixa,
  definirPessoas,
  finalizarComanda,
  imprimirConferencia,
  iniciarFechamento,
  registrarMovimentoCaixa,
  registrarPagamento,
} from "@/app/pdv/pagamento-actions";
import { paraTela } from "@/lib/impressao";
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

/**
 * A frase da recusa.
 *
 * Existe porque "recusou" não basta em algumas portas: a nota fiscal recusa
 * sozinha quando a emissão está desligada, e o carrinho recusa por preço ou
 * esgotado. Um ataque que aceite qualquer recusa passaria sem provar nada da
 * regra que ele veio defender.
 */
const porQue = (t: { resposta: unknown; lancou: string | null }) =>
  t.lancou ?? (temErro(t.resposta) ? t.resposta.erro : "");

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

  /** O perfil fiscal mínimo que a action aceita. */
  const perfilDeProva = (nome: string) => ({
    nome,
    cfop: "5102",
    origemMercadoria: 0,
    csosn: "102",
    cstIcms: "",
    aliquotaIcms: 0,
    cstPis: "49",
    aliquotaPis: 0,
    cstCofins: "49",
    aliquotaCofins: 0,
    padrao: false,
  });

  /**
   * O fiscal na mão de quem edita cardápio.
   *
   * As cinco ações da tela pediam `produto.editar`: a mesma permissão de
   * trocar o título de um prato abria CFOP, CST/CSOSN e alíquotas — o que a
   * NFC-e declara à SEFAZ no nome da empresa —, a série, o ambiente de
   * emissão, o CSC, o token do emissor e o cancelamento de nota, que tem prazo
   * contado. As telas vizinhas de mesma natureza pedem `unidade.configurar`.
   *
   * Na instalação padrão (`prisma/dados-de-exemplo.ts`) o gerente tem
   * `produto.editar` e não tem `unidade.configurar` — então é exatamente ele
   * quem passava.
   */
  it("o gerente não mexe no fiscal da casa", async () => {
    const antes = await admin.unidade.findUniqueOrThrow({
      where: { id: A.unidade.id },
      select: { serieNfce: true, ambienteFiscal: true, inscricaoEstadual: true },
    });

    const config = await tentar(A.gerentes[0]!, () =>
      salvarConfigFiscal({
        inscricaoEstadual: "111111111",
        regimeTributario: "SIMPLES_NACIONAL",
        serieNfce: 9,
        ambienteFiscal: "PRODUCAO",
        emiteNfce: false,
        cscId: "1",
        csc: "",
        tokenEmissor: "",
      })
    );
    const perfil = await tentar(A.gerentes[0]!, () =>
      salvarPerfil(perfilDeProva("Perfil do gerente"))
    );

    const depois = await admin.unidade.findUniqueOrThrow({
      where: { id: A.unidade.id },
      select: { serieNfce: true, ambienteFiscal: true, inscricaoEstadual: true },
    });

    expect({
      config: recusou(config),
      perfil: recusou(perfil),
      perfisDoGerente: await admin.perfilFiscal.count({
        where: { unidadeId: A.unidade.id, nome: "Perfil do gerente" },
      }),
      serie: depois.serieNfce === antes.serieNfce,
      ambiente: depois.ambienteFiscal === antes.ambienteFiscal,
      ie: depois.inscricaoEstadual === antes.inscricaoEstadual,
    }).toEqual({
      config: true,
      perfil: true,
      perfisDoGerente: 0,
      serie: true,
      ambiente: true,
      ie: true,
    });
  });

  /** E quem responde pela unidade continua mexendo. */
  it("o proprietário mexe no fiscal", async () => {
    const t = await tentar(A.proprietario, () =>
      salvarPerfil(perfilDeProva("Perfil do dono"))
    );

    const criado = await admin.perfilFiscal.count({
      where: { unidadeId: A.unidade.id, nome: "Perfil do dono" },
    });
    await admin.perfilFiscal.deleteMany({
      where: { unidadeId: A.unidade.id, nome: "Perfil do dono" },
    });

    expect({ recusou: recusou(t), criado }).toEqual({ recusou: false, criado: 1 });
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

/**
 * O ticket que saiu no papel, puxado de volta para a tela.
 *
 * A casa que trocou a tela de cozinha pela térmica não tem quem toque em
 * "pronto": o ticket nasce `NO_PAPEL` justamente para ficar fora do quadro e
 * da contagem de atrasados da barra. A porta do KDS, porém, é pública e só
 * exige estar logado — pelo `avancarPedido` o ticket voltaria ao fluxo da
 * tela, reaparecendo no quadro e voltando a contar como atrasado, que é o
 * problema que o estado resolve.
 */
/**
 * A troca de destino no meio do turno.
 *
 * O dono muda "como a cozinha recebe" quando a térmica chega — e isso
 * acontece com a casa aberta, porque é quando ele está no restaurante. Os
 * tickets que já estavam no fogo nasceram no fluxo da tela: ninguém os marcou
 * como prontos, eles contam como atrasados na barra, e quem avança é a cozinha
 * **nesta tela**. Se a tela os engolir, não sobra nenhum lugar onde terminá-los
 * — prato no fogo sem acompanhamento e um alarme que ninguém pode desligar.
 */
describe("trocar o destino com a casa aberta", () => {
  const destinoDaCasa = async (valor: string) => {
    await admin.parametroUnidade.upsert({
      where: { unidadeId_chave: { unidadeId: A.unidade.id, chave: "producao.destinoDoPedido" } },
      create: {
        tenantId: A.tenant.id,
        unidadeId: A.unidade.id,
        grupo: "KDS",
        chave: "producao.destinoDoPedido",
        valor,
      },
      update: { valor },
    });
  };

  it("o prato que está no fogo continua na tela, e o aviso explica o resto", async () => {
    // Uma rodada no fluxo da tela, que é como a casa estava até agora.
    const g = A.garcons[2]!;
    const aberta = (await como(g, () => abrirComanda(A.mesas[44]!.id, 2))) as { comandaId: string };
    const item = A.itens[0]!;
    await como(g, () =>
      adicionarAoCarrinho({
        comandaId: aberta.comandaId,
        produtoId: item.produtoId,
        cardapioItemId: item.cardapioItemId,
        precoUnitario: item.preco,
        exigePontoCarne: false,
      })
    );
    await como(g, () => enviarCarrinho(aberta.comandaId));
    const pedido = await admin.pedido.findFirstOrThrow({ where: { comandaId: aberta.comandaId } });

    // Agora a térmica chegou, e o dono troca com a mesa servida.
    await destinoDaCasa("PAPEL");
    const comPratoNoFogo = JSON.stringify(await como(g, () => KdsPage()));

    // Terminado o prato, ele sai do quadro como qualquer outro.
    //
    // Não se afirma aqui que a tela virou o aviso de "quadro vazio": nesta
    // altura da bateria a unidade A tem outros tickets vivos, e exigir o
    // quadro vazio faria este teste depender da ordem dos vizinhos. O que se
    // afirma é o que não depende deles — o ticket entra, é avançado por esta
    // tela e sai. A tela do aviso sozinho é o caso que o `pedidos.length === 0`
    // decide, e está provado no navegador.
    await como(A.caixas[0]!, () => avancarPedido(pedido.id, "PRONTO"));
    await como(A.caixas[0]!, () => avancarPedido(pedido.id, "ENTREGUE"));
    const semPrato = JSON.stringify(await como(g, () => KdsPage()));

    await destinoDaCasa("TELA_E_PAPEL");
    const depois = await admin.pedido.findUniqueOrThrow({ where: { id: pedido.id } });

    expect({
      ticketNaTela: comPratoNoFogo.includes(`"numero":${pedido.numero}`),
      avisouQueOsNovosSaemNoPapel: comPratoNoFogo.includes("saem na impressora"),
      // Com o fogo apagado, a tela é só o aviso — e o ticket não está nela.
      quadroDepois: semPrato.includes(`"numero":${pedido.numero}`),
      // E, com prato no fogo, a tela **não** trocou o quadro pelo aviso: é
      // exatamente o que ela fazia antes desta correção.
      trocouOQuadroPeloAviso: comPratoNoFogo.includes("recebe os pedidos pela impressora"),
      // E ele foi avançado de verdade, pela tela, depois da troca.
      status: depois.status,
    }).toEqual({
      ticketNaTela: true,
      avisouQueOsNovosSaemNoPapel: true,
      quadroDepois: false,
      trocouOQuadroPeloAviso: false,
      status: "ENTREGUE",
    });
  });
});

describe("o ticket de papel e a porta do KDS", () => {
  it("o monitor não puxa de volta o pedido que saiu no papel", async () => {
    const g = A.garcons[1]!;
    const aberta = (await como(g, () => abrirComanda(A.mesas[49]!.id, 2))) as { comandaId: string };
    const item = A.itens[0]!;
    await como(g, () =>
      adicionarAoCarrinho({
        comandaId: aberta.comandaId,
        produtoId: item.produtoId,
        cardapioItemId: item.cardapioItemId,
        precoUnitario: item.preco,
        exigePontoCarne: false,
      })
    );
    await como(g, () => enviarCarrinho(aberta.comandaId));
    const pedido = await admin.pedido.findFirstOrThrow({ where: { comandaId: aberta.comandaId } });
    // A casa é de papel: o ticket já nasceria assim no fluxo de verdade, e
    // aqui chega-se ao mesmo estado sem reconfigurar o cenário inteiro.
    await admin.pedido.update({ where: { id: pedido.id }, data: { status: "NO_PAPEL" } });

    const t = await tentar(A.caixas[0]!, () => avancarPedido(pedido.id, "PRONTO"));

    const depois = await admin.pedido.findUniqueOrThrow({ where: { id: pedido.id } });
    expect({ porQue: porQue(t), status: depois.status }).toEqual({
      porQue: "Este pedido saiu no papel: quem acompanha é a comanda da praça.",
      status: "NO_PAPEL",
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
   * Os tickets de conta paga ficavam no KDS: depois do dia simulado eram 433
   * "na fila". Decidido pelo dono em 22/09: ao pagar, sai sozinho o ticket
   * pronto; o que ainda está na fila ou no fogo fica, porque há casa em que se
   * paga antes de a comida sair. E a cozinha terminar esse prato não devolve à
   * conta paga um item "em preparo".
   */
  it("conta paga tira da cozinha o ticket pronto e deixa o que ainda está por fazer", async () => {
    const pronta = await comandaPronta(A.garcons[0]!, 52);
    const jaPronto = await admin.pedido.findFirstOrThrow({ where: { comandaId: pronta } });
    await como(A.garcons[1]!, () => avancarPedido(jaPronto.id, "PRONTO"));
    await pagarTudo(A.caixas[0]!, pronta);
    const prontoDepois = await admin.pedido.findUniqueOrThrow({ where: { id: jaPronto.id } });

    const porFazer = await comandaPronta(A.garcons[0]!, 55);
    const noFogo = await admin.pedido.findFirstOrThrow({ where: { comandaId: porFazer } });
    await pagarTudo(A.caixas[0]!, porFazer);
    const porFazerDepois = await admin.pedido.findUniqueOrThrow({ where: { id: noFogo.id } });
    const t = await tentar(A.garcons[1]!, () => avancarPedido(noFogo.id, "PRONTO"));
    const aposCozinha = await admin.pedido.findUniqueOrThrow({ where: { id: noFogo.id } });
    const itens = await admin.comandaItem.findMany({ where: { comandaId: porFazer }, select: { status: true } });

    expect({
      prontoDepoisDePagar: prontoDepois.status,
      porFazerDepoisDePagar: porFazerDepois.status,
      cozinhaTerminou: !recusou(t) && aposCozinha.status === "PRONTO",
      itensDaConta: [...new Set(itens.map((i) => i.status))],
    }).toEqual({
      prontoDepoisDePagar: "ENTREGUE",
      porFazerDepoisDePagar: noFogo.status,
      cozinhaTerminou: true,
      itensDaConta: ["ENTREGUE"],
    });
  });

  // Decidido pelo dono em 22/09: o gerente transfere mesa, como o garçom.
  it("o gerente da instalação padrão transfere mesa", async () => {
    const comandaId = await comandaPronta(A.garcons[0]!, 53, 1);
    const t = await tentar(A.gerentes[0]!, () => transferirMesa(comandaId, A.mesas[54]!.id));
    const comanda = await admin.comanda.findUniqueOrThrow({ where: { id: comandaId } });
    expect({ recusou: recusou(t), mesa: comanda.mesaId }).toEqual({ recusou: false, mesa: A.mesas[54]!.id });
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
 * A porta da maquininha.
 *
 * Ela fecha conta e recebe dinheiro sem passar por navegador nenhum: o que
 * protege é o token do aparelho (de qual restaurante ele é) mais o PIN de quem
 * está recebendo. Os dois precisam ser conferidos em toda chamada, e o reenvio
 * de um resultado preso na rede não pode virar um segundo pagamento.
 */
describe("maquininha", () => {
  const BASE = "http://demo.frentfood.test";

  async function ligarAparelho(r: Restaurante, marca: string) {
    const token = `maquininha-${marca}-${r.unidade.id}`;
    await admin.unidade.update({ where: { id: r.unidade.id }, data: { tokenImpressao: token } });
    return token;
  }

  function chamada(
    caminho: string,
    o: { aparelho?: string; operador?: string; corpo?: unknown } = {}
  ) {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (o.aparelho) headers.authorization = `Bearer ${o.aparelho}`;
    if (o.operador) headers["x-operador"] = o.operador;
    return new NextRequest(`${BASE}${caminho}`, {
      method: o.corpo === undefined ? "GET" : "POST",
      headers,
      ...(o.corpo === undefined ? {} : { body: JSON.stringify(o.corpo) }),
    });
  }

  const tokenDoOperador = async (aparelho: string, pin: string) => {
    const r = await POSTEntrar(chamada("/api/maquininha/entrar", { aparelho, corpo: { pin } }));
    return { status: r.status, corpo: (await r.json()) as { token?: string; erro?: string } };
  };

  /**
   * Um aparelho com **cadastro próprio**, e não o token da unidade.
   *
   * O `ligarAparelho` acima põe o token na unidade, que é o que o agente antigo
   * usa: ele não identifica aparelho nenhum, e com ele o crachá não tem a que
   * se prender. Os ataques de crachá copiado precisam de dois aparelhos que o
   * servidor saiba distinguir.
   */
  const cadastrarAparelho = async (r: Restaurante, nome: string) =>
    (
      await admin.aparelho.create({
        data: {
          tenantId: r.tenant.id,
          unidadeId: r.unidade.id,
          nome,
          token: `aparelho-${nome}-${r.unidade.id}`,
        },
      })
    ).token;

  /**
   * O cabeçalho `x-operador` copiado de um aparelho para o outro.
   *
   * O crachá do turno é um JWT de doze horas, e era portador puro: quem
   * copiasse o cabeçalho operava como aquela pessoa até ele vencer. O par que
   * falta — o token do aparelho — também não é segredo: o da unidade está no
   * arquivo de configuração do agente de impressão do balcão. Quatro
   * relatórios seguidos apontaram isto antes de ser fechado, e o que fecha é o
   * crachá nascer preso ao aparelho em que o PIN foi digitado.
   */
  it("o crachá copiado não recebe no aparelho do lado", async () => {
    const doSalao = await cadastrarAparelho(A, "salao");
    const doBalcao = await cadastrarAparelho(A, "balcao");
    const caixa = await tokenDoOperador(doSalao, A.caixas[0]!.pin);

    const { comandaId } = await contaNaMesaNova(A.garcons[0]!, 2);
    const { falta } = await quantoDeve(comandaId);
    const corpo = {
      comandaId,
      referencia: "cracha-copiado-de-outro-aparelho",
      forma: "DEBITO",
      valorEmCentavos: Math.round(falta * 100),
    };

    const noOutro = await POSTPagamentos(
      chamada("/api/maquininha/pagamentos", { aparelho: doBalcao, operador: caixa.corpo.token!, corpo })
    );
    // E o mesmo crachá, no aparelho dele, recebe: a regra barra o lugar
    // errado, não o operador.
    const noDele = await POSTPagamentos(
      chamada("/api/maquininha/pagamentos", { aparelho: doSalao, operador: caixa.corpo.token!, corpo })
    );

    expect({
      noOutro: noOutro.status,
      noDele: noDele.status,
      pagamentos: await admin.pagamento.count({ where: { comandaId } }),
    }).toEqual({ noOutro: 401, noDele: 200, pagamentos: 1 });
  });

  it("sem token do aparelho e sem operador, ninguém vê as mesas", async () => {
    const aparelho = await ligarAparelho(A, "mesas");
    const semNada = await GETMesas(chamada("/api/maquininha/mesas"));
    const semOperador = await GETMesas(chamada("/api/maquininha/mesas", { aparelho }));
    const comLixo = await GETMesas(
      chamada("/api/maquininha/mesas", { aparelho, operador: "token.inventado.aqui" })
    );
    expect([semNada.status, semOperador.status, comLixo.status]).toEqual([401, 401, 401]);
  });

  /**
   * O garçom entra, e a porta do dinheiro continua fechada para ele.
   *
   * Até o salão entrar no aparelho, a porta do turno só abria para quem recebe
   * pagamento, e este teste exigia 403 para o garçom. Com a maquininha abrindo
   * mesa e lançando rodada, o cargo que ela atende é justamente o dele: entrar
   * passou a valer para quem recebe **ou** lança, e cada rota confere a sua
   * permissão depois.
   *
   * O que importa não mudou, e é o que se afirma aqui: o garçom entra no
   * aparelho e **não** registra pagamento. A conferência saiu da porta e foi
   * para a rota, e é lá que ela é cobrada.
   */
  it("o garçom entra no aparelho, mas não registra pagamento", async () => {
    const aparelho = await ligarAparelho(A, "pin");
    const garcom = await tokenDoOperador(aparelho, A.garcons[0]!.pin);
    const errado = await tokenDoOperador(aparelho, "9999");
    const caixa = await tokenDoOperador(aparelho, A.caixas[0]!.pin);

    const { comandaId } = await contaNaMesaNova(A.garcons[0]!, 2);
    const { falta } = await quantoDeve(comandaId);
    const cobrou = await POSTPagamentos(
      chamada("/api/maquininha/pagamentos", {
        aparelho,
        operador: garcom.corpo.token!,
        corpo: {
          comandaId,
          referencia: "garcom-querendo-cobrar",
          forma: "DEBITO",
          valorEmCentavos: Math.round(falta * 100),
        },
      })
    );

    expect({
      garcom: garcom.status,
      garcomComToken: typeof garcom.corpo.token === "string",
      errado: errado.status,
      caixa: caixa.status,
      caixaComToken: typeof caixa.corpo.token === "string",
      cobrou: cobrou.status,
      pagamentos: await admin.pagamento.count({ where: { comandaId } }),
    }).toEqual({
      garcom: 200,
      garcomComToken: true,
      errado: 401,
      caixa: 200,
      caixaComToken: true,
      cobrou: 403,
      pagamentos: 0,
    });
  });

  it("operador de um restaurante não opera a maquininha do outro", async () => {
    const doVizinho = await ligarAparelho(B, "vizinho");
    const daCasa = await ligarAparelho(A, "casa");
    const operadorVizinho = (await tokenDoOperador(doVizinho, B.caixas[0]!.pin)).corpo.token!;

    const resposta = await GETMesas(
      chamada("/api/maquininha/mesas", { aparelho: daCasa, operador: operadorVizinho })
    );
    expect(resposta.status).toBe(401);
  });

  it("a maquininha só enxerga as mesas do próprio restaurante", async () => {
    const aparelho = await ligarAparelho(A, "lista");
    const operador = (await tokenDoOperador(aparelho, A.caixas[0]!.pin)).corpo.token!;
    const comandaId = await comandaPronta(A.garcons[0]!, 56, 2);

    const resposta = await GETMesas(chamada("/api/maquininha/mesas", { aparelho, operador }));
    const corpo = (await resposta.json()) as { mesas: { comandaId: string }[] };
    const doVizinho = await admin.comanda.findMany({
      where: { unidadeId: B.unidade.id },
      select: { id: true },
    });

    expect({
      trouxeAMinha: corpo.mesas.some((m) => m.comandaId === comandaId),
      trouxeDoVizinho: corpo.mesas.some((m) => doVizinho.some((c) => c.id === m.comandaId)),
    }).toEqual({ trouxeAMinha: true, trouxeDoVizinho: false });
  });

  it("o reenvio do mesmo pagamento não cobra duas vezes", async () => {
    const aparelho = await ligarAparelho(A, "reenvio");
    const operador = (await tokenDoOperador(aparelho, A.caixas[0]!.pin)).corpo.token!;
    const comandaId = await comandaPronta(A.garcons[0]!, 57, 2);
    const { falta } = await quantoDeve(comandaId);
    const corpo = {
      comandaId,
      referencia: "rede-caiu-no-meio",
      forma: "CREDITO",
      valorEmCentavos: Math.round((falta / 2) * 100),
      finalizar: false,
    };

    const uma = await POSTPagamentos(chamada("/api/maquininha/pagamentos", { aparelho, operador, corpo }));
    const outra = await POSTPagamentos(chamada("/api/maquininha/pagamentos", { aparelho, operador, corpo }));
    const pagamentos = await admin.pagamento.findMany({ where: { comandaId } });

    expect({
      uma: uma.status,
      outra: outra.status,
      quantos: pagamentos.length,
      jaRegistrado: ((await outra.json()) as { jaRegistrado: boolean }).jaRegistrado,
    }).toEqual({ uma: 200, outra: 200, quantos: 1, jaRegistrado: true });
  });

  it("pagamento acima do que falta é recusado, e nada entra", async () => {
    const aparelho = await ligarAparelho(A, "demais");
    const operador = (await tokenDoOperador(aparelho, A.caixas[0]!.pin)).corpo.token!;
    const comandaId = await comandaPronta(A.garcons[0]!, 58, 2);
    const { falta } = await quantoDeve(comandaId);

    const resposta = await POSTPagamentos(
      chamada("/api/maquininha/pagamentos", {
        aparelho,
        operador,
        corpo: {
          comandaId,
          referencia: "dedo-pesado",
          forma: "DEBITO",
          valorEmCentavos: Math.round((falta + 50) * 100),
        },
      })
    );
    const pagamentos = await admin.pagamento.count({ where: { comandaId } });
    expect({ status: resposta.status, pagamentos }).toEqual({ status: 409, pagamentos: 0 });
  });

  it("quando o pagamento quita, a conta fecha e a mesa volta para o salão", async () => {
    const aparelho = await ligarAparelho(A, "quita");
    const operador = (await tokenDoOperador(aparelho, A.caixas[0]!.pin)).corpo.token!;
    const mesa = A.mesas[59]!;
    const comandaId = await comandaPronta(A.garcons[0]!, 59, 2);
    const { falta } = await quantoDeve(comandaId);

    const resposta = await POSTPagamentos(
      chamada("/api/maquininha/pagamentos", {
        aparelho,
        operador,
        corpo: {
          comandaId,
          referencia: "pagou-tudo",
          forma: "CREDITO",
          valorEmCentavos: Math.round(falta * 100),
          nsu: "123456",
          bandeira: "MASTERCARD",
        },
      })
    );
    const corpo = (await resposta.json()) as { quitada: boolean; finalizada: boolean };
    const comanda = await admin.comanda.findUniqueOrThrow({ where: { id: comandaId } });
    const depois = await admin.mesa.findUniqueOrThrow({ where: { id: mesa.id } });
    const pagamento = await admin.pagamento.findFirstOrThrow({ where: { comandaId } });

    expect({
      status: resposta.status,
      quitada: corpo.quitada,
      finalizada: corpo.finalizada,
      comanda: comanda.status,
      mesa: depois.status,
      // Quem recebeu é o operador do PIN, não o aparelho: é isso que o diário
      // responde quando alguém pergunta de quem foi a venda.
      recebedor: pagamento.usuarioId === A.caixas[0]!.usuarioId,
      nsu: pagamento.nsu,
    }).toEqual({
      status: 200,
      quitada: true,
      finalizada: true,
      comanda: "PAGA",
      mesa: "LIVRE",
      recebedor: true,
      nsu: "123456",
    });
  });

  /**
   * O salão dentro do aparelho — exploração de 16/10.
   *
   * Nove rotas novas passaram a abrir mesa, lançar rodada, pedir a conta,
   * reabrir, transferir, cancelar item e aprovar com PIN sem navegador nenhum.
   * O que se procura aqui é o que muda **durante** o turno: gente desligada,
   * cargo rebaixado, aparelho cortado — e as corridas de dois aparelhos na
   * mesma mesa e na mesma fila de papel.
   */

  /** Uma mesa só deste teste: as 60 do cenário já têm dono nos de cima. */
  let proximaMesa = 900;
  async function mesaNova() {
    const area = await admin.area.findFirstOrThrow({ where: { unidadeId: A.unidade.id } });
    proximaMesa += 1;
    return admin.mesa.create({
      data: {
        tenantId: A.tenant.id,
        unidadeId: A.unidade.id,
        areaId: area.id,
        numero: String(proximaMesa),
        capacidade: 4,
        qrToken: `qr-aparelho-${proximaMesa}`,
      },
    });
  }

  /** Uma conta honesta numa mesa nova, aberta e lançada pelo PDV. */
  async function contaNaMesaNova(g: Membro, itens = 2) {
    const mesa = await mesaNova();
    const aberta = await como(g, () => abrirComanda(mesa.id, 2));
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
    return { mesa, comandaId: aberta.comandaId };
  }

  const comId = (id: string) => ({ params: Promise.resolve({ id }) });

  /**
   * Desligado no meio do turno.
   *
   * No navegador isto já é conferido em toda requisição (`conferirNoBanco` em
   * `src/lib/session.ts`): o cookie vale 12 horas, e sem a conferência quem
   * fosse desligado continuaria recebendo dinheiro até ele vencer. O token do
   * turno da maquininha dura as mesmas 12 horas e é a mesma pergunta.
   */
  it("o caixa desligado no meio do turno para de receber pelo aparelho", async () => {
    const aparelho = await ligarAparelho(A, "desligado-no-turno");
    const caixa = A.caixas[0]!;
    const operador = (await tokenDoOperador(aparelho, caixa.pin)).corpo.token!;
    const { comandaId } = await contaNaMesaNova(A.garcons[0]!, 2);
    const { falta } = await quantoDeve(comandaId);

    await admin.usuario.update({ where: { id: caixa.usuarioId }, data: { ativo: false } });
    try {
      const resposta = await POSTPagamentos(
        chamada("/api/maquininha/pagamentos", {
          aparelho,
          operador,
          corpo: {
            comandaId,
            referencia: "turno-de-quem-ja-saiu",
            forma: "CREDITO",
            valorEmCentavos: Math.round(falta * 100),
          },
        })
      );
      expect({
        status: resposta.status,
        pagamentos: await admin.pagamento.count({ where: { comandaId } }),
        conta: (await admin.comanda.findUniqueOrThrow({ where: { id: comandaId } })).status,
      }).toEqual({ status: 401, pagamentos: 0, conta: "ABERTA" });
    } finally {
      await admin.usuario.update({ where: { id: caixa.usuarioId }, data: { ativo: true } });
    }
  });

  /**
   * Rebaixado no meio do turno.
   *
   * A outra metade do mesmo cuidado: no navegador o cargo é relido do banco em
   * toda requisição, justamente porque "o gerente rebaixado a garçom continuava
   * dando desconto sem PIN até o cookie vencer". No aparelho, as permissões
   * vão dentro do token do turno.
   */
  it("o caixa rebaixado a garçom no meio do turno deixa de receber pelo aparelho", async () => {
    const aparelho = await ligarAparelho(A, "rebaixado-no-turno");
    const caixa = A.caixas[0]!;
    const operador = (await tokenDoOperador(aparelho, caixa.pin)).corpo.token!;
    const { comandaId } = await contaNaMesaNova(A.garcons[0]!, 2);
    const { falta } = await quantoDeve(comandaId);

    const vinculo = await admin.usuarioUnidade.findFirstOrThrow({
      where: { usuarioId: caixa.usuarioId, unidadeId: A.unidade.id },
    });
    await admin.usuarioUnidade.update({
      where: { id: vinculo.id },
      data: { cargoId: A.cargos.GARCOM! },
    });
    try {
      const resposta = await POSTPagamentos(
        chamada("/api/maquininha/pagamentos", {
          aparelho,
          operador,
          corpo: {
            comandaId,
            referencia: "cargo-de-ontem",
            forma: "CREDITO",
            valorEmCentavos: Math.round(falta * 100),
          },
        })
      );
      expect({
        recusou: resposta.status === 401 || resposta.status === 403,
        pagamentos: await admin.pagamento.count({ where: { comandaId } }),
      }).toEqual({ recusou: true, pagamentos: 0 });
    } finally {
      await admin.usuarioUnidade.update({
        where: { id: vinculo.id },
        data: { cargoId: vinculo.cargoId },
      });
    }
  });

  /**
   * O aparelho cortado para de falar na mesma hora — o contraste do caso acima.
   *
   * Aqui o cadastro é relido a cada chamada (`reconhecerPeloToken`), e é isso
   * que faz "cortar a maquininha que sumiu no táxi" significar alguma coisa.
   */
  it("a maquininha revogada para de falar, mesmo com o turno aberto", async () => {
    const token = `aparelho-proprio-${A.unidade.id}`;
    const aparelho = await admin.aparelho.create({
      data: { tenantId: A.tenant.id, unidadeId: A.unidade.id, nome: "Maquininha 7", token },
    });
    const operador = (await tokenDoOperador(token, A.caixas[0]!.pin)).corpo.token!;

    const antes = await GETMesas(chamada("/api/maquininha/mesas", { aparelho: token, operador }));
    await admin.aparelho.update({
      where: { id: aparelho.id },
      data: { ativo: false, revogadoEm: new Date() },
    });
    const depois = await GETMesas(chamada("/api/maquininha/mesas", { aparelho: token, operador }));

    expect({ antes: antes.status, depois: depois.status }).toEqual({ antes: 200, depois: 401 });
  });

  /**
   * O token do turno não é cookie de navegador.
   *
   * Ele é assinado com a chave da sessão mais um sufixo justamente para isto:
   * quem copiasse o da maquininha entraria na gestão pelo navegador.
   */
  it("o token do turno não vale como cookie de sessão", async () => {
    const aparelho = await ligarAparelho(A, "chave-separada");
    const operador = (await tokenDoOperador(aparelho, A.caixas[0]!.pin)).corpo.token!;
    const { comandaId } = await contaNaMesaNova(A.garcons[0]!, 1);

    const intruso = pessoa("intruso", "0000", "10.2.0.98", "demo.frentfood.test");
    intruso.cookies.set("sessao", operador);
    const t = await tentar(intruso as unknown as Membro, () =>
      registrarPagamento(comandaId, A.formas.pix.id, 1, 0)
    );

    expect({
      recusou: recusou(t),
      pagamentos: await admin.pagamento.count({ where: { comandaId } }),
    }).toEqual({ recusou: true, pagamentos: 0 });
  });

  /**
   * Dois aparelhos puxando a fila ao mesmo tempo.
   *
   * Era hipótese enquanto só o balcão imprimia; deixou de ser quando a
   * maquininha virou agente e passou a buscar na mesma fila. Duas vias da mesma
   * comanda na cozinha é prato feito duas vezes.
   */
  it("dois agentes buscando ao mesmo tempo não levam o mesmo papel", async () => {
    const daMaquininha = `agente-fila-${A.unidade.id}`;
    await admin.aparelho.create({
      data: {
        tenantId: A.tenant.id,
        unidadeId: A.unidade.id,
        nome: "Maquininha da fila",
        token: daMaquininha,
      },
    });
    const daUnidade = await ligarAparelho(A, "fila-de-dois");
    for (let i = 0; i < 3; i++) await contaNaMesaNova(A.garcons[0]!, 2);

    const esperando = await admin.filaImpressao.count({
      where: { unidadeId: A.unidade.id, status: "PENDENTE", entregueEm: null },
    });

    const buscar = (token: string, agente: string) =>
      GETImpressao(
        new NextRequest(`http://demo.frentfood.test/api/impressao?agente=${agente}`, {
          headers: { authorization: `Bearer ${token}` },
        })
      );
    const [um, dois] = await Promise.all([
      buscar(daUnidade, "balcao"),
      buscar(daMaquininha, "maquininha"),
    ]);
    const ids = async (r: Response) =>
      ((await r.json()) as { trabalhos: { id: string }[] }).trabalhos.map((t) => t.id);
    const doBalcao = await ids(um);
    const doAparelho = await ids(dois);

    expect({
      status: [um.status, dois.status],
      haviaPapel: esperando > 0,
      nosDois: doBalcao.filter((id) => doAparelho.includes(id)),
    }).toEqual({ status: [200, 200], haviaPapel: true, nosDois: [] });
  });

  /**
   * O papel que o agente levou e não imprimiu.
   *
   * A reserva segura o trabalho por dois minutos para o outro agente não tirar
   * uma segunda via. Mas o agente pode ter perdido a rede ou morrido no meio, e
   * aí o prazo tem de devolver o papel à fila: o risco do prazo curto é uma
   * segunda via; o do prazo que não vence é a cozinha esperando para sempre.
   *
   * A marca de entrega é escrita aqui pelo Prisma, como qualquer outra data do
   * banco — é assim que uma rotina de manutenção a escreveria. A fila comparava
   * com `now()`, que resolve no fuso da sessão do Postgres, e as duas leituras
   * ficavam três horas apartadas: o papel só voltava à fila depois de o fuso
   * inteiro passar.
   */
  it("o papel reservado não sai duas vezes, e volta à fila quando o prazo vence", async () => {
    const token = await ligarAparelho(A, "fila-vencida");
    await contaNaMesaNova(A.garcons[0]!, 2);

    const buscar = () =>
      GETImpressao(
        new NextRequest("http://demo.frentfood.test/api/impressao?agente=sumido", {
          headers: { authorization: `Bearer ${token}` },
        })
      );
    const ids = async (r: Response) =>
      ((await r.json()) as { trabalhos: { id: string }[] }).trabalhos.map((t) => t.id);

    const levados = await ids(await buscar());
    const logoDepois = await ids(await buscar());

    // Três minutos sem confirmação: o agente que levou não voltou.
    await admin.filaImpressao.updateMany({
      where: { id: { in: levados } },
      data: { entregueEm: new Date(Date.now() - 3 * 60_000) },
    });
    const depoisDoPrazo = await ids(await buscar());

    expect({
      levouPapel: levados.length > 0,
      repetiuNaHora: logoDepois.filter((id) => levados.includes(id)),
      voltaramTodos: levados.every((id) => depoisDoPrazo.includes(id)),
    }).toEqual({ levouPapel: true, repetiuNaHora: [], voltaramTodos: true });
  });

  /**
   * A praça que não tem impressora própria.
   *
   * A fila passou a entregar ao agente de bobina embutida — a maquininha no
   * bolso do garçom — só os trabalhos **sem impressora endereçada**, para que a
   * comanda da cozinha não saísse no bolso dele deixando a praça sem o papel.
   * A conta foi feita pelo endereço, e o endereço vem da estação: numa casa que
   * comprou a térmica do bar e deixou a cozinha no agente do balcão, a comanda
   * da cozinha **não tem** impressora endereçada — e volta a caber no bolso do
   * garçom, que é exatamente o que a regra veio impedir. Com a reserva, quem
   * leva é um só: o balcão não vê mais aquele papel, e a cozinha espera um
   * prato que ninguém mandou fazer.
   *
   * O que o aparelho de bobina leva é o papel da mão — conferência e cupom. A
   * casa sem impressora nenhuma é o caso de contraste: ali ele é o único
   * destino possível, e continua levando tudo.
   */
  it("a comanda da praça sem impressora própria não sai no bolso do garçom", async () => {
    // No vizinho, cuja fila ninguém encheu: os vinte do lote são os daqui.
    const token = await ligarAparelho(B, "bobina-embutida");
    const impressora = await admin.impressora.create({
      data: {
        tenantId: B.tenant.id,
        unidadeId: B.unidade.id,
        nome: "Térmica do bar",
        conexao: "rede",
      },
    });
    const papel = (tipo: "COMANDA_PRODUCAO" | "CONFERENCIA", titulo: string, impressoraId: string | null) =>
      admin.filaImpressao.create({
        data: {
          tenantId: B.tenant.id,
          unidadeId: B.unidade.id,
          impressoraId,
          tipo,
          titulo,
          conteudo: titulo,
        },
      });
    const doBar = await papel("COMANDA_PRODUCAO", "BAR · pedido #1", impressora.id);
    const daCozinha = await papel("COMANDA_PRODUCAO", "COZINHA · pedido #1", null);
    const daMao = await papel("CONFERENCIA", "Conferência da mesa 1", null);

    const resposta = await GETImpressao(
      new NextRequest(
        "http://demo.frentfood.test/api/impressao?embutida=1&colunas=32&agente=maquininha",
        { headers: { authorization: `Bearer ${token}` } }
      )
    );
    const levados = ((await resposta.json()) as { trabalhos: { id: string }[] }).trabalhos.map(
      (t) => t.id
    );

    expect({
      conferencia: levados.includes(daMao.id),
      comandaDoBar: levados.includes(doBar.id),
      comandaDaCozinha: levados.includes(daCozinha.id),
    }).toEqual({ conferencia: true, comandaDoBar: false, comandaDaCozinha: false });
  });

  /**
   * A casa que só tem a maquininha — o contraste do caso acima.
   *
   * Sem impressora cadastrada, nenhum trabalho tem destino e a bobina do bolso
   * é o único papel que existe na casa. Recusar a comanda da cozinha ali seria
   * trocar "o papel saiu no lugar errado" por "o papel não saiu".
   */
  it("na casa sem impressora nenhuma, a bobina do bolso continua levando tudo", async () => {
    const token = await ligarAparelho(B, "bobina-sozinha");
    await admin.impressora.deleteMany({ where: { unidadeId: B.unidade.id } });
    const daCozinha = await admin.filaImpressao.create({
      data: {
        tenantId: B.tenant.id,
        unidadeId: B.unidade.id,
        tipo: "COMANDA_PRODUCAO",
        titulo: "COZINHA · pedido #2",
        conteudo: "COZINHA · pedido #2",
      },
    });

    const resposta = await GETImpressao(
      new NextRequest(
        "http://demo.frentfood.test/api/impressao?embutida=1&colunas=32&agente=maquininha-sozinha",
        { headers: { authorization: `Bearer ${token}` } }
      )
    );
    const levados = ((await resposta.json()) as { trabalhos: { id: string }[] }).trabalhos.map(
      (t) => t.id
    );

    expect(levados.includes(daCozinha.id)).toBe(true);
  });

  /**
   * Tirado da unidade no meio do turno.
   *
   * O terceiro jeito de perder o vínculo, depois do desligamento e do
   * rebaixamento: a pessoa continua ativa e no mesmo restaurante, mas deixou de
   * trabalhar nesta casa — transferida para a filial, ou tirada da escala. É o
   * caso que `vinculoAtual` resolve pela ausência do vínculo, e não pelo
   * `ativo` nem pelo cargo, e nenhum teste o prendia.
   */
  it("o caixa tirado da unidade no meio do turno para de receber pelo aparelho", async () => {
    const aparelho = await ligarAparelho(A, "tirado-da-unidade");
    const caixa = A.caixas[0]!;
    const operador = (await tokenDoOperador(aparelho, caixa.pin)).corpo.token!;
    const { comandaId } = await contaNaMesaNova(A.garcons[0]!, 2);
    const { falta } = await quantoDeve(comandaId);

    const vinculo = await admin.usuarioUnidade.findFirstOrThrow({
      where: { usuarioId: caixa.usuarioId, unidadeId: A.unidade.id },
    });
    await admin.usuarioUnidade.delete({ where: { id: vinculo.id } });
    try {
      const resposta = await POSTPagamentos(
        chamada("/api/maquininha/pagamentos", {
          aparelho,
          operador,
          corpo: {
            comandaId,
            referencia: "turno-de-quem-mudou-de-casa",
            forma: "CREDITO",
            valorEmCentavos: Math.round(falta * 100),
          },
        })
      );
      expect({
        status: resposta.status,
        pagamentos: await admin.pagamento.count({ where: { comandaId } }),
        conta: (await admin.comanda.findUniqueOrThrow({ where: { id: comandaId } })).status,
      }).toEqual({ status: 401, pagamentos: 0, conta: "ABERTA" });
    } finally {
      await admin.usuarioUnidade.create({
        data: {
          id: vinculo.id,
          usuarioId: vinculo.usuarioId,
          unidadeId: vinculo.unidadeId,
          cargoId: vinculo.cargoId,
        },
      });
    }
  });

  /**
   * Cancelar item pelo aparelho: o garçom pede o PIN de quem pode.
   *
   * O cargo GARCOM não tem `comanda.cancelarItem`, e é ele quem está na mesa.
   * A liberação fica presa àquele item: a mesma não pode servir para tirar um
   * segundo prato da conta.
   */
  it("cancelar pelo aparelho precisa do PIN, e a liberação não serve duas vezes", async () => {
    const aparelho = await ligarAparelho(A, "cancelar-no-aparelho");
    const garcom = A.garcons[0]!;
    const operador = (await tokenDoOperador(aparelho, garcom.pin)).corpo.token!;
    const { comandaId } = await contaNaMesaNova(garcom, 2);
    const itens = await admin.comandaItem.findMany({
      where: { comandaId },
      orderBy: { lancadoEm: "asc" },
    });
    const alvo = itens[0]!;
    const outro = itens[1]!;

    const cancelar = (itemId: string, corpo: unknown) =>
      POSTCancelarNoAparelho(
        chamada(`/api/maquininha/itens/${itemId}/cancelar`, { aparelho, operador, corpo }),
        comId(itemId)
      );

    const semPin = await cancelar(alvo.id, { motivo: "cliente desistiu" });
    const semPinCorpo = (await semPin.json()) as { precisaAutorizacao?: string };

    const pediu = await POSTAutorizacoesNoAparelho(
      chamada("/api/maquininha/autorizacoes", {
        aparelho,
        operador,
        corpo: {
          tipo: "CANCELAMENTO_ITEM",
          referenciaId: alvo.id,
          pin: A.gerentes[0]!.pin,
          motivo: "prato recusado",
        },
      })
    );
    const { autorizacaoId } = (await pediu.json()) as { autorizacaoId?: string };

    const comPin = await cancelar(alvo.id, { motivo: "cliente desistiu", autorizacaoId });
    const reuso = await cancelar(outro.id, { motivo: "e esse também", autorizacaoId });

    const depoisAlvo = await admin.comandaItem.findUniqueOrThrow({ where: { id: alvo.id } });
    const depoisOutro = await admin.comandaItem.findUniqueOrThrow({ where: { id: outro.id } });

    expect({
      semPin: semPin.status,
      pediuPin: semPinCorpo.precisaAutorizacao,
      autorizou: pediu.status,
      cancelou: comPin.status,
      alvo: depoisAlvo.status,
      reuso: reuso.status,
      outroSegueNaConta: depoisOutro.status !== "CANCELADO",
    }).toEqual({
      semPin: 403,
      pediuPin: "CANCELAMENTO_ITEM",
      autorizou: 200,
      cancelou: 200,
      alvo: "CANCELADO",
      reuso: 403,
      outroSegueNaConta: true,
    });
  });

  /** Dois garçons chegando juntos na mesma mesa, cada um com o seu aparelho. */
  it("duas aberturas da mesma mesa pelo aparelho deixam uma conta só", async () => {
    const aparelho = await ligarAparelho(A, "abrir-junto");
    const um = (await tokenDoOperador(aparelho, A.garcons[0]!.pin)).corpo.token!;
    const dois = (await tokenDoOperador(aparelho, A.garcons[1]!.pin)).corpo.token!;
    const mesa = await mesaNova();
    const corpo = { mesaId: mesa.id, pessoas: 2 };

    const [a, b] = await Promise.all([
      POSTAbrirMesa(chamada("/api/maquininha/mesas", { aparelho, operador: um, corpo })),
      POSTAbrirMesa(chamada("/api/maquininha/mesas", { aparelho, operador: dois, corpo })),
    ]);

    expect({
      status: [a.status, b.status],
      abertas: await admin.comanda.count({
        where: { mesaId: mesa.id, status: { in: ["ABERTA", "FECHANDO"] } },
      }),
    }).toEqual({ status: [200, 200], abertas: 1 });
  });

  /** Transferir para uma mesa que já tem conta não junta as duas. */
  it("o aparelho não empilha duas contas na mesma mesa", async () => {
    const aparelho = await ligarAparelho(A, "transferir-no-aparelho");
    const garcom = A.garcons[0]!;
    const operador = (await tokenDoOperador(aparelho, garcom.pin)).corpo.token!;
    const origem = await contaNaMesaNova(garcom, 1);
    const ocupada = await contaNaMesaNova(garcom, 1);

    const resposta = await POSTTransferirNoAparelho(
      chamada(`/api/maquininha/comandas/${origem.comandaId}/transferir`, {
        aparelho,
        operador,
        corpo: { mesaDestinoId: ocupada.mesa.id },
      }),
      comId(origem.comandaId)
    );

    expect({
      status: resposta.status,
      noDestino: await admin.comanda.count({
        where: { mesaId: ocupada.mesa.id, status: { in: ["ABERTA", "FECHANDO"] } },
      }),
      origemFicou: (
        await admin.comanda.findUniqueOrThrow({ where: { id: origem.comandaId } })
      ).mesaId === origem.mesa.id,
    }).toEqual({ status: 409, noDestino: 1, origemFicou: true });
  });

  /** Conta paga não volta a aberta pelo aparelho. */
  it("conta paga não reabre pelo aparelho", async () => {
    const aparelho = await ligarAparelho(A, "reabrir-no-aparelho");
    const operador = (await tokenDoOperador(aparelho, A.caixas[0]!.pin)).corpo.token!;
    const { comandaId } = await contaNaMesaNova(A.garcons[0]!, 1);
    await pagarTudo(A.caixas[0]!, comandaId);

    const resposta = await POSTReabrirNoAparelho(
      chamada(`/api/maquininha/comandas/${comandaId}/reabrir`, { aparelho, operador, corpo: {} }),
      comId(comandaId)
    );

    expect({
      status: resposta.status,
      conta: (await admin.comanda.findUniqueOrThrow({ where: { id: comandaId } })).status,
    }).toEqual({ status: 409, conta: "PAGA" });
  });

  /** A rodada presa na rede, reenviada, não vai duas vezes para a chapa. */
  it("a rodada reenviada pelo aparelho não lança o item duas vezes", async () => {
    const aparelho = await ligarAparelho(A, "rodada-reenviada");
    const garcom = A.garcons[0]!;
    const operador = (await tokenDoOperador(aparelho, garcom.pin)).corpo.token!;
    const mesa = await mesaNova();
    const abriu = await POSTAbrirMesa(
      chamada("/api/maquininha/mesas", {
        aparelho,
        operador,
        corpo: { mesaId: mesa.id, pessoas: 2 },
      })
    );
    const { comandaId } = (await abriu.json()) as { comandaId: string };
    const item = A.itens.find((i) => !i.exigePontoCarne)!;
    const corpo = {
      itens: [
        { cardapioItemId: item.cardapioItemId, referencia: "rodada-presa-na-rede", quantidade: 2 },
      ],
    };

    const caminho = `/api/maquininha/comandas/${comandaId}/itens`;
    const uma = await POSTItensNoAparelho(
      chamada(caminho, { aparelho, operador, corpo }),
      comId(comandaId)
    );
    const outra = await POSTItensNoAparelho(
      chamada(caminho, { aparelho, operador, corpo }),
      comId(comandaId)
    );
    const soma = await admin.comandaItem.aggregate({
      where: { comandaId },
      _sum: { quantidade: true },
      _count: true,
    });

    expect({
      uma: uma.status,
      outra: outra.status,
      lancados: ((await outra.json()) as { lancados: number }).lancados,
      linhas: soma._count,
      quantidade: Number(soma._sum.quantidade),
    }).toEqual({ uma: 200, outra: 200, lancados: 0, linhas: 1, quantidade: 2 });
  });

  /**
   * O cardápio do vizinho pelo aparelho.
   *
   * Chave estrangeira ignora o RLS: um `cardapioItemId` do outro restaurante é
   * aceito pelo banco e precisa ser recusado no código.
   */
  it("o aparelho não lança item do cardápio do vizinho", async () => {
    const aparelho = await ligarAparelho(A, "cardapio-do-vizinho");
    const garcom = A.garcons[0]!;
    const operador = (await tokenDoOperador(aparelho, garcom.pin)).corpo.token!;
    const mesa = await mesaNova();
    const abriu = await POSTAbrirMesa(
      chamada("/api/maquininha/mesas", {
        aparelho,
        operador,
        corpo: { mesaId: mesa.id, pessoas: 2 },
      })
    );
    const { comandaId } = (await abriu.json()) as { comandaId: string };

    const resposta = await POSTItensNoAparelho(
      chamada(`/api/maquininha/comandas/${comandaId}/itens`, {
        aparelho,
        operador,
        corpo: {
          itens: [{ cardapioItemId: B.itens[0]!.cardapioItemId, referencia: "do-vizinho" }],
        },
      }),
      comId(comandaId)
    );

    expect({
      status: resposta.status,
      itens: await admin.comandaItem.count({ where: { comandaId } }),
    }).toEqual({ status: 409, itens: 0 });
  });

  /**
   * A credencial do aparelho na tela de quem não mexe em aparelho.
   *
   * O token é a credencial inteira: com ele se puxa a fila de impressão da casa
   * — toda comanda e toda conta — e se dá baixa nela sem papel sair. Cadastrar,
   * cortar e trocar token exigem `unidade.configurar`, que o gerente não tem;
   * e o diário de propósito não guarda o token, "porque ele é credencial". Ler
   * é a mesma pergunta, e a tela precisa responder igual.
   */
  /**
   * A credencial da unidade abre as mesmas portas que a do aparelho: a fila de
   * impressão da casa e o turno da maquininha. Ela tinha régua mais frouxa só
   * porque mora numa tela mais antiga.
   */
  it("a credencial da unidade não vai para a tela de impressão de ninguém", async () => {
    const token = `unidade-na-tela-${A.unidade.id}`;
    const antes = await admin.unidade.findUniqueOrThrow({
      where: { id: A.unidade.id },
      select: { tokenImpressao: true },
    });
    await admin.unidade.update({
      where: { id: A.unidade.id },
      data: { tokenImpressao: token },
    });

    try {
      const naTela = async (quem: Membro) =>
        JSON.stringify(await como(quem, () => ImpressaoPage())).includes(token);

      /*
       * Nem para o proprietário: a tela nunca mostrou o valor — ela diz
       * "Token configurado" e só exibe o que acabou de ser gerado. O que
       * descia no payload era credencial viajando sem ninguém pedir.
       */
      expect({
        gerente: await naTela(A.gerentes[0]!),
        proprietario: await naTela(A.proprietario),
      }).toEqual({ gerente: false, proprietario: false });
    } finally {
      await admin.unidade.update({
        where: { id: A.unidade.id },
        data: { tokenImpressao: antes.tokenImpressao },
      });
    }
  });

  it("o gerente não gera credencial nova da unidade", async () => {
    const antes = await admin.unidade.findUniqueOrThrow({
      where: { id: A.unidade.id },
      select: { tokenImpressao: true },
    });

    // Gerar de novo derruba todos os aparelhos da casa de uma vez, o agente do
    // balcão inclusive — é a mesma régua de cortar um aparelho.
    const t = await tentar(A.gerentes[0]!, () => gerarTokenImpressao());

    const depois = await admin.unidade.findUniqueOrThrow({
      where: { id: A.unidade.id },
      select: { tokenImpressao: true },
    });
    expect({ recusou: recusou(t), mudou: depois.tokenImpressao !== antes.tokenImpressao }).toEqual({
      recusou: true,
      mudou: false,
    });
  });

  it("o token do aparelho não vai para a tela de quem não configura aparelho", async () => {
    const token = `aparelho-na-tela-${A.unidade.id}`;
    await admin.aparelho.create({
      data: {
        tenantId: A.tenant.id,
        unidadeId: A.unidade.id,
        nome: "Maquininha do balcão",
        token,
      },
    });

    const naTela = async (quem: Membro) =>
      JSON.stringify(await como(quem, () => AparelhosPage())).includes(token);

    expect({
      gerente: await naTela(A.gerentes[0]!),
      proprietario: await naTela(A.proprietario),
    }).toEqual({ gerente: false, proprietario: true });
  });

  /**
   * A venda de balcão, pelo avesso.
   *
   * O caminho feliz já está preso em `tests/balcao.test.ts`. O que se ataca
   * aqui é o que a venda deixa para trás quando **não** dá certo: a comanda
   * nasce antes do pagamento, de propósito, e comanda de balcão não tem mesa.
   * O mapa do salão só monta as comandas que têm mesa
   * (`src/app/pdv/page.tsx`), então uma comanda de balcão aberta não aparece
   * em tela nenhuma — e `fecharCaixa` recusa enquanto houver comanda aberta
   * na unidade. Uma venda recusada vira, assim, uma noite que não fecha, por
   * causa de uma comanda que ninguém consegue ver nem fechar.
   */
  /**
   * O caixa do vizinho, aberto, sem herdar nem deixar herança.
   *
   * Os testes de baixo abrem e fecham o caixa de B contando os valores que
   * eles mesmos puseram; um caixa meu esquecido aberto os faria medir a
   * gaveta errada. Por isso o que eu abrir, eu apago em `varrerOBalcao`.
   */
  const meusCaixas: string[] = [];
  async function caixaAbertoDoVizinho() {
    const existe = await admin.caixa.findFirst({
      where: { unidadeId: B.unidade.id, tipo: "GERAL", status: "ABERTO" },
    });
    if (existe) return existe;
    const meu = await admin.caixa.create({
      data: {
        tenantId: B.tenant.id,
        unidadeId: B.unidade.id,
        data: new Date(),
        tipo: "GERAL",
        turno: "NOITE",
        status: "ABERTO",
        fundoCaixa: 200,
        abertoPorId: B.caixas[0]!.usuarioId,
      },
    });
    meusCaixas.push(meu.id);
    return meu;
  }

  /** Comandas abertas sem mesa: as que nenhuma tela mostra. */
  const invisiveisDoVizinho = () =>
    admin.comanda.count({
      where: { unidadeId: B.unidade.id, mesaId: null, status: { in: ["ABERTA", "FECHANDO"] } },
    });

  /** O ataque não pode deixar sujeira para o vizinho de baixo. */
  async function varrerOBalcao() {
    await admin.comanda.deleteMany({ where: { unidadeId: B.unidade.id, origem: "BALCAO" } });
    if (meusCaixas.length > 0) {
      await admin.caixa.deleteMany({ where: { id: { in: meusCaixas.splice(0) } } });
    }
  }

  /**
   * A casa que nunca cadastrou "vale-refeição" e recebe um no aparelho.
   *
   * A rota abre a comanda de balcão **antes** de procurar a forma, então a
   * recusa por falta de forma deixa a comanda para trás. Ela não tem mesa,
   * não aparece no mapa, e tranca o fechamento do caixa com uma mensagem que
   * manda fechar uma comanda que não está em lugar nenhum. E a fila do
   * aparelho não desiste de uma recusa: a mesma venda volta a cada escoamento
   * e para a fila inteira atrás dela.
   */
  it("venda de balcão sem forma cadastrada não deixa comanda trancando o caixa", async () => {
    const aparelho = await ligarAparelho(B, "balcao-sem-forma");
    const operador = (await tokenDoOperador(aparelho, B.caixas[0]!.pin)).corpo.token!;
    const caixa = await caixaAbertoDoVizinho();

    const r = await POSTPagamentos(
      chamada("/api/maquininha/pagamentos", {
        aparelho,
        operador,
        corpo: { referencia: "vale-refeicao-1", forma: "VOUCHER", valorEmCentavos: 4_500 },
      })
    );

    const invisiveis = await invisiveisDoVizinho();
    const fechou = await tentar(B.caixas[0]!, () => fecharCaixa(caixa.id, 200));
    await varrerOBalcao();

    expect({
      recusou: r.status === 409,
      comandasInvisiveis: invisiveis,
      aNoiteFecha: !recusou(fechou),
    }).toEqual({ recusou: true, comandasInvisiveis: 0, aNoiteFecha: true });
  });

  /**
   * Valor fora do que a coluna guarda.
   *
   * `valorEmCentavos` só precisa ser inteiro e positivo para passar pela
   * porta. Na conta de mesa isso morre numa recusa limpa — "falta receber só
   * R$ 12,30" —, porque ninguém paga mais do que a conta. A venda de balcão
   * **é** o valor que ela recebe: `Decimal(10,2)` estoura, o Prisma lança, e
   * o que chega ao aparelho é erro de sistema, que a fila trata como rede
   * ruim e reenvia para sempre.
   */
  it("venda de balcão com valor fora da conta é recusa legível, não erro de sistema", async () => {
    const aparelho = await ligarAparelho(B, "balcao-valor");
    const operador = (await tokenDoOperador(aparelho, B.caixas[0]!.pin)).corpo.token!;
    await caixaAbertoDoVizinho();

    const t = await tentar(B.caixas[0]!, async () =>
      POSTPagamentos(
        chamada("/api/maquininha/pagamentos", {
          aparelho,
          operador,
          // R$ 10 bilhões: a coluna guarda até R$ 99.999.999,99.
          corpo: { referencia: "valor-absurdo-1", forma: "CREDITO", valorEmCentavos: 1_000_000_000_000 },
        })
      )
    );
    const status = t.resposta ? (t.resposta as Response).status : 0;
    await varrerOBalcao();

    expect({ lancou: t.lancou, status }).toEqual({ lancou: null, status: 400 });
  });

  /**
   * Referência comprida demais.
   *
   * A referência do aparelho entra num índice único, e o btree do Postgres
   * recusa chave acima de 2704 bytes com `54000`. Nada confere o tamanho em
   * lugar nenhum do caminho: nem no pagamento da mesa, nem na venda de
   * balcão, nem no lançamento da rodada. O que chega ao aparelho é erro de
   * sistema — e a fila, que trata recusa como rede ruim, reenvia a noite
   * inteira a mesma venda que nunca vai entrar.
   */
  it("referência comprida demais é recusa legível, e não derruba a rota", async () => {
    const aparelho = await ligarAparelho(A, "referencia-comprida");
    const operador = (await tokenDoOperador(aparelho, A.caixas[0]!.pin)).corpo.token!;
    const comprida = "R".repeat(3000);

    const { comandaId } = await contaNaMesaNova(A.garcons[0]!, 1);
    const naMesa = await tentar(A.caixas[0]!, async () =>
      POSTPagamentos(
        chamada("/api/maquininha/pagamentos", {
          aparelho,
          operador,
          corpo: { comandaId, referencia: comprida, forma: "DEBITO", valorEmCentavos: 100 },
        })
      )
    );

    const noBalcao = await tentar(A.caixas[0]!, async () =>
      POSTPagamentos(
        chamada("/api/maquininha/pagamentos", {
          aparelho,
          operador,
          corpo: { referencia: comprida + "-balcao", forma: "DEBITO", valorEmCentavos: 100 },
        })
      )
    );

    const doGarcom = (await tokenDoOperador(aparelho, A.garcons[0]!.pin)).corpo.token!;
    const item = A.itens.find((i) => !i.exigePontoCarne)!;
    const naRodada = await tentar(A.garcons[0]!, async () =>
      POSTItensNoAparelho(
        chamada(`/api/maquininha/comandas/${comandaId}/itens`, {
          aparelho,
          operador: doGarcom,
          corpo: {
            itens: [
              {
                cardapioItemId: item.cardapioItemId,
                quantidade: 1,
                referencia: comprida + "-item",
              },
            ],
          },
        }),
        comId(comandaId)
      )
    );

    const estado = (t: { resposta: unknown; lancou: string | null }) =>
      t.lancou !== null ? `estourou: ${t.lancou.slice(0, 60)}` : (t.resposta as Response).status;

    expect({
      naMesa: estado(naMesa),
      noBalcao: estado(noBalcao),
      naRodada: estado(naRodada),
    }).toEqual({ naMesa: 400, noBalcao: 400, naRodada: 400 });
  });

  /**
   * O aparelho pedindo para não finalizar uma venda de balcão.
   *
   * A regra escrita na própria rota é que a venda de balcão fecha sempre, sem
   * pedir `comanda.fechar`: ela nasce terminada e deixá-la aberta poria no
   * mapa do salão uma comanda sem mesa, tudo pago, esperando alguém entender
   * o que é aquilo. O `finalizar` do corpo, porém, vale para as duas — e com
   * ele a venda fica paga e aberta, que é exatamente o estado que a regra
   * proíbe, com a agravante de trancar o fechamento do caixa.
   */
  it("o aparelho não deixa a venda de balcão paga e aberta pedindo para não finalizar", async () => {
    const aparelho = await ligarAparelho(B, "balcao-sem-finalizar");
    const operador = (await tokenDoOperador(aparelho, B.caixas[0]!.pin)).corpo.token!;
    await caixaAbertoDoVizinho();

    const r = await POSTPagamentos(
      chamada("/api/maquininha/pagamentos", {
        aparelho,
        operador,
        corpo: {
          referencia: "balcao-sem-finalizar-1",
          forma: "CREDITO",
          valorEmCentavos: 1_200,
          finalizar: false,
        },
      })
    );
    const corpo = (await r.json()) as { quitada?: boolean };
    const comanda = await admin.comanda.findFirstOrThrow({
      where: { unidadeId: B.unidade.id, origem: "BALCAO" },
    });
    const invisiveis = await invisiveisDoVizinho();
    await varrerOBalcao();

    expect({
      recebeu: r.status === 200 && corpo.quitada === true,
      status: comanda.status,
      comandasInvisiveis: invisiveis,
    }).toEqual({ recebeu: true, status: "PAGA", comandasInvisiveis: 0 });
  });

  /**
   * Dois reenvios da mesma venda de balcão, no mesmo instante: o aplicativo
   * reaberto enquanto o escoamento já corria. Duas comandas de balcão com o
   * mesmo dinheiro dobrariam o faturamento do dia.
   */
  it("dois reenvios simultâneos da mesma venda de balcão não viram duas vendas", async () => {
    const aparelho = await ligarAparelho(B, "balcao-reenvio");
    const operador = (await tokenDoOperador(aparelho, B.caixas[0]!.pin)).corpo.token!;
    await caixaAbertoDoVizinho();

    const venda = {
      referencia: "reenvio-simultaneo-1",
      forma: "CREDITO",
      valorEmCentavos: 2_500,
    };
    const [um, dois] = await Promise.all([
      POSTPagamentos(chamada("/api/maquininha/pagamentos", { aparelho, operador, corpo: venda })),
      POSTPagamentos(chamada("/api/maquininha/pagamentos", { aparelho, operador, corpo: venda })),
    ]);

    const comandas = await admin.comanda.count({
      where: { unidadeId: B.unidade.id, origem: "BALCAO" },
    });
    const pagamentos = await admin.pagamento.count({
      where: { tenantId: B.tenant.id, referenciaExterna: venda.referencia },
    });
    await varrerOBalcao();

    expect({ um: um.status, dois: dois.status, comandas, pagamentos }).toEqual({
      um: 200,
      dois: 200,
      comandas: 1,
      pagamentos: 1,
    });
  });

});

/**
 * Os números que a tela mostra.
 *
 * Um número errado numa tela de diagnóstico é pior que número nenhum: ele
 * responde a pergunta e encerra a investigação.
 */
describe("números na tela", () => {
  it("a fila de impressão mostra tudo o que espera, e não só a primeira página", async () => {
    // Um sábado com a impressora fora do ar: muito mais papel do que a lista
    // da tela carrega de uma vez.
    const impressora = await admin.impressora.create({
      data: {
        tenantId: A.tenant.id,
        unidadeId: A.unidade.id,
        nome: "Térmica do balcão",
        conexao: "REDE",
        endereco: "10.0.0.9",
      },
    });
    await admin.filaImpressao.createMany({
      data: Array.from({ length: 120 }, (_, i) => ({
        tenantId: A.tenant.id,
        unidadeId: A.unidade.id,
        impressoraId: impressora.id,
        tipo: "COMANDA_PRODUCAO" as const,
        titulo: `Papel parado ${i + 1}`,
        conteudo: "papel que não saiu",
      })),
    });

    const esperando = await admin.filaImpressao.count({
      where: { unidadeId: A.unidade.id, status: "PENDENTE" },
    });
    const tela = JSON.stringify(await como(A.proprietario, () => ImpressaoPage()));

    expect({
      haviaMuitoPapel: esperando > 50,
      mostraOTotal: tela.includes(`"naFila":${esperando}`),
    }).toEqual({ haviaMuitoPapel: true, mostraOTotal: true });
  });
});

/**
 * O que a tela mostra quando a ação recusa.
 *
 * Sessão vencida e cargo sem permissão são coisas que o operador precisa ler —
 * e, como exceção, a mensagem não atravessa a server action em produção (vira
 * um código minificado do React) e em desenvolvimento aparecia o texto cru.
 * Elas voltam como valor, com a frase pronta.
 */
describe("recusa com mensagem, não com exceção", () => {
  it("sem sessão, a ação devolve 'faça login' em vez de estourar", async () => {
    const semLogin = pessoa("ninguém", "0000", "10.2.0.99", "demo.frentfood.test");
    const comandaId = await comandaPronta(A.garcons[0]!, 47, 1);

    const t = await tentar(semLogin as unknown as Membro, () =>
      registrarPagamento(comandaId, A.formas.pix.id, 10, 0)
    );
    expect({ lancou: t.lancou, erro: temErro(t.resposta) ? t.resposta.erro : null }).toEqual({
      lancou: null,
      erro: "Sessão expirada. Faça login novamente.",
    });
  });

  it("cargo sem permissão devolve o motivo, dizendo qual cargo é", async () => {
    const t = await tentar(A.garcons[0]!, () => fecharCaixa("caixa-inventado", 0));
    expect(temErro(t.resposta) && t.resposta.erro).toMatch(/GARCOM.*permissão.*caixa\.fechar/);
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

/**
 * A conferência que vai para a mesa, pelo caminho de verdade: o botão busca os
 * pagamentos no banco e o papel vai para a fila. Os testes de `impressao.ts`
 * conferem a montagem; este confere que os dados chegam nela.
 */
describe("conferência impressa com pagamento parcial", () => {
  it("mostra quem já pagou, pelo valor líquido, e quanto falta", async () => {
    const comandaId = await comandaPronta(A.garcons[0]!, 51);
    const caixa = A.caixas[0]!;
    await como(caixa, () => iniciarFechamento(comandaId));
    const { total } = await quantoDeve(comandaId);

    // Metade em dinheiro, com nota maior e troco: o papel deve mostrar a
    // metade, não a nota que o cliente entregou.
    const metade = Math.round((total / 2) * 100) / 100;
    const entregue = Math.ceil(metade / 10) * 10 + 10;
    const troco = Math.round((entregue - metade) * 100) / 100;
    await como(caixa, () => registrarPagamento(comandaId, A.formas.dinheiro.id, entregue, troco));

    await como(A.garcons[0]!, () => imprimirConferencia(comandaId));
    const fila = await admin.filaImpressao.findFirstOrThrow({
      where: { referenciaId: comandaId, tipo: "CONFERENCIA" },
      orderBy: { criadoEm: "desc" },
    });
    const papel = paraTela(fila.conteudo);
    const reais = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const linha = (trecho: string) => papel.split("\n").find((l) => l.includes(trecho)) ?? "";

    expect(papel).toContain("JA PAGO");
    expect(linha("Dinheiro")).toContain(reais(metade));
    expect(linha("Dinheiro")).not.toContain(reais(entregue));
    expect(linha("FALTA PAGAR")).toContain(`R$ ${reais(total - metade)}`);

    // E o agente recebe a letra dupla em ESC/POS, não os marcadores da fila.
    // A rota entrega os 20 pendentes mais antigos, e os outros testes já
    // encheram a fila: o resto sai da frente para a conferência ser entregue.
    await admin.filaImpressao.updateMany({
      where: { unidadeId: A.unidade.id, status: "PENDENTE", NOT: { id: fila.id } },
      data: { status: "IMPRESSO" },
    });
    const token = `agente-conferencia-${A.unidade.id}`;
    await admin.unidade.update({ where: { id: A.unidade.id }, data: { tokenImpressao: token } });
    const resposta = await GETImpressao(
      new NextRequest("http://demo.frentfood.test/api/impressao", {
        headers: { authorization: `Bearer ${token}` },
      })
    );
    const { trabalhos } = (await resposta.json()) as { trabalhos: { id: string; conteudo: string }[] };
    const entregue_ = trabalhos.find((t) => t.id === fila.id);
    expect(entregue_, "a conferência na fila do agente").toBeTruthy();
    expect(entregue_!.conteudo).toContain("\x1d\x21\x11");
    expect(entregue_!.conteudo).toContain("\x1d\x21\x00");
    expect(entregue_!.conteudo).not.toMatch(/[\x0e\x0f]/);
  });
});

/**
 * Segunda rodada de 21/09: o que as correções da primeira ainda deixavam
 * passar quando duas pessoas tocam ao mesmo tempo, e o que o navegador pode
 * mandar que a tela nunca manda.
 */
describe("exploração de 21/09, segunda rodada", () => {
  const bebida = () => A.itens.find((i) => i.controlaEstoque && !i.exigePontoCarne)!;

  /** A conta pela regra do sistema, e o que entrou líquido de troco. */
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

  /** Uma mesa com uma bebida (que tem estoque) já enviada. Devolve a comanda e o item. */
  async function mesaComBebida(g: Membro, mesaIndice: number) {
    const aberta = (await como(g, () => abrirComanda(A.mesas[mesaIndice]!.id, 2))) as { comandaId: string };
    const b = bebida();
    await como(g, () =>
      adicionarAoCarrinho({
        comandaId: aberta.comandaId,
        produtoId: b.produtoId,
        cardapioItemId: b.cardapioItemId,
        precoUnitario: b.preco,
        exigePontoCarne: false,
      })
    );
    await como(g, () => enviarCarrinho(aberta.comandaId));
    const item = await admin.comandaItem.findFirstOrThrow({ where: { comandaId: aberta.comandaId } });
    return { comandaId: aberta.comandaId, item, produtoId: b.produtoId };
  }

  const saldo = async (produtoId: string) =>
    Number(
      (
        await admin.estoqueSaldo.findUniqueOrThrow({
          where: { unidadeId_produtoId: { unidadeId: A.unidade.id, produtoId } },
        })
      ).quantidade
    );

  it("dois toques em 'cancelar item' não devolvem o estoque duas vezes", async () => {
    const { item, produtoId } = await mesaComBebida(A.garcons[0]!, 18);
    const antes = await saldo(produtoId);
    const gerente = A.gerentes[0]!;
    await Promise.all([
      tentar(gerente, () => cancelarItem(item.id, "cliente desistiu")),
      tentar(gerente, () => cancelarItem(item.id, "cliente desistiu")),
    ]);
    const devolucoes = await admin.movimentoEstoque.count({
      where: { referenciaId: item.id, tipo: "DEVOLUCAO" },
    });
    const diario = await admin.auditLog.count({ where: { entidadeId: item.id, acao: "ITEM_CANCELADO" } });
    expect({ saldo: await saldo(produtoId), devolucoes, diario }).toEqual({
      saldo: antes + Number(item.quantidade),
      devolucoes: 1,
      diario: 1,
    });
  });

  /**
   * O estorno foi proibido em conta paga — mas a conferência era feita antes,
   * fora de qualquer trava. Com o caixa corrigindo a forma de pagamento no
   * mesmo instante em que outro toca em "finalizar", a conta podia sair PAGA
   * sem o pagamento: exatamente o que a proibição queria impedir.
   */
  it("estorno e finalização ao mesmo tempo não deixam conta paga devendo", async () => {
    const caixa = A.caixas[0]!;
    const erradas: string[] = [];
    for (const mesa of [19, 20, 21, 23, 24]) {
      const comandaId = await comandaPronta(A.garcons[1]!, mesa);
      await como(caixa, () => iniciarFechamento(comandaId));
      const { falta } = await quantoDeve(comandaId);
      await como(caixa, () => registrarPagamento(comandaId, A.formas.pix.id, falta, 0));
      const pagamento = await admin.pagamento.findFirstOrThrow({ where: { comandaId } });
      await Promise.all([
        tentar(caixa, () => estornarPagamento(pagamento.id)),
        tentar(caixa, () => finalizarComanda(comandaId)),
      ]);
      const c = await admin.comanda.findUniqueOrThrow({ where: { id: comandaId } });
      const { total, pago } = await totalConsumido(comandaId);
      if (c.status === "PAGA" && Math.abs(total - pago) > 0.009) erradas.push(`mesa ${mesa}: total ${total}, recebido ${pago}`);
    }
    expect(erradas).toEqual([]);
  });

  it("dois toques em 'estornar' dão um estorno e uma mensagem, não erro de sistema", async () => {
    const caixa = A.caixas[0]!;
    const comandaId = await comandaPronta(A.garcons[1]!, 47);
    await como(caixa, () => iniciarFechamento(comandaId));
    const { falta } = await quantoDeve(comandaId);
    await como(caixa, () => registrarPagamento(comandaId, A.formas.pix.id, falta, 0));
    const pagamento = await admin.pagamento.findFirstOrThrow({ where: { comandaId } });
    const r = await Promise.all([
      tentar(caixa, () => estornarPagamento(pagamento.id)),
      tentar(caixa, () => estornarPagamento(pagamento.id)),
    ]);
    const diario = await admin.auditLog.count({ where: { entidadeId: pagamento.id, acao: "PAGAMENTO_ESTORNADO" } });
    expect({ lancaram: r.filter((t) => t.lancou !== null).map((t) => t.lancou!.slice(-120)), diario }).toEqual({
      lancaram: [],
      diario: 1,
    });
  });

  /**
   * Mesma corrida, com o cancelamento. Conta paga é conta que recebeu
   * exatamente o total — nem a menos, nem a mais: o item cancelado depois do
   * pagamento, e antes do "finalizar", deixava a conta paga com o dinheiro de
   * um item que ela não tem mais.
   */
  it("item cancelado no mesmo instante da finalização: conta paga recebeu exatamente o total", async () => {
    const caixa = A.caixas[0]!;
    const erradas: string[] = [];
    for (const mesa of [25, 26, 27, 28, 29]) {
      const { comandaId, item } = await mesaComBebida(A.garcons[2]!, mesa);
      await como(caixa, () => iniciarFechamento(comandaId));
      const { falta } = await quantoDeve(comandaId);
      await como(caixa, () => registrarPagamento(comandaId, A.formas.pix.id, falta, 0));
      await Promise.all([
        tentar(A.gerentes[0]!, () => cancelarItem(item.id, "engano")),
        tentar(caixa, () => finalizarComanda(comandaId)),
      ]);
      const c = await admin.comanda.findUniqueOrThrow({ where: { id: comandaId } });
      const { total, pago } = await totalConsumido(comandaId);
      if (c.status === "PAGA" && Math.abs(total - pago) > 0.009) erradas.push(`mesa ${mesa}: total ${total}, recebido ${pago}`);
    }
    expect(erradas).toEqual([]);
  });

  it("a quantidade do carrinho só anda de um em um: NaN e fração são recusados", async () => {
    const g = A.garcons[0]!;
    const aberta = (await como(g, () => abrirComanda(A.mesas[38]!.id, 2))) as { comandaId: string };
    const b = bebida();
    await como(g, () =>
      adicionarAoCarrinho({
        comandaId: aberta.comandaId,
        produtoId: b.produtoId,
        cardapioItemId: b.cardapioItemId,
        precoUnitario: b.preco,
        exigePontoCarne: false,
      })
    );
    const item = await admin.comandaItem.findFirstOrThrow({ where: { comandaId: aberta.comandaId } });
    const nan = await tentar(g, () => alterarQuantidade(item.id, Number.NaN));
    const fracao = await tentar(g, () => alterarQuantidade(item.id, -0.99));
    const depois = await admin.comandaItem.findUnique({ where: { id: item.id } });
    expect({
      nan: recusou(nan),
      fracao: recusou(fracao),
      quantidade: depois ? Number(depois.quantidade) : null,
      precoTotal: depois ? Number(depois.precoTotal) : null,
    }).toEqual({ nan: true, fracao: true, quantidade: 1, precoTotal: b.preco });
  });

  // Quem transfere é o garçom, que tem mesa.transferir desde a instalação padrão.
  it("duas mesas transferidas ao mesmo tempo para a mesma mesa livre não a dividem", async () => {
    const destino = A.mesas[41]!;
    const um = (await como(A.garcons[0]!, () => abrirComanda(A.mesas[39]!.id, 2))) as { comandaId: string };
    const dois = (await como(A.garcons[1]!, () => abrirComanda(A.mesas[40]!.id, 2))) as { comandaId: string };
    await Promise.all([
      tentar(A.garcons[0]!, () => transferirMesa(um.comandaId, destino.id)),
      tentar(A.garcons[1]!, () => transferirMesa(dois.comandaId, destino.id)),
    ]);
    const abertas = await admin.comanda.count({
      where: { mesaId: destino.id, status: { in: ["ABERTA", "FECHANDO"] } },
    });
    expect(abertas, "comandas abertas na mesa de destino").toBe(1);
  });

  it("transferir para uma mesa que outro garçom está abrindo não a divide", async () => {
    const destino = A.mesas[43]!;
    const um = (await como(A.garcons[0]!, () => abrirComanda(A.mesas[42]!.id, 2))) as { comandaId: string };
    await Promise.all([
      tentar(A.garcons[0]!, () => transferirMesa(um.comandaId, destino.id)),
      tentar(A.garcons[1]!, () => abrirComanda(destino.id, 3)),
    ]);
    const abertas = await admin.comanda.count({
      where: { mesaId: destino.id, status: { in: ["ABERTA", "FECHANDO"] } },
    });
    expect(abertas, "comandas abertas na mesa de destino").toBe(1);
  });

  it("estoque: quantidade inválida na entrada, na perda ou na contagem não estraga o saldo", async () => {
    const dono = A.proprietario;
    const b = A.itens.filter((i) => i.controlaEstoque)[1]!;
    const antes = await saldo(b.produtoId);
    const r = [
      await tentar(dono, () =>
        registrarEntrada({ produtoId: b.produtoId, quantidade: Number.NaN, custoTotal: 10, motivo: "nota" })
      ),
      await tentar(dono, () =>
        registrarEntrada({ produtoId: b.produtoId, quantidade: 10, custoTotal: Number.NaN, motivo: "nota" })
      ),
      await tentar(dono, () => registrarPerda({ produtoId: b.produtoId, quantidade: Number.NaN, motivo: "quebra" })),
      await tentar(dono, () =>
        registrarContagem({ produtoId: b.produtoId, quantidadeContada: Number.NaN, motivo: "contagem" })
      ),
      await tentar(dono, () =>
        registrarPerda({ produtoId: b.produtoId, quantidade: Number.POSITIVE_INFINITY, motivo: "quebra" })
      ),
    ];
    const s = await admin.estoqueSaldo.findUniqueOrThrow({
      where: { unidadeId_produtoId: { unidadeId: A.unidade.id, produtoId: b.produtoId } },
    });
    // Recusada com mensagem, e não com erro de sistema: quem digitou precisa
    // saber o que corrigir.
    expect({
      comMensagem: r.map((t) => t.lancou === null && temErro(t.resposta)),
      saldo: Number(s.quantidade),
      custo: Number.isFinite(Number(s.custoMedio)),
    }).toEqual({ comMensagem: [true, true, true, true, true], saldo: antes, custo: true });
  });

  /**
   * A divisão da taxa de serviço decide quanto cada área da equipe recebe.
   * Garçom não pode reescrevê-la chamando a action direto, e a soma que não
   * fecha 100 não entra nem pelo dono.
   */
  it("divisão da taxa: só quem configura salva, e só somando 100", async () => {
    const certa = [
      { nome: "Cozinha", pct: 40 },
      { nome: "Atendimento", pct: 60 },
    ];
    const garcom = await tentar(A.garcons[0]!, () => salvarDivisaoDaTaxa(certa));
    const torta = await tentar(A.proprietario, () =>
      salvarDivisaoDaTaxa([
        { nome: "Cozinha", pct: 40 },
        { nome: "Atendimento", pct: 70 },
      ])
    );
    const lixo = await tentar(A.proprietario, () =>
      salvarDivisaoDaTaxa("tudo para mim" as unknown as { nome: string; pct: number }[])
    );
    const dono = await tentar(A.proprietario, () => salvarDivisaoDaTaxa(certa));
    const gravado = await admin.parametroUnidade.findUnique({
      where: { unidadeId_chave: { unidadeId: A.unidade.id, chave: "caixa.divisaoTaxaServico" } },
    });
    expect({
      garcom: recusou(garcom),
      torta: recusou(torta),
      lixo: recusou(lixo),
      dono: recusou(dono),
      gravado: gravado?.valor,
    }).toEqual({ garcom: true, torta: true, lixo: true, dono: false, gravado: certa });
  });

  it("nome do cliente com 5 mil caracteres não vai inteiro para a comanda", async () => {
    const g = A.garcons[0]!;
    const t = await tentar(g, () => abrirComanda(A.mesas[44]!.id, 2, "Z".repeat(5000)));
    const c = await admin.comanda.findFirst({
      where: { mesaId: A.mesas[44]!.id, status: "ABERTA" },
      select: { nomeCliente: true },
    });
    expect(recusou(t) || (c?.nomeCliente?.length ?? 0) <= 80, `gravou ${c?.nomeCliente?.length} caracteres`).toBe(
      true
    );
  });

  /**
   * O vizinho tem o caixa fechado por um teste anterior, e nenhuma mesa
   * aberta: cada teste abre um caixa novo e o fecha, sem tocar no do demo.
   */
  it("sangria no mesmo instante do fechamento não fica fora do apurado", async () => {
    const c = B.caixas[0]!;
    const erradas: string[] = [];
    for (let vez = 1; vez <= 5; vez++) {
      await como(c, () => abrirCaixa("NOITE", 300));
      const caixa = await admin.caixa.findFirstOrThrow({ where: { unidadeId: B.unidade.id, status: "ABERTO" } });
      await Promise.all([
        tentar(c, () => fecharCaixa(caixa.id, 300)),
        tentar(B.gerentes[0]!, () => registrarMovimentoCaixa(caixa.id, "SANGRIA", 100, "cofre")),
      ]);
      const depois = await admin.caixa.findUniqueOrThrow({ where: { id: caixa.id }, include: { movimentos: true } });
      const retirado = depois.movimentos.reduce((s, m) => s + Number(m.valor), 0);
      if (depois.status !== "FECHADO") erradas.push(`vez ${vez}: caixa ficou ${depois.status}`);
      else if (Number(depois.valorApurado) !== 300 - retirado) {
        erradas.push(`vez ${vez}: apurado ${Number(depois.valorApurado)} com ${retirado} de sangria`);
      }
    }
    expect(erradas).toEqual([]);
  });

  it("dois toques em 'fechar caixa' com valores diferentes: vale o primeiro, o segundo é recusado", async () => {
    const c = B.caixas[0]!;
    await como(c, () => abrirCaixa("NOITE", 300));
    const caixa = await admin.caixa.findFirstOrThrow({ where: { unidadeId: B.unidade.id, status: "ABERTO" } });
    const r = await Promise.all([
      tentar(c, () => fecharCaixa(caixa.id, 300)),
      tentar(B.gerentes[0]!, () => fecharCaixa(caixa.id, 50)),
    ]);
    const fechamentos = await admin.auditLog.count({ where: { entidadeId: caixa.id, acao: "CAIXA_FECHADO" } });
    expect({ recusadas: r.filter(recusou).length, fechamentos }).toEqual({ recusadas: 1, fechamentos: 1 });
  });
});

/**
 * O papel vai byte a byte para a térmica: o agente escreve o `conteudo` como
 * está. Texto digitado — nome do cliente, ponto da carne — não pode levar
 * comando de impressora junto. `ESC p` é o pulso que abre a gaveta de
 * dinheiro, e pela action dá para mandar qualquer byte.
 */
describe("papel da impressora", () => {
  it("nome do cliente com comando ESC/POS não chega à impressora como comando", async () => {
    const g = A.garcons[0]!;
    const mesa = A.mesas[45]!;
    const aberta = (await como(g, () => abrirComanda(mesa.id, 2, "Ana\x1bp\x01\x19\xfa\x1dV\x01"))) as {
      comandaId: string;
    };
    await como(g, () => imprimirConferencia(aberta.comandaId));
    const fila = await admin.filaImpressao.findFirstOrThrow({
      where: { referenciaId: aberta.comandaId, tipo: "CONFERENCIA" },
    });
    await admin.filaImpressao.updateMany({
      where: { unidadeId: A.unidade.id, status: "PENDENTE", NOT: { id: fila.id } },
      data: { status: "IMPRESSO" },
    });
    const token = `agente-papel-${A.unidade.id}`;
    await admin.unidade.update({ where: { id: A.unidade.id }, data: { tokenImpressao: token } });
    const resposta = await GETImpressao(
      new NextRequest("http://demo.frentfood.test/api/impressao", { headers: { authorization: `Bearer ${token}` } })
    );
    const { trabalhos } = (await resposta.json()) as { trabalhos: { id: string; conteudo: string }[] };
    const papel = trabalhos.find((t) => t.id === fila.id)!.conteudo;
    // Só o que o próprio servidor põe: a letra dupla (GS ! n). Nada de ESC, nem GS V (corte).
    const semOsDoServidor = papel.split("\x1d\x21\x11").join("").split("\x1d\x21\x00").join("");
    expect(semOsDoServidor).not.toMatch(/[\x00-\x08\x0b-\x1f\x7f]/);
  });

  it("nome do cliente com byte zero não vira erro de sistema", async () => {
    const t = await tentar(A.garcons[0]!, () => abrirComanda(A.mesas[46]!.id, 2, "Ana\x00Maria"));
    expect(t.lancou, "a action lançou").toBeNull();
  });

  it("ponto da carne com comando ESC/POS não chega à cozinha como comando", async () => {
    const g = A.garcons[0]!;
    const aberta = (await como(g, () => abrirComanda(A.mesas[48]!.id, 2))) as { comandaId: string };
    const carne = A.itens.find((i) => i.exigePontoCarne)!;
    await como(g, () =>
      adicionarAoCarrinho({
        comandaId: aberta.comandaId,
        produtoId: carne.produtoId,
        cardapioItemId: carne.cardapioItemId,
        precoUnitario: carne.preco,
        exigePontoCarne: true,
      })
    );
    const item = await admin.comandaItem.findFirstOrThrow({ where: { comandaId: aberta.comandaId } });
    await como(g, () => definirPontoCarne(item.id, "Mal passada\x1bp\x01\x19\xfa"));
    await como(g, () => enviarCarrinho(aberta.comandaId));
    const pedido = await admin.pedido.findFirstOrThrow({ where: { comandaId: aberta.comandaId } });
    const fila = await admin.filaImpressao.findFirstOrThrow({ where: { referenciaId: pedido.id } });
    await admin.filaImpressao.updateMany({
      where: { unidadeId: A.unidade.id, status: "PENDENTE", NOT: { id: fila.id } },
      data: { status: "IMPRESSO" },
    });
    const token = `agente-cozinha-${A.unidade.id}`;
    await admin.unidade.update({ where: { id: A.unidade.id }, data: { tokenImpressao: token } });
    const resposta = await GETImpressao(
      new NextRequest("http://demo.frentfood.test/api/impressao", { headers: { authorization: `Bearer ${token}` } })
    );
    const { trabalhos } = (await resposta.json()) as { trabalhos: { id: string; conteudo: string }[] };
    const papel = trabalhos.find((t) => t.id === fila.id)!.conteudo;
    const semOsDoServidor = papel.split("\x1d\x21\x11").join("").split("\x1d\x21\x00").join("");
    expect(semOsDoServidor).not.toMatch(/[\x00-\x08\x0b-\x1f\x7f]/);
  });

  /**
   * A fila entrega o papel a um agente só, e a baixa é dele.
   *
   * A confirmação aceitava qualquer token da unidade: o aparelho do bolso dava
   * baixa no papel reservado pelo balcão. Era inofensivo quando todos
   * imprimiam a mesma fila — deixou de ser quando a reserva passou a entregar
   * listas diferentes de propósito, porque dar baixa no papel do outro marca
   * como impresso um papel que não saiu, e a praça espera um prato que ninguém
   * mandou fazer.
   */
  it("a baixa do papel é de quem levou, e não de qualquer aparelho da casa", async () => {
    const dados = (nome: string) => ({
      tenantId: A.tenant.id,
      unidadeId: A.unidade.id,
      nome,
      token: `baixa-${nome}-${A.unidade.id}`,
    });
    const doBalcao = (await admin.aparelho.create({ data: dados("balcao") })).token;
    const doBolso = (await admin.aparelho.create({ data: dados("bolso") })).token;

    // O resto do dia já saiu: sobra um papel na fila, que é o que se segue.
    await admin.filaImpressao.updateMany({
      where: { unidadeId: A.unidade.id, status: "PENDENTE" },
      data: { status: "IMPRESSO" },
    });
    const papel = await admin.filaImpressao.create({
      data: {
        tenantId: A.tenant.id,
        unidadeId: A.unidade.id,
        tipo: "COMANDA_PRODUCAO",
        titulo: "Comanda da praça",
        conteudo: "papel da praça",
      },
    });

    const comToken = (token: string, corpo?: unknown) =>
      new NextRequest("http://demo.frentfood.test/api/impressao", {
        method: corpo === undefined ? "GET" : "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
      });
    const baixa = (token: string) => POSTImpressao(comToken(token, { id: papel.id, ok: true }));

    const levou = (await (await GETImpressao(comToken(doBalcao))).json()) as {
      trabalhos: { id: string }[];
    };
    const doOutro = await baixa(doBolso);
    const depoisDaTentativa = await admin.filaImpressao.findUniqueOrThrow({
      where: { id: papel.id },
    });
    const dele = await baixa(doBalcao);

    expect({
      levou: levou.trabalhos.map((t) => t.id),
      doOutro: doOutro.status,
      statusNaTentativa: depoisDaTentativa.status,
      dele: dele.status,
      statusNoFim: (await admin.filaImpressao.findUniqueOrThrow({ where: { id: papel.id } })).status,
    }).toEqual({
      levou: [papel.id],
      doOutro: 409,
      statusNaTentativa: "PENDENTE",
      dele: 200,
      statusNoFim: "IMPRESSO",
    });
  });
});

/**
 * A marca de qual forma a maquininha usa.
 *
 * O aparelho manda o **tipo** — crédito, débito, Pix —, que é o que a
 * credenciadora precisa para passar o cartão; a forma é a escrituração: nome,
 * taxa e prazo. Numa casa com "Cartão de Crédito" a 3,2% no balcão e "Crédito
 * Stone" a 1,9% na maquininha, o servidor escolhia pela ordem alfabética e a
 * taxa da errada ia **congelada** no pagamento — o custo do mês sai torto e não
 * há como corrigir depois. A marca veio para acabar com isso, e a regra dela é
 * uma só por tipo: enquanto ela valer, não há o que adivinhar.
 */
describe("qual forma a maquininha usa", () => {
  const dados = (nome: string, tipo: "CREDITO" | "DEBITO", taxaPct: number) => ({
    nome,
    tipo: tipo as never,
    taxaPct,
    prazoDias: 30,
  });

  async function marcadas(tipo: string) {
    return admin.formaPagamento.findMany({
      where: { tenantId: A.tenant.id, tipo: tipo as never, naMaquininha: true },
      select: { nome: true },
      orderBy: { nome: "asc" },
    });
  }

  /** Cria a forma e devolve o id — a action não o devolve. */
  async function criar(nome: string, tipo: "CREDITO" | "DEBITO", taxaPct: number) {
    const r = await como(A.proprietario, () => criarForma(dados(nome, tipo, taxaPct)));
    if (temErro(r)) throw new Error(`não criou ${nome}: ${JSON.stringify(r)}`);
    return (await admin.formaPagamento.findFirstOrThrow({ where: { tenantId: A.tenant.id, nome } })).id;
  }

  it("marcar a segunda do mesmo tipo desmarca a primeira", async () => {
    const balcao = await criar("Crédito do balcão", "CREDITO", 3.2);
    const stone = await criar("Crédito Stone", "CREDITO", 1.9);

    await como(A.proprietario, () => alternarNaMaquininha(balcao));
    const depoisDaPrimeira = await marcadas("CREDITO");
    await como(A.proprietario, () => alternarNaMaquininha(stone));
    const depoisDaSegunda = await marcadas("CREDITO");

    expect({
      primeira: depoisDaPrimeira.map((f) => f.nome),
      segunda: depoisDaSegunda.map((f) => f.nome),
    }).toEqual({ primeira: ["Crédito do balcão"], segunda: ["Crédito Stone"] });
  });

  /**
   * Trocar o tipo de uma forma marcada.
   *
   * A regra "uma por tipo" é conferida na hora de marcar, e só ali. O tipo,
   * porém, é campo do formulário: quem cadastrou a "Stone" como crédito e
   * depois percebe que a maquininha dela passa débito corrige o tipo — e a
   * marca vai junto, para um tipo que já tem a sua. Ficam duas marcadas no
   * mesmo tipo, a escolha volta a ser a ordem alfabética, e o aviso da tela
   * ("a maquininha está escolhendo sozinha") **cala**, porque ele só pergunta
   * se existe alguma marcada. É o único caminho pelo qual a ambiguidade volta
   * sem ninguém ver.
   */
  it("trocar o tipo de uma forma marcada não deixa duas marcadas no mesmo tipo", async () => {
    const debitoDaCasa = await criar("Débito Stone", "DEBITO", 1.5);
    const credito = await criar("Crédito Stone 2", "CREDITO", 1.9);
    await como(A.proprietario, () => alternarNaMaquininha(debitoDaCasa));
    await como(A.proprietario, () => alternarNaMaquininha(credito));

    // "Na verdade essa maquininha passa débito": o tipo é campo do formulário.
    const r = await como(A.proprietario, () =>
      editarForma(credito, dados("Crédito Stone 2", "DEBITO", 1.9))
    );
    expect(temErro(r)).toBe(false);

    expect({
      debito: (await marcadas("DEBITO")).map((f) => f.nome),
      credito: (await marcadas("CREDITO")).map((f) => f.nome),
    }).toEqual({ debito: ["Débito Stone"], credito: [] });
  });

  /**
   * Dois toques em "usar na maquininha", no mesmo instante.
   *
   * Duas abas da retaguarda, ou dois sócios resolvendo a mesma pendência: cada
   * transação desmarca as irmãs antes de marcar a sua, e nenhuma enxerga a
   * marca que a outra ainda não entregou. Se as duas passarem, o tipo fica com
   * duas marcadas e a ambiguidade volta pela porta que ninguém vigia.
   */
  it("dois toques em 'usar na maquininha' ao mesmo tempo deixam uma marcada só", async () => {
    const uma = await criar("Crédito Alfa", "CREDITO", 2.1);
    const outra = await criar("Crédito Beta", "CREDITO", 2.9);

    await Promise.all([
      como(A.proprietario, () => alternarNaMaquininha(uma)),
      como(A.proprietario, () => alternarNaMaquininha(outra)),
    ]);

    expect((await marcadas("CREDITO")).map((f) => f.nome).length).toBe(1);
  });
});

/**
 * A saída da venda de balcão presa — a porta nova de 18/10.
 *
 * `receberBalcaoPelaRetaguarda` é dinheiro entrando pela palavra de quem
 * opera, com a prova em papel: a venda existe na adquirente, o cartão já foi
 * debitado, e a comanda ficou aberta sem mesa — fora do mapa do salão e
 * trancando o fechamento do caixa.
 *
 * O que se ataca aqui não é a autorização (`tests/balcao-retaguarda.test.ts`
 * já a prende de seis lados), é **o valor**: quanto a porta decide receber, e
 * o que acontece com a comanda quando esse valor não é o que a conta vale.
 * Uma porta de recebimento que erra o valor para cima deixa a comanda aberta
 * para sempre — e o caixa, que recusa enquanto houver comanda aberta, não
 * fecha mais a noite.
 */
describe("a venda de balcão recebida pela retaguarda", () => {
  /**
   * O caixa aberto do vizinho, meu e só meu.
   *
   * Um ataque mais acima fecha o caixa de B de propósito (é o que ele prova:
   * que a noite volta a fechar). Sem abrir um aqui, todo pagamento destes
   * testes seria recusado por \"nenhum caixa aberto\" — e eu leria isso como
   * brecha onde era defeito do meu teste.
   */
  let meuCaixa: string | null = null;
  async function caixaAberto() {
    const existe = await admin.caixa.findFirst({
      where: { unidadeId: B.unidade.id, tipo: "GERAL", status: "ABERTO" },
    });
    if (existe) return existe.id;
    const meu = await admin.caixa.create({
      data: {
        tenantId: B.tenant.id,
        unidadeId: B.unidade.id,
        data: new Date(),
        tipo: "GERAL",
        turno: "NOITE",
        status: "ABERTO",
        fundoCaixa: 200,
        abertoPorId: B.caixas[0]!.usuarioId,
      },
    });
    meuCaixa = meu.id;
    return meu.id;
  }

  /** A venda que a maquininha cobrou e não conseguiu registrar: aberta, sem mesa, sem pagamento. */
  const vendaPresa = (quem: Membro, referencia: string, valorEmCentavos: number) =>
    como(quem, () =>
      comandaDeBalcao(
        { usuarioId: quem.usuarioId, tenantId: B.tenant.id, unidadeId: B.unidade.id },
        { referencia, valorEmCentavos }
      )
    );

  const comandaComPagamentos = (comandaId: string) =>
    admin.comanda.findUniqueOrThrow({ where: { id: comandaId }, include: { pagamentos: true } });

  /** O que ficou na unidade sem mesa e aberto: o que tranca a noite. */
  const trancandoANoite = () =>
    admin.comanda.count({
      where: { unidadeId: B.unidade.id, mesaId: null, status: { in: ["ABERTA", "FECHANDO"] } },
    });

  /** Nada do que eu abrir pode sobrar para o vizinho de baixo. */
  async function varrer() {
    const minhas = await admin.comanda.findMany({
      where: { unidadeId: B.unidade.id, origem: "BALCAO" },
      select: { id: true },
    });
    const ids = minhas.map((c) => c.id);
    await admin.pagamento.deleteMany({ where: { comandaId: { in: ids } } });
    await admin.comanda.deleteMany({ where: { id: { in: ids } } });
    if (meuCaixa) {
      await admin.caixa.deleteMany({ where: { id: meuCaixa } });
      meuCaixa = null;
    }
  }

  /**
   * O desconto na venda de balcão.
   *
   * O gerente da demonstração tem `comanda.aplicarDesconto` **e**
   * `caixa.sangria`: a mesma pessoa que abate a venda é a que a recebe pela
   * retaguarda. É o caso honesto — o cliente reclamou, a casa abateu R$ 5 de
   * uma venda de R$ 20 cobrada no aparelho.
   *
   * A retaguarda soma os itens e ignora o desconto, então ela tenta receber
   * R$ 20 de uma conta que vale R$ 15. `receberPagamento` recusa com razão —
   * ninguém paga mais do que a conta —, e a venda fica **sem saída nenhuma**:
   * cada tentativa recusa igual, a comanda não tem mesa para ser recebida por
   * outra tela, e o caixa não fecha mais a noite.
   */
  it("desconto na venda de balcão: recebe o que a conta vale e a noite fecha", async () => {
    await caixaAberto();
    const { comandaId } = await vendaPresa(B.gerentes[0]!, "balcao-com-desconto", 2_000);
    const desconto = await tentar(B.gerentes[0]!, () =>
      aplicarDesconto(comandaId, 5, "cliente reclamou do atendimento")
    );

    const r = await tentar(B.gerentes[0]!, () => receberBalcao(comandaId, B.formas.credito.id));
    const comanda = await comandaComPagamentos(comandaId);
    const presas = await trancandoANoite();
    await varrer();

    expect({
      descontoEntrou: !recusou(desconto),
      recebeu: !recusou(r),
      recusa: r.lancou ?? (temErro(r.resposta) ? r.resposta.erro : null),
      status: comanda.status,
      pago: comanda.pagamentos.reduce((s, p) => s + Number(p.valor) - Number(p.troco), 0),
      trancandoANoite: presas,
    }).toEqual({
      descontoEntrou: true,
      recebeu: true,
      recusa: null,
      status: "PAGA",
      pago: 15,
      trancandoANoite: 0,
    });
  });

  /**
   * A venda de balcão que recebeu parte do dinheiro e ficou.
   *
   * O caminho é o do próprio aparelho: a venda de R$ 20 é cobrada em duas
   * passadas de cartão — a primeira aprova R$ 8, a segunda cai na rede. A
   * comanda fica aberta com R$ 8 dentro. A retaguarda soma os itens e ignora
   * o que já entrou, então tenta receber R$ 20 numa conta que deve R$ 12 —
   * recusa, e a comanda fica presa do mesmo jeito. (A faixa do mapa, que só
   * oferece a porta quando `recebido === 0`, nem mostra o botão: esta venda
   * não tem saída em tela nenhuma.)
   */
  it("venda de balcão com parte recebida: recebe o que falta e a noite fecha", async () => {
    await caixaAberto();
    const { comandaId } = await vendaPresa(B.gerentes[0]!, "balcao-pela-metade", 2_000);
    const parcial = await tentar(B.caixas[0]!, () =>
      registrarPagamento(comandaId, B.formas.debito.id, 8, 0)
    );

    const r = await tentar(B.gerentes[0]!, () => receberBalcao(comandaId, B.formas.credito.id));
    const comanda = await comandaComPagamentos(comandaId);
    const presas = await trancandoANoite();
    await varrer();

    expect({
      parcialEntrou: !recusou(parcial),
      recebeu: !recusou(r),
      recusa: r.lancou ?? (temErro(r.resposta) ? r.resposta.erro : null),
      status: comanda.status,
      pago: comanda.pagamentos.reduce((s, p) => s + Number(p.valor) - Number(p.troco), 0),
      trancandoANoite: presas,
    }).toEqual({
      parcialEntrou: true,
      recebeu: true,
      recusa: null,
      status: "PAGA",
      pago: 20,
      trancandoANoite: 0,
    });
  });


  /**
   * A venda de balcão que recebeu tudo e ficou aberta.
   *
   * O dinheiro entrou e o fechamento não: a aba do caixa fechou no meio, ou
   * `finalizarConta` falhou depois de o pagamento já estar gravado. A comanda
   * fica paga por dentro e aberta por fora — e é a pior das três, porque não há
   * o que receber: pedindo o total cheio, esta porta batia em "esta conta já
   * está quitada" e a noite não fechava nunca mais.
   */
  it("venda de balcão paga e aberta: a retaguarda a fecha, e a noite fecha", async () => {
    await caixaAberto();
    const { comandaId } = await vendaPresa(B.gerentes[0]!, "balcao-paga-e-aberta", 2_000);
    const pago = await tentar(B.caixas[0]!, () =>
      registrarPagamento(comandaId, B.formas.debito.id, 20, 0)
    );

    const r = await tentar(B.gerentes[0]!, () => receberBalcao(comandaId, B.formas.credito.id));
    const comanda = await comandaComPagamentos(comandaId);
    const presas = await trancandoANoite();
    await varrer();

    expect({
      pagamentoEntrou: !recusou(pago),
      fechou: !recusou(r),
      status: comanda.status,
      // Nada entra duas vezes: a venda já tinha o dinheiro dentro.
      pagamentos: comanda.pagamentos.length,
      pago: comanda.pagamentos.reduce((s, p) => s + Number(p.valor) - Number(p.troco), 0),
      trancandoANoite: presas,
    }).toEqual({
      pagamentoEntrou: true,
      fechou: true,
      status: "PAGA",
      pagamentos: 1,
      pago: 20,
      trancandoANoite: 0,
    });
  });

  /**
   * Dois toques em "receber pela retaguarda", no mesmo instante.
   *
   * Duas abas do caixa, ou o gerente e o caixa resolvendo a mesma pendência
   * da faixa. O dinheiro desta venda já entrou uma vez na adquirente: dois
   * pagamentos aqui são R$ 40 de faturamento sobre uma venda de R$ 20.
   */
  it("dois toques simultâneos na retaguarda registram um pagamento só", async () => {
    await caixaAberto();
    const { comandaId } = await vendaPresa(B.gerentes[0]!, "balcao-dois-toques", 2_000);

    await Promise.all([
      tentar(B.gerentes[0]!, () => receberBalcao(comandaId, B.formas.credito.id)),
      tentar(B.gerentes[0]!, () => receberBalcao(comandaId, B.formas.debito.id)),
    ]);

    const comanda = await comandaComPagamentos(comandaId);
    await varrer();

    expect({
      pagamentos: comanda.pagamentos.length,
      pago: comanda.pagamentos.reduce((s, p) => s + Number(p.valor) - Number(p.troco), 0),
      status: comanda.status,
    }).toEqual({ pagamentos: 1, pago: 20, status: "PAGA" });
  });

  /**
   * A comanda do vizinho na retaguarda do demo.
   *
   * O `comandaId` vem do navegador. Sob RLS a linha do outro restaurante não
   * existe para esta sessão, e `findUniqueOrThrow` lança antes da conferência
   * de tenant: o que o caixa vê é erro de sistema, com a consulta do Prisma
   * dentro, onde devia ver uma recusa.
   */
  it("comanda de outro restaurante na retaguarda é recusa legível, não erro de sistema", async () => {
    await caixaAberto();
    const { comandaId } = await vendaPresa(B.gerentes[0]!, "balcao-do-vizinho", 2_000);

    const t = await tentar(A.proprietario, () => receberBalcao(comandaId, B.formas.credito.id));
    const comanda = await comandaComPagamentos(comandaId);
    await varrer();

    expect({
      recusou: recusou(t),
      recusa: t.lancou ?? (temErro(t.resposta) ? t.resposta.erro : null),
      vazouPrisma: /prisma|invocation|findUniqueOrThrow/i.test(t.lancou ?? ""),
      status: comanda.status,
      pagamentos: comanda.pagamentos.length,
    }).toEqual({
      recusou: true,
      recusa: "Venda não encontrada.",
      vazouPrisma: false,
      status: "ABERTA",
      pagamentos: 0,
    });
  });
});

/**
 * A conta da outra filial, pela sessão da matriz.
 *
 * O `comandaId` vem do navegador, e o RLS é por **restaurante**: a conta da
 * filial existe para a sessão da matriz, porque as duas são do mesmo tenant.
 * Dez lugares do código conferem `unidadeId` depois de conferir `tenantId` —
 * `receberPagamento`, `finalizarConta`, `estornarPagamento`, a retaguarda do
 * balcão. Outros conferem só o restaurante, e esses aceitam mexer na conta da
 * filial vizinha. É a mesma falha que `abrirCaixa` tinha e que já foi
 * corrigida: a sessão sabe em que unidade a pessoa está, e é essa que vale.
 *
 * Duas delas mexem com dinheiro, e as duas são do cargo do gerente.
 */
describe("a conta da filial vizinha", () => {
  let filial: { unidadeId: string; comandaId: string; areaId: string; mesaId: string } | null = null;

  /** Uma filial do mesmo restaurante, com uma conta de R$ 100 aberta. */
  async function montarFilial() {
    const unidade = await admin.unidade.create({
      data: {
        tenantId: B.tenant.id,
        codigo: "002",
        nome: "Filial",
        cidade: "Anápolis",
        uf: "GO",
        taxaServicoPct: 10,
        atuaLoja: true,
      },
    });
    const area = await admin.area.create({
      data: { tenantId: B.tenant.id, unidadeId: unidade.id, nome: "Salão", ordem: 1 },
    });
    const mesa = await admin.mesa.create({
      data: {
        tenantId: B.tenant.id,
        unidadeId: unidade.id,
        areaId: area.id,
        numero: "1",
        capacidade: 4,
        qrToken: `qr-filial-${unidade.id}`,
      },
    });
    const comanda = await admin.comanda.create({
      data: {
        tenantId: B.tenant.id,
        unidadeId: unidade.id,
        numero: 1,
        mesaId: mesa.id,
        pessoas: 2,
        taxaServicoPct: 10,
        abertaPorId: B.gerentes[0]!.usuarioId,
        itens: {
          create: {
            tenantId: B.tenant.id,
            produtoId: B.itens[0]!.produtoId,
            quantidade: 1,
            precoUnitario: 100,
            precoTotal: 100,
            status: "ENTREGUE",
            lancadoPorId: B.gerentes[0]!.usuarioId,
          },
        },
      },
    });
    filial = {
      unidadeId: unidade.id,
      comandaId: comanda.id,
      areaId: area.id,
      mesaId: mesa.id,
    };
    return filial;
  }

  async function desmontarFilial() {
    if (!filial) return;
    await admin.comanda.deleteMany({ where: { unidadeId: filial.unidadeId } });
    await admin.mesa.deleteMany({ where: { unidadeId: filial.unidadeId } });
    await admin.area.deleteMany({ where: { unidadeId: filial.unidadeId } });
    await admin.unidade.deleteMany({ where: { id: filial.unidadeId } });
    filial = null;
  }

  /**
   * O gerente da matriz abatendo a conta da filial.
   *
   * Ele tem `comanda.aplicarDesconto` — na unidade dele. A conta é de outra,
   * a 100 km de distância, com outro caixa e outro turno: o desconto entra no
   * fechamento de quem nem sabe que ele existiu, e o diário o registra na
   * unidade da conta, não na de quem o deu.
   */
  it("o gerente da matriz não abate a conta da filial", async () => {
    const { comandaId } = await montarFilial();

    const t = await tentar(B.gerentes[0]!, () =>
      aplicarDesconto(comandaId, 20, "cortesia que não é minha de dar")
    );

    const depois = await admin.comanda.findUniqueOrThrow({
      where: { id: comandaId },
      select: { descontoValor: true },
    });
    await desmontarFilial();

    expect({ recusou: recusou(t), desconto: Number(depois.descontoValor) }).toEqual({
      recusou: true,
      desconto: 0,
    });
  });

  /**
   * A taxa de serviço da filial, tirada pela matriz.
   *
   * Zerar a taxa de 10% de uma conta de R$ 100 é R$ 10 a menos na gorjeta da
   * equipe de outra cidade. Mesma permissão do desconto, e por isso mesmo a
   * mesma régua: a unidade é a da sessão.
   */
  it("o gerente da matriz não tira a taxa de serviço da filial", async () => {
    const { comandaId } = await montarFilial();

    const t = await tentar(B.gerentes[0]!, () => definirTaxaServico(comandaId, 0));

    const depois = await admin.comanda.findUniqueOrThrow({
      where: { id: comandaId },
      select: { taxaServicoPct: true },
    });
    await desmontarFilial();

    expect({ recusou: recusou(t), taxa: Number(depois.taxaServicoPct) }).toEqual({
      recusou: true,
      taxa: 10,
    });
  });

  /**
   * A gaveta da filial, mexida pela matriz.
   *
   * `fecharCaixa` e `registrarMovimentoCaixa` recebem um `caixaId` do
   * navegador e conferem só o restaurante. Fechar é assinar um número: o
   * valor contado, a divergência e o nome de quem fechou entram no turno de
   * outra cidade, que nem acabou. E a sangria tira dinheiro de uma gaveta que
   * quem a tirou não vai contar.
   */
  it("o caixa da matriz não fecha nem sangra a gaveta da filial", async () => {
    const { unidadeId } = await montarFilial();
    const gaveta = await admin.caixa.create({
      data: {
        tenantId: B.tenant.id,
        unidadeId,
        data: new Date(),
        tipo: "GERAL",
        turno: "NOITE",
        status: "ABERTO",
        fundoCaixa: 300,
        abertoPorId: B.caixas[0]!.usuarioId,
      },
    });

    const sangrou = await tentar(B.gerentes[0]!, () =>
      registrarMovimentoCaixa(gaveta.id, "SANGRIA", 100, "para o cofre")
    );
    /*
     * A conta da filial sai antes de tentar fechar.
     *
     * Com ela aberta, `fecharCaixa` recusa por "ainda há 1 comanda aberta" e o
     * teste passaria sem nada provar: a recusa que se quer aqui é a da
     * unidade, não a da comanda.
     */
    await admin.comanda.deleteMany({ where: { unidadeId } });
    const fechou = await tentar(B.caixas[0]!, () => fecharCaixa(gaveta.id, 300));

    const depois = await admin.caixa.findUniqueOrThrow({
      where: { id: gaveta.id },
      include: { movimentos: true },
    });
    await admin.caixa.deleteMany({ where: { unidadeId } });
    await desmontarFilial();

    expect({
      recusouSangria: recusou(sangrou),
      recusouFechamento: recusou(fechou),
      movimentos: depois.movimentos.length,
      status: depois.status,
    }).toEqual({
      recusouSangria: true,
      recusouFechamento: true,
      movimentos: 0,
      status: "ABERTO",
    });
  });

  /**
   * O garçom da matriz lançando na conta da filial.
   *
   * `comandaAberta` conferia só o restaurante, e o cardápio da sessão é o da
   * matriz: o item entrava na conta de outra cidade, com o preço daqui, e
   * aparecia na comanda de quem está servindo lá.
   */
  it("o garçom da matriz não lança item na conta da filial", async () => {
    const { comandaId } = await montarFilial();
    const item = B.itens[0]!;

    const t = await tentar(B.garcons[0]!, () =>
      adicionarAoCarrinho({
        comandaId,
        produtoId: item.produtoId,
        cardapioItemId: item.cardapioItemId,
        precoUnitario: item.preco,
        exigePontoCarne: false,
      })
    );

    const itens = await admin.comandaItem.count({ where: { comandaId } });
    await desmontarFilial();

    // A recusa tem de ser a da unidade: o carrinho também recusa por preço,
    // por esgotado e por conta em fechamento, e qualquer uma delas faria este
    // ataque passar sem provar nada.
    expect({ porQue: porQue(t), itens }).toEqual({
      porQue: "Comanda de outra unidade.",
      itens: 1,
    });
  });

  /**
   * E mandando para a cozinha de lá o que estava no carrinho.
   *
   * `enviarCarrinho` é a operação mais delicada do sistema: ela imprime na
   * praça, baixa estoque e abre ticket no KDS — tudo na unidade da comanda.
   */
  it("a matriz não manda para a cozinha da filial o carrinho de lá", async () => {
    const { comandaId } = await montarFilial();
    await admin.comandaItem.create({
      data: {
        tenantId: B.tenant.id,
        comandaId,
        produtoId: B.itens[0]!.produtoId,
        quantidade: 1,
        precoUnitario: 50,
        precoTotal: 50,
        status: "PENDENTE",
        lancadoPorId: B.gerentes[0]!.usuarioId,
      },
    });

    const t = await tentar(B.garcons[0]!, () => enviarCarrinho(comandaId));

    const pendentes = await admin.comandaItem.count({ where: { comandaId, status: "PENDENTE" } });
    const pedidos = await admin.pedido.count({ where: { comandaId } });
    await desmontarFilial();

    expect({ recusou: recusou(t), pendentes, pedidos }).toEqual({
      recusou: true,
      pendentes: 1,
      pedidos: 0,
    });
  });

  /**
   * O ticket da praça da filial, avançado pelo monitor da matriz.
   *
   * Mover ticket só exige estar logado — é o trabalho de todo mundo na cozinha
   * —, então aqui a unidade é a única régua que existe. Sem ela, o prato sumia
   * da tela de lá sem ninguém ter montado nada.
   */
  it("o KDS da matriz não avança o ticket da filial", async () => {
    const { comandaId, unidadeId } = await montarFilial();
    const item = await admin.comandaItem.findFirstOrThrow({ where: { comandaId } });
    const pedido = await admin.pedido.create({
      data: {
        tenantId: B.tenant.id,
        unidadeId,
        comandaId,
        estacaoId: (await admin.estacao.findFirstOrThrow({ where: { tenantId: B.tenant.id } })).id,
        numero: 1,
        status: "EM_PREPARO",
        itens: { create: { comandaItemId: item.id } },
      },
    });

    const t = await tentar(B.garcons[0]!, () => avancarPedido(pedido.id, "PRONTO"));

    const depois = await admin.pedido.findUniqueOrThrow({ where: { id: pedido.id } });
    await admin.pedidoItem.deleteMany({ where: { pedidoId: pedido.id } });
    await admin.pedido.deleteMany({ where: { comandaId } });
    await desmontarFilial();

    expect({ recusou: recusou(t), status: depois.status }).toEqual({
      recusou: true,
      status: "EM_PREPARO",
    });
  });

  /**
   * O item da filial cancelado pelo gerente da matriz.
   *
   * Cancelar é tirar dinheiro da conta de alguém — e o estoque volta na
   * unidade da comanda, não na de quem cancelou.
   */
  it("o gerente da matriz não cancela item da conta da filial", async () => {
    const { comandaId } = await montarFilial();
    const item = await admin.comandaItem.findFirstOrThrow({ where: { comandaId } });

    const t = await tentar(B.gerentes[0]!, () => cancelarItem(item.id, "não é minha de cancelar"));

    const depois = await admin.comandaItem.findUniqueOrThrow({ where: { id: item.id } });
    await desmontarFilial();

    expect({ recusou: recusou(t), status: depois.status }).toEqual({
      recusou: true,
      status: "ENTREGUE",
    });
  });

  /**
   * A conta da filial mudando de mesa por ordem da matriz.
   *
   * O destino já era conferido contra a unidade **da comanda** — uma conta não
   * atravessa cidades. Faltava a outra ponta: quem manda transferir precisa
   * estar na mesma casa, senão o salão de lá vê a mesa trocar sozinha.
   */
  it("a matriz não transfere a conta da filial de mesa", async () => {
    const { comandaId, unidadeId, areaId, mesaId } = await montarFilial();
    const destino = await admin.mesa.create({
      data: {
        tenantId: B.tenant.id,
        unidadeId,
        areaId,
        numero: "2",
        capacidade: 4,
        qrToken: `qr-filial-2-${unidadeId}`,
      },
    });

    const t = await tentar(B.gerentes[0]!, () => transferirMesa(comandaId, destino.id));

    const depois = await admin.comanda.findUniqueOrThrow({ where: { id: comandaId } });
    await desmontarFilial();

    expect({ recusou: recusou(t), ficouNaMesa: depois.mesaId === mesaId }).toEqual({
      recusou: true,
      ficouNaMesa: true,
    });
  });

  /**
   * O pagamento da filial estornado pelo caixa da matriz.
   *
   * Estorno é dinheiro saindo do faturamento de um turno que não é o de quem
   * estorna: o caixa de lá fecha a noite com um buraco que ninguém explica.
   */
  it("o caixa da matriz não estorna o pagamento da filial", async () => {
    const { comandaId } = await montarFilial();
    const pagamento = await admin.pagamento.create({
      data: {
        tenantId: B.tenant.id,
        comandaId,
        formaPagamentoId: B.formas.credito.id,
        valor: 110,
        troco: 0,
        taxaPct: 0,
        taxaValor: 0,
        usuarioId: B.caixas[0]!.usuarioId,
      },
    });

    const t = await tentar(B.caixas[0]!, () => estornarPagamento(pagamento.id));

    const aindaExiste = await admin.pagamento.count({ where: { id: pagamento.id } });
    await admin.pagamento.deleteMany({ where: { comandaId } });
    await desmontarFilial();

    expect({ recusou: recusou(t), aindaExiste }).toEqual({ recusou: true, aindaExiste: 1 });
  });

  /**
   * A conta da filial posta em fechamento pela matriz.
   *
   * "Pedir a conta" imprime a parcial na impressora da unidade da comanda:
   * saía papel na cozinha de lá, e a mesa entrava em fechamento sem ninguém
   * ter pedido nada ao garçom.
   */
  it("a matriz não põe a conta da filial em fechamento", async () => {
    const { comandaId } = await montarFilial();

    const t = await tentar(B.gerentes[0]!, () => iniciarFechamento(comandaId));

    const depois = await admin.comanda.findUniqueOrThrow({ where: { id: comandaId } });
    await desmontarFilial();

    expect({ recusou: recusou(t), status: depois.status }).toEqual({
      recusou: true,
      status: "ABERTA",
    });
  });

  /**
   * O chamado da mesa da filial, apagado pela matriz.
   *
   * Aqui não há dinheiro: há uma mesa de mão levantada que some da tela de
   * quem poderia ir até ela. O comentário do código dizia que "só o
   * restaurante importa, porque o chamado é da mesa" — e "perto" é dentro da
   * mesma casa.
   */
  it("a matriz não apaga o chamado da mesa da filial", async () => {
    const { comandaId } = await montarFilial();
    await admin.comanda.update({
      where: { id: comandaId },
      data: { chamadoGarcomEm: new Date() },
    });

    const t = await tentar(B.garcons[0]!, () => atenderChamado(comandaId));

    const depois = await admin.comanda.findUniqueOrThrow({ where: { id: comandaId } });
    await desmontarFilial();

    expect({ recusou: recusou(t), aindaChamando: depois.chamadoGarcomEm !== null }).toEqual({
      recusou: true,
      aindaChamando: true,
    });
  });

  /**
   * E a nota da filial reemitida pela matriz.
   *
   * Reemitir gasta número na série **da unidade da conta**, com o CNPJ de lá,
   * por decisão de quem não responde por aquele caixa. A recusa precisa ser a
   * da unidade: com a emissão desligada no ambiente de teste, "recusou"
   * sozinho não provaria nada.
   */
  it("a matriz não reemite a nota da conta da filial", async () => {
    const { comandaId } = await montarFilial();

    // O proprietário, e não o gerente: o fiscal pede `unidade.configurar`, e
    // com o gerente a recusa seria de permissão — não provaria a da unidade.
    const t = await tentar(B.proprietario, () => reemitirNota(comandaId));

    await desmontarFilial();

    expect(porQue(t)).toBe("Comanda de outra unidade.");
  });

  /**
   * A nota fiscal da filial cancelada pela matriz.
   *
   * Série, numeração e CNPJ são da unidade, e cancelar é ato fiscal com prazo
   * contado. A nota de lá não é desta sessão, nem o prazo dela.
   */
  it("a matriz não cancela a nota fiscal da filial", async () => {
    const { comandaId, unidadeId } = await montarFilial();
    const nota = await admin.notaFiscal.create({
      data: {
        tenantId: B.tenant.id,
        unidadeId,
        comandaId,
        serie: 1,
        numero: 1,
        ambiente: "HOMOLOGACAO",
        status: "AUTORIZADA",
        valorTotal: 110,
      },
    });

    const t = await tentar(B.proprietario, () => cancelarNota(nota.id, "cancelamento que não é meu"));

    const depois = await admin.notaFiscal.findUniqueOrThrow({ where: { id: nota.id } });
    await admin.notaFiscal.deleteMany({ where: { unidadeId } });
    await desmontarFilial();

    // Pela mesma razão do carrinho: com a emissão desligada, "recusou" seria
    // verdade mesmo sem a regra da unidade existir.
    expect({ porQue: porQue(t), status: depois.status }).toEqual({
      porQue: "Nota de outra unidade.",
      status: "AUTORIZADA",
    });
  });

  /**
   * A conta da filial impressa pela matriz.
   *
   * `imprimirConferencia` recebe o id do navegador e confere **só o
   * restaurante** — a linha da unidade não está lá, e as vizinhas de arquivo
   * (`aplicarDesconto`, `definirTaxaServico`) conferem as duas.
   *
   * E o papel não sai aqui: `enfileirarConferencia` enfileira na unidade **da
   * comanda**. Então a matriz faz sair papel na impressora da filial, de uma
   * mesa que está sendo servida a 100 km — o cliente de lá recebe a conta sem
   * ter pedido, e quem está no caixa de lá vê uma segunda via que ninguém
   * daquela casa mandou imprimir. Qualquer sessão basta: a ação pede sessão e
   * nada mais.
   */
  it("a matriz não imprime a conta da filial na impressora de lá", async () => {
    const { comandaId, unidadeId } = await montarFilial();

    const t = await tentar(B.gerentes[0]!, () => imprimirConferencia(comandaId));

    const papeis = await admin.filaImpressao.count({
      where: { unidadeId, referenciaId: comandaId },
    });
    await admin.filaImpressao.deleteMany({ where: { unidadeId } });
    await desmontarFilial();

    expect({ porQue: porQue(t), papeis }).toEqual({
      porQue: "Comanda de outra unidade.",
      papeis: 0,
    });
  });

  /**
   * As pessoas da mesa da filial, corrigidas pela matriz.
   *
   * `definirPessoas` também confere só o restaurante. O número não muda o
   * total, muda a **divisão** — é por ele que a tela de fechamento diz quanto
   * cada um paga, e é essa tela que o cliente está olhando quando a conta
   * chega à mesa. Mexer nele de outra cidade troca a divisão no meio da
   * conversa, e o garçom de lá não tem como saber por quê.
   */
  it("a matriz não corrige as pessoas da mesa da filial", async () => {
    const { comandaId } = await montarFilial();

    const t = await tentar(B.gerentes[0]!, () => definirPessoas(comandaId, 9));

    const depois = await admin.comanda.findUniqueOrThrow({
      where: { id: comandaId },
      select: { pessoas: true },
    });
    await desmontarFilial();

    expect({ porQue: porQue(t), pessoas: depois.pessoas }).toEqual({
      porQue: "Comanda de outra unidade.",
      pessoas: 2,
    });
  });
  /**
   * O perfil fiscal da filial, reescrito pela matriz.
   *
   * `salvarPerfil` recebe o `perfilId` do navegador e confere **só o
   * restaurante** (`src/app/gestao/fiscal/actions.ts`), embora o perfil seja
   * da unidade: ele nasce com `unidadeId: sessao.unidadeId` e a tela Fiscal
   * lista só os da unidade da sessão.
   *
   * O que se reescreve daqui é CFOP, CSOSN/CST e as alíquotas de ICMS, PIS e
   * COFINS — o que a NFC-e declara à SEFAZ no nome da empresa. Toda nota que
   * a filial emitir depois sai com o imposto de outra, e na tela de lá nada
   * mudou de lugar: o perfil simplesmente passou a dizer outra coisa, sem
   * autor e sem aviso. É o caso mais caro desta família, porque o erro só
   * aparece na apuração do contador, semanas depois.
   */
  it("a matriz não reescreve o perfil fiscal da filial", async () => {
    const { unidadeId } = await montarFilial();
    const perfil = await admin.perfilFiscal.create({
      data: {
        tenantId: B.tenant.id,
        unidadeId,
        nome: "Perfil da filial",
        cfop: "5102",
        csosn: "102",
        aliquotaIcms: 0,
        padrao: true,
      },
    });

    const t = await tentar(B.proprietario, () =>
      salvarPerfil(
        {
          nome: "Perfil reescrito de longe",
          cfop: "6108",
          origemMercadoria: 0,
          csosn: "500",
          cstIcms: "",
          aliquotaIcms: 18,
          cstPis: "49",
          aliquotaPis: 0,
          cstCofins: "49",
          aliquotaCofins: 0,
          padrao: false,
        },
        perfil.id
      )
    );

    const depois = await admin.perfilFiscal.findUniqueOrThrow({ where: { id: perfil.id } });
    await admin.perfilFiscal.deleteMany({ where: { unidadeId } });
    await desmontarFilial();

    expect({
      porQue: porQue(t),
      nome: depois.nome,
      cfop: depois.cfop,
      csosn: depois.csosn,
      icms: Number(depois.aliquotaIcms),
    }).toEqual({
      porQue: "Perfil não encontrado.",
      nome: "Perfil da filial",
      cfop: "5102",
      csosn: "102",
      icms: 0,
    });
  });


});

/**
 * O cadastro da retaguarda recebendo id de fora.
 *
 * O PDV e a maquininha já conferem cada id que o navegador manda. A retaguarda
 * — onde se cadastra mesa, produto, ficha técnica e papel — faz isso em
 * algumas portas e não em outras: `vincularProduto` confere o produto com um
 * comentário citando a regra, e as vizinhas de arquivo não conferem nada.
 *
 * O que está em jogo é o que a memória do projeto chama de "chave estrangeira
 * ignora o RLS": o Postgres valida a referência com os privilégios do dono da
 * tabela, então o banco **aceita apontar** para uma linha que ele próprio
 * esconderia numa consulta. Quem segura isso é o código.
 */
describe("o cadastro da retaguarda com id de fora", () => {
  /**
   * Uma mesa só desta bateria, para não brigar com as contas dos outros testes.
   *
   * O número é 9901 e não 901: a bateria da maquininha cria mesas a partir de
   * 901, e o número é único por unidade — a primeira versão deste teste
   * quebrava por isso, e a falha era minha, não do sistema.
   */
  async function mesaDeProva() {
    const area = await admin.area.findFirstOrThrow({ where: { unidadeId: A.unidade.id } });
    const mesa = await admin.mesa.create({
      data: {
        tenantId: A.tenant.id,
        unidadeId: A.unidade.id,
        areaId: area.id,
        numero: "9901",
        capacidade: 4,
        qrToken: `qr-prova-${Date.now()}`,
      },
    });
    return { mesa, areaId: area.id };
  }

  function dadosDeProduto(sobre: Partial<DadosProduto> = {}): DadosProduto {
    return {
      titulo: "Produto de prova",
      codigo: "",
      categoriaId: "",
      preco: 10,
      descricao: "",
      exigePontoCarne: false,
      ncm: "",
      cest: "",
      perfilFiscalId: "",
      maiorDeIdade: false,
      estacaoId: "",
      ...sobre,
    };
  }

  /** O produto que a tentativa criou, se criou — pelo título, que é só meu. */
  async function produtoCriado(titulo: string) {
    return admin.produto.findFirst({ where: { titulo }, include: { estacoes: true } });
  }

  /**
   * A mesa indo para a área do vizinho.
   *
   * `atualizarMesa` confere a mesa (`mesaDaUnidade`) e grava o `areaId` como
   * veio. A mesa é agrupada pela área no mapa do salão e na tela de mesas: uma
   * mesa pendurada numa área que a sessão não enxerga sai das duas telas — e
   * não há por onde trazê-la de volta, porque a tela que a editaria é a que
   * deixou de mostrá-la.
   */
  it("a mesa não muda para a área do vizinho", async () => {
    const { mesa, areaId } = await mesaDeProva();
    const areaDoVizinho = await admin.area.findFirstOrThrow({
      where: { unidadeId: B.unidade.id },
    });

    const t = await tentar(A.gerentes[0]!, () =>
      atualizarMesa({
        mesaId: mesa.id,
        numero: mesa.numero,
        capacidade: mesa.capacidade,
        areaId: areaDoVizinho.id,
      })
    );

    const depois = await admin.mesa.findUniqueOrThrow({ where: { id: mesa.id } });
    await admin.mesa.delete({ where: { id: mesa.id } });

    expect({
      recusou: recusou(t),
      area: depois.areaId === areaId ? "a própria" : "a do vizinho",
    }).toEqual({ recusou: true, area: "a própria" });
  });

  /**
   * O produto nascendo na praça de produção do vizinho.
   *
   * A praça (`Estacao`) é por **unidade**: é ela que decide em qual monitor o
   * ticket aparece e em qual impressora o papel sai. Um produto apontado para
   * a praça de outra casa manda o pedido para uma cozinha que não é a dele —
   * ou, se a outra casa não imprime, para nenhuma.
   */
  it("o produto não nasce na praça de produção do vizinho", async () => {
    const titulo = `Prova praca ${Date.now()}`;
    const estacaoDoVizinho = await admin.estacao.findFirstOrThrow({
      where: { unidadeId: B.unidade.id },
    });

    const t = await tentar(A.gerentes[0]!, () =>
      criarProduto(dadosDeProduto({ titulo, estacaoId: estacaoDoVizinho.id }))
    );

    const criado = await produtoCriado(titulo);
    if (criado) await admin.produto.delete({ where: { id: criado.id } });

    expect({
      recusou: recusou(t),
      pracas: criado?.estacoes.map((e) => (e.estacaoId === estacaoDoVizinho.id ? "do vizinho" : "propria")) ?? [],
    }).toEqual({ recusou: true, pracas: [] });
  });

  /**
   * O produto nascendo na categoria do vizinho.
   *
   * A categoria é do restaurante, e é por ela que a tela de produtos e o
   * cardápio agrupam. Apontando para a de fora, o produto cai num grupo cujo
   * nome esta sessão não lê — a linha aparece sem categoria ou não aparece,
   * conforme a tela.
   */
  it("o produto não nasce na categoria do vizinho", async () => {
    const titulo = `Prova categoria ${Date.now()}`;
    const categoriaDoVizinho = await admin.categoriaProduto.findFirstOrThrow({
      where: { tenantId: B.tenant.id },
    });

    const t = await tentar(A.gerentes[0]!, () =>
      criarProduto(dadosDeProduto({ titulo, categoriaId: categoriaDoVizinho.id }))
    );

    const criado = await produtoCriado(titulo);
    if (criado) await admin.produto.delete({ where: { id: criado.id } });

    expect({ recusou: recusou(t), categoria: criado?.categoriaId ?? null }).toEqual({
      recusou: true,
      categoria: null,
    });
  });

  /**
   * O produto herdando o perfil fiscal do vizinho.
   *
   * O perfil fiscal carrega CFOP, CST/CSOSN e alíquotas: é o que a NFC-e
   * declara à SEFAZ. Emitir nota com o perfil de outra empresa é número errado
   * em documento fiscal — e o perfil é por unidade, então nem dentro da mesma
   * rede vale pegar o da filial.
   */
  it("o produto não herda o perfil fiscal do vizinho", async () => {
    const titulo = `Prova fiscal ${Date.now()}`;
    const perfilDoVizinho = await admin.perfilFiscal.create({
      data: {
        tenantId: B.tenant.id,
        unidadeId: B.unidade.id,
        nome: "Perfil do vizinho",
        cfop: "5102",
      },
    });

    const t = await tentar(A.gerentes[0]!, () =>
      criarProduto(dadosDeProduto({ titulo, perfilFiscalId: perfilDoVizinho.id }))
    );

    const criado = await produtoCriado(titulo);
    if (criado) await admin.produto.delete({ where: { id: criado.id } });
    await admin.perfilFiscal.delete({ where: { id: perfilDoVizinho.id } });

    expect({ recusou: recusou(t), perfil: criado?.perfilFiscalId ?? null }).toEqual({
      recusou: true,
      perfil: null,
    });
  });

  /** O mesmo perfil de fora, agora pela edição de um produto que já existe. */
  it("o produto editado não passa a usar o perfil fiscal do vizinho", async () => {
    const meu = A.itens[0]!;
    const perfilDoVizinho = await admin.perfilFiscal.create({
      data: {
        tenantId: B.tenant.id,
        unidadeId: B.unidade.id,
        nome: "Perfil do vizinho",
        cfop: "5102",
      },
    });

    const t = await tentar(A.gerentes[0]!, () =>
      atualizarProduto(
        meu.produtoId,
        dadosDeProduto({ titulo: meu.titulo, preco: meu.preco, perfilFiscalId: perfilDoVizinho.id })
      )
    );

    const depois = await admin.produto.findUniqueOrThrow({ where: { id: meu.produtoId } });
    await admin.produto.update({ where: { id: meu.produtoId }, data: { perfilFiscalId: null } });
    await admin.perfilFiscal.delete({ where: { id: perfilDoVizinho.id } });

    expect({ recusou: recusou(t), perfil: depois.perfilFiscalId ?? null }).toEqual({
      recusou: true,
      perfil: null,
    });
  });

  /**
   * A ficha técnica consumindo o insumo do vizinho.
   *
   * É a pior das portas desta tela, porque o estrago é automático: a cada
   * venda, `baixarVenda` percorre a composição e grava um movimento de estoque
   * **por insumo**. Com um insumo de fora, cada espeto vendido aqui lança
   * movimento e saldo contra um produto de outra empresa.
   */
  it("a ficha técnica não consome o insumo do vizinho", async () => {
    const meu = A.itens.find((i) => !i.controlaEstoque)!;
    const insumoDoVizinho = B.itens.find((i) => i.controlaEstoque)!;

    const t = await tentar(A.gerentes[0]!, () =>
      salvarComposicao(meu.produtoId, [{ insumoId: insumoDoVizinho.produtoId, quantidade: 1 }])
    );

    const ficha = await admin.composicao.findMany({ where: { produtoId: meu.produtoId } });
    await admin.composicao.deleteMany({ where: { produtoId: meu.produtoId } });

    expect({
      recusou: recusou(t),
      atravessou: ficha.some((c) => c.insumoId === insumoDoVizinho.produtoId),
    }).toEqual({ recusou: true, atravessou: false });
  });

  /**
   * O papel da filial reimpresso e descartado pela matriz.
   *
   * `reimprimir` e `descartar` conferem só o restaurante, e o RLS é por
   * restaurante: a fila da filial existe para a sessão da matriz. Reimprimir
   * enfileira de novo **na unidade de origem** — o papel sai na outra cidade,
   * sozinho, de madrugada; descartar apaga da fila de lá um trabalho que
   * ninguém de lá resolveu.
   */
  /**
   * A praça ligada na térmica da outra casa.
   *
   * O vínculo praça → impressora é o que faz a comanda da cozinha sair na
   * térmica da cozinha. Com o id de fora, a comanda desta casa sairia na
   * impressora da outra cidade — de madrugada, para ninguém.
   */
  it("a praça não é ligada na impressora de outra unidade", async () => {
    const outra = await admin.unidade.create({
      data: {
        tenantId: B.tenant.id,
        codigo: "005",
        nome: "Filial da térmica",
        cidade: "Anápolis",
        uf: "GO",
        taxaServicoPct: 10,
        atuaLoja: true,
      },
    });
    const daOutra = await admin.impressora.create({
      data: {
        tenantId: B.tenant.id,
        unidadeId: outra.id,
        nome: "Térmica da filial",
        conexao: "rede",
        endereco: "10.9.9.9",
      },
    });
    const minhaPraca = await admin.estacao.findFirstOrThrow({ where: { unidadeId: B.unidade.id } });

    const t = await tentar(B.proprietario, () =>
      ligarPracaNaImpressora(minhaPraca.id, daOutra.id)
    );

    const depois = await admin.estacao.findUniqueOrThrow({ where: { id: minhaPraca.id } });
    await admin.impressora.delete({ where: { id: daOutra.id } });
    await admin.unidade.delete({ where: { id: outra.id } });

    expect({ porQue: porQue(t), ligou: depois.impressoraId }).toEqual({
      porQue: "Impressora de outra unidade.",
      ligou: null,
    });
  });

  /** E a praça de lá não é religada por quem está aqui. */
  it("a praça de outra unidade não é mexida daqui", async () => {
    const outra = await admin.unidade.create({
      data: {
        tenantId: B.tenant.id,
        codigo: "006",
        nome: "Filial da praça",
        cidade: "Anápolis",
        uf: "GO",
        taxaServicoPct: 10,
        atuaLoja: true,
      },
    });
    const pracaDeLa = await admin.estacao.create({
      data: { tenantId: B.tenant.id, unidadeId: outra.id, nome: "COZINHA DE LÁ" },
    });

    const t = await tentar(B.proprietario, () => ligarPracaNaImpressora(pracaDeLa.id, null));

    await admin.estacao.delete({ where: { id: pracaDeLa.id } });
    await admin.unidade.delete({ where: { id: outra.id } });

    expect(porQue(t)).toBe("Praça de outra unidade.");
  });

  /**
   * Apagar a impressora que uma praça usa.
   *
   * O banco recusaria com erro de chave estrangeira, que chega à tela como
   * falha de sistema — e a casa ficaria sem saber que bastava desligá-la.
   */
  it("impressora em uso por uma praça não é apagada", async () => {
    const minha = await admin.impressora.create({
      data: {
        tenantId: B.tenant.id,
        unidadeId: B.unidade.id,
        nome: "Térmica em uso",
        conexao: "rede",
        endereco: "10.0.0.5",
      },
    });
    const praca = await admin.estacao.findFirstOrThrow({ where: { unidadeId: B.unidade.id } });
    await admin.estacao.update({ where: { id: praca.id }, data: { impressoraId: minha.id } });

    const t = await tentar(B.proprietario, () => excluirImpressora(minha.id));

    const aindaExiste = await admin.impressora.count({ where: { id: minha.id } });
    await admin.estacao.update({ where: { id: praca.id }, data: { impressoraId: null } });
    await admin.impressora.delete({ where: { id: minha.id } });

    expect({ porQue: porQue(t), aindaExiste }).toEqual({
      porQue: "Esta impressora atende 1 praça(s). Troque a impressora delas antes de apagar — ou desligue-a.",
      aindaExiste: 1,
    });
  });

  it("a matriz não reimprime nem descarta o papel da filial", async () => {
    const unidade = await admin.unidade.create({
      data: {
        tenantId: B.tenant.id,
        codigo: "003",
        nome: "Filial da impressão",
        cidade: "Anápolis",
        uf: "GO",
        taxaServicoPct: 10,
        atuaLoja: true,
      },
    });
    const papel = await admin.filaImpressao.create({
      data: {
        tenantId: B.tenant.id,
        unidadeId: unidade.id,
        tipo: "CONFERENCIA",
        titulo: "Conferência da filial",
        conteudo: "nada que a matriz tenha pedido",
      },
    });

    const reimpressao = await tentar(B.gerentes[0]!, () => reimprimir(papel.id));
    const descarte = await tentar(B.gerentes[0]!, () => descartar(papel.id));

    const naFila = await admin.filaImpressao.findMany({ where: { unidadeId: unidade.id } });
    const depois = naFila.find((f) => f.id === papel.id)!;

    await admin.filaImpressao.deleteMany({ where: { unidadeId: unidade.id } });
    await admin.unidade.delete({ where: { id: unidade.id } });

    expect({
      reimpressaoRecusada: recusou(reimpressao),
      descarteRecusado: recusou(descarte),
      trabalhosNaFilaDaFilial: naFila.length,
      statusDoOriginal: depois.status,
    }).toEqual({
      reimpressaoRecusada: true,
      descarteRecusado: true,
      trabalhosNaFilaDaFilial: 1,
      statusDoOriginal: "PENDENTE",
    });
  });
});

/**
 * A gaveta aberta por dois toques ao mesmo tempo.
 *
 * `abrirCaixa` procura um caixa aberto na unidade e, se não achar, cria. Entre
 * as duas consultas não há trava nem índice único (`@@index([unidadeId,
 * status])` não é `@@unique`), e as duas pessoas que abrem a casa — o caixa que
 * chega às 17h e o gerente que confere o fundo — tocam no mesmo botão da mesma
 * barra, nos dois tablets, ao mesmo tempo.
 *
 * O teste roda numa unidade recém-criada, porque o `beforeAll` já abriu as
 * gavetas das duas casas do cenário.
 */
describe("duas pessoas abrindo a mesma gaveta", () => {
  it("dois toques em 'abrir caixa' no mesmo instante deixam uma gaveta só", async () => {
    const unidade = await admin.unidade.create({
      data: {
        tenantId: B.tenant.id,
        codigo: "004",
        nome: "Filial que vai abrir",
        cidade: "Anápolis",
        uf: "GO",
        taxaServicoPct: 10,
        atuaLoja: true,
      },
    });
    const usuario = await admin.usuario.create({
      data: {
        tenantId: B.tenant.id,
        nome: "caixa da filial",
        email: `caixa-filial-${Date.now()}@vizinho.com`,
        pinHash: await bcrypt.hash("9999", 4),
        unidades: { create: { unidadeId: unidade.id, cargoId: B.cargos.CAIXA! } },
      },
    });
    const cargo = await admin.cargo.findUniqueOrThrow({
      where: { id: B.cargos.CAIXA! },
      include: { permissoes: true },
    });

    const quem = { ...pessoa("caixa da filial", "9999", "10.4.0.9", "vizinho.frentfood.test"), usuarioId: usuario.id, cargo: "CAIXA" };
    await sessaoAssinada(quem, {
      usuarioId: usuario.id,
      tenantId: B.tenant.id,
      unidadeId: unidade.id,
      nome: quem.nome,
      cargo: "CAIXA",
      permissoes: cargo.permissoes.map((p) => p.chave),
    });

    // Os toques de verdade: a mesma ação, disparada ao mesmo tempo. Seis e não
    // dois — a janela entre o "procura aberto" e o "cria" é estreita, e com
    // dois toques ela se fecha sozinha na maioria das execuções.
    const toques = await Promise.all(
      Array.from({ length: 6 }, () => tentar(quem, () => abrirCaixa("NOITE", 200)))
    );

    const gavetas = await admin.caixa.findMany({
      where: { unidadeId: unidade.id, status: "ABERTO" },
    });

    await admin.caixa.deleteMany({ where: { unidadeId: unidade.id } });
    await admin.usuarioUnidade.deleteMany({ where: { unidadeId: unidade.id } });
    await admin.usuario.delete({ where: { id: usuario.id } });
    await admin.unidade.delete({ where: { id: unidade.id } });

    // Um dos dois pode ter sido recusado, e isso está certo: o que não pode é
    // a casa ficar com duas gavetas abertas, cada uma com metade do dinheiro.
    expect({
      gavetasAbertas: gavetas.length,
      algumRespondeu: toques.some((t) => !recusou(t)),
    }).toEqual({ gavetasAbertas: 1, algumRespondeu: true });
  });
});

/**
 * As duas portas da fila da contingência, ao mesmo tempo.
 *
 * A nota que a SEFAZ não recebeu fica guardada esperando transmissão, e a
 * transmissão tem dois gatilhos de propósito: o botão da retaguarda, para quem
 * está olhando a tela, e `POST /api/fiscal/contingencia`, para o agendador que
 * passa a cada poucos minutos com o token da unidade.
 *
 * Nada impede que os dois caiam na mesma nota no mesmo segundo — e é o encontro
 * mais provável que existe, porque o dono aperta o botão justamente quando
 * percebe que a internet voltou, que é quando o agendador também está passando.
 *
 * Duas transmissões da mesma nota não são um papel a mais: é o mesmo documento
 * fiscal entrando duas vezes na SEFAZ, com a resposta da segunda sobrescrevendo
 * a da primeira aqui dentro.
 */
describe("a fila da contingência com duas pessoas puxando", () => {
  it("o botão da tela e o agendador juntos transmitem a nota uma vez só", async () => {
    const TOKEN = `agendador-${Date.now()}`;
    const unidade = await admin.unidade.create({
      data: {
        tenantId: B.tenant.id,
        codigo: "005",
        nome: "Casa que emite",
        razaoSocial: "Casa Que Emite LTDA",
        cidade: "Anápolis",
        uf: "GO",
        cnpj: "11222333000181",
        inscricaoEstadual: "123456789",
        emiteNfce: true,
        ambienteFiscal: "HOMOLOGACAO",
        serieNfce: 1,
        taxaServicoPct: 0,
        atuaLoja: true,
        tokenImpressao: TOKEN,
      },
    });
    const perfil = await admin.perfilFiscal.create({
      data: { tenantId: B.tenant.id, unidadeId: unidade.id, nome: "Padrão", cfop: "5102", padrao: true },
    });
    const produto = await admin.produto.create({
      data: {
        tenantId: B.tenant.id,
        titulo: "Prato com NCM",
        unidadeMedida: "UN",
        // NCM válido: sem ele o emissor recusa de propósito, e a recusa
        // esconderia a corrida atrás de um motivo que não é o do teste.
        ncm: "21069090",
        perfilFiscalId: perfil.id,
      },
    });
    const usuario = await admin.usuario.create({
      data: {
        tenantId: B.tenant.id,
        nome: "dona da casa que emite",
        email: `fiscal-${Date.now()}@vizinho.com`,
        pinHash: await bcrypt.hash("8888", 4),
        unidades: { create: { unidadeId: unidade.id, cargoId: B.cargos.PROPRIETARIO! } },
      },
    });
    const cargo = await admin.cargo.findUniqueOrThrow({
      where: { id: B.cargos.PROPRIETARIO! },
      include: { permissoes: true },
    });
    const quem = {
      ...pessoa("dona da casa que emite", "8888", "10.5.0.9", "vizinho.frentfood.test"),
      usuarioId: usuario.id,
      cargo: "PROPRIETARIO",
    };
    await sessaoAssinada(quem, {
      usuarioId: usuario.id,
      tenantId: B.tenant.id,
      unidadeId: unidade.id,
      nome: quem.nome,
      cargo: "PROPRIETARIO",
      permissoes: cargo.permissoes.map((p) => p.chave),
    });

    // Uma venda paga, com o pagamento batendo o total: o emissor confere a
    // soma, e divergência viraria rejeição em vez de autorização.
    const comanda = await admin.comanda.create({
      data: {
        tenantId: B.tenant.id,
        unidadeId: unidade.id,
        numero: 1,
        pessoas: 1,
        status: "PAGA",
        taxaServicoPct: 0,
        abertaPorId: usuario.id,
        itens: {
          create: {
            tenantId: B.tenant.id,
            produtoId: produto.id,
            quantidade: 1,
            precoUnitario: 100,
            precoTotal: 100,
            status: "ENTREGUE",
            lancadoPorId: usuario.id,
          },
        },
        pagamentos: {
          create: {
            tenantId: B.tenant.id,
            formaPagamentoId: B.formas.pix.id,
            valor: 100,
            troco: 0,
            taxaPct: 0,
            taxaValor: 0,
            usuarioId: usuario.id,
          },
        },
      },
    });

    // A nota nasce em contingência pelo caminho de verdade: a SEFAZ fora do ar
    // é o que guarda o documento para ser transmitido igual depois.
    await como(quem, () =>
      emitirNfce(comanda.id, usuario.id, {
        nome: "FORA",
        async emitir() {
          return { status: "INDISPONIVEL" as const, motivo: "Serviço da SEFAZ indisponível." };
        },
        async cancelar() {
          return { status: "RECUSADO" as const, motivo: "fora do ar" };
        },
      })
    );
    const parada = await admin.notaFiscal.findFirstOrThrow({ where: { unidadeId: unidade.id } });
    // Sem nota parada não há corrida para medir, e o resto do teste ficaria
    // verde por falta de assunto.
    if (parada.status !== "CONTINGENCIA") {
      throw new Error(`a nota do teste não ficou em contingência: ${parada.status}`);
    }

    // O botão e o agendador no mesmo instante, cada um pela sua porta.
    const pedido = new NextRequest("http://vizinho.frentfood.test/api/fiscal/contingencia", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    await Promise.all([
      tentar(quem, () => transmitirContingencia()),
      POSTContingencia(pedido).catch(() => null),
    ]);

    const depois = await admin.notaFiscal.findUniqueOrThrow({ where: { id: parada.id } });
    // O papel **da transmissão**, e não todos os desta nota: a venda em
    // contingência entrega um cupom ao cliente na hora, de propósito, e
    // contar os dois esconderia a transmissão repetida que se persegue aqui.
    const danfes = await admin.filaImpressao.count({
      where: {
        unidadeId: unidade.id,
        tipo: "DANFE_NFCE",
        referenciaId: parada.id,
        titulo: { contains: "transmitida" },
      },
    });
    // E o cliente saiu com o cupom dele: é a exigência legal que a emissão
    // offline passou a cumprir.
    const cupomDoCliente = await admin.filaImpressao.count({
      where: {
        unidadeId: unidade.id,
        tipo: "DANFE_NFCE",
        referenciaId: parada.id,
        titulo: { contains: "(contingência)" },
      },
    });

    await admin.filaImpressao.deleteMany({ where: { unidadeId: unidade.id } });
    await admin.notaFiscal.deleteMany({ where: { unidadeId: unidade.id } });
    await admin.pagamento.deleteMany({ where: { comandaId: comanda.id } });
    await admin.comanda.deleteMany({ where: { unidadeId: unidade.id } });
    await admin.usuarioUnidade.deleteMany({ where: { unidadeId: unidade.id } });
    await admin.usuario.delete({ where: { id: usuario.id } });
    await admin.produto.delete({ where: { id: produto.id } });
    await admin.perfilFiscal.delete({ where: { id: perfil.id } });
    await admin.unidade.delete({ where: { id: unidade.id } });

    // Uma transmissão, uma autorização, um papel. Duas idas à SEFAZ com o
    // mesmo documento é nota duplicada lá, com prazo e multa deste lado.
    expect({ status: depois.status, tentativas: depois.tentativas, danfes, cupomDoCliente }).toEqual({
      status: "AUTORIZADA",
      tentativas: 1,
      danfes: 1,
      cupomDoCliente: 1,
    });
  });
});

describe("dois caixas fechando contas no mesmo instante", () => {
  /**
   * A numeração da NFC-e é `max + 1`, lida fora de qualquer trava.
   *
   * Dois caixas tocando "finalizar" no mesmo segundo é o sábado inteiro, e
   * `reservarNumero` (`src/lib/fiscal/emitir.ts:34`) lê o maior número da série
   * e soma um. As duas leituras veem o mesmo máximo, as duas tentam gravar o
   * mesmo número, e a tabela tem `@@unique([unidadeId, serie, numero])` — então
   * a segunda gravação estoura.
   *
   * O estouro acontece **antes** do `try` que protege a conversa com a SEFAZ, e
   * sobe por uma função cujo contrato diz "nunca lança". Quem chama
   * (`lib/conta.ts:364`) engole num `console.error`, porque a conta já foi paga
   * e o cliente não pode ser segurado na porta — e aí a venda termina **sem
   * nota nenhuma e sem linha no banco**: a tela Fiscal lista notas, e uma venda
   * que não gerou nota não aparece em lugar nenhum.
   *
   * O certo é as duas vendas saírem com nota, em números seguidos. A série
   * não pode ter buraco nem repetição — e muito menos venda sem documento.
   */
  it("as duas vendas saem com nota, em números diferentes", async () => {
    const unidade = await admin.unidade.create({
      data: {
        tenantId: B.tenant.id,
        codigo: "006",
        nome: "Casa de dois caixas",
        razaoSocial: "Casa De Dois Caixas LTDA",
        cidade: "Anápolis",
        uf: "GO",
        cnpj: "11222333000181",
        inscricaoEstadual: "123456789",
        emiteNfce: true,
        ambienteFiscal: "HOMOLOGACAO",
        serieNfce: 1,
        taxaServicoPct: 0,
        atuaLoja: true,
      },
    });
    const perfil = await admin.perfilFiscal.create({
      data: { tenantId: B.tenant.id, unidadeId: unidade.id, nome: "Padrão", cfop: "5102", padrao: true },
    });
    const produto = await admin.produto.create({
      data: {
        tenantId: B.tenant.id,
        titulo: "Prato com NCM",
        unidadeMedida: "UN",
        // Sem NCM o emissor recusa de propósito, e a recusa esconderia a
        // corrida atrás de um motivo que não é o deste teste.
        ncm: "21069090",
        perfilFiscalId: perfil.id,
      },
    });
    const usuario = await admin.usuario.create({
      data: {
        tenantId: B.tenant.id,
        nome: "dona da casa de dois caixas",
        email: `doiscaixas-${Date.now()}@vizinho.com`,
        pinHash: await bcrypt.hash("8787", 4),
        unidades: { create: { unidadeId: unidade.id, cargoId: B.cargos.PROPRIETARIO! } },
      },
    });
    const cargo = await admin.cargo.findUniqueOrThrow({
      where: { id: B.cargos.PROPRIETARIO! },
      include: { permissoes: true },
    });
    const quem = {
      ...pessoa("dona da casa de dois caixas", "8787", "10.5.0.11", "vizinho.frentfood.test"),
      usuarioId: usuario.id,
      cargo: "PROPRIETARIO",
    };
    await sessaoAssinada(quem, {
      usuarioId: usuario.id,
      tenantId: B.tenant.id,
      unidadeId: unidade.id,
      nome: quem.nome,
      cargo: "PROPRIETARIO",
      permissoes: cargo.permissoes.map((p) => p.chave),
    });

    /** Duas contas pagas, em mesas diferentes, prontas para virar nota. */
    const umaConta = async (numero: number) =>
      admin.comanda.create({
        data: {
          tenantId: B.tenant.id,
          unidadeId: unidade.id,
          numero,
          pessoas: 2,
          status: "PAGA",
          taxaServicoPct: 0,
          abertaPorId: usuario.id,
          itens: {
            create: {
              tenantId: B.tenant.id,
              produtoId: produto.id,
              quantidade: 1,
              precoUnitario: 50,
              precoTotal: 50,
              status: "ENTREGUE",
              lancadoPorId: usuario.id,
            },
          },
          pagamentos: {
            create: {
              tenantId: B.tenant.id,
              formaPagamentoId: B.formas.pix.id,
              valor: 50,
              troco: 0,
              taxaPct: 0,
              taxaValor: 0,
              usuarioId: usuario.id,
            },
          },
        },
      });

    const contaA = await umaConta(901);
    const contaB = await umaConta(902);

    // Os dois caixas no mesmo instante. O emissor é o simulado, que autoriza:
    // o que se mede aqui é a numeração, não a resposta da SEFAZ.
    const idas = await Promise.all([
      como(quem, () => emitirNfce(contaA.id, usuario.id)).catch((e) =>
        e instanceof Error ? `estourou: ${e.message}` : String(e)
      ),
      como(quem, () => emitirNfce(contaB.id, usuario.id)).catch((e) =>
        e instanceof Error ? `estourou: ${e.message}` : String(e)
      ),
    ]);

    const notas = await admin.notaFiscal.findMany({
      where: { unidadeId: unidade.id },
      orderBy: { numero: "asc" },
      select: { numero: true, status: true, comandaId: true },
    });

    await admin.filaImpressao.deleteMany({ where: { unidadeId: unidade.id } });
    await admin.notaFiscal.deleteMany({ where: { unidadeId: unidade.id } });
    await admin.pagamento.deleteMany({ where: { comandaId: { in: [contaA.id, contaB.id] } } });
    await admin.comandaItem.deleteMany({ where: { comandaId: { in: [contaA.id, contaB.id] } } });
    await admin.comanda.deleteMany({ where: { unidadeId: unidade.id } });
    await admin.usuarioUnidade.deleteMany({ where: { unidadeId: unidade.id } });
    await admin.usuario.delete({ where: { id: usuario.id } });
    await admin.produto.delete({ where: { id: produto.id } });
    await admin.perfilFiscal.delete({ where: { id: perfil.id } });
    await admin.unidade.delete({ where: { id: unidade.id } });

    // Duas vendas, duas notas, números 1 e 2. E nenhuma das duas chamadas
    // estourou: `emitirNfce` promete não lançar, e quem a chama conta com isso.
    expect({
      notas: notas.map((n) => ({ numero: n.numero, status: n.status })),
      comandasComNota: new Set(notas.map((n) => n.comandaId)).size,
      estouros: idas.filter((r) => typeof r === "string").length,
    }).toEqual({
      notas: [
        { numero: 1, status: "AUTORIZADA" },
        { numero: 2, status: "AUTORIZADA" },
      ],
      comandasComNota: 2,
      estouros: 0,
    });
  });
});

describe("dois toques em 'reemitir' na mesma venda", () => {
  /**
   * `emitirNfce` recusa a segunda nota da mesma comanda — mas lendo antes de
   * gravar, sem nada entre as duas coisas.
   *
   * A conferência (`src/lib/fiscal/emitir.ts`, `jaEmitida`) procura nota
   * AUTORIZADA, PROCESSANDO ou CONTINGENCIA da comanda e só então grava a
   * linha nova. Duas chamadas no mesmo instante passam as duas pela
   * conferência, porque nenhuma das duas gravou ainda — e a venda termina com
   * **duas notas fiscais**, as duas autorizadas na SEFAZ, para um cliente só.
   *
   * O botão existe e é de tocar duas vezes: a tela Fiscal oferece "reemitir"
   * justamente para a nota que deu errado, e quem está olhando uma nota
   * recusada toca, não vê resposta e toca de novo. Pelo caixa é o mesmo: duas
   * abas, dois toques em "finalizar".
   *
   * Nota em duplicidade é o problema fiscal mais caro que existe neste módulo:
   * a casa recolhe imposto duas vezes sobre a mesma venda, e desfazer pede
   * cancelamento dentro da janela da SEFAZ.
   */
  it("a venda termina com uma nota, não duas", async () => {
    const unidade = await admin.unidade.create({
      data: {
        tenantId: B.tenant.id,
        codigo: "007",
        nome: "Casa do reemitir",
        razaoSocial: "Casa Do Reemitir LTDA",
        cidade: "Anápolis",
        uf: "GO",
        cnpj: "11222333000181",
        inscricaoEstadual: "123456789",
        emiteNfce: true,
        ambienteFiscal: "HOMOLOGACAO",
        serieNfce: 1,
        taxaServicoPct: 0,
        atuaLoja: true,
      },
    });
    const perfil = await admin.perfilFiscal.create({
      data: { tenantId: B.tenant.id, unidadeId: unidade.id, nome: "Padrão", cfop: "5102", padrao: true },
    });
    const produto = await admin.produto.create({
      data: {
        tenantId: B.tenant.id,
        titulo: "Prato com NCM",
        unidadeMedida: "UN",
        ncm: "21069090",
        perfilFiscalId: perfil.id,
      },
    });
    const usuario = await admin.usuario.create({
      data: {
        tenantId: B.tenant.id,
        nome: "dona da casa do reemitir",
        email: `reemitir-${Date.now()}@vizinho.com`,
        pinHash: await bcrypt.hash("8686", 4),
        unidades: { create: { unidadeId: unidade.id, cargoId: B.cargos.PROPRIETARIO! } },
      },
    });
    const cargo = await admin.cargo.findUniqueOrThrow({
      where: { id: B.cargos.PROPRIETARIO! },
      include: { permissoes: true },
    });
    const quem = {
      ...pessoa("dona da casa do reemitir", "8686", "10.5.0.12", "vizinho.frentfood.test"),
      usuarioId: usuario.id,
      cargo: "PROPRIETARIO",
    };
    await sessaoAssinada(quem, {
      usuarioId: usuario.id,
      tenantId: B.tenant.id,
      unidadeId: unidade.id,
      nome: quem.nome,
      cargo: "PROPRIETARIO",
      permissoes: cargo.permissoes.map((p) => p.chave),
    });

    const comanda = await admin.comanda.create({
      data: {
        tenantId: B.tenant.id,
        unidadeId: unidade.id,
        numero: 903,
        pessoas: 2,
        status: "PAGA",
        taxaServicoPct: 0,
        abertaPorId: usuario.id,
        itens: {
          create: {
            tenantId: B.tenant.id,
            produtoId: produto.id,
            quantidade: 1,
            precoUnitario: 70,
            precoTotal: 70,
            status: "ENTREGUE",
            lancadoPorId: usuario.id,
          },
        },
        pagamentos: {
          create: {
            tenantId: B.tenant.id,
            formaPagamentoId: B.formas.pix.id,
            valor: 70,
            troco: 0,
            taxaPct: 0,
            taxaValor: 0,
            usuarioId: usuario.id,
          },
        },
      },
    });

    // Os dois toques no mesmo instante, pela porta da retaguarda — o botão
    // "reemitir" da tela Fiscal, que é onde o dedo repete.
    await Promise.all([
      tentar(quem, () => reemitirNota(comanda.id)),
      tentar(quem, () => reemitirNota(comanda.id)),
    ]);

    const notas = await admin.notaFiscal.findMany({
      where: { comandaId: comanda.id },
      orderBy: { numero: "asc" },
      select: { numero: true, status: true },
    });

    await admin.filaImpressao.deleteMany({ where: { unidadeId: unidade.id } });
    await admin.notaFiscal.deleteMany({ where: { unidadeId: unidade.id } });
    await admin.pagamento.deleteMany({ where: { comandaId: comanda.id } });
    await admin.comandaItem.deleteMany({ where: { comandaId: comanda.id } });
    await admin.comanda.deleteMany({ where: { unidadeId: unidade.id } });
    await admin.usuarioUnidade.deleteMany({ where: { unidadeId: unidade.id } });
    await admin.usuario.delete({ where: { id: usuario.id } });
    await admin.produto.delete({ where: { id: produto.id } });
    await admin.perfilFiscal.delete({ where: { id: perfil.id } });
    await admin.unidade.delete({ where: { id: unidade.id } });

    // Uma venda, uma nota. A segunda chamada pode recusar — o que ela não pode
    // é gravar um segundo documento fiscal da mesma venda.
    expect(notas.map((n) => ({ numero: n.numero, status: n.status }))).toEqual([
      { numero: 1, status: "AUTORIZADA" },
    ]);
  });
});
