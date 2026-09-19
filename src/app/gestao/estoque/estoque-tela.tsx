"use client";

import { temErro } from "@/lib/erro-de-operacao";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  configurarProdutoEstoque,
  registrarContagem,
  registrarEntrada,
  registrarPerda,
} from "./actions";

type ProdutoEstoque = {
  id: string;
  titulo: string;
  tipo: string;
  unidadeMedida: string;
  controlaEstoque: boolean;
  temFicha: boolean;
  estoqueMinimo: number | null;
  quantidade: number;
  custoMedio: number;
  valorEmEstoque: number;
  abaixoDoMinimo: boolean;
};

type Movimento = {
  id: string;
  produto: string;
  unidadeMedida: string;
  tipo: string;
  quantidade: number;
  saldoDepois: number;
  custoUnitario: number;
  motivo: string | null;
  criadoEm: string;
};

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const qtd = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });

const CORES_MOVIMENTO: Record<string, string> = {
  ENTRADA: "bg-emerald-100 text-emerald-800",
  SAIDA_VENDA: "bg-neutral-100 text-neutral-600",
  PERDA: "bg-red-100 text-red-700",
  AJUSTE: "bg-amber-100 text-amber-800",
  DEVOLUCAO: "bg-sky-100 text-sky-800",
};

type Operacao = "entrada" | "perda" | "contagem";

