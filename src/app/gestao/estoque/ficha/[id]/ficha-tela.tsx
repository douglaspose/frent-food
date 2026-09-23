"use client";

import { mensagemDeFalha } from "@/lib/erro-de-operacao";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { salvarComposicao } from "../../actions";

type Insumo = { id: string; titulo: string; unidadeMedida: string };

type Parte = {
  insumoId: string;
  titulo: string;
  unidadeMedida: string;
  quantidade: number;
  custoUnitario: number;
  custo: number;
};

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

type LinhaEdicao = { chave: string; insumoId: string; quantidade: string };

export function FichaTela({
  produto,
  custo,
  partes,
  insumos,
  podeEditar,
}: {
  produto: {
    id: string;
    titulo: string;
    unidadeMedida: string;
    preco: number;
    margemLucroMin: number | null;
  };
  custo: number;
  partes: Parte[];
  insumos: Insumo[];
  podeEditar: boolean;
}) {
  const [linhas, setLinhas] = useState<LinhaEdicao[]>(
    partes.map((p, i) => ({
      chave: `${p.insumoId}-${i}`,
      insumoId: p.insumoId,
      quantidade: String(p.quantidade).replace(".", ","),
    }))
  );
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  const router = useRouter();

  const margem = produto.preco > 0 ? ((produto.preco - custo) / produto.preco) * 100 : 0;
  const lucro = produto.preco - custo;
  const abaixoDoMinimo = produto.margemLucroMin !== null && margem < produto.margemLucroMin;

  function salvar() {
    setErro(null);
    iniciar(async () => {
      try {
        await salvarComposicao(
          produto.id,
          linhas.map((l) => ({
            insumoId: l.insumoId,
            quantidade: Number(l.quantidade.replace(/\./g, "").replace(",", ".")) || 0,
          }))
        );
        router.refresh();
      } catch (e) {
        setErro(mensagemDeFalha(e, "Não foi possível salvar."));
      }
    });
  }

  return (
    <>
      <Link href="/gestao/estoque" className="text-sm text-neutral-500 hover:text-neutral-900">
        ← Estoque
      </Link>

      <h1 className="mt-4 text-2xl font-bold tracking-tight">{produto.titulo}</h1>
      <p className="mt-1 text-sm text-neutral-500">Ficha técnica</p>

      <div className="mt-6 grid gap-4 sm:grid-cols-4">
        {[
          { rotulo: "Preço de venda", valor: brl.format(produto.preco) },
          { rotulo: "Custo dos insumos", valor: custo > 0 ? brl.format(custo) : "—" },
          {
            rotulo: "Lucro por unidade",
            valor: custo > 0 ? brl.format(lucro) : "—",
            cor: lucro < 0 ? "text-red-600" : "text-emerald-700",
          },
          {
            rotulo: "Margem",
            valor: custo > 0 && produto.preco > 0 ? `${margem.toFixed(1)}%` : "—",
            cor: abaixoDoMinimo || margem < 0 ? "text-red-600" : "text-emerald-700",
          },
        ].map((c) => (
          <div key={c.rotulo} className="rounded-xl border border-neutral-200 bg-white p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              {c.rotulo}
            </p>
            <p className={`mt-2 text-xl font-bold tabular-nums ${c.cor ?? ""}`}>{c.valor}</p>
          </div>
        ))}
      </div>

      {custo === 0 && (
        <p className="mt-4 rounded-lg bg-neutral-200 px-4 py-3 text-sm text-neutral-600">
          Sem ficha técnica, este produto não dá baixa no estoque e o custo dele não entra em
          nenhum relatório.
        </p>
      )}

      {abaixoDoMinimo && (
        <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          Margem abaixo do mínimo definido para este produto ({produto.margemLucroMin}%).
        </p>
      )}

      {erro && <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{erro}</p>}

      <h2 className="mt-8 text-sm font-semibold">
        Composição
        <span className="ml-2 font-normal text-neutral-500">
          quanto cada insumo é consumido por unidade vendida
        </span>
      </h2>

      {/* Rola em vez de cortar, como as outras tabelas da gestão: são cinco
          colunas que não cabem nos 325px do celular. */}
      <div className="mt-3 overflow-x-auto rounded-xl border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-4 py-3 font-semibold">Insumo</th>
              <th className="px-4 py-3 font-semibold">Quantidade</th>
              <th className="px-4 py-3 text-right font-semibold">Custo médio</th>
              <th className="px-4 py-3 text-right font-semibold">Custo na ficha</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {linhas.map((linha, indice) => {
              const insumo = insumos.find((i) => i.id === linha.insumoId);
              // O custo mostrado é o da última leitura do servidor; depois de
              // salvar, o refresh traz o valor recalculado.
              const parte = partes.find((p) => p.insumoId === linha.insumoId);

              return (
                <tr key={linha.chave}>
                  <td className="px-4 py-3">
                    <select
                      value={linha.insumoId}
                      disabled={!podeEditar}
                      onChange={(e) =>
                        setLinhas((atual) =>
                          atual.map((l, i) =>
                            i === indice ? { ...l, insumoId: e.target.value } : l
                          )
                        )
                      }
                      className="w-full max-w-xs rounded-lg border border-neutral-300 bg-white px-3 py-2 disabled:bg-neutral-50"
                    >
                      <option value="">Escolha o insumo</option>
                      {insumos.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.titulo}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-2">
                      <input
                        value={linha.quantidade}
                        disabled={!podeEditar}
                        inputMode="decimal"
                        onChange={(e) =>
                          setLinhas((atual) =>
                            atual.map((l, i) =>
                              i === indice ? { ...l, quantidade: e.target.value } : l
                            )
                          )
                        }
                        className="w-24 rounded-lg border border-neutral-300 px-3 py-2 text-right tabular-nums disabled:bg-neutral-50"
                      />
                      <span className="text-xs text-neutral-500">
                        {insumo?.unidadeMedida ?? ""}
                      </span>
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-neutral-500">
                    {parte && parte.custoUnitario > 0 ? brl.format(parte.custoUnitario) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {parte && parte.custo > 0 ? brl.format(parte.custo) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {podeEditar && (
                      <button
                        onClick={() =>
                          setLinhas((atual) => atual.filter((_, i) => i !== indice))
                        }
                        className="text-neutral-500 hover:text-red-600"
                      >
                        remover
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {linhas.length === 0 && (
          <p className="py-12 text-center text-sm text-neutral-500">
            Nenhum insumo na ficha ainda.
          </p>
        )}
      </div>

      {podeEditar && (
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            onClick={() =>
              setLinhas((atual) => [
                ...atual,
                { chave: `novo-${Date.now()}`, insumoId: "", quantidade: "" },
              ])
            }
            className="rounded-lg bg-neutral-200 px-4 py-2 text-sm font-semibold text-neutral-700 transition hover:bg-neutral-300"
          >
            Adicionar insumo
          </button>
          <button
            onClick={salvar}
            disabled={pendente}
            className="rounded-lg bg-neutral-900 px-5 py-2 text-sm font-semibold text-white transition hover:bg-neutral-700 disabled:opacity-40"
          >
            {pendente ? "Salvando..." : "Salvar ficha"}
          </button>
        </div>
      )}

      <p className="mt-6 text-sm text-neutral-500">
        Ao vender {produto.titulo}, cada insumo acima sai do estoque automaticamente na
        quantidade indicada.
      </p>
    </>
  );
}
