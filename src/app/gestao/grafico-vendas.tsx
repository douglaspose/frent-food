const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function rotuloDia(iso: string) {
  // Monta a data local a partir do ISO para não perder um dia por fuso.
  const [ano, mes, dia] = iso.split("-").map(Number);
  return new Date(ano, mes - 1, dia).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  });
}

/**
 * Barras em CSS puro. Uma biblioteca de gráficos aqui custaria ~100kB para
 * desenhar catorze retângulos.
 */
export function GraficoVendas({ dados }: { dados: [string, number][] }) {
  const maximo = Math.max(...dados.map(([, v]) => v), 1);

  return (
    <div className="flex h-56 gap-1.5">
      {dados.map(([dia, valor]) => (
        <div key={dia} className="group flex min-w-0 flex-1 flex-col items-center gap-1.5">
          <span className="h-3 text-[10px] font-semibold tabular-nums text-neutral-400 opacity-0 transition group-hover:opacity-100">
            {valor > 0 ? brl.format(valor) : ""}
          </span>
          {/* A altura em % só resolve dentro de um pai com altura definida —
              por isso a barra mora neste trilho flex-1, e não solta na coluna. */}
          <div className="flex w-full min-h-0 flex-1 items-end">
            <div
              className={`w-full rounded-t transition ${
                valor > 0 ? "bg-orange-500 group-hover:bg-orange-600" : "bg-neutral-200"
              }`}
              style={{ height: `${Math.max((valor / maximo) * 100, 2)}%` }}
            />
          </div>
          <span className="truncate text-[10px] tabular-nums text-neutral-400">
            {rotuloDia(dia)}
          </span>
        </div>
      ))}
    </div>
  );
}
