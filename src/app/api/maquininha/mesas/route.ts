import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { declararTenant } from "@/lib/tenant-atual";
import { CONSUMO } from "@/lib/itens";
import { calcularTotais, centavos } from "@/lib/comanda";
import { operadorDaRequisicao, unidadeDoAparelho, podeNoAparelho } from "@/lib/maquininha";
import { abrirMesa, mesasLivres } from "@/lib/abertura";
import { ajusteBooleano } from "@/lib/parametros-servidor";
import { ErroDeOperacao } from "@/lib/erro-de-operacao";

export const dynamic = "force-dynamic";

/** Reais viram centavos na porta: dentro da maquininha tudo é inteiro. */
const emCentavos = (v: number) => Math.round(centavos(v) * 100);

/**
 * GET /api/maquininha/mesas — o salão: as contas abertas e as mesas livres.
 *
 * É a tela inicial de quem vai receber: mesa, quanto deu e quanto falta. Uma
 * consulta só para o salão inteiro, e não uma por mesa — num sábado são
 * dezenas de mesas abertas ao mesmo tempo.
 *
 * As livres vêm junto porque o garçom que chega com o aparelho na mão atende a
 * mesa que acabou de sentar: na mesma tela em que ele recebe, ele abre. Vinham
 * numa chamada à parte no primeiro rascunho, e o aparelho mostrava "nenhuma
 * mesa livre" por um instante toda vez que voltava para o salão.
 */
export async function GET(request: NextRequest) {
  const unidade = await unidadeDoAparelho(request);
  if (!unidade?.ativo) {
    return NextResponse.json({ erro: "Token do aparelho inválido." }, { status: 401 });
  }
  declararTenant(unidade.tenantId);

  const operador = await operadorDaRequisicao(request, unidade);
  if (!operador) {
    return NextResponse.json({ erro: "Sessão do operador expirada." }, { status: 401 });
  }

  const comandas = await db.comanda.findMany({
    where: { unidadeId: unidade.id, status: { in: ["ABERTA", "FECHANDO"] } },
    orderBy: [{ abertaEm: "asc" }],
    include: {
      mesa: { select: { numero: true } },
      itens: { where: CONSUMO, select: { precoTotal: true } },
      pagamentos: { select: { valor: true, troco: true } },
    },
  });

  /*
   * Sem a permissão, nem a lista: o botão de abrir não aparece no aparelho, e
   * mandar as mesas livres para quem não pode abrir seria dado inútil
   * trafegando a cada volta ao salão.
   */
  const podeAbrir = podeNoAparelho(operador.permissoes, "comanda.abrir");
  const livres = podeAbrir ? await mesasLivres(unidade.id) : [];
  /*
   * Quem não recebe pagamento não vê onde cobrar.
   *
   * O garçom entra no aparelho para lançar e abrir mesa; deixar os botões de
   * cobrança na tela dele seria oferecer um caminho que termina em 403 com o
   * cartão do cliente já na mão.
   */
  const podeReceber = podeNoAparelho(operador.permissoes, "comanda.receberPagamento");

  const caixaAberto = await db.caixa.findFirst({
    where: { unidadeId: unidade.id, tipo: "GERAL", status: "ABERTO" },
    select: { id: true },
  });

  /*
   * Quem pediu a conta vem primeiro: é a mesa que está esperando a maquininha.
   * Depois as demais, da mais antiga para a mais nova, que é a ordem em que
   * elas vão pedir.
   */
  const emOrdem = [...comandas].sort((a, b) => {
    const pediu = Number(b.status === "FECHANDO") - Number(a.status === "FECHANDO");
    return pediu !== 0 ? pediu : a.abertaEm.getTime() - b.abertaEm.getTime();
  });

  return NextResponse.json({
    unidade: unidade.nome,
    operador: operador.nome,
    // Sem caixa aberto nenhum pagamento entra. A maquininha avisa antes de o
    // cliente entregar o cartão, em vez de recusar depois de cobrar.
    caixaAberto: Boolean(caixaAberto),
    podeAbrir,
    podeReceber,
    /*
     * Pedir a conta é do garçom (`comanda.imprimirParcial`) e de quem vai
     * cobrar: o cargo CAIXA não tem a chave de impressão parcial, e recusar a
     * ele a folha que ele mesmo vai receber não faria sentido nenhum.
     */
    podePedirConta: podeNoAparelho(
      operador.permissoes,
      "comanda.imprimirParcial",
      "comanda.receberPagamento"
    ),
    livres,
    // A casa que exige o nome do cliente exige nas duas portas. O aparelho
    // precisa saber antes de perguntar — e não depois, com o erro na mão.
    exigeNomeCliente: podeAbrir
      ? await ajusteBooleano(unidade.id, "mesa.exigirIdentificacaoCliente")
      : false,
    mesas: emOrdem.map((c) => {
      const totais = calcularTotais({
        itens: c.itens.map((i) => ({ precoTotal: Number(i.precoTotal) })),
        taxaServicoPct: Number(c.taxaServicoPct),
        descontoValor: Number(c.descontoValor),
      });
      const recebido = centavos(
        c.pagamentos.reduce((soma, p) => soma + Number(p.valor) - Number(p.troco), 0)
      );
      return {
        comandaId: c.id,
        numero: c.numero,
        mesa: c.mesa ? `Mesa ${c.mesa.numero}` : null,
        nomeCliente: c.nomeCliente,
        pessoas: c.pessoas,
        fechando: c.status === "FECHANDO",
        abertaEm: c.abertaEm.toISOString(),
        totalEmCentavos: emCentavos(totais.total),
        recebidoEmCentavos: emCentavos(recebido),
        faltaEmCentavos: emCentavos(Math.max(0, totais.total - recebido)),
      };
    }),
  });
}

