"use client";

import { temErro, mensagemDeFalha } from "@/lib/erro-de-operacao";
import { useState, useTransition } from "react";
import {
  MAXIMO_DE_AREAS,
  TAMANHO_DO_NOME,
  validarDivisao,
  type AreaDaTaxa,
} from "@/lib/divisao-da-taxa";
import { salvarDivisaoDaTaxa } from "./actions";

/** Linha em edição: a parte fica como texto até salvar, para "4" não virar erro a caminho de "40". */
type Linha = { chave: number; nome: string; pct: string };

let proxima = 0;
const linha = (a?: AreaDaTaxa): Linha => ({
  chave: proxima++,
  nome: a?.nome ?? "",
  pct: a ? String(a.pct) : "",
});

const paraAreas = (linhas: Linha[]): AreaDaTaxa[] =>
  linhas.map((l) => ({ nome: l.nome.trim(), pct: l.pct.trim() === "" ? Number.NaN : Number(l.pct) }));

/**
 * As áreas que repartem a taxa de serviço.
 *
 * Ao contrário dos outros ajustes, tem botão de salvar: as partes só valem
 * juntas, somando 100. Gravando a cada campo, a divisão ficaria torta entre
 * uma digitação e outra — e um fechamento aberto nesse meio-tempo mostraria a
 * conta errada.
 */
export function DivisaoDaTaxa({ salva }: { salva: AreaDaTaxa[] }) {
  const [linhas, setLinhas] = useState<Linha[]>(() => salva.map(linha));
  const [gravada, setGravada] = useState(salva);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  const areas = paraAreas(linhas);
  const soma = areas.reduce((s, a) => s + (Number.isFinite(a.pct) ? a.pct : 0), 0);
  const mudou = JSON.stringify(areas) !== JSON.stringify(gravada);

  function mudar(chave: number, campo: "nome" | "pct", valor: string) {
    setAviso(null);
    setLinhas((ls) => ls.map((l) => (l.chave === chave ? { ...l, [campo]: valor } : l)));
  }

  function salvar() {
    setErro(null);
    setAviso(null);
    // A mesma conferência do servidor, antes de ir: a resposta vem na hora.
    const motivo = validarDivisao(areas);
    if (motivo) {
      setErro(motivo);
      return;
    }
    iniciar(async () => {
      try {
        const r = await salvarDivisaoDaTaxa(areas);
        // A recusa já vem escrita para a tela ("As áreas somam 110%...").
        if (temErro(r)) {
          setErro(r.erro);
          return;
        }
        setGravada(r.areas);
        setLinhas(r.areas.map(linha));
        setAviso(r.areas.length ? "Divisão salva." : "Salvo: a taxa não é mais dividida.");
      } catch (e) {
        setErro(mensagemDeFalha(e, "Não foi possível salvar."));
      }
    });
  }

  return (
    <section className="rounded-xl border border-neutral-200 bg-white">
      <h2 className="border-b border-neutral-200 px-5 py-3 text-xs font-semibold uppercase tracking-widest text-neutral-500">
        Divisão da taxa de serviço
      </h2>

      <div className="px-5 py-4">
        <p className="text-sm text-neutral-500">
          As áreas da equipe que repartem a taxa, e a parte de cada uma. A parte é da taxa, não
          da conta: com a taxa de 10%, uma área com 40% leva 4% da conta. O valor de cada área
          aparece no detalhe de cada fechamento de caixa.
        </p>

        {linhas.length === 0 ? (
          <p className="mt-4 rounded-lg bg-neutral-50 px-4 py-3 text-sm text-neutral-500">
            A taxa não é dividida: o fechamento de caixa mostra só o total.
          </p>
        ) : (
          <ul className="mt-4 space-y-2">
            {linhas.map((l) => {
              const pct = Number(l.pct);
              return (
                <li key={l.chave} className="flex flex-wrap items-center gap-2">
                  <input
                    value={l.nome}
                    onChange={(e) => mudar(l.chave, "nome", e.target.value)}
                    maxLength={TAMANHO_DO_NOME}
                    placeholder="Nome da área (ex.: Cozinha)"
                    aria-label="Nome da área"
                    className="min-w-0 flex-1 basis-40 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm focus:border-neutral-900 focus:outline-none"
                  />
                  <span className="flex items-center gap-1.5">
                    <input
                      value={l.pct}
                      onChange={(e) => mudar(l.chave, "pct", e.target.value)}
                      inputMode="numeric"
                      placeholder="0"
                      aria-label={`Parte de ${l.nome || "área"} na taxa`}
                      className="w-16 rounded-lg border border-neutral-300 px-3 py-1.5 text-right text-sm tabular-nums focus:border-neutral-900 focus:outline-none"
                    />
                    <span className="text-sm text-neutral-500">%</span>
                  </span>
                  <span className="w-28 text-xs text-neutral-500">
                    {Number.isFinite(pct) && pct > 0
                      ? `${(pct / 10).toLocaleString("pt-BR")}% da conta*`
                      : ""}
                  </span>
                  <button
                    onClick={() => {
                      setAviso(null);
                      setLinhas((ls) => ls.filter((x) => x.chave !== l.chave));
                    }}
                    className="text-sm text-neutral-500 hover:text-red-600"
                  >
                    remover
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-neutral-100 pt-4">
          <button
            onClick={() => {
              setAviso(null);
              setLinhas((ls) => [...ls, linha()]);
            }}
            disabled={linhas.length >= MAXIMO_DE_AREAS}
            className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 transition hover:border-neutral-900 disabled:opacity-40"
          >
            + Adicionar área
          </button>

          <div className="flex flex-wrap items-center gap-3">
            {linhas.length > 0 && (
              <span
                className={`text-sm tabular-nums ${soma === 100 ? "text-emerald-700" : "text-amber-700"}`}
              >
                {soma === 100
                  ? "Somam 100%"
                  : soma < 100
                    ? `Somam ${soma}% — faltam ${100 - soma}%`
                    : `Somam ${soma}% — passam ${soma - 100}%`}
              </span>
            )}
            <button
              onClick={salvar}
              disabled={pendente || !mudou}
              className="rounded-lg bg-neutral-900 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-neutral-700 disabled:opacity-40"
            >
              {pendente ? "Salvando..." : "Salvar divisão"}
            </button>
          </div>
        </div>

        {linhas.length > 0 && (
          <p className="mt-3 text-xs text-neutral-500">* considerando a taxa de 10%.</p>
        )}
        {erro && <p className="mt-3 text-sm text-red-600">{erro}</p>}
        {aviso && <p className="mt-3 text-sm text-emerald-700">{aviso}</p>}
      </div>
    </section>
  );
}
