"use client";

import { useState } from "react";
import { TEXTO_DE_CAMPO } from "@/lib/campo";

/** Depois disto o servidor recusa, e a tela não deve deixar digitar o que ele recusa. */
const LIMITE = 200;

/**
 * O recado da linha: "sem cebola", "molho à parte", "a salada vem depois".
 *
 * É digitação no salão, de pé, com o cliente falando — por isso o campo abre
 * com o texto que já estava e com o foco dentro, e "Limpar" é um botão, não um
 * apagar letra por letra. O mesmo diálogo que a maquininha mostra, e com o
 * mesmo exemplo escrito no campo vazio: quem aprendeu num não reaprende noutro.
 */
export function ObservacaoDoItem({
  titulo,
  observacao,
  pendente,
  aoSalvar,
  aoFechar,
}: {
  titulo: string;
  observacao: string | null;
  pendente: boolean;
  aoSalvar: (texto: string) => void;
  aoFechar: () => void;
}) {
  const [texto, setTexto] = useState(observacao ?? "");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/80 p-4">
      <div className="w-full max-w-md rounded-xl border border-neutral-800 bg-neutral-900 shadow-2xl">
        <div className="border-b border-neutral-800 px-5 py-4">
          <p className="text-base font-semibold">{titulo}</p>
          <p className="text-sm text-neutral-400">O que a cozinha precisa saber</p>
        </div>

        <div className="px-5 py-4">
          <textarea
            autoFocus
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            maxLength={LIMITE}
            rows={3}
            placeholder="sem cebola, molho à parte..."
            className={`w-full resize-none rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 outline-none focus:border-orange-600 ${TEXTO_DE_CAMPO}`}
          />
          {/*
            O contador só aparece perto do fim. Sempre à vista, ele viraria
            parte do campo e ninguém o leria justamente quando passa a importar.
          */}
          {texto.length > LIMITE - 40 && (
            <p className="mt-1 text-right text-[11px] tabular-nums text-neutral-500">
              {LIMITE - texto.length} caracteres
            </p>
          )}
        </div>

        <div className="flex gap-2 border-t border-neutral-800 px-5 py-4">
          <button
            onClick={aoFechar}
            className="h-12 flex-1 rounded-lg border border-neutral-700 text-sm font-semibold transition hover:bg-neutral-800"
          >
            Cancelar
          </button>
          {/* Só quando há recado gravado: num item sem observação, "Limpar" é
              um botão que não faz nada e ainda divide o espaço do que faz. */}
          {observacao && (
            <button
              onClick={() => aoSalvar("")}
              disabled={pendente}
              className="h-12 flex-1 rounded-lg border border-neutral-700 text-sm font-semibold text-neutral-400 transition hover:bg-neutral-800 disabled:opacity-40"
            >
              Limpar
            </button>
          )}
          <button
            onClick={() => aoSalvar(texto)}
            disabled={pendente}
            className="h-12 flex-[2] rounded-lg bg-orange-600 text-sm font-bold transition hover:bg-orange-500 disabled:opacity-40"
          >
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}
