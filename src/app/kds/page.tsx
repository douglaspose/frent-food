import type { Metadata } from "next";
import { db } from "@/lib/db";
import { sessaoDaTela } from "@/lib/session";
import { dadosDaBarra } from "@/lib/barra";
import { BarraAmbientes } from "../pdv/barra-ambientes";
import { KdsBoard } from "./kds-board";

export const metadata: Metadata = { title: "KDS" };
export const dynamic = "force-dynamic";

export default async function KdsPage() {
  const sessao = await sessaoDaTela();
  const unidade = await db.unidade.findFirst({ where: { id: sessao.unidadeId } });
  if (!unidade) {
    return (
      <main className="flex min-h-tela items-center justify-center bg-neutral-950 text-neutral-400">
        Nenhuma unidade encontrada.
      </main>
    );
  }

  const [estacoes, pedidos, alerta] = await Promise.all([
    db.estacao.findMany({
      where: { unidadeId: unidade.id, ativo: true, tipo: { in: ["KDS", "AMBOS"] } },
      orderBy: { ordem: "asc" },
    }),
    db.pedido.findMany({
      // ENTREGUE sai do quadro: o que já foi para a mesa não ocupa espaço na cozinha.
      // O pronto de conta paga também sai — a finalização já o conclui, e
      // este filtro cobre os que ficaram de antes dela. O que está na fila ou
      // no fogo continua, mesmo pago: ainda tem prato para fazer.
      where: {
        unidadeId: unidade.id,
        comanda: { status: { not: "CANCELADA" } },
        OR: [
          { status: { in: ["AGUARDANDO", "EM_PREPARO"] } },
          { status: "PRONTO", comanda: { status: { not: "PAGA" } } },
        ],
      },
      orderBy: { criadoEm: "asc" },
      include: {
        estacao: { select: { id: true, nome: true, corHex: true } },
        comanda: {
          select: { numero: true, status: true, mesa: { select: { numero: true } } },
        },
        itens: {
          include: {
            comandaItem: {
              include: { produto: { select: { titulo: true } } },
            },
          },
        },
      },
    }),
    db.parametroUnidade.findMany({
      where: {
        unidadeId: unidade.id,
        chave: { in: ["kds.alertaAtrasoMin", "kds.alertaRetiradaMin"] },
      },
    }),
  ]);

  const parametro = (chave: string, padrao: number) =>
    Number(alerta.find((a) => a.chave === chave)?.valor ?? padrao);

  return (
    <div className="flex h-tela flex-col bg-neutral-950">
    <BarraAmbientes dados={await dadosDaBarra(sessao)} />
    <KdsBoard
      estacoes={estacoes.map((e) => ({ id: e.id, nome: e.nome, corHex: e.corHex }))}
      alertaAtrasoMin={parametro("kds.alertaAtrasoMin", 20)}
      // Prato pronto parado no balcão esfria. Cinco minutos é o ponto em que
      // vale chamar alguém para levar.
      alertaRetiradaMin={parametro("kds.alertaRetiradaMin", 5)}
      pedidos={pedidos.map((p) => ({
        id: p.id,
        numero: p.numero,
        status: p.status,
        estacaoId: p.estacao.id,
        estacaoNome: p.estacao.nome,
        estacaoCor: p.estacao.corHex,
        comandaNumero: p.comanda.numero,
        mesaNumero: p.comanda.mesa?.numero ?? null,
        // A mesa pediu a conta e ainda há comida na cozinha — o caso em que
        // alguém precisa decidir se apressa o prato ou cancela.
        contaPedida: p.comanda.status === "FECHANDO",
        criadoEm: p.criadoEm.toISOString(),
        prontoEm: p.prontoEm?.toISOString() ?? null,
        itens: p.itens.map((i) => ({
          id: i.id,
          titulo: i.comandaItem.produto.titulo,
          quantidade: Number(i.comandaItem.quantidade),
          pontoCarne: i.comandaItem.pontoCarne,
          observacao: i.comandaItem.observacao,
          cancelado: i.comandaItem.status === "CANCELADO",
        })),
      }))}
    />
    </div>
  );
}
