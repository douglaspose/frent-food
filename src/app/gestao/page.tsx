import type { Metadata } from "next";
import Link from "next/link";
import { sessaoDaTela } from "@/lib/session";
import { diasDoIntervalo, janelaDoGrafico, lerPeriodo, variacao } from "@/lib/periodo";
import {
  alertasDoPainel,
  coberturaDeCusto,
  faturamentoELucroPorDia,
  rankingDeProdutos,
  resumoDosPeriodos,
  formasDePagamento,
  resumoDeCaixa,
  totalEmAberto,
  vendasPorCategoria,
} from "@/lib/painel";
import { GraficoVendas } from "./grafico-vendas";
import { MaisVendidos } from "./mais-vendidos";
import { VendasPorCategoria } from "./vendas-por-categoria";
import { FormasDePagamento } from "./formas-de-pagamento";
import { Alertas } from "./alertas";
import { ResumoDeCaixaCard } from "./resumo-de-caixa";
import { SeletorDePeriodo } from "./seletor-de-periodo";

export const metadata: Metadata = { title: "Painel" };
export const dynamic = "force-dynamic";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/**
 * Porcentagem em pt-BR, com vírgula.
 *
 * `toFixed(1)` devolvia "93.8%" ao lado de "R$ 875,29" — o mesmo cartão com
 * duas convenções decimais.
 */
const pct = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const inteiro = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

/**
 * A variação contra o período anterior.
 *
 * Discreta de propósito: ela acompanha o número, não disputa com ele. Verde e
 * vermelho aqui são leitura rápida — "subiu" e "caiu" —, e não julgamento:
 * custo subindo aparece em vermelho no lugar certo, que é o cartão de CMV.
 */
function Variacao({ atual, anterior, invertido = false, unidade = "dinheiro" }: {
  atual: number;
  anterior: number;
  /** Quando crescer é ruim, como em CMV e perdas. */
  invertido?: boolean;
  /**
   * Como o valor anterior é escrito. Sem isto o cartão de comandas anunciava
   * "R$ 1,00 antes" para uma contagem de mesas.
   */
  unidade?: "dinheiro" | "contagem";
}) {
  const diferenca = variacao(atual, anterior);

  // Sem base de comparação não há porcentagem: dizer "+100%" sobre zero seria
  // inventar informação onde não existe.
  if (diferenca === null) {
    return <p className="mt-1 text-xs text-neutral-400">sem base de comparação</p>;
  }

  const subiu = diferenca > 0;
  const bom = invertido ? !subiu : subiu;
  const parado = Math.abs(diferenca) < 0.05;

  return (
    <p
      className={`mt-1 text-xs font-medium tabular-nums ${
        parado ? "text-neutral-500" : bom ? "text-emerald-700" : "text-red-600"
      }`}
    >
      {parado ? "estável" : `${subiu ? "+" : ""}${pct.format(diferenca)}%`}
      <span className="font-normal text-neutral-500">
        {" · "}
        {unidade === "dinheiro" ? brl.format(anterior) : inteiro.format(anterior)} antes
      </span>
    </p>
  );
}

function Cartao({
  rotulo,
  valor,
  nota,
  cor,
  filhos,
}: {
  rotulo: string;
  valor: string;
  nota?: string;
  cor?: string;
  filhos?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{rotulo}</p>
      <p className={`mt-2 text-2xl font-bold tabular-nums ${cor ?? ""}`}>{valor}</p>
      {nota && <p className="mt-1 text-xs text-neutral-500">{nota}</p>}
      {filhos}
    </div>
  );
}

