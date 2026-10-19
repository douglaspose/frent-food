import { db } from "@/lib/db";
import { calcularTotais, centavos } from "@/lib/comanda";
import { sessaoDaTela } from "@/lib/session";
import { dadosDaBarra } from "@/lib/barra";
import { lerAjustes } from "@/lib/parametros-servidor";
import { BarraAmbientes } from "./barra-ambientes";
import { MapaMesas, type MesaView } from "./mapa-mesas";

export const dynamic = "force-dynamic";

export default async function PdvMesasPage() {
  const sessao = await sessaoDaTela();
  const ajustes = await lerAjustes(sessao.unidadeId, [
    "mesa.alertaSemLancamentoMin",
    "mesa.voltarParaAreasAoFechar",
  ]);

  const unidade = await db.unidade.findFirst({
    where: { id: sessao.unidadeId },
    include: {
      areas: {
        where: { ativo: true },
        orderBy: { ordem: "asc" },
        include: { mesas: { where: { ativo: true } } },
      },
    },
  });

  if (!unidade) {
    return (
      <main className="flex min-h-tela items-center justify-center p-6 text-center">
        <p className="text-neutral-400">
          Nenhuma unidade encontrada. Rode <code className="text-orange-400">npm run db:seed</code>.
        </p>
      </main>
    );
  }

  // Uma consulta para todas as comandas abertas, em vez de uma por mesa.
  const comandas = await db.comanda.findMany({
    where: { unidadeId: unidade.id, status: { in: ["ABERTA", "FECHANDO"] } },
    include: {
      itens: { where: { status: { not: "CANCELADO" } }, select: { status: true, precoTotal: true } },
      pagamentos: { select: { valor: true, troco: true } },
    },
  });

  /*
   * As comandas sem mesa, que o mapa não tinha onde desenhar.
   *
   * Venda de balcão não ocupa mesa, então ela não existia em tela nenhuma do
   * salão — e `fecharCaixa` recusa enquanto houver comanda aberta na unidade.
   * O caixa terminava a noite lendo "ainda há 1 comanda(s) aberta(s)" sobre
   * uma comanda que ninguém conseguia achar.
   *
   * Aqui elas viram uma faixa com o que o caixa precisa para decidir: quanto,
   * desde quando, e se o pagamento já entrou — pago e aberto é problema de
   * fechamento; aberto e sem pagamento é a maquininha que ainda vai reenviar,
   * ou uma venda recusada que ficou para trás.
   */
  const semMesa = comandas
    .filter((c) => !c.mesaId)
    .map((c) => {
      /*
       * O total é o da conta, não a soma dos itens.
       *
       * Somando os itens, a faixa prometia R$ 20 numa venda de R$ 20 que tinha
       * ganhado R$ 5 de desconto, e o botão "Receber R$ 20,00" batia na recusa
       * certa de quem confere a conta de verdade. `calcularTotais` é a mesma
       * régua do resto do sistema; `falta` é o que esta porta vai receber.
       */
      const { total } = calcularTotais({
        itens: c.itens
          .filter((i) => i.status !== "PENDENTE")
          .map((i) => ({ precoTotal: Number(i.precoTotal) })),
        taxaServicoPct: Number(c.taxaServicoPct),
        descontoValor: Number(c.descontoValor),
      });
      const recebido = centavos(
        c.pagamentos.reduce((soma, p) => soma + Number(p.valor) - Number(p.troco), 0)
      );
      return {
        id: c.id,
        numero: c.numero,
        origem: c.origem,
        total,
        recebido,
        falta: centavos(Math.max(0, total - recebido)),
        abertaEm: c.abertaEm.toISOString(),
      };
    });

  const porMesa = new Map(
    comandas.filter((c) => c.mesaId).map((c) => {
      const pendentes = c.itens.filter((i) => i.status === "PENDENTE");
      const enviados = c.itens.filter((i) => i.status !== "PENDENTE");

      return [
        c.mesaId!,
        {
          id: c.id,
          // O carrinho ainda não é consumo: só entra na conta depois de enviado.
          total: enviados.reduce((soma, i) => soma + Number(i.precoTotal), 0),
          abertaEm: c.abertaEm.toISOString(),
          pessoas: c.pessoas,
          itensNoCarrinho: pendentes.length,
          semPedido: enviados.length === 0,
          chamadoEm: c.chamadoGarcomEm?.toISOString() ?? null,
        },
      ];
    })
  );

  /*
   * As formas ativas, para a venda de balcão recebida à mão.
   *
   * Quem recebe não digita valor — é o da comanda —, mas escolhe a forma: é
   * ela que diz onde o dinheiro caiu e qual taxa a casa pagou naquela venda.
   */
  const formas =
    semMesa.length > 0
      ? await db.formaPagamento.findMany({
          where: { tenantId: unidade.tenantId, ativo: true },
          orderBy: { nome: "asc" },
          select: { id: true, nome: true },
        })
      : [];

  const areas = unidade.areas.map((area) => ({
    id: area.id,
    nome: area.nome,
    mesas: area.mesas
      // numero é texto (mesas podem se chamar "12A"), então ordena pelo valor numérico
      .sort((a, b) => Number(a.numero) - Number(b.numero) || a.numero.localeCompare(b.numero))
      .map<MesaView>((mesa) => ({
        id: mesa.id,
        numero: mesa.numero,
        capacidade: mesa.capacidade,
        status: mesa.status,
        comanda: porMesa.get(mesa.id) ?? null,
      })),
  }));

  return (
    <>
      <BarraAmbientes dados={await dadosDaBarra(sessao)} />
      <MapaMesas
        areas={areas}
        semMesa={semMesa}
        formasDePagamento={formas}
        ajustes={{
          alertaSemPedidoMin: Number(ajustes["mesa.alertaSemLancamentoMin"]),
          voltarParaAreas: Boolean(ajustes["mesa.voltarParaAreasAoFechar"]),
        }}
      />
    </>
  );
}
