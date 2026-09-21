"use client";

import { useState } from "react";
import type { RankingDeProdutos } from "@/lib/painel";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const quant = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });

type Aba = "quantidade" | "faturamento";

/**
 * Os mais vendidos, por quantidade ou por faturamento.
 *
 * A aba é estado do componente, e não da URL — ao contrário do período. O
 * período vira link que se manda para o contador; qual coluna está ordenando um
 * cartão é escolha de quem está olhando naquele segundo, e não vale um
 * recarregamento da página inteira.
 *
 * As duas listas já vêm prontas do servidor, na mesma consulta. Reordenar aqui
 * daria errado: os oito que mais faturam e os oito que mais saem são conjuntos
 * diferentes, e a lista de um não contém a do outro.
 *
 * Os dois números aparecem nas duas abas, com o da vez em negrito. Mostrar só a
 * métrica ordenada obrigaria a trocar de aba para responder "e quanto isso
 * faturou?", que é a pergunta seguinte em toda linha.
 */
export function MaisVendidos({ ranking }: { ranking: RankingDeProdutos }) {
  const [aba, setAba] = useState<Aba>("faturamento");

  const lista = aba === "faturamento" ? ranking.porFaturamento : ranking.porQuantidade;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">
          Mais vendidos
          <span className="ml-2 font-normal text-neutral-500">inclui mesas abertas</span>
        </h2>

        <div className="flex gap-1" role="tablist" aria-label="Ordenar os mais vendidos por">
          {(
            [
              ["faturamento", "Faturamento"],
              ["quantidade", "Quantidade"],
            ] as const
          ).map(([valor, rotulo]) => (
            <button
              key={valor}
              role="tab"
              aria-selected={aba === valor}
              onClick={() => setAba(valor)}
              className={`realce-ao-toque shrink-0 touch-manipulation rounded-lg px-2.5 py-1 text-xs font-medium transition duration-100 active:scale-95 ${
                aba === valor
                  ? "bg-neutral-900 text-white"
                  : "bg-white text-neutral-600 ring-1 ring-neutral-200 hover:bg-neutral-50"
              }`}
            >
              {rotulo}
            </button>
          ))}
        </div>
      </div>

      {lista.length === 0 ? (
        <p className="py-8 text-center text-sm text-neutral-500">Nenhuma venda ainda.</p>
      ) : (
        <ol className="space-y-3">
          {lista.map((item) => (
            <li key={item.produtoId} className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-sm">
                <span
                  className={`mr-2 tabular-nums ${
                    aba === "quantidade" ? "font-semibold text-orange-600" : "text-neutral-500"
                  }`}
                >
                  {quant.format(item.quantidade)}×
                </span>
                {item.titulo}
              </span>
              <span
                className={`shrink-0 text-sm tabular-nums ${
                  aba === "faturamento" ? "font-semibold" : "text-neutral-500"
                }`}
              >
                {brl.format(item.faturamento)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