export function EstoqueTela({
  produtos,
  movimentos,
  podeEditar,
}: {
  produtos: ProdutoEstoque[];
  movimentos: Movimento[];
  podeEditar: boolean;
}) {
  const [busca, setBusca] = useState("");
  const [soAcompanhados, setSoAcompanhados] = useState(true);
  const [operacao, setOperacao] = useState<{ tipo: Operacao; produto: ProdutoEstoque } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  const router = useRouter();

  /** Item de estoque é o que tem controle próprio ou serve de insumo em ficha. */
  const acompanhado = (p: ProdutoEstoque) =>
    p.controlaEstoque || p.tipo === "INSUMO" || p.quantidade !== 0;

  const visiveis = produtos.filter(
    (p) =>
      (!soAcompanhados || acompanhado(p)) &&
      (!busca.trim() || p.titulo.toLowerCase().includes(busca.trim().toLowerCase()))
  );

  const valorTotal = produtos.reduce((s, p) => s + p.valorEmEstoque, 0);
  const emFalta = produtos.filter((p) => p.abaixoDoMinimo);

  function agir(fn: () => Promise<unknown>, aoTerminar?: () => void) {
    setErro(null);
    setAviso(null);
    iniciar(async () => {
      try {
        // Regra de negócio violada volta como valor, não como exceção: a
        // mensagem de uma exceção não atravessa a server action em produção.
        const r = await fn();
        if (temErro(r)) {
          setErro(r.erro);
          return;
        }
        aoTerminar?.();
        router.refresh();
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Algo deu errado.");
      }
    });
  }

  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Estoque</h1>
          <p className="mt-1 text-sm text-neutral-500">
            {brl.format(valorTotal)} parados em mercadoria
          </p>
        </div>
      </div>

      {emFalta.length > 0 && (
        <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <strong>{emFalta.length} item(ns) no mínimo ou abaixo:</strong>{" "}
          {emFalta.map((p) => p.titulo).join(", ")}
        </p>
      )}

      {erro && <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{erro}</p>}
      {aviso && (
        <p className="mt-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{aviso}</p>
      )}

      {operacao && (
        <OperacaoForm
          tipo={operacao.tipo}
          produto={operacao.produto}
          pendente={pendente}
          onCancelar={() => setOperacao(null)}
          onConfirmar={(dados) =>
            agir(
              async () => {
                if (operacao.tipo === "entrada") {
                  await registrarEntrada({
                    produtoId: operacao.produto.id,
                    quantidade: dados.quantidade,
                    custoTotal: dados.custoTotal,
                    motivo: dados.motivo,
                  });
                } else if (operacao.tipo === "perda") {
                  await registrarPerda({
                    produtoId: operacao.produto.id,
                    quantidade: dados.quantidade,
                    motivo: dados.motivo,
                  });
                } else {
                  const r = await registrarContagem({
                    produtoId: operacao.produto.id,
                    quantidadeContada: dados.quantidade,
                    motivo: dados.motivo,
                  });
                  if (temErro(r)) throw new Error(r.erro);
                  setAviso(
                    r.diferenca === 0
                      ? "Contagem bateu com o sistema."
                      : `Divergência de ${qtd.format(r.diferenca)} ${operacao.produto.unidadeMedida} registrada.`
                  );
                }
              },
              () => setOperacao(null)
            )
          }
        />
      )}

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar produto"
          className="w-full max-w-xs rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
        />
        <label className="flex cursor-pointer items-center gap-2 text-sm text-neutral-600">
          <input
            type="checkbox"
            checked={soAcompanhados}
            onChange={(e) => setSoAcompanhados(e.target.checked)}
            className="h-4 w-4 accent-neutral-900"
          />
          Só itens de estoque
        </label>
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-4 py-3 font-semibold">Produto</th>
              <th className="px-4 py-3 text-right font-semibold">Saldo</th>
              <th className="px-4 py-3 text-right font-semibold">Custo médio</th>
              <th className="px-4 py-3 text-right font-semibold">Em estoque</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {visiveis.map((p) => (
              <tr key={p.id} className={p.abaixoDoMinimo ? "bg-amber-50/60" : ""}>
                <td className="px-4 py-3">
                  {p.titulo}
                  {p.temFicha && (
                    <span className="ml-2 rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-bold text-sky-700">
                      FICHA
                    </span>
                  )}
                  {p.estoqueMinimo !== null && (
                    <span className="ml-2 text-xs text-neutral-400">
                      mín {qtd.format(p.estoqueMinimo)}
                    </span>
                  )}
                </td>
                <td
                  className={`px-4 py-3 text-right tabular-nums ${
                    p.quantidade < 0
                      ? "font-semibold text-red-600"
                      : p.abaixoDoMinimo
                        ? "font-semibold text-amber-700"
                        : ""
                  }`}
                >
                  {qtd.format(p.quantidade)}{" "}
                  <span className="text-xs text-neutral-400">{p.unidadeMedida}</span>
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-neutral-500">
                  {p.custoMedio > 0 ? brl.format(p.custoMedio) : "—"}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {p.valorEmEstoque > 0 ? brl.format(p.valorEmEstoque) : "—"}
                </td>
                <td className="px-4 py-3 text-right">
                  {podeEditar && (
                    <span className="flex justify-end gap-3 whitespace-nowrap">
                      <button
                        onClick={() => setOperacao({ tipo: "entrada", produto: p })}
                        className="text-emerald-700 hover:text-emerald-900"
                      >
                        entrada
                      </button>
                      <button
                        onClick={() => setOperacao({ tipo: "perda", produto: p })}
                        className="text-neutral-500 hover:text-red-600"
                      >
                        perda
                      </button>
                      <button
                        onClick={() => setOperacao({ tipo: "contagem", produto: p })}
                        className="text-neutral-500 hover:text-neutral-900"
                      >
                        contar
                      </button>
                      <Link
                        href={`/gestao/estoque/ficha/${p.id}`}
                        className="text-neutral-500 hover:text-neutral-900"
                      >
                        ficha
                      </Link>
                      <button
                        onClick={() =>
                          agir(() =>
                            configurarProdutoEstoque({
                              produtoId: p.id,
                              controlaEstoque: !p.controlaEstoque,
                              estoqueMinimo: p.estoqueMinimo,
                            })
                          )
                        }
                        className="text-neutral-400 hover:text-neutral-900"
                        title="Dá baixa direto na venda, sem ficha técnica"
                      >
                        {p.controlaEstoque ? "não controlar" : "controlar"}
                      </button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {visiveis.length === 0 && (
          <p className="py-16 text-center text-sm text-neutral-400">
            Nenhum item de estoque. Marque produtos como &quot;controlar&quot; ou monte fichas
            técnicas.
          </p>
        )}
      </div>

      <h2 className="mt-10 text-sm font-semibold">Movimentações recentes</h2>
      <div className="mt-3 overflow-hidden rounded-xl border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-4 py-3 font-semibold">Quando</th>
              <th className="px-4 py-3 font-semibold">Produto</th>
              <th className="px-4 py-3 font-semibold">Tipo</th>
              <th className="px-4 py-3 text-right font-semibold">Qtd.</th>
              <th className="px-4 py-3 text-right font-semibold">Saldo</th>
              <th className="px-4 py-3 font-semibold">Motivo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {movimentos.map((m) => (
              <tr key={m.id}>
                <td className="whitespace-nowrap px-4 py-3 tabular-nums text-neutral-400">
                  {new Date(m.criadoEm).toLocaleString("pt-BR", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </td>
                <td className="px-4 py-3">{m.produto}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded px-2 py-1 text-xs font-semibold ${CORES_MOVIMENTO[m.tipo] ?? ""}`}
                  >
                    {m.tipo.replace("_", " ")}
                  </span>
                </td>
                <td
                  className={`px-4 py-3 text-right tabular-nums ${
                    m.quantidade < 0 ? "text-red-600" : "text-emerald-700"
                  }`}
                >
                  {m.quantidade > 0 ? "+" : ""}
                  {qtd.format(m.quantidade)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-neutral-500">
                  {qtd.format(m.saldoDepois)}
                </td>
                <td className="px-4 py-3 text-neutral-500">{m.motivo ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {movimentos.length === 0 && (
          <p className="py-16 text-center text-sm text-neutral-400">Nenhuma movimentação ainda.</p>
        )}
      </div>
    </>
  );
}

const TITULOS: Record<Operacao, string> = {
  entrada: "Entrada de compra",
  perda: "Registrar perda",
  contagem: "Contagem de inventário",
};

function OperacaoForm({
  tipo,
  produto,
  pendente,
  onConfirmar,
  onCancelar,
}: {
  tipo: Operacao;
  produto: ProdutoEstoque;
  pendente: boolean;
  onConfirmar: (dados: { quantidade: number; custoTotal: number; motivo: string }) => void;
  onCancelar: () => void;
}) {
  const [quantidade, setQuantidade] = useState("");
  const [custoTotal, setCustoTotal] = useState("");
  const [motivo, setMotivo] = useState("");

  const numero = (texto: string) => Number(texto.replace(/\./g, "").replace(",", ".")) || 0;
  const qtdNum = numero(quantidade);
  const custoNum = numero(custoTotal);

  return (
    <div className="mt-6 rounded-xl border border-neutral-300 bg-white p-6">
      <h2 className="font-semibold">{TITULOS[tipo]}</h2>
      <p className="mb-4 mt-1 text-sm text-neutral-500">
        {produto.titulo} · saldo atual {qtd.format(produto.quantidade)} {produto.unidadeMedida}
      </p>

      <div className="grid gap-4 sm:grid-cols-3">
        <label>
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
            {tipo === "contagem" ? "Quantidade contada" : "Quantidade"} ({produto.unidadeMedida})
          </span>
          <input
            value={quantidade}
            onChange={(e) => setQuantidade(e.target.value)}
            inputMode="decimal"
            autoFocus
            placeholder="0"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 tabular-nums focus:border-neutral-900 focus:outline-none"
          />
        </label>

        {tipo === "entrada" && (
          <label>
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Valor total da nota
            </span>
            <input
              value={custoTotal}
              onChange={(e) => setCustoTotal(e.target.value)}
              inputMode="decimal"
              placeholder="0,00"
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 tabular-nums focus:border-neutral-900 focus:outline-none"
            />
            {qtdNum > 0 && custoNum > 0 && (
              <span className="mt-1 block text-xs text-neutral-500">
                {brl.format(custoNum / qtdNum)} por {produto.unidadeMedida}
              </span>
            )}
          </label>
        )}

        <label className={tipo === "entrada" ? "" : "sm:col-span-2"}>
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
            {tipo === "perda" ? "Motivo" : "Observação"}
          </span>
          <input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder={
              tipo === "perda" ? "quebra, vencimento, queimou..." : "fornecedor, nota, turno..."
            }
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 placeholder:text-xs placeholder:text-neutral-400 focus:border-neutral-900 focus:outline-none"
          />
        </label>
      </div>

      {tipo === "contagem" && quantidade !== "" && (
        <p className="mt-3 text-sm text-neutral-600">
          Diferença:{" "}
          <strong className="tabular-nums">
            {qtd.format(qtdNum - produto.quantidade)} {produto.unidadeMedida}
          </strong>
        </p>
      )}

      <div className="mt-6 flex gap-3">
        <button
          onClick={() => onConfirmar({ quantidade: qtdNum, custoTotal: custoNum, motivo })}
          disabled={pendente || quantidade === ""}
          className="rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-neutral-700 disabled:opacity-40"
        >
          {pendente ? "Salvando..." : "Confirmar"}
        </button>
        <button
          onClick={onCancelar}
          className="rounded-lg px-5 py-2.5 text-sm font-semibold text-neutral-500 transition hover:text-neutral-900"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
