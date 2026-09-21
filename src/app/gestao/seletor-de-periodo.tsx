"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ORDEM_DOS_ATALHOS, PERIODOS, type ChaveDePeriodo } from "@/lib/periodo";
import { CampoDeData } from "./campo-de-data";

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

  /**
   * Se os campos de data estão à mostra — e isto **não** é o mesmo que "o
   * período mostrado é personalizado".
   *
   * Era, e o botão ficava morto: ele navegava para `?periodo=personalizado`,
   * mas sem datas o `lerPeriodo` cai no padrão de 14 dias, a chave voltava
   * como "14", e os campos nunca apareciam. Clicar não fazia nada visível.
   *
   * Agora abrir o formulário é estado local e não navega: o período só muda
   * quando há duas datas e alguém aperta Aplicar.
   */
  const [camposAbertos, setCamposAbertos] = useState(chave === "personalizado");

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
          onClick={() => {
            // Escolher um atalho fecha o formulário: deixá-lo aberto sugeriria
            // que aquelas datas ainda valem para o que está na tela.
            setCamposAbertos(false);
            ir({ periodo: valor });
          }}
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

      {/*
        Este botão só abre o formulário — não navega. O preenchido continua
        seguindo o que a tela mostra de verdade: enquanto não houver duas datas
        aplicadas, quem fica marcado é o atalho que está valendo.
      */}
      <button
        onClick={() => setCamposAbertos(true)}
        aria-expanded={camposAbertos}
        aria-pressed={chave === "personalizado"}
        className={`realce-ao-toque shrink-0 touch-manipulation rounded-lg px-3 py-1.5 text-sm font-medium transition duration-100 active:scale-95 ${
          chave === "personalizado"
            ? "bg-neutral-900 text-white"
            : camposAbertos
              ? "bg-white text-neutral-900 ring-2 ring-neutral-400"
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
      {camposAbertos && (
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <CampoDeData
            rotulo="Data inicial"
            valor={abertoDe}
            max={abertoAte || undefined}
            aoMudar={setAbertoDe}
          />
          <span className="text-sm text-neutral-500">até</span>
          <CampoDeData
            rotulo="Data final"
            valor={abertoAte}
            min={abertoDe || undefined}
            aoMudar={setAbertoAte}
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
