"use client";

import { useState, useTransition } from "react";
import { chamarGarcomPeloQr } from "./actions";

export function ChamarGarcom({ token, jaChamou }: { token: string; jaChamou: boolean }) {
  const [chamado, setChamado] = useState(jaChamou);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  function chamar() {
    setAviso(null);
    iniciar(async () => {
      const r = await chamarGarcomPeloQr(token);
      // Mesmo no caso do freio a resposta é tranquilizadora: do ponto de vista
      // do cliente, apertar de novo não deveria parecer um erro.
      if (r.erro) setAviso(r.erro);
      setChamado(true);
    });
  }

  if (chamado) {
    return (
      <div className="mt-12 max-w-xs">
        <p className="text-2xl font-semibold text-emerald-400">Garçom a caminho</p>
        <p className="mt-3 text-neutral-400">
          {aviso ?? "Já avisamos a equipe. Alguém vem até você em instantes."}
        </p>
      </div>
    );
  }

  return (
    <button
      onClick={chamar}
      disabled={pendente}
      // Botão grande de propósito: é usado com uma mão só, no escuro, com a
      // mesa cheia de copo.
      className="mt-12 w-full max-w-xs rounded-2xl bg-orange-600 px-8 py-8 text-2xl font-bold text-white transition hover:bg-orange-500 active:scale-95 disabled:opacity-50"
    >
      {pendente ? "Chamando..." : "Chamar garçom"}
    </button>
  );
}