export default async function PainelPage({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string; de?: string; ate?: string }>;
}) {
  const sessao = await sessaoDaTela();
  const periodo = lerPeriodo(await searchParams);
  const unidade = sessao.unidadeId;

  /**
   * Em sequência, e não em `Promise.all`.
   *
   * Cada uma destas chamadas abre a sua própria transação no adaptador de RLS.
   * Disparadas juntas, são um pico de conexões a cada carregamento da tela, em
   * troca de milissegundos numa rede local. `resumoDosPeriodos` já traz o
   * período atual e o anterior na mesma consulta, com as duas colunas saindo do
   * mesmo `SUM` — é o que garante que a comparação não passe a mentir quando
   * alguém corrigir uma conta só de um lado.
   */
  const { atual, anterior } = await resumoDosPeriodos(unidade, periodo);
  const emAberto = await totalEmAberto(unidade);
  const cobertura = await coberturaDeCusto(unidade, periodo.atual);
  /**
   * O gráfico tem a sua própria janela: em "Hoje" e "Ontem" ele abre para uma
   * semana, porque uma barra sozinha não é gráfico. O destaque marca quais dias
   * são o período dos cartões, para o gráfico não passar a contradizê-los.
   */
  const janela = janelaDoGrafico(periodo);
  const serie = await faturamentoELucroPorDia(unidade, janela);
  const destaque = diasDoIntervalo(periodo.atual);
  const graficoMaiorQuePeriodo = periodo.dias < serie.length;
  const ranking = await rankingDeProdutos(unidade, periodo.atual);
  const categorias = await vendasPorCategoria(unidade, periodo.atual);
  const formas = await formasDePagamento(unidade, periodo.atual);
  const caixa = await resumoDeCaixa(unidade, periodo.atual);
  const alertas = await alertasDoPainel(unidade, periodo.atual);

  const semCusto = atual.cmv === 0;

  return (
    <>
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Painel</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {periodo.rotulo} · {brl.format(atual.faturamento)} no período
        </p>
        <SeletorDePeriodo chave={periodo.chave} de={periodo.de} ate={periodo.ate} />
      </header>

      <Alertas itens={alertas} />

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Cartao
          rotulo="Faturamento"
          valor={brl.format(atual.faturamento)}
          filhos={<Variacao atual={atual.faturamento} anterior={anterior.faturamento} />}
        />
        <Cartao
          rotulo="Comandas"
          valor={String(atual.comandas)}
          nota={`${atual.pessoas} pessoa(s)`}
          filhos={
            <Variacao atual={atual.comandas} anterior={anterior.comandas} unidade="contagem" />
          }
        />
        <Cartao
          rotulo="Ticket médio"
          valor={atual.ticketMedio === null ? "—" : brl.format(atual.ticketMedio)}
          nota={
            atual.pessoas > 0
              ? `${brl.format(atual.faturamento / atual.pessoas)} por pessoa`
              : undefined
          }
          filhos={
            atual.ticketMedio !== null && anterior.ticketMedio !== null ? (
              <Variacao atual={atual.ticketMedio} anterior={anterior.ticketMedio} />
            ) : undefined
          }
        />
        {/*
          O único cartão que ignora o filtro: em aberto é um retrato do agora,
          e um "em aberto do mês passado" não quer dizer nada.
        */}
        <Cartao
          rotulo="Em aberto no salão"
          valor={brl.format(emAberto)}
          nota="agora, independente do período"
          cor="text-orange-600"
        />
      </div>

      <h2 className="mt-10 text-sm font-semibold">
        Resultado do período
        <span className="ml-2 font-normal text-neutral-500">
          faturamento menos o custo da mercadoria que saiu
        </span>
      </h2>

      <div className="mt-3 grid gap-4 sm:grid-cols-3">
        <Cartao
          rotulo="CMV"
          valor={semCusto ? "—" : brl.format(atual.cmv)}
          nota="custo do que foi vendido"
          filhos={
            semCusto ? undefined : (
              <Variacao atual={atual.cmv} anterior={anterior.cmv} invertido />
            )
          }
        />
        <Cartao
          rotulo="Lucro bruto"
          valor={semCusto ? "—" : brl.format(atual.lucroBruto)}
          cor={atual.lucroBruto < 0 ? "text-red-600" : "text-emerald-700"}
          filhos={
            semCusto ? undefined : (
              <Variacao atual={atual.lucroBruto} anterior={anterior.lucroBruto} />
            )
          }
        />
        <Cartao
          rotulo="Margem bruta"
          valor={atual.margemBruta === null ? "—" : `${pct.format(atual.margemBruta)}%`}
          cor={(atual.margemBruta ?? 0) < 0 ? "text-red-600" : "text-emerald-700"}
          nota={
            anterior.margemBruta !== null && atual.margemBruta !== null
              ? `${pct.format(anterior.margemBruta)}% no período anterior`
              : undefined
          }
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-3 text-sm">
        {atual.perdas > 0 && (
          <p className="rounded-lg bg-red-50 px-4 py-3 text-red-700">
            <strong>{brl.format(atual.perdas)}</strong> em perdas no período
            {atual.faturamento > 0 &&
              ` · ${pct.format((atual.perdas / atual.faturamento) * 100)}% do faturamento`}
          </p>
        )}

        {cobertura.porcentagem !== null && (
          <p
            className={`rounded-lg px-4 py-3 ${
              cobertura.porcentagem < 80
                ? "bg-amber-50 text-amber-800"
                : "bg-neutral-100 text-neutral-600"
            }`}
          >
            <strong>{inteiro.format(cobertura.porcentagem)}%</strong> do faturamento vem de produto com
            custo cadastrado.
            {cobertura.porcentagem < 80 && (
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
        <section className="min-w-0 rounded-xl border border-neutral-200 bg-white p-5 lg:col-span-3">
          {/*
            O título mora dentro do gráfico porque muda com o checkbox de custo,
            que é escolha de quem está olhando. Sem custo lançado no período o
            checkbox nem aparece: oferecer a opção prometeria uma informação que
            o gráfico não tem.
          */}
          <GraficoVendas
            dados={serie}
            temCusto={!semCusto}
            destaque={destaque}
            janelaMaiorQuePeriodo={graficoMaiorQuePeriodo}
          />
        </section>

        <section className="min-w-0 rounded-xl border border-neutral-200 bg-white p-5 lg:col-span-2">
          <MaisVendidos ranking={ranking} />
        </section>
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <section className="min-w-0 rounded-xl border border-neutral-200 bg-white p-5">
          {/*
            Estes dois cartões contam **itens lançados**, e não faturamento: as
            mesas ainda abertas entram, e o desconto dado no fechamento não sai.
            É de propósito — às 20h o "Hoje" mostraria quase nada se esperasse o
            pagamento —, mas o total não bate com o cartão de faturamento lá em
            cima, então a legenda avisa em vez de deixar a conta parecer errada.
          */}
          <h2 className="mb-4 text-sm font-semibold">
            Vendas por categoria
            <span className="ml-2 font-normal text-neutral-500">
              pelo preço dos itens lançados, incluindo as mesas ainda abertas
            </span>
          </h2>
          <VendasPorCategoria dados={categorias} />
        </section>

        <section className="min-w-0 rounded-xl border border-neutral-200 bg-white p-5">
          {/*
            Ao contrário do cartão ao lado, este conta **pagamento recebido**: o
            total daqui fecha com o cartão de faturamento lá em cima, e não com o
            de categorias. São perguntas diferentes — "o que vendeu" e "como o
            dinheiro entrou" —, e por isso os dois números não precisam bater.
          */}
          <h2 className="mb-4 text-sm font-semibold">
            Formas de pagamento
            <span className="ml-2 font-normal text-neutral-500">do que já foi recebido</span>
          </h2>
          <FormasDePagamento dados={formas} />
        </section>

        <section className="min-w-0 rounded-xl border border-neutral-200 bg-white p-5">
          <h2 className="mb-4 text-sm font-semibold">
            Caixa
            <span className="ml-2 font-normal text-neutral-500">fechamentos do período</span>
          </h2>
          <ResumoDeCaixaCard dados={caixa} />
        </section>
      </div>
    </>
  );
}
