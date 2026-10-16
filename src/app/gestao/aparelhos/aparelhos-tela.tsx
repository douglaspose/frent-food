"use client";

import { temErro, mensagemDeFalha } from "@/lib/erro-de-operacao";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cadastrarAparelho, revogarAparelho, trocarToken } from "./actions";

type Aparelho = {
  id: string;
  nome: string;
  tipo: string;
  token: string;
  ativo: boolean;
  /** Como ele se apresenta na fila de impressão, quando puxa papel. */
  apelido: string | null;
  ultimoContatoEm: string | null;
};

const TIPOS: Record<string, string> = {
  MAQUININHA: "Maquininha",
  AGENTE_IMPRESSAO: "Agente de impressão",
};

/**
 * Há quanto tempo o aparelho falou.
 *
 * Em palavras, e não em hora cheia: a pergunta que esta tela responde é "ele
 * está vivo?", e "há 2 min" responde na hora — "14:37" obriga a olhar o
 * relógio e fazer a conta.
 */
function desdeQuando(iso: string | null) {
  if (!iso) return "nunca falou";
  const minutos = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutos < 2) return "agora há pouco";
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `há ${horas}h`;
  return `há ${Math.floor(horas / 24)} dia(s)`;
}

export function AparelhosTela({
  unidade,
  aparelhos,
  temTokenDaUnidade,
  podeEditar,
}: {
  unidade: string;
  aparelhos: Aparelho[];
  temTokenDaUnidade: boolean;
  podeEditar: boolean;
}) {
  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState<"MAQUININHA" | "AGENTE_IMPRESSAO">("MAQUININHA");
  const [mostrando, setMostrando] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  const router = useRouter();

  function agir(fn: () => Promise<unknown>, aoConcluir?: () => void) {
    setErro(null);
    iniciar(async () => {
      try {
        const r = await fn();
        if (temErro(r)) {
          setErro(r.erro);
          return;
        }
        aoConcluir?.();
        router.refresh();
      } catch (e) {
        setErro(mensagemDeFalha(e, "Algo deu errado."));
      }
    });
  }

  const ativos = aparelhos.filter((a) => a.ativo);

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-2xl font-bold text-neutral-900">Aparelhos</h1>
      <p className="mt-1 text-sm text-neutral-500">
        {unidade} · {ativos.length} em uso
      </p>

      <div className="mt-6 rounded-xl border border-neutral-200 bg-white p-5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Como funciona
        </h2>
        <p className="mt-2 text-sm text-neutral-600">
          Cada aparelho que fala com o servidor sem ser por uma pessoa — a maquininha no bolso do
          garçom, o agente de impressão do balcão — entra aqui e recebe uma credencial própria.
          Assim, a maquininha que sumir se corta sozinha, sem derrubar as outras.
        </p>
        {temTokenDaUnidade && (
          <p className="mt-2 text-sm text-neutral-600">
            O token antigo da unidade continua valendo, em{" "}
            <span className="font-medium text-neutral-700">Impressão</span>: é o que o agente já
            instalado usa. Cadastre-o aqui quando quiser poder cortá-lo sem parar o resto.
          </p>
        )}
      </div>

      {erro && <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{erro}</p>}

      {podeEditar && (
        <form
          className="mt-6 flex flex-wrap items-end gap-3 rounded-xl border border-neutral-200 bg-white p-5"
          onSubmit={(e) => {
            e.preventDefault();
            agir(() => cadastrarAparelho(nome, tipo), () => setNome(""));
          }}
        >
          <label className="flex-1">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Nome
            </span>
            <input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Maquininha do salão"
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
            />
          </label>
          <label>
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Tipo
            </span>
            <select
              value={tipo}
              onChange={(e) => setTipo(e.target.value as typeof tipo)}
              className="rounded-lg border border-neutral-300 px-3 py-2 text-sm"
            >
              <option value="MAQUININHA">Maquininha</option>
              <option value="AGENTE_IMPRESSAO">Agente de impressão</option>
            </select>
          </label>
          <button
            type="submit"
            disabled={!nome.trim() || pendente}
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            Cadastrar
          </button>
        </form>
      )}

      <div className="mt-6 overflow-x-auto rounded-xl border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-4 py-3 font-semibold">Aparelho</th>
              <th className="px-4 py-3 font-semibold">Último contato</th>
              <th className="px-4 py-3 font-semibold">Credencial</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {aparelhos.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-neutral-500">
                  Nenhum aparelho cadastrado. O que já estiver funcionando com o token da unidade
                  continua funcionando.
                </td>
              </tr>
            )}
            {aparelhos.map((a) => (
              <tr key={a.id} className={a.ativo ? "" : "bg-neutral-50 text-neutral-400"}>
                <td className="px-4 py-3">
                  <span className="font-medium">{a.nome}</span>
                  <span className="ml-2 text-xs text-neutral-500">{TIPOS[a.tipo] ?? a.tipo}</span>
                  {!a.ativo && (
                    <span className="ml-2 rounded-md bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                      cortado
                    </span>
                  )}
                  {/* O apelido é como ele assina na fila: é por ele que se acha
                      de qual aparelho saiu um papel. */}
                  {a.apelido && (
                    <span className="ml-2 font-mono text-xs text-neutral-400">{a.apelido}</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-neutral-500">
                  {desdeQuando(a.ultimoContatoEm)}
                </td>
                <td className="px-4 py-3">
                  {/*
                    O token fica escondido até alguém pedir. Ele é digitado uma
                    vez no aparelho e não serve para mais nada depois — deixá-lo
                    à mostra numa tela que fica aberta no balcão é o jeito mais
                    fácil de ele acabar numa foto.
                  */}
                  {mostrando === a.id ? (
                    <code className="break-all font-mono text-xs text-neutral-700">{a.token}</code>
                  ) : (
                    <button
                      onClick={() => setMostrando(a.id)}
                      className="text-xs font-semibold text-neutral-500 underline"
                    >
                      mostrar
                    </button>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right">
                  {podeEditar && a.ativo && (
                    <>
                      <button
                        onClick={() => agir(() => trocarToken(a.id))}
                        disabled={pendente}
                        title="O aparelho para até alguém digitar a credencial nova."
                        className="text-xs font-semibold text-neutral-500 underline"
                      >
                        trocar credencial
                      </button>
                      {confirmando === a.id ? (
                        <button
                          onClick={() => agir(() => revogarAparelho(a.id), () => setConfirmando(null))}
                          disabled={pendente}
                          className="ml-3 rounded-md bg-red-600 px-2 py-1 text-xs font-semibold text-white"
                        >
                          confirmar corte
                        </button>
                      ) : (
                        <button
                          onClick={() => setConfirmando(a.id)}
                          className="ml-3 text-xs font-semibold text-red-600 underline"
                        >
                          cortar
                        </button>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
