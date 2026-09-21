"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ORDEM_DOS_ATALHOS, PERIODOS, type ChaveDePeriodo } from "@/lib/periodo";

/**
 * O período vive na URL, não em estado local.
 *
 * Mesma razão do filtro do diário: "olha o faturamento da semana passada" é um
 * link que o dono manda no WhatsApp para o contador. Guardado no componente, o
 * link abriria no período padrão e a conversa recomeçaria.
 *
 * De quebra, o painel continua sendo renderizado no servidor: a página inteira
 * é recalculada com o período novo, sem o cliente buscar nada.
 */
const ATALHOS = ORDEM_DOS_ATALHOS.map((chave) => [chave, PERIODOS[chave]] as const);

export function SeletorDePeriodo({
  chave,
  de,
  ate,
}: {
  chave: ChaveDePeriodo;
  de?: string;
  ate?: string;
}) {
  const router = useRouter();
  const [abertoDe, setAbertoDe] = useState(de ?? "");
  const [abertoAte, setAbertoAte] = useState(ate ?? "");

  const personalizado = chave === "personalizado";

  function ir(destino: Record<string, string>) {
    router.push(`/gestao?${new URLSearchParams(destino)}`);
  }

  function aplicarPersonalizado() {
    // Sem as duas datas não há intervalo: deixa o botão quieto em vez de
    // navegar para uma tela que cairia no padrão sem explicar por quê.
    if (!abertoDe || !abertoAte) return;
    ir({ periodo: "personalizado", de: abertoDe, ate: abertoAte });
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      {ATALHOS.map(([valor, rotulo]) => (
        <button
          key={valor}
          onClick={() => ir({ periodo: valor })}
          aria-pressed={chave === valor}
          className={`realce-ao-toque shrink-0 touch-manipulation rounded-lg px-3 py-1.5 text-sm font-medium transition duration-100 active:scale-95 ${
            chave === valor
              ? "bg-neutral-900 text-white"
              : "bg-white text-neutral-600 ring-1 ring-neutral-200 hover:bg-neutral-50"
          }`}
        >
          {rotulo}
        </button>
      ))}

      <button
        onClick={() => (personalizado ? undefined : ir({ periodo: "personalizado" }))}
        aria-pressed={personalizado}
        className={`realce-ao-toque shrink-0 touch-manipulation rounded-lg px-3 py-1.5 text-sm font-medium transition duration-100 active:scale-95 ${
          personalizado
            ? "bg-neutral-900 text-white"
            : "bg-white text-neutral-600 ring-1 ring-neutral-200 hover:bg-neutral-50"
        }`}
      >
        Personalizado
      </button>

      {/*
        Os campos só aparecem depois de escolher "Personalizado". Deixá-los
        sempre à mostra somaria dois controles a uma linha que já tem oito
        botões, para uma escolha que é a exceção.
      */}
      {personalizado && (
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <input
            type="date"
            value={abertoDe}
            max={abertoAte || undefined}
            onChange={(e) => setAbertoDe(e.target.value)}
            aria-label="Data inicial"
            className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm"
          />
          <span className="text-sm text-neutral-500">até</span>
          <input
            type="date"
            value={abertoAte}
            min={abertoDe || undefined}
            onChange={(e) => setAbertoAte(e.target.value)}
            aria-label="Data final"
            className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm"
          />
          <button
            onClick={aplicarPersonalizado}
            disabled={!abertoDe || !abertoAte}
            className="realce-ao-toque touch-manipulation rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-semibold text-white transition duration-100 active:scale-95 disabled:opacity-40"
          >
            Aplicar
          </button>
        </div>
      )}
    </div>
  );
}
