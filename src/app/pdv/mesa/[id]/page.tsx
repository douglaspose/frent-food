import { BotaoVoltar } from "../../botao-voltar";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { exigirSessao, temPermissao } from "@/lib/session";
import { lerAjustes } from "@/lib/parametros-servidor";
import { ComandaScreen } from "./comanda-screen";
import { AbrirForm } from "./abrir-form";

export const dynamic = "force-dynamic";

export default async function MesaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const sessao = await exigirSessao();

  const ajustes = await lerAjustes(sessao.unidadeId, [
    "mesa.exibirNomeGarcomNosItens",
    "cozinha.voltarParaCategoriaAposLancar",
    "mesa.exigirIdentificacaoCliente",
  ]);

  const mesa = await db.mesa.findUnique({ where: { id }, include: { area: true } });
  // Mesa de outra unidade é tratada como inexistente — não confirma nem nega.
  if (!mesa || mesa.unidadeId !== sessao.unidadeId) notFound();

  const comanda = await db.comanda.findFirst({
    where: { mesaId: mesa.id, status: { in: ["ABERTA", "FECHANDO"] } },
    include: {
      abertaPor: { select: { nome: true } },
      itens: {
        where: { status: { not: "CANCELADO" } },
        orderBy: { lancadoEm: "asc" },
        include: {
          produto: { select: { titulo: true, exigePontoCarne: true } },
          lancadoPor: { select: { nome: true } },
        },
      },
    },
  });

  const cardapio = await db.cardapio.findFirst({
    where: { unidadeId: mesa.unidadeId, canal: "SALAO", ativo: true },
    include: {
      itens: {
        where: { visivel: true },
        // Categoria primeiro, item depois — senão o agrupamento sai na ordem
        // em que a primeira linha de cada categoria aparecer.
        orderBy: [{ categoria: { ordem: "asc" } }, { ordem: "asc" }],
        include: {
          categoria: true,
          produto: { select: { id: true, codigo: true, titulo: true, exigePontoCarne: true } },
        },
      },
    },
  });

  // Agrupa por categoria preservando a ordem definida no cadastro.
  const categorias = new Map<string, { id: string; nome: string; itens: CardapioItemView[] }>();
  for (const item of cardapio?.itens ?? []) {
    const cat = item.categoria;
    if (!cat) continue;
    if (!categorias.has(cat.id)) categorias.set(cat.id, { id: cat.id, nome: cat.nome, itens: [] });
    categorias.get(cat.id)!.itens.push({
      id: item.id,
      produtoId: item.produto.id,
      codigo: item.produto.codigo ?? "",
      titulo: item.produto.titulo,
      preco: Number(item.preco),
      esgotado: item.esgotado,
      exigePontoCarne: item.produto.exigePontoCarne,
    });
  }

  if (!comanda) {
    return (
      <AberturaDeMesa
        mesaId={mesa.id}
        numero={mesa.numero}
        area={mesa.area?.nome ?? null}
        capacidade={mesa.capacidade}
        exigeNome={Boolean(ajustes["mesa.exigirIdentificacaoCliente"])}
      />
    );
  }

  return (
    <ComandaScreen
      // Sem a permissão o botão nem aparece: no salão, ver um botão que
      // sempre recusa só faz o garçom clicar de novo mais forte.
      podeCancelar={temPermissao(sessao, "comanda.cancelarItem")}
      podeTransferir={temPermissao(sessao, "mesa.transferir")}
      ajustes={{
        exibirNomeGarcom: Boolean(ajustes["mesa.exibirNomeGarcomNosItens"]),
        limparBuscaAposLancar: Boolean(ajustes["cozinha.voltarParaCategoriaAposLancar"]),
      }}
      mesa={{ id: mesa.id, numero: mesa.numero, area: mesa.area?.nome ?? null }}
      comanda={{
        id: comanda.id,
        numero: comanda.numero,
        pessoas: comanda.pessoas,
        nomeCliente: comanda.nomeCliente,
        abertaEm: comanda.abertaEm.toISOString(),
        taxaServicoPct: Number(comanda.taxaServicoPct),
        itens: comanda.itens.map((i) => ({
          id: i.id,
          titulo: i.produto.titulo,
          quantidade: Number(i.quantidade),
          precoUnitario: Number(i.precoUnitario),
          precoTotal: Number(i.precoTotal),
          status: i.status,
          pontoCarne: i.pontoCarne,
          observacao: i.observacao,
          exigePontoCarne: i.produto.exigePontoCarne,
          lancadoEm: i.lancadoEm.toISOString(),
          lancadoPor: i.lancadoPor.nome,
        })),
        chamadoEm: comanda.chamadoGarcomEm?.toISOString() ?? null,
        status: comanda.status,
      }}
      categorias={[...categorias.values()]}
    />
  );
}

export type CardapioItemView = {
  id: string;
  produtoId: string;
  codigo: string;
  titulo: string;
  preco: number;
  esgotado: boolean;
  exigePontoCarne: boolean;
};

function AberturaDeMesa({
  mesaId,
  numero,
  area,
  capacidade,
  exigeNome,
}: {
  mesaId: string;
  numero: string;
  area: string | null;
  capacidade: number;
  exigeNome: boolean;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <BotaoVoltar href="/pdv" rotulo="Mesas" className="mb-6" />
      <h1 className="text-3xl font-bold">Mesa {numero}</h1>
      <p className="mt-1 text-sm text-neutral-500">
        {area ?? "Sem área"} · {capacidade} lugares · livre
      </p>
      <AbrirForm mesaId={mesaId} capacidade={capacidade} exigeNome={exigeNome} />
    </main>
  );
}
