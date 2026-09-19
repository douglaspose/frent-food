import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { CONSUMO } from "@/lib/itens";
import { centavos } from "@/lib/comanda";
import { exigirSessao } from "@/lib/session";
import { GraficoVendas } from "./grafico-vendas";

export const metadata: Metadata = { title: "Painel" };
export const dynamic = "force-dynamic";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const DIAS_NO_GRAFICO = 14;

function inicioDoDia(offsetDias = 0) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - offsetDias);
  return d;
}

export default async function PainelPage() {
  const sessao = await exigirSessao();
  const desde = inicioDoDia(DIAS_NO_GRAFICO - 1);
  const hoje = inicioDoDia();

  const [pagamentos, comandasPagas, emAberto, itensVendidos, movimentos, itensDoPeriodo] =
    await Promise.all([
      db.pagamento.findMany({
        // Filtra pela unidade, não pelo tenant: o custo abaixo é da unidade, e
        // faturamento de uma loja com custo de outra daria uma margem fantasia.
        where: { comanda: { unidadeId: sessao.unidadeId }, criadoEm: { gte: desde } },
        select: { valor: true, troco: true, criadoEm: true },
      }),
    db.comanda.findMany({
      where: { unidadeId: sessao.unidadeId, status: "PAGA", fechadaEm: { gte: hoje } },
      select: { pessoas: true },
    }),
    db.comandaItem.findMany({
      where: {
        comanda: { unidadeId: sessao.unidadeId, status: { in: ["ABERTA", "FECHANDO"] } },
        ...CONSUMO,
      },
      select: { precoTotal: true },
    }),
    db.comandaItem.groupBy({
      by: ["produtoId"],
      where: {
        tenantId: sessao.tenantId,
        ...CONSUMO,
        lancadoEm: { gte: desde },
      },
      _sum: { quantidade: true, precoTotal: true },
      orderBy: { _sum: { precoTotal: "desc" } },
      take: 8,
    }),
    // O custo de cada venda já ficou congelado no movimento de estoque, com o
    // custo médio vigente na hora. Somar daqui é mais fiel que recalcular
    // depois com o custo de hoje.
    db.movimentoEstoque.findMany({
      where: {
        unidadeId: sessao.unidadeId,
        criadoEm: { gte: desde },
        // DEVOLUCAO entra porque abate: é o insumo que voltou de um item
        // cancelado, e sem ele o CMV cobraria o custo de um prato que ninguém
        // vendeu — justo no dia em que a cozinha errou bastante.
        tipo: { in: ["SAIDA_VENDA", "PERDA", "DEVOLUCAO"] },
      },
      select: { tipo: true, quantidade: true, custoUnitario: true },
    }),
    db.comandaItem.findMany({
      where: {
        comanda: { unidadeId: sessao.unidadeId },
        ...CONSUMO,
        lancadoEm: { gte: desde },
      },
      select: {
        precoTotal: true,
        produtoId: true,
        produto: {
          select: { controlaEstoque: true, _count: { select: { composicao: true } } },
        },
      },
    }),
  ]);

  // Produto marcado como controlado mas sem custo lançado contribui R$ 0 ao
  // CMV. Contá-lo como "coberto" inflaria justamente a métrica que existe
  // para denunciar o buraco.
  const comCustoConhecido = new Set(
    (
      await db.estoqueSaldo.findMany({
        where: { unidadeId: sessao.unidadeId, custoMedio: { gt: 0 } },
        select: { produtoId: true },
      })
    ).map((s) => s.produtoId)
  );

  // Os nomes vêm numa consulta só, em vez de uma por produto do ranking.
  const produtos = await db.produto.findMany({
    where: { id: { in: itensVendidos.map((i) => i.produtoId) } },
    select: { id: true, titulo: true },
  });
  const nomePorId = new Map(produtos.map((p) => [p.id, p.titulo]));

  const liquido = (p: { valor: unknown; troco: unknown }) => Number(p.valor) - Number(p.troco);

  const porDia = new Map<string, number>();
  for (let i = 0; i < DIAS_NO_GRAFICO; i++) {
    porDia.set(inicioDoDia(i).toISOString().slice(0, 10), 0);
  }
  for (const p of pagamentos) {
    const chave = p.criadoEm.toISOString().slice(0, 10);
    if (porDia.has(chave)) porDia.set(chave, centavos(porDia.get(chave)! + liquido(p)));
  }

  const faturamentoHoje = centavos(
    pagamentos.filter((p) => p.criadoEm >= hoje).reduce((s, p) => s + liquido(p), 0)
  );
  const faturamentoPeriodo = centavos(pagamentos.reduce((s, p) => s + liquido(p), 0));

  // Saídas têm quantidade negativa; o custo é sempre positivo.
  const valorDoMovimento = (m: { quantidade: unknown; custoUnitario: unknown }) =>
    Math.abs(Number(m.quantidade)) * Number(m.custoUnitario);

  const saidas = movimentos
    .filter((m) => m.tipo === "SAIDA_VENDA")
    .reduce((s, m) => s + valorDoMovimento(m), 0);
  const devolvido = movimentos
    .filter((m) => m.tipo === "DEVOLUCAO")
    .reduce((s, m) => s + valorDoMovimento(m), 0);

  // O que voltou não foi vendido. Um piso de zero evita que uma devolução
  // lançada fora do período deixe o CMV negativo, que não quer dizer nada.
  const cmv = centavos(Math.max(0, saidas - devolvido));
  const perdas = centavos(
    movimentos.filter((m) => m.tipo === "PERDA").reduce((s, m) => s + valorDoMovimento(m), 0)
  );

  const lucroBruto = centavos(faturamentoPeriodo - cmv);
  const margemBruta = faturamentoPeriodo > 0 ? (lucroBruto / faturamentoPeriodo) * 100 : 0;

  /**
   * Quanto do faturamento vem de produto que tem custo cadastrado.
   *
   * Sem isto a margem engana: produto sem ficha entra com custo zero e faz o
   * lucro parecer enorme. Se a cobertura está baixa, o número acima é ficção.
   */
  const receitaTotal = centavos(itensDoPeriodo.reduce((s, i) => s + Number(i.precoTotal), 0));
  const receitaComCusto = centavos(
    itensDoPeriodo
      .filter(
        (i) =>
          i.produto._count.composicao > 0 ||
          (i.produto.controlaEstoque && comCustoConhecido.has(i.produtoId))
      )
      .reduce((s, i) => s + Number(i.precoTotal), 0)
  );
  const cobertura = receitaTotal > 0 ? (receitaComCusto / receitaTotal) * 100 : 0;
  const totalEmAberto = centavos(emAberto.reduce((s, i) => s + Number(i.precoTotal), 0));
  const pessoasHoje = comandasPagas.reduce((s, c) => s + c.pessoas, 0);

  const cartoes = [
    { rotulo: "Faturamento hoje", valor: brl.format(faturamentoHoje) },
    {
      rotulo: "Ticket médio hoje",
      valor:
        comandasPagas.length > 0
          ? brl.format(centavos(faturamentoHoje / comandasPagas.length))
          : "—",
      nota: `${comandasPagas.length} comanda(s) · ${pessoasHoje} pessoa(s)`,
    },
    {
      rotulo: "Por pessoa hoje",
      valor: pessoasHoje > 0 ? brl.format(centavos(faturamentoHoje / pessoasHoje)) : "—",
    },
    { rotulo: "Em aberto no salão", valor: brl.format(totalEmAberto), destaque: true },
  ];

  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">Painel</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Últimos {DIAS_NO_GRAFICO} dias · {brl.format(faturamentoPeriodo)} no período
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cartoes.map((c) => (
          <div key={c.rotulo} className="rounded-xl border border-neutral-200 bg-white p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              {c.rotulo}
            </p>
            <p
              className={`mt-2 text-2xl font-bold tabular-nums ${
                c.destaque ? "text-orange-600" : ""
              }`}
            >
              {c.valor}
            </p>
            {c.nota && <p className="mt-1 text-xs text-neutral-500">{c.nota}</p>}
          </div>
        ))}
      </div>

      <h2 className="mt-10 text-sm font-semibold">
        Resultado do período
        <span className="ml-2 font-normal text-neutral-500">
          faturamento menos o custo da mercadoria que saiu
        </span>
      </h2>

      <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { rotulo: "Faturamento", valor: brl.format(faturamentoPeriodo) },
          { rotulo: "CMV", valor: cmv > 0 ? brl.format(cmv) : "—", nota: "custo do que foi vendido" },
          {
            rotulo: "Lucro bruto",
            valor: cmv > 0 ? brl.format(lucroBruto) : "—",
            cor: lucroBruto < 0 ? "text-red-600" : "text-emerald-700",
          },
          {
            rotulo: "Margem bruta",
            valor: cmv > 0 ? `${margemBruta.toFixed(1)}%` : "—",
            cor: margemBruta < 0 ? "text-red-600" : "text-emerald-700",
          },
        ].map((c) => (
          <div key={c.rotulo} className="rounded-xl border border-neutral-200 bg-white p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              {c.rotulo}
            </p>
            <p className={`mt-2 text-2xl font-bold tabular-nums ${c.cor ?? ""}`}>{c.valor}</p>
            {c.nota && <p className="mt-1 text-xs text-neutral-500">{c.nota}</p>}
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-3 text-sm">
        {perdas > 0 && (
          <p className="rounded-lg bg-red-50 px-4 py-3 text-red-700">
            <strong>{brl.format(perdas)}</strong> em perdas no período
            {faturamentoPeriodo > 0 && ` · ${((perdas / faturamentoPeriodo) * 100).toFixed(1)}% do faturamento`}
          </p>
        )}

        {receitaTotal > 0 && (
          <p
            className={`rounded-lg px-4 py-3 ${
              cobertura < 80 ? "bg-amber-50 text-amber-800" : "bg-neutral-100 text-neutral-600"
            }`}
          >
            <strong>{cobertura.toFixed(0)}%</strong> do faturamento vem de produto com custo
            cadastrado.
            {cobertura < 80 && (
              <>
                {" "}
                A margem acima está otimista —{" "}
                <Link href="/gestao/estoque" className="font-semibold underline">
                  monte as fichas técnicas
                </Link>{" "}
                que faltam.
              </>
            )}
          </p>
        )}
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-5">
        <section className="rounded-xl border border-neutral-200 bg-white p-5 lg:col-span-3">
          <h2 className="mb-4 text-sm font-semibold">Vendas por dia</h2>
          <GraficoVendas dados={[...porDia.entries()].reverse()} />
        </section>

        <section className="rounded-xl border border-neutral-200 bg-white p-5 lg:col-span-2">
          <h2 className="mb-4 text-sm font-semibold">Mais vendidos no período</h2>
          {itensVendidos.length === 0 ? (
            <p className="py-8 text-center text-sm text-neutral-400">Nenhuma venda ainda.</p>
          ) : (
            <ol className="space-y-3">
              {itensVendidos.map((item) => (
                <li key={item.produtoId} className="flex items-baseline justify-between gap-3">
                  <span className="text-sm">
                    <span className="mr-2 tabular-nums text-neutral-400">
                      {Number(item._sum.quantidade ?? 0)}×
                    </span>
                    {nomePorId.get(item.produtoId) ?? "—"}
                  </span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums">
                    {brl.format(Number(item._sum.precoTotal ?? 0))}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </>
  );
}
