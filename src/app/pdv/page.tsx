import { db } from "@/lib/db";
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
    },
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
        ajustes={{
          alertaSemPedidoMin: Number(ajustes["mesa.alertaSemLancamentoMin"]),
          voltarParaAreas: Boolean(ajustes["mesa.voltarParaAreasAoFechar"]),
        }}
      />
    </>
  );
}
