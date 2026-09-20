"use client";

import { useState, useTransition } from "react";
import { TIPOS_DE_AUTORIZACAO, type TipoAutorizacao } from "@/lib/autorizacao";
import { pedirAutorizacao } from "./autorizacao-actions";

const TECLAS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

/**
 * O gerente libera a ação no próprio tablet do garçom.
 *
 * Sem isto, a saída real era o gerente emprestar o PIN — e aí todo desconto
 * da casa fica no nome dele, o que é pior que não ter controle nenhum, porque
 * parece controle. Aqui o registro sai certo: feito por quem fez, liberado por
 * quem liberou.
 */
export function PainelAutorizacao({
  tipo,
  referenciaId,
  motivo,
  aoLiberar,
  aoDesistir,
}: {
  tipo: TipoAutorizacao;
  referenciaId: string;
  motivo?: string;
  /** Recebe o id da liberação para repetir a ação que foi barrada. */
  aoLiberar: (autorizacaoId: string) => void;
  aoDesistir: () => void;
}) {
  const [pin, setPin] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  function digitar(tecla: string) {
    if (pendente) return;
    setErro(null);
    const novo = (pin + tecla).slice(0, 4);
    setPin(novo);
    // Confere sozinho no quarto dígito: quem está com a mão no tablet é o
    // gerente de passagem, e um botão a mais é um passo a mais na mesa.
    if (novo.length === 4) enviar(novo);
  }

  function enviar(valor: string) {
    iniciar(async () => {
      const r = await pedirAutorizacao(tipo, referenciaId, valor, motivo);
      if (r.ok) {
        aoLiberar(r.id);
        return;
      }
      setErro(r.motivo);
      // Limpa sempre depois de recusar: metade de um PIN na tela é convite
      // para a próxima pessoa tentar adivinhar o resto.
      setPin("");
    });
  }

  /**
   * Sobreposição, não um bloco na coluna.
   *
   * O painel apareceu primeiro embutido na comanda, e numa coluna estreita o
   * teclado ficava espremido em noventa pixels — inutilizável com o dedo. E é
   * o momento em que o tablet troca de mão: o gerente precisa ver uma coisa
   * só, em alvo grande, sem caçar o campo.
   */
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/80 p-4">
      <div className="w-full max-w-sm rounded-xl border border-neutral-800 bg-neutral-900 p-6 shadow-2xl">
        <p className="text-center text-base font-semibold text-amber-300">
          {TIPOS_DE_AUTORIZACAO[tipo].titulo}
        </p>
        <p className="mt-1 text-center text-sm text-neutral-400">
          Peça a quem tem a permissão para digitar o PIN.
        </p>

        <div className="my-6 flex justify-center gap-3">
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className={`h-3.5 w-3.5 rounded-full transition ${
                i < pin.length ? "bg-amber-400" : "bg-neutral-700"
              }`}
            />
          ))}
        </div>

        <div className="grid grid-cols-3 gap-3">
          {TECLAS.map((t) => (
            <button
              key={t}
              onClick={() => digitar(t)}
              disabled={pendente}
              className="h-16 rounded-xl bg-neutral-800 text-2xl font-semibold text-neutral-100 transition hover:bg-neutral-700 disabled:opacity-40"
            >
              {t}
            </button>
          ))}
          <button
            onClick={aoDesistir}
            disabled={pendente}
            className="h-16 rounded-xl bg-neutral-800 text-sm font-semibold text-neutral-500 transition hover:bg-neutral-700 disabled:opacity-40"
          >
            Voltar
          </button>
          <button
            onClick={() => digitar("0")}
            disabled={pendente}
            className="h-16 rounded-xl bg-neutral-800 text-2xl font-semibold text-neutral-100 transition hover:bg-neutral-700 disabled:opacity-40"
          >
            0
          </button>
          <button
            onClick={() => {
              setErro(null);
              setPin((p) => p.slice(0, -1));
            }}
            disabled={pendente}
            className="h-16 rounded-xl bg-neutral-800 text-2xl text-neutral-400 transition hover:bg-neutral-700 disabled:opacity-40"
          >
            ←
          </button>
        </div>

        {pendente && <p className="mt-4 text-center text-sm text-neutral-500">Conferindo…</p>}
        {erro && <p className="mt-4 text-center text-sm text-red-400">{erro}</p>}
      </div>
    </div>
  );
}
