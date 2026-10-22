"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { temErro, mensagemDeFalha } from "@/lib/erro-de-operacao";
import { lerPreco } from "../cardapio/cardapio-editor";
import { Recusa } from "../recusa";
import {
  alternarOpcaoAtiva,
  atualizarGrupo,
  criarGrupo,
  criarOpcao,
  desvincularProduto,
  excluirGrupo,
  excluirOpcao,
  vincularProduto,
  type DadosDoGrupo,
} from "./actions";

export type OpcaoNaTela = {
  id: string;
  titulo: string;
  preco: number;
  ativo: boolean;
  produtoId: string | null;
};

export type GrupoNaTela = {
  id: string;
  titulo: string;
  minEscolhas: number;
  maxEscolhas: number;
  obrigatorio: boolean;
  opcoes: OpcaoNaTela[];
  produtos: { id: string; titulo: string }[];
};

export type ProdutoNaLista = { id: string; titulo: string };

const brl = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2 });

const GRUPO_VAZIO: DadosDoGrupo = {
  titulo: "",
  minEscolhas: 1,
  maxEscolhas: 1,
  obrigatorio: true,
};

/**
 * Descreve a regra em palavras.
 *
 * "min 1 / max 1" é como o banco guarda, mas quem lê a tela quer saber o que
 * vai acontecer na maquininha: o garçom é obrigado a escolher uma, ou pode
 * marcar até três e seguir sem nenhuma.
 */
function descreverRegra(g: { minEscolhas: number; maxEscolhas: number; obrigatorio: boolean }) {
  const minimo = g.obrigatorio ? Math.max(1, g.minEscolhas) : g.minEscolhas;
  /*
   * Regra impossível se anuncia: "escolha de 3 a 1" soava como uma regra
   * qualquer, e o gerente só descobria o problema ao tocar em Salvar. Um
   * grupo assim nunca poderia ser lançado — o garçom ficaria preso na tela
   * da maquininha sem conseguir atender a exigência.
   */
  if (minimo > g.maxEscolhas) return "regra impossível — o mínimo passa do máximo";
  if (g.maxEscolhas < 1) return "regra impossível — o máximo tem de ser pelo menos 1";
  if (minimo === 0) {
    return g.maxEscolhas === 1 ? "opcional, uma opção" : `opcional, até ${g.maxEscolhas}`;
  }
  if (minimo === g.maxEscolhas) {
    return minimo === 1 ? "escolha obrigatória de 1" : `escolha obrigatória de ${minimo}`;
  }
  return `escolha de ${minimo} a ${g.maxEscolhas}`;
}

export function OpcionaisTela({
  grupos,
  produtos,
  podeEditar,
}: {
  grupos: GrupoNaTela[];
  produtos: ProdutoNaLista[];
  podeEditar: boolean;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<GrupoNaTela | "novo" | null>(null);
  const [pendente, iniciar] = useTransition();
  const router = useRouter();

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
        setErro(mensagemDeFalha(e, "Algo deu errado."));
      }
    });
  }

  return (
    <>
      {erro && <Recusa>{erro}</Recusa>}

      {podeEditar && (
        <div className="mt-4">
          {editando === "novo" ? (
            <GrupoForm
              inicial={GRUPO_VAZIO}
              pendente={pendente}
              onCancelar={() => setEditando(null)}
              onSalvar={(dados) => agir(() => criarGrupo(dados), () => setEditando(null))}
            />
          ) : (
            <button
              onClick={() => setEditando("novo")}
              className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-700"
            >
              Novo grupo
            </button>
          )}
        </div>
      )}

      {grupos.length === 0 && (
        <p className="mt-6 rounded-lg border border-dashed border-neutral-300 px-4 py-8 text-center text-sm text-neutral-500">
          Um grupo é uma pergunta que a maquininha faz ao lançar o prato: &ldquo;qual o ponto
          da carne?&rdquo;, &ldquo;quer adicionais?&rdquo;. Depois de criar, ligue o grupo
          aos produtos que ele acompanha.
        </p>
      )}

      <div className="mt-6 space-y-4">
        {grupos.map((grupo) => (
          <section key={grupo.id} className="rounded-xl border border-neutral-200 bg-white p-4">
            {editando !== "novo" && editando?.id === grupo.id ? (
              <GrupoForm
                inicial={grupo}
                pendente={pendente}
                onCancelar={() => setEditando(null)}
                onSalvar={(dados) =>
                  agir(() => atualizarGrupo(grupo.id, dados), () => setEditando(null))
                }
              />
            ) : (
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <h2 className="font-semibold">{grupo.titulo}</h2>
                  <p className="text-xs text-neutral-500">{descreverRegra(grupo)}</p>
                </div>
                {podeEditar && (
                  <div className="flex gap-3 text-sm">
                    <button
                      onClick={() => setEditando(grupo)}
                      className="text-neutral-600 underline hover:text-neutral-900"
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => {
                        /*
                         * A conta antiga não muda: cada escolha já lançada
                         * guarda título e preço próprios. Vale dizer isso aqui,
                         * senão ninguém se atreve a apagar nada.
                         */
                        if (
                          confirm(
                            `Apagar "${grupo.titulo}" e suas opções?\n\n` +
                              "As contas já lançadas não mudam: cada escolha guarda o título e o preço do dia em que foi pedida."
                          )
                        ) {
                          agir(() => excluirGrupo(grupo.id));
                        }
                      }}
                      className="text-red-600 underline hover:text-red-800"
                    >
                      Apagar
                    </button>
                  </div>
                )}
              </div>
            )}

            <Opcoes
              grupo={grupo}
              produtos={produtos}
              podeEditar={podeEditar}
              pendente={pendente}
              agir={agir}
            />

            <ProdutosDoGrupo
              grupo={grupo}
              produtos={produtos}
              podeEditar={podeEditar}
              pendente={pendente}
              agir={agir}
            />
          </section>
        ))}
      </div>
    </>
  );
}

