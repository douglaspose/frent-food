"use client";

import { temErro } from "@/lib/erro-de-operacao";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { abrirComanda } from "../../actions";

export function AbrirForm({
  mesaId,
  capacidade,
  exigeNome,
}: {
  mesaId: string;
  capacidade: number;
  /**
   * Decide se o campo existe, não só se ele é obrigatório.
   *
   * Onde o nome não é exigido, ele quase nunca era preenchido — e um campo em
   * branco entre o número de pessoas e o botão custa um toque e uma leitura a
   * cada abertura de mesa, no horário em que há fila na porta. Quem precisa da
   * conta com dono liga o ajuste; para os outros, some da tela.
   */
  exigeNome: boolean;
}) {
  const [pessoas, setPessoas] = useState(capacidade);
  const [nome, setNome] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  const router = useRouter();

  function abrir() {
    setErro(null);
    iniciar(async () => {
      try {
        const r = await abrirComanda(mesaId, pessoas, nome);
        if (temErro(r)) {
          setErro(r.erro);
          return;
        }
        router.refresh();
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Não foi possível abrir a mesa.");
      }
    });
  }

  return (
    <div className="mt-8 space-y-5">
      <div>
        <label className="mb-2 block texto-etiqueta text-neutral-400">
          Pessoas
        </label>
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5, 6, 8, 10].map((n) => (
            <button
              key={n}
              onClick={() => setPessoas(n)}
              className={`h-12 w-12 rounded-lg text-lg font-semibold tabular-nums transition ${
                pessoas === n
                  ? "bg-orange-700 text-white"
                  : "bg-neutral-900 text-neutral-400 hover:bg-neutral-800"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      {exigeNome && (
        <div>
          <label className="mb-2 block texto-etiqueta text-neutral-400">
            Nome do cliente{" "}
            <span className="font-normal normal-case tracking-normal">(obrigatório)</span>
          </label>
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && abrir()}
            placeholder="Ex.: Douglas"
            className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 placeholder:text-neutral-600 focus:border-orange-600 focus:outline-none"
          />
        </div>
      )}

      {erro && <p className="text-sm text-red-400">{erro}</p>}

      <button
        onClick={abrir}
        disabled={pendente || (exigeNome && !nome.trim())}
        className="w-full rounded-lg bg-orange-700 py-4 text-lg font-semibold text-white transition hover:bg-orange-600 disabled:opacity-50"
      >
        {pendente ? "Abrindo..." : "Abrir mesa"}
      </button>
    </div>
  );
}
