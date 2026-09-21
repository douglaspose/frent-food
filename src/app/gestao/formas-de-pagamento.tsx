import type { FormaNoPainel } from "@/lib/painel";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const pct = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

/**
 * Cada tipo de pagamento ganha a sua cor.
 *
 * Não é enfeite: com a barra colorida, "quanto entrou no cartão" se lê de
 * relance sem somar duas linhas. Dinheiro e Pix em verde porque caem na conta
 * na hora; cartão em azul porque só cai depois e ainda paga taxa.
 *
 * O padrão cobre VOUCHER, CONVENIO e OUTRO, e também uma forma que o dono crie
 * com um tipo que este mapa não conheça.
 */
const COR_POR_TIPO: Record<string, string> = {
  DINHEIRO: "bg-emerald-500",
  PIX: "bg-emerald-500",
  CREDITO: "bg-sky-500",
  DEBITO: "bg-sky-400",
};

export function FormasDePagamento({ dados }: { dados: FormaNoPainel[] }) {
  if (dados.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-neutral-500">Nenhum pagamento no período.</p>
    );
  }

  const maior = Math.max(...dados.map((d) => d.valor), 1);
  const taxaTotal = dados.reduce((soma, d) => soma + d.custoDaTaxa, 0);

  return (
    <>
      <ol className="space-y-3">
        {dados.map((f) => (
          <li key={f.nome}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              {/*
                Quebra em vez de truncar: em 375px "Cartão de Crédito
                6 pagamento(s) · taxa 3,2%" saía como "6 pag…", escondendo
                justamente a taxa. Uma segunda linha custa menos que o dado.
              */}
              <span className="min-w-0">
                {f.nome}
                <span className="ml-2 text-xs text-neutral-500">
                  {f.pagamentos} pagamento(s)
                  {/*
                    Taxa nula quer dizer que o período pegou uma renegociação no
                    meio: houve mais de uma taxa, e anunciar uma delas como "a"
                    taxa esconderia a outra. O total abaixo continua exato.
                  */}
                  {f.taxaPct === null
                    ? " · taxa mudou no período"
                    : f.taxaPct > 0 && ` · taxa ${pct.format(f.taxaPct)}%`}
                </span>
              </span>
              <span className="shrink-0 tabular-nums">
                <span className="font-semibold">{brl.format(f.valor)}</span>
                <span className="ml-2 text-xs text-neutral-500">{pct.format(f.fatia)}%</span>
              </span>
            </div>

            <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-neutral-100">
              <div
                className={`h-full rounded-full ${COR_POR_TIPO[f.tipo] ?? "bg-neutral-400"}`}
                style={{ width: `${Math.max((f.valor / maior) * 100, 1)}%` }}
              />
            </div>
          </li>
        ))}
      </ol>

      {/*
        Só aparece quando há taxa a mostrar: numa casa que só recebe em dinheiro
        e Pix, uma linha anunciando "R$ 0,00 em taxas" é ruído.
      */}
      {taxaTotal > 0 && (
        <p className="mt-4 border-t border-neutral-100 pt-3 text-xs text-neutral-500">
          <strong className="font-semibold text-neutral-700">{brl.format(taxaTotal)}</strong> em
          taxas de cartão no período, pela taxa que valia em cada pagamento.
        </p>
      )}
    </>
  );
}
