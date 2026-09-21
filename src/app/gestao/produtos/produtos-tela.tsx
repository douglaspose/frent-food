"use client";

import { temErro } from "@/lib/erro-de-operacao";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  alternarProdutoAtivo,
  atualizarProduto,
  criarCategoria,
  criarProduto,
  type DadosProduto,
} from "../actions";

type Opcao = { id: string; nome: string };

export type ProdutoView = DadosProduto & {
  id: string;
  categoriaNome: string;
  ativo: boolean;
};

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

const VAZIO: DadosProduto = {
  titulo: "",
  codigo: "",
  categoriaId: "",
  preco: 0,
  descricao: "",
  exigePontoCarne: false,
  maiorDeIdade: false,
  estacaoId: "",
  ncm: "",
  cest: "",
  perfilFiscalId: "",
};

export function ProdutosTela({
  produtos,
  categorias,
  estacoes,
  perfis,
  podeEditar,
}: {
  produtos: ProdutoView[];
  categorias: Opcao[];
  estacoes: Opcao[];
  perfis: Opcao[];
  podeEditar: boolean;
}) {
  const [editando, setEditando] = useState<ProdutoView | "novo" | null>(null);
  const [busca, setBusca] = useState("");
  const [novaCategoria, setNovaCategoria] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  const router = useRouter();

  const filtrados = produtos.filter(
    (p) =>
      !busca.trim() ||
      p.titulo.toLowerCase().includes(busca.trim().toLowerCase()) ||
      p.codigo.startsWith(busca.trim())
  );

  function agir(fn: () => Promise<unknown>, aoTerminar?: () => void) {
    setErro(null);
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
          <h1 className="text-2xl font-bold tracking-tight">Produtos</h1>
          <p className="mt-1 text-sm text-neutral-500">{produtos.length} cadastrados</p>
        </div>
        {podeEditar && (
          <button
            onClick={() => setEditando("novo")}
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-700"
          >
            Novo produto
          </button>
        )}
      </div>

      {erro && (
        <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{erro}</p>
      )}

      {editando && (
        <ProdutoForm
          inicial={editando === "novo" ? VAZIO : editando}
          categorias={categorias}
          estacoes={estacoes}
          perfis={perfis}
          pendente={pendente}
          onCancelar={() => setEditando(null)}
          onSalvar={(dados) =>
            agir(
              () =>
                editando === "novo"
                  ? criarProduto(dados)
                  : atualizarProduto(editando.id, dados),
              () => setEditando(null)
            )
          }
        />
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar produto ou código"
          className="w-full max-w-xs rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
        />

        {podeEditar && (
          <div className="flex gap-2">
            <input
              value={novaCategoria}
              onChange={(e) => setNovaCategoria(e.target.value)}
              placeholder="Nova categoria"
              className="w-40 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
            />
            <button
              onClick={() =>
                agir(() => criarCategoria(novaCategoria), () => setNovaCategoria(""))
              }
              disabled={pendente || !novaCategoria.trim()}
              className="rounded-lg bg-neutral-200 px-3 text-sm font-semibold text-neutral-700 transition hover:bg-neutral-300 disabled:opacity-40"
            >
              Criar
            </button>
          </div>
        )}
      </div>

      {/*
        Rola na horizontal em vez de cortar. Em 375px sobram 325px de largura
        para uma tabela que pede 581 — medido —, e com overflow-hidden as colunas
        de preço e de ações ficavam inalcançáveis no celular. Mesma solução do
        Diário, que já fazia assim.
      */}
      <div className="mt-4 overflow-x-auto rounded-xl border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-4 py-3 font-semibold">Código</th>
              <th className="px-4 py-3 font-semibold">Produto</th>
              <th className="px-4 py-3 font-semibold">Categoria</th>
              <th className="px-4 py-3 text-right font-semibold">Preço</th>
              <th className="px-4 py-3 font-semibold"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {filtrados.map((p) => (
              <tr key={p.id} className={p.ativo ? "" : "opacity-50"}>
                <td className="px-4 py-3 tabular-nums text-neutral-500">{p.codigo}</td>
                <td className="whitespace-nowrap px-4 py-3">
                  {p.titulo}
                  {p.exigePontoCarne && (
                    <span className="ml-2 rounded-md bg-red-50 px-1.5 py-0.5 text-[10px] font-bold text-red-600">
                      PONTO
                    </span>
                  )}
                  {p.maiorDeIdade && (
                    <span className="ml-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                      +18
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-neutral-500">{p.categoriaNome}</td>
                <td className="px-4 py-3 text-right tabular-nums">{brl.format(p.preco)}</td>
                <td className="px-4 py-3 text-right">
                  {podeEditar && (
                    <span className="flex justify-end gap-3">
                      <button
                        onClick={() => setEditando(p)}
                        className="text-neutral-500 hover:text-neutral-900"
                      >
                        editar
                      </button>
                      <button
                        onClick={() => agir(() => alternarProdutoAtivo(p.id, !p.ativo))}
                        className="text-neutral-500 hover:text-red-600"
                      >
                        {p.ativo ? "desativar" : "reativar"}
                      </button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {filtrados.length === 0 && (
          <p className="py-16 text-center text-sm text-neutral-500">Nenhum produto encontrado.</p>
        )}
      </div>
    </>
  );
}

function ProdutoForm({
  inicial,
  categorias,
  estacoes,
  perfis,
  pendente,
  onSalvar,
  onCancelar,
}: {
  inicial: DadosProduto;
  categorias: Opcao[];
  estacoes: Opcao[];
  perfis: Opcao[];
  pendente: boolean;
  onSalvar: (dados: DadosProduto) => void;
  onCancelar: () => void;
}) {
  const [dados, setDados] = useState<DadosProduto>(inicial);
  const [precoTexto, setPrecoTexto] = useState(
    inicial.preco ? inicial.preco.toFixed(2).replace(".", ",") : ""
  );

  function campo<K extends keyof DadosProduto>(chave: K, valor: DadosProduto[K]) {
    setDados((d) => ({ ...d, [chave]: valor }));
  }

  return (
    <div className="mt-6 rounded-xl border border-neutral-300 bg-white p-6">
      <h2 className="mb-4 font-semibold">{inicial.titulo ? "Editar produto" : "Novo produto"}</h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="sm:col-span-2">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Título
          </span>
          <input
            value={dados.titulo}
            onChange={(e) => campo("titulo", e.target.value)}
            autoFocus
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 focus:border-neutral-900 focus:outline-none"
          />
        </label>

        <label>
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Código
          </span>
          <input
            value={dados.codigo}
            onChange={(e) => campo("codigo", e.target.value)}
            inputMode="numeric"
            placeholder="o que o garçom digita no PDV"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 placeholder:text-xs placeholder:text-neutral-400 focus:border-neutral-900 focus:outline-none"
          />
        </label>

        <label>
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Preço
          </span>
          <input
            value={precoTexto}
            onChange={(e) => {
              setPrecoTexto(e.target.value);
              campo("preco", Number(e.target.value.replace(/\./g, "").replace(",", ".")) || 0);
            }}
            inputMode="decimal"
            placeholder="0,00"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 tabular-nums focus:border-neutral-900 focus:outline-none"
          />
        </label>

        <label>
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Categoria
          </span>
          <select
            value={dados.categoriaId}
            onChange={(e) => campo("categoriaId", e.target.value)}
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 focus:border-neutral-900 focus:outline-none"
          >
            <option value="">—</option>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Vai para
          </span>
          <select
            value={dados.estacaoId}
            onChange={(e) => campo("estacaoId", e.target.value)}
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 focus:border-neutral-900 focus:outline-none"
          >
            <option value="">Não vai para produção</option>
            {estacoes.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nome}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
            NCM
          </span>
          <input
            value={dados.ncm}
            onChange={(e) => campo("ncm", e.target.value)}
            inputMode="numeric"
            placeholder="8 dígitos — obrigatório para NFC-e"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 tabular-nums placeholder:text-xs placeholder:text-neutral-400 focus:border-neutral-900 focus:outline-none"
          />
        </label>

        <label>
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Perfil fiscal
          </span>
          <select
            value={dados.perfilFiscalId}
            onChange={(e) => campo("perfilFiscalId", e.target.value)}
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 focus:border-neutral-900 focus:outline-none"
          >
            <option value="">Usar o padrão</option>
            {perfis.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>
        </label>

        <label className="sm:col-span-2">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Descrição
          </span>
          <textarea
            value={dados.descricao}
            onChange={(e) => campo("descricao", e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 focus:border-neutral-900 focus:outline-none"
          />
        </label>

        <div className="flex gap-6 sm:col-span-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={dados.exigePontoCarne}
              onChange={(e) => campo("exigePontoCarne", e.target.checked)}
              className="h-4 w-4 accent-neutral-900"
            />
            Pergunta o ponto da carne
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={dados.maiorDeIdade}
              onChange={(e) => campo("maiorDeIdade", e.target.checked)}
              className="h-4 w-4 accent-neutral-900"
            />
            Proibido para menores
          </label>
        </div>
      </div>

      <div className="mt-6 flex gap-3">
        <button
          onClick={() => onSalvar(dados)}
          disabled={pendente || !dados.titulo.trim()}
          className="rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-neutral-700 disabled:opacity-40"
        >
          {pendente ? "Salvando..." : "Salvar"}
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
