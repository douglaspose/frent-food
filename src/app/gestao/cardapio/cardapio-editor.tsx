"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { alterarPreco, alternarEsgotado } from "../actions";

export type ItemCardapio = {
  id: string;
  titulo: string;
  codigo: string;
  preco: number;
  esgotado: boolean;
  visivel: boolean;
  produtoAtivo: boolean;
};

export type CategoriaCardapio = { id: string; nome: string; itens: ItemCardapio[] };

const brl = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2 });

/**
 * Lê o preço digitado.
 *
 * A regra antiga apagava todo ponto como separador de milhar. Num teclado
 * numérico a tecla decimal costuma ser o ponto, então "18.90" virava 1890 —
 * cem vezes o preço, gravado sem aviso. O campo ainda mostrava o texto
 * digitado, e o gerente só descobria pela primeira conta absurda.
 *
 * Com vírgula, é notação brasileira e o ponto é milhar. Sem vírgula, um único
 * ponto com uma ou duas casas depois é decimal ("18.90"); qualquer outro é
 * milhar ("1.890").
 */
export function lerPreco(texto: string): number {
  const limpo = texto.replace(/[\sR$]/g, "");
  if (!limpo) return NaN;

  if (limpo.includes(",")) return Number(limpo.replace(/\./g, "").replace(",", "."));
  if (/^\d+\.\d{1,2}$/.test(limpo)) return Number(limpo);
  return Number(limpo.replace(/\./g, ""));
}

export function CardapioEditor({
  categorias,
  podeEditar,
}: {
  categorias: CategoriaCardapio[];
  podeEditar: boolean;
}) {
  const [busca, setBusca] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState<string | null>(null);
  const [, iniciar] = useTransition();
  const router = useRouter();

  const visiveis = categorias
    .map((c) => ({
      ...c,
      itens: c.itens.filter(
        (i) =>
          !busca.trim() ||
          i.titulo.toLowerCase().includes(busca.trim().toLowerCase()) ||
          i.codigo.startsWith(busca.trim())
      ),
    }))
    .filter((c) => c.itens.length > 0);

  function salvarPreco(item: ItemCardapio, texto: string) {
    const novo = lerPreco(texto);
    if (!Number.isFinite(novo) || novo === item.preco) return;

    setErro(null);
    iniciar(async () => {
      try {
        await alterarPreco(item.id, novo);
        setSalvo(item.id);
        // O "salvo" some sozinho: é confirmação, não estado permanente.
        setTimeout(() => setSalvo(null), 1500);
        router.refresh();
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Não foi possível alterar o preço.");
      }
    });
  }

  function marcarEsgotado(item: ItemCardapio) {
    setErro(null);
    iniciar(async () => {
      try {
        await alternarEsgotado(item.id, !item.esgotado);
        router.refresh();
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Não foi possível alterar.");
      }
    });
  }

  return (
    <div className="mt-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar produto ou código"
          className="w-full max-w-xs rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
        />
        {!podeEditar && (
          <span className="text-sm text-neutral-500">
            Somente leitura — alterar cardápio é com o gerente.
          </span>
        )}
      </div>

      {erro && (
        <p className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{erro}</p>
      )}

      <div className="space-y-6">
        {visiveis.map((categoria) => (
          <section
            key={categoria.id}
            className="overflow-hidden rounded-xl border border-neutral-200 bg-white"
          >
            <h2 className="border-b border-neutral-200 bg-neutral-50 px-5 py-3 text-xs font-semibold uppercase tracking-widest text-neutral-500">
              {categoria.nome}
              <span className="ml-2 font-normal text-neutral-500">{categoria.itens.length}</span>
            </h2>

            <ul className="divide-y divide-neutral-100">
              {categoria.itens.map((item) => (
                <li
                  key={item.id}
                  className={`flex flex-wrap items-center gap-3 px-5 py-3 ${
                    item.produtoAtivo ? "" : "opacity-50"
                  }`}
                >
                  <span className="w-10 shrink-0 text-xs tabular-nums text-neutral-500">
                    {item.codigo}
                  </span>

                  <span className="min-w-0 flex-1 text-sm">
                    {item.titulo}
                    {!item.produtoAtivo && (
                      <span className="ml-2 text-[10px] font-bold uppercase text-neutral-500">
                        inativo
                      </span>
                    )}
                  </span>

                  <label className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-neutral-500">R$</span>
                    <input
                      // A chave no preço força o campo a renascer quando o
                      // valor salvo muda. Sem isso ele continuava exibindo o
                      // texto digitado, e "18.90" parecia ter virado R$ 18,90
                      // quando na verdade eram R$ 1.890,00.
                      key={item.preco}
                      defaultValue={brl.format(item.preco)}
                      onBlur={(e) => salvarPreco(item, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                      }}
                      disabled={!podeEditar}
                      inputMode="decimal"
                      className={`w-24 rounded-lg border px-3 py-1.5 text-right text-sm tabular-nums transition focus:outline-none disabled:bg-neutral-50 disabled:text-neutral-500 ${
                        salvo === item.id
                          ? "border-emerald-500 bg-emerald-50"
                          : "border-neutral-300 focus:border-neutral-900"
                      }`}
                    />
                  </label>

                  <button
                    onClick={() => marcarEsgotado(item)}
                    disabled={!podeEditar}
                    className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:opacity-40 ${
                      item.esgotado
                        ? "bg-red-600 text-white hover:bg-red-500"
                        : "bg-neutral-100 text-neutral-500 hover:bg-neutral-200"
                    }`}
                  >
                    {item.esgotado ? "Esgotado" : "Disponível"}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      {visiveis.length === 0 && (
        <p className="py-16 text-center text-sm text-neutral-500">Nenhum item encontrado.</p>
      )}
    </div>
  );
}