/**
 * POST /api/maquininha/mesas — o garçom abre a mesa pelo aparelho.
 *
 * Até aqui a maquininha só listava as contas já abertas: quem recebia uma mesa
 * nova tinha de voltar ao tablet do balcão para abri-la e só então lançar o
 * pedido. Com o aparelho na mão, a mesa que acabou de sentar vira conta ali
 * mesmo.
 *
 * A regra é a mesma do PDV (`@/lib/abertura`), inclusive a trava que protege a
 * numeração da comanda. **Repetir é seguro:** mesa que já tem conta aberta
 * devolve a conta que existe, com `jaEstavaAberta`, em vez de abrir a segunda
 * — vale para o reenvio de uma rede ruim e para os dois garçons que chegam
 * juntos na mesma mesa.
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

  const podeAbrir = podeNoAparelho(operador.permissoes, "comanda.abrir");
  if (!podeAbrir) {
    return NextResponse.json({ erro: "Seu acesso não permite abrir mesa." }, { status: 403 });
  }

  let corpo: { mesaId?: string; pessoas?: number; nomeCliente?: string | null };
  try {
    corpo = (await request.json()) as typeof corpo;
  } catch {
    return NextResponse.json({ erro: "Corpo inválido: envie JSON." }, { status: 400 });
  }

  if (typeof corpo?.mesaId !== "string" || !corpo.mesaId) {
    return NextResponse.json({ erro: "Mesa sem identificação." }, { status: 400 });
  }

  // A mesa é conferida aqui, antes de qualquer escrita: o aparelho guarda a
  // lista do salão, e uma mesa apagada no cadastro desde então merece "não
  // encontrada" em vez de erro genérico.
  const mesa = await db.mesa.findFirst({
    where: { id: corpo.mesaId, unidadeId: unidade.id },
    select: { id: true },
  });
  if (!mesa) return NextResponse.json({ erro: "Mesa não encontrada." }, { status: 404 });

  try {
    const { comandaId, jaEstavaAberta } = await abrirMesa(
      { usuarioId: operador.usuarioId, tenantId: unidade.tenantId, unidadeId: unidade.id },
      { mesaId: mesa.id, pessoas: corpo.pessoas ?? 0, nomeCliente: corpo.nomeCliente }
    );
    return NextResponse.json({ ok: true, comandaId, jaEstavaAberta });
  } catch (e) {
    // ErroDeOperacao é frase pronta para a tela ("Informe de 1 a 99 pessoas.");
    // o resto é defeito nosso e não vira texto na mão do garçom.
    if (e instanceof ErroDeOperacao) {
      return NextResponse.json({ erro: e.message }, { status: 409 });
    }
    console.error("Falha ao abrir mesa pela maquininha", e);
    return NextResponse.json({ erro: "Não foi possível abrir a mesa." }, { status: 500 });
  }
}
