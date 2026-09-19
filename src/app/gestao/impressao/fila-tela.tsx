"use client";

import { temErro } from "@/lib/erro-de-operacao";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { descartar, gerarTokenImpressao, imprimirTeste, reimprimir } from "./actions";

type Trabalho = {
  id: string;
  tipo: string;
  titulo: string;
  status: string;
  conteudo: string;
  impressora: string | null;
  tentativas: number;
  erro: string | null;
  criadoEm: string;
};

type Impressora = {
  id: string;
  nome: string;
  conexao: string;
  endereco: string | null;
  ativo: boolean;
};

const CORES: Record<string, string> = {
  PENDENTE: "bg-amber-100 text-amber-800",
  IMPRESSO: "bg-emerald-100 text-emerald-800",
  ERRO: "bg-red-100 text-red-700",
};

export function FilaTela({
  unidade,
  token,
  trabalhos,
  impressoras,
  podeEditar,
}: {
  unidade: string;
  token: string | null;
  trabalhos: Trabalho[];
  impressoras: Impressora[];
  podeEditar: boolean;
}) {
  const [vendo, setVendo] = useState<Trabalho | null>(null);
  const [tokenNovo, setTokenNovo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  const router = useRouter();

  const naFila = trabalhos.filter((t) => t.status === "PENDENTE").length;

  function agir(fn: () => Promise<unknown>) {
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
          <h1 className="text-2xl font-bold tracking-tight">Impressão</h1>
          <p className="mt-1 text-sm text-neutral-500">
            {unidade} · {naFila} na fila
          </p>
        </div>
        {podeEditar && (
          <button
            onClick={() => agir(imprimirTeste)}
            disabled={pendente}
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-700 disabled:opacity-40"
          >
            Imprimir teste
          </button>
        )}
      </div>

      {erro && <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{erro}</p>}

      <section className="mt-6 rounded-xl border border-neutral-200 bg-white p-5">
        <h2 className="text-sm font-semibold">Agente de impressão</h2>
        <p className="mt-1 text-sm text-neutral-500">
          O servidor não fala com a impressora: ele enfileira, e o agente instalado no restaurante
          busca e imprime. Se a internet cair, a fila espera e nada se perde.
        </p>

        {podeEditar && (
          <div className="mt-4">
            {tokenNovo ? (
              <div className="rounded-lg bg-neutral-900 p-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                  Copie agora — não será mostrado de novo
                </p>
                <code className="block break-all font-mono text-sm text-emerald-400">
                  {tokenNovo}
                </code>
              </div>
            ) : (
              <p className="text-sm text-neutral-500">
                {token ? "Token configurado." : "Nenhum token gerado ainda."}
              </p>
            )}

            <button
              onClick={() =>
                agir(async () => {
                  const r = await gerarTokenImpressao();
                  if (temErro(r)) return r;
                  setTokenNovo(r);
                })
              }
              disabled={pendente}
              className="mt-3 rounded-lg bg-neutral-200 px-4 py-2 text-sm font-semibold text-neutral-700 transition hover:bg-neutral-300 disabled:opacity-40"
            >
              {token ? "Gerar novo token" : "Gerar token"}
            </button>
            {token && (
              <p className="mt-2 text-xs text-neutral-500">
                Gerar um novo invalida o anterior — o agente para até ser atualizado.
              </p>
            )}
          </div>
        )}

        <div className="mt-5 border-t border-neutral-100 pt-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Impressoras
          </h3>
          {impressoras.length === 0 ? (
            <p className="text-sm text-neutral-400">
              Nenhuma impressora cadastrada. Sem endereço configurado, os papéis ficam na fila.
            </p>
          ) : (
            <ul className="space-y-1 text-sm">
              {impressoras.map((i) => (
                <li key={i.id} className="flex gap-3">
                  <span className="font-medium">{i.nome}</span>
                  <span className="text-neutral-400">
                    {i.conexao} {i.endereco ?? "— sem endereço"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {vendo && (
        <section className="mt-6 rounded-xl border border-neutral-300 bg-white p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">{vendo.titulo}</h2>
            <button
              onClick={() => setVendo(null)}
              className="text-sm text-neutral-400 hover:text-neutral-900"
            >
              fechar
            </button>
          </div>
          {/* Fundo claro e monoespaçado: é a prévia de como sai no papel. */}
          <pre className="overflow-x-auto rounded-lg bg-neutral-50 p-4 font-mono text-xs leading-tight text-neutral-800">
            {vendo.conteudo}
          </pre>
        </section>
      )}

      <div className="mt-6 overflow-hidden rounded-xl border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-4 py-3 font-semibold">Hora</th>
              <th className="px-4 py-3 font-semibold">Documento</th>
              <th className="px-4 py-3 font-semibold">Impressora</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {trabalhos.map((t) => (
              <tr key={t.id}>
                <td className="whitespace-nowrap px-4 py-3 tabular-nums text-neutral-400">
                  {new Date(t.criadoEm).toLocaleTimeString("pt-BR", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </td>
                <td className="px-4 py-3">
                  {t.titulo}
                  {t.erro && <span className="ml-2 text-xs text-red-600">{t.erro}</span>}
                </td>
                <td className="px-4 py-3 text-neutral-500">{t.impressora ?? "—"}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded px-2 py-1 text-xs font-semibold ${CORES[t.status] ?? ""}`}
                  >
                    {t.status}
                  </span>
                  {t.tentativas > 0 && (
                    <span className="ml-2 text-xs text-neutral-400">{t.tentativas} tentativa(s)</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <span className="flex justify-end gap-3">
                    <button
                      onClick={() => setVendo(t)}
                      className="text-neutral-500 hover:text-neutral-900"
                    >
                      ver
                    </button>
                    {podeEditar && (
                      <button
                        onClick={() => agir(() => reimprimir(t.id))}
                        className="text-neutral-500 hover:text-neutral-900"
                      >
                        reimprimir
                      </button>
                    )}
                    {podeEditar && t.status === "PENDENTE" && (
                      <button
                        onClick={() => agir(() => descartar(t.id))}
                        className="text-neutral-400 hover:text-red-600"
                      >
                        descartar
                      </button>
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {trabalhos.length === 0 && (
          <p className="py-16 text-center text-sm text-neutral-400">Nada impresso ainda.</p>
        )}
      </div>
    </>
  );
}
