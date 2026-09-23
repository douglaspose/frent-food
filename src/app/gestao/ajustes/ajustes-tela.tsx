"use client";

import { temErro, mensagemDeFalha } from "@/lib/erro-de-operacao";
import { Fragment, useState, useTransition } from "react";
import { GRUPOS, PARAMETROS, TITULO_DO_GRUPO, type Parametro } from "@/lib/parametros";
import type { AreaDaTaxa } from "@/lib/divisao-da-taxa";
import { salvarAjuste } from "./actions";
import { DivisaoDaTaxa } from "./divisao-da-taxa";

export function AjustesTela({
  valores,
  divisaoDaTaxa,
}: {
  valores: Record<string, boolean | number>;
  divisaoDaTaxa: AreaDaTaxa[];
}) {
  // Estado local para o interruptor responder ao dedo na hora; o servidor
  // confirma logo atrás e corrige se recusar.
  const [atual, setAtual] = useState(valores);
  const [salvando, setSalvando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [, iniciar] = useTransition();

  function salvar(chave: string, valor: boolean | number) {
    const anterior = atual[chave]!;
    setAtual((v) => ({ ...v, [chave]: valor }));
    setErro(null);
    setSalvando(chave);

    iniciar(async () => {
      try {
        const r = await salvarAjuste(chave, valor);
        // Recusa tem mensagem própria, escrita para quem está lendo a tela; só
        // o que **lançou** vira a frase genérica.
        if (temErro(r)) {
          setAtual((v) => ({ ...v, [chave]: anterior }));
          setErro(r.erro);
          return;
        }
        setAtual((v) => ({ ...v, [chave]: r.valor }));
      } catch (e) {
        // Volta ao que era: deixar o interruptor ligado depois de uma recusa
        // faria o gerente acreditar numa regra que não está valendo.
        setAtual((v) => ({ ...v, [chave]: anterior }));
        setErro(mensagemDeFalha(e, "Não foi possível salvar."));
      } finally {
        setSalvando(null);
      }
    });
  }

  return (
    <>
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Ajustes</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Como esta unidade opera. Cada mudança vale na hora, em todos os
          tablets, e fica registrada no diário.
        </p>
      </header>

      {erro && (
        <p className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">
          {erro}
        </p>
      )}

      <div className="space-y-6">
        {GRUPOS.map((grupo) => {
          const doGrupo = PARAMETROS.filter((p) => p.grupo === grupo);
          if (doGrupo.length === 0) return null;

          const secao = (
            <section key={grupo} className="rounded-xl border border-neutral-200 bg-white">
              <h2 className="border-b border-neutral-200 px-5 py-3 text-xs font-semibold uppercase tracking-widest text-neutral-500">
                {TITULO_DO_GRUPO[grupo]}
              </h2>
              <ul className="divide-y divide-neutral-100">
                {doGrupo.map((p) => (
                  <li key={p.chave} className="flex items-start gap-4 px-5 py-4">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{p.rotulo}</p>
                      {/* A explicação não é enfeite: um interruptor sem ela
                          vira adivinhação, e o gerente liga para descobrir. */}
                      <p className="mt-0.5 text-sm text-neutral-500">{p.explicacao}</p>
                    </div>

                    <Controle
                      parametro={p}
                      valor={atual[p.chave]!}
                      salvando={salvando === p.chave}
                      aoMudar={(v) => salvar(p.chave, v)}
                    />
                  </li>
                ))}
              </ul>
            </section>
          );

          // A divisão da taxa é do caixa, mas é uma lista, não um interruptor:
          // vem logo abaixo, com o editor próprio.
          if (grupo !== "CAIXA") return secao;
          return (
            <Fragment key={grupo}>
              {secao}
              <DivisaoDaTaxa salva={divisaoDaTaxa} />
            </Fragment>
          );
        })}
      </div>
    </>
  );
}

function Controle({
  parametro,
  valor,
  salvando,
  aoMudar,
}: {
  parametro: Parametro;
  valor: boolean | number;
  salvando: boolean;
  aoMudar: (valor: boolean | number) => void;
}) {
  if (parametro.tipo === "bool") {
    const ligado = Boolean(valor);
    return (
      <button
        role="switch"
        aria-checked={ligado}
        aria-label={parametro.rotulo}
        onClick={() => aoMudar(!ligado)}
        disabled={salvando}
        className={`relative mt-1 h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50 ${
          ligado ? "bg-emerald-600" : "bg-neutral-300"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
            ligado ? "left-[1.375rem]" : "left-0.5"
          }`}
        />
      </button>
    );
  }

  return <CampoNumero parametro={parametro} valor={Number(valor)} salvando={salvando} aoMudar={aoMudar} />;
}

/**
 * Número só salva ao sair do campo.
 *
 * Salvar a cada tecla gravaria "2" no caminho de "20" — e por um instante o
 * alerta de atraso da cozinha valeria dois minutos.
 */
function CampoNumero({
  parametro,
  valor,
  salvando,
  aoMudar,
}: {
  parametro: Parametro;
  valor: number;
  salvando: boolean;
  aoMudar: (valor: number) => void;
}) {
  const [texto, setTexto] = useState(String(valor));

  return (
    <div className="mt-1 flex shrink-0 items-center gap-2">
      <input
        key={valor}
        defaultValue={String(valor)}
        onChange={(e) => setTexto(e.target.value)}
        onBlur={() => {
          const n = Number(texto);
          if (Number.isFinite(n) && n !== valor) aoMudar(n);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        inputMode="numeric"
        disabled={salvando}
        aria-label={parametro.rotulo}
        className="w-20 rounded-lg border border-neutral-300 px-3 py-1.5 text-right tabular-nums focus:border-neutral-900 focus:outline-none disabled:opacity-50"
      />
      {parametro.sufixo && (
        <span className="w-6 text-sm text-neutral-500">{parametro.sufixo}</span>
      )}
    </div>
  );
}
