import { BotaoVoltar } from "../../../botao-voltar";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { CONSUMO } from "@/lib/itens";
import { exigirSessao, temPermissao } from "@/lib/session";
import { lerAjustes } from "@/lib/parametros-servidor";
import { FechamentoScreen } from "./fechamento-screen";

export const metadata: Metadata = { title: "Fechar conta" };
export const dynamic = "force-dynamic";

export default async function FecharPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const sessao = await exigirSessao();

  const ajustes = await lerAjustes(sessao.unidadeId, ["caixa.perguntarQtdPessoasAoPagar"]);

  const mesa = await db.mesa.findUnique({ where: { id } });
  if (!mesa || mesa.unidadeId !== sessao.unidadeId) notFound();

  const comanda = await db.comanda.findFirst({
    where: { mesaId: mesa.id, status: { in: ["ABERTA", "FECHANDO"] } },
    include: {
      itens: {
        where: CONSUMO,
        orderBy: { lancadoEm: "asc" },
        include: { produto: { select: { titulo: true } } },
      },
      pagamentos: {
        orderBy: { criadoEm: "asc" },
        include: { formaPagamento: { select: { nome: true, tipo: true } } },
      },
    },
  });

  if (!comanda) {
    return (
      <main className="flex min-h-tela flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-neutral-400">A mesa {mesa.numero} não tem comanda aberta.</p>
        <BotaoVoltar
          href="/pdv"
          rotulo="Voltar às mesas"
          className="bg-orange-600 text-white hover:bg-orange-500 hover:text-white active:bg-orange-700"
        />
      </main>
    );
  }

  const [formas, caixa] = await Promise.all([
    db.formaPagamento.findMany({
      where: { tenantId: mesa.tenantId, ativo: true },
      orderBy: { nome: "asc" },
    }),
    db.caixa.findFirst({
      where: { unidadeId: mesa.unidadeId, tipo: "GERAL", status: "ABERTO" },
      select: { id: true },
    }),
  ]);

  // Carrinho esquecido no fechamento significa pedido que o cliente fez e
  // ninguém preparou — o caixa precisa ver isso antes de cobrar.
  const itensNoCarrinho = await db.comandaItem.count({
    where: { comandaId: comanda.id, status: "PENDENTE" },
  });

  return (
    <FechamentoScreen
      itensNoCarrinho={itensNoCarrinho}
      caixaAberto={Boolean(caixa)}
      podeDescontar={temPermissao(sessao, "comanda.aplicarDesconto")}
      podeReceber={temPermissao(sessao, "comanda.receberPagamento")}
      podeFechar={temPermissao(sessao, "comanda.fechar")}
      podeEditarPessoas={
        temPermissao(sessao, "comanda.fechar") &&
        Boolean(ajustes["caixa.perguntarQtdPessoasAoPagar"])
      }
      mesa={{ id: mesa.id, numero: mesa.numero }}
      formas={formas.map((f) => ({ id: f.id, nome: f.nome, tipo: f.tipo }))}
      comanda={{
        id: comanda.id,
        numero: comanda.numero,
        pessoas: comanda.pessoas,
        nomeCliente: comanda.nomeCliente,
        taxaServicoPct: Number(comanda.taxaServicoPct),
        descontoValor: Number(comanda.descontoValor),
        descontoMotivo: comanda.descontoMotivo,
        itens: comanda.itens.map((i) => ({
          id: i.id,
          titulo: i.produto.titulo,
          quantidade: Number(i.quantidade),
          precoTotal: Number(i.precoTotal),
        })),
        pagamentos: comanda.pagamentos.map((p) => ({
          id: p.id,
          forma: p.formaPagamento.nome,
          tipo: p.formaPagamento.tipo,
          valor: Number(p.valor),
          troco: Number(p.troco),
        })),
      }}
    />
  );
}