/** As opções do grupo: o que o garçom vai poder marcar. */
function Opcoes({
  grupo,
  produtos,
  podeEditar,
  pendente,
  agir,
}: {
  grupo: GrupoNaTela;
  produtos: ProdutoNaLista[];
  podeEditar: boolean;
  pendente: boolean;
  agir: (fn: () => Promise<unknown>, aoTerminar?: () => void) => void;
}) {
  const [titulo, setTitulo] = useState("");
  const [preco, setPreco] = useState("");
  const [produtoId, setProdutoId] = useState("");

  return (
    <div className="mt-3">
      <ul className="divide-y divide-neutral-100">
        {grupo.opcoes.map((opcao) => (
          <li key={opcao.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
            <span className={opcao.ativo ? "" : "text-neutral-400 line-through"}>
              {opcao.titulo}
            </span>
            {opcao.preco > 0 && (
              <span className="text-neutral-500">+ R$ {brl.format(opcao.preco)}</span>
            )}
            {opcao.produtoId && (
              // Dizer que baixa estoque importa: é a diferença entre um texto
              // solto e um item que sai do inventário a cada pedido.
              <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] text-neutral-600">
                baixa estoque
              </span>
            )}
            {podeEditar && (
              <span className="ml-auto flex gap-3">
                <button
                  disabled={pendente}
                  onClick={() => agir(() => alternarOpcaoAtiva(opcao.id, !opcao.ativo))}
                  className="text-neutral-600 underline hover:text-neutral-900"
                >
                  {opcao.ativo ? "Desativar" : "Reativar"}
                </button>
                <button
                  disabled={pendente}
                  onClick={() => agir(() => excluirOpcao(opcao.id))}
                  className="text-red-600 underline hover:text-red-800"
                >
                  Apagar
                </button>
              </span>
            )}
          </li>
        ))}
        {grupo.opcoes.length === 0 && (
          <li className="py-2 text-sm text-neutral-500">
            Sem opções ainda. Um grupo vazio não aparece na maquininha.
          </li>
        )}
      </ul>

      {podeEditar && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="Nova opção"
            className="w-40 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm focus:border-neutral-900 focus:outline-none"
          />
          <input
            value={preco}
            onChange={(e) => setPreco(e.target.value)}
            placeholder="Preço (0)"
            className="w-24 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm focus:border-neutral-900 focus:outline-none"
          />
          <select
            value={produtoId}
            onChange={(e) => setProdutoId(e.target.value)}
            className="w-48 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm focus:border-neutral-900 focus:outline-none"
          >
            <option value="">Não sai do estoque</option>
            {produtos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.titulo}
              </option>
            ))}
          </select>
          <button
            disabled={pendente || !titulo.trim()}
            onClick={() =>
              agir(
                () =>
                  criarOpcao(grupo.id, {
                    titulo,
                    // Em branco é de graça: "sem cebola" não tem preço, e
                    // obrigar a digitar zero só atrasa o cadastro.
                    preco: preco.trim() ? lerPreco(preco) : 0,
                    produtoId: produtoId || null,
                  }),
                () => {
                  setTitulo("");
                  setPreco("");
                  setProdutoId("");
                }
              )
            }
            className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium transition hover:bg-neutral-100 disabled:opacity-50"
          >
            Adicionar opção
          </button>
        </div>
      )}
    </div>
  );
}

