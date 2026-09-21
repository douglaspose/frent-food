import type { CategoriaNoPainel } from "@/lib/painel";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const pct = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const quant = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

/**
 * Vendas por categoria, em barras horizontais.
 *
 * Horizontal, e não pizza: nome de categoria cabe ao lado da barra sem legenda
 * separada, e comparar comprimentos é mais fácil que comparar ângulos. Com
 * cinco ou seis categorias a pizza ainda funcionaria; com o cardápio crescendo,
 * não.
 *
 * A barra é proporcional à **maior** categoria, não a 100%: com uma categoria
 * dominante as outras viram traços indistinguíveis, e é justamente entre elas
 * que está a comparação interessante. O percentual do total fica escrito ao
 * lado, para a leitura absoluta não se perder.
 */
export function VendasPorCategoria({ dados }: { dados: CategoriaNoPainel[] }) {
  if (dados.length === 0) {
    return <p className="py-8 text-center text-sm text-neutral-500">Nenhuma venda no período.</p>;
  }

  const maior = Math.max(...dados.map((d) => d.faturamento), 1);

  return (
    <ol className="space-y-3">
      {dados.map((c) => (
        <li key={c.nome}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            {/* Quebra em vez de truncar, pelo mesmo motivo do cartão ao lado:
                nome de categoria longo levava a contagem de itens junto. */}
            <span className="min-w-0">
              {c.nome}
              <span className="ml-2 text-xs text-neutral-500">
                {quant.format(c.quantidade)} item(ns)
              </span>
            </span>
            <span className="shrink-0 tabular-nums">
              <span className="font-semibold">{brl.format(c.faturamento)}</span>
              <span className="ml-2 text-xs text-neutral-500">{pct.format(c.fatia)}%</span>
            </span>
          </div>

          <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-neutral-100">
            <div
              className="h-full rounded-full bg-orange-500"
              style={{ width: `${Math.max((c.faturamento / maior) * 100, 1)}%` }}
            />
          </div>
        </li>
      ))}
    </ol>
  );
}