/** Os produtos que fazem a pergunta. Sem nenhum, o grupo não aparece. */
function ProdutosDoGrupo({
  grupo,
  produtos,
  podeEditar,
  pendente,
  agir,
}: {
  grupo: GrupoNaTela;
  produtos: ProdutoNaLista[];
  podeEditar: boolean;
  pendente: boolean;
  agir: (fn: () => Promise<unknown>, aoTerminar?: () => void) => void;
}) {
  const [produtoId, setProdutoId] = useState("");
  const ligados = new Set(grupo.produtos.map((p) => p.id));
  const disponiveis = produtos.filter((p) => !ligados.has(p.id));

  return (
    <div className="mt-3 border-t border-neutral-100 pt-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
        Pratos que usam este grupo
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {grupo.produtos.map((p) => (
          <span
            key={p.id}
            className="flex items-center gap-1.5 rounded-full bg-neutral-100 px-2.5 py-1 text-sm"
          >
            {p.titulo}
            {podeEditar && (
              <button
                disabled={pendente}
                onClick={() => agir(() => desvincularProduto(grupo.id, p.id))}
                className="text-neutral-500 hover:text-red-600"
                aria-label={`Tirar ${p.titulo}`}
              >
                ×
              </button>
            )}
          </span>
        ))}
        {grupo.produtos.length === 0 && (
          <span className="text-sm text-neutral-500">
            Nenhum ainda — enquanto isso, o grupo não aparece na maquininha.
          </span>
        )}
      </div>

      {podeEditar && disponiveis.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select
            value={produtoId}
            onChange={(e) => setProdutoId(e.target.value)}
            className="w-56 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm focus:border-neutral-900 focus:outline-none"
          >
            <option value="">Escolha um prato</option>
            {disponiveis.map((p) => (
              <option key={p.id} value={p.id}>
                {p.titulo}
              </option>
            ))}
          </select>
          <button
            disabled={pendente || !produtoId}
            onClick={() =>
              agir(() => vincularProduto(grupo.id, produtoId), () => setProdutoId(""))
            }
            className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium transition hover:bg-neutral-100 disabled:opacity-50"
          >
            Ligar ao grupo
          </button>
        </div>
      )}
    </div>
  );
}

/** O formulário do grupo: título e a regra de quantas escolhas. */
function GrupoForm({
  inicial,
  pendente,
  onCancelar,
  onSalvar,
}: {
  inicial: DadosDoGrupo;
  pendente: boolean;
  onCancelar: () => void;
  onSalvar: (dados: DadosDoGrupo) => void;
}) {
  const [titulo, setTitulo] = useState(inicial.titulo);
  const [min, setMin] = useState(String(inicial.minEscolhas));
  const [max, setMax] = useState(String(inicial.maxEscolhas));
  const [obrigatorio, setObrigatorio] = useState(inicial.obrigatorio);

  const dados: DadosDoGrupo = {
    titulo,
    minEscolhas: Number(min) || 0,
    maxEscolhas: Number(max) || 1,
    obrigatorio,
  };

  return (
    <div className="rounded-xl border border-neutral-300 bg-neutral-50 p-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="block text-xs text-neutral-500">Título</span>
          <input
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="Ponto da carne"
            className="mt-1 w-48 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm focus:border-neutral-900 focus:outline-none"
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-neutral-500">Mínimo</span>
          <input
            value={min}
            onChange={(e) => setMin(e.target.value)}
            inputMode="numeric"
            className="mt-1 w-20 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm focus:border-neutral-900 focus:outline-none"
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-neutral-500">Máximo</span>
          <input
            value={max}
            onChange={(e) => setMax(e.target.value)}
            inputMode="numeric"
            className="mt-1 w-20 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm focus:border-neutral-900 focus:outline-none"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={obrigatorio}
            onChange={(e) => setObrigatorio(e.target.checked)}
          />
          Obrigatório
        </label>
      </div>

      {/* O que vai acontecer na maquininha, em palavras, antes de salvar. */}
      <p className="mt-2 text-xs text-neutral-500">Na maquininha: {descreverRegra(dados)}</p>

      <div className="mt-3 flex gap-2">
        <button
          disabled={pendente || !titulo.trim()}
          onClick={() => onSalvar(dados)}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-700 disabled:opacity-50"
        >
          Salvar
        </button>
        <button
          onClick={onCancelar}
          className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium transition hover:bg-neutral-100"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
