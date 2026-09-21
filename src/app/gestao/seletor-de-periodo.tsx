"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ORDEM_DOS_ATALHOS, PERIODOS, type ChaveDePeriodo } from "@/lib/periodo";
import { CampoDeData, paraBr } from "./campo-de-data";

/**
 * O período vive na URL, não em estado local.
 *
 * Mesma razão do filtro do diário: "olha o faturamento da semana passada" é um
 * link que o dono manda no WhatsApp para o contador. Guardado no componente, o
 * link abriria no período padrão e a conversa recomeçaria.
 *
 * De quebra, o painel continua sendo renderizado no servidor: a página inteira
 * é recalculada com o período novo, sem o cliente buscar nada.
 *
 * O bloco tem três controles para **um** filtro só, e nenhum deles guarda
 * estado próprio: o select, os atalhos e o calendário escrevem na mesma URL, e
 * todos leem de volta a mesma `chave`. Clicar em "7 dias" move o select junto,
 * porque não há dois lugares onde a escolha possa discordar.
 */

/**
 * Os três que se usa todo dia, ao lado do select.
 *
 * A lista completa continua no select — isto aqui é atalho, não um segundo
 * conjunto de opções. Os rótulos são curtos de propósito: na linha do filtro
 * "Últimos 7 dias" ocupa o triplo de "7 dias" e diz o mesmo.
 */
const ATALHOS_RAPIDOS: { chave: ChaveDePeriodo; rotulo: string }[] = [
  { chave: "hoje", rotulo: "Hoje" },
  { chave: "7", rotulo: "7 dias" },
  { chave: "30", rotulo: "30 dias" },
];

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
   * Se o formulário de datas está à mostra — e isto **não** é o mesmo que "o
   * período mostrado é personalizado".
   *
   * Era, e o botão ficava morto: ele navegava para `?periodo=personalizado`,
   * mas sem datas o `lerPeriodo` cai no padrão de catorze dias e a chave
   * voltava como "14", então os campos nunca apareciam. Abrir o formulário é
   * estado local e não navega; o período só muda no Aplicar.
   */
  const [camposAbertos, setCamposAbertos] = useState(false);

  function ir(destino: Record<string, string>) {
    setCamposAbertos(false);
    router.push(`/gestao?${new URLSearchParams(destino)}`);
  }

  function aplicarPersonalizado() {
    // Sem as duas datas não há intervalo: deixa o botão quieto em vez de
    // navegar para uma tela que cairia no padrão sem explicar por quê.
    if (!abertoDe || !abertoAte) return;
    ir({ periodo: "personalizado", de: abertoDe, ate: abertoAte });
  }

  function cancelar() {
    // Volta ao que está valendo, e não ao que a pessoa digitou e desistiu.
    setAbertoDe(de ?? "");
    setAbertoAte(ate ?? "");
    setCamposAbertos(false);
  }

  /**
   * O que o select mostra quando o período é personalizado.
   *
   * "18/09/2026 — 20/09/2026" responde sozinho qual intervalo está valendo; a
   * palavra "Personalizado" obrigaria a abrir o formulário para descobrir.
   */
  const rotuloPersonalizado =
    chave === "personalizado" && de && ate
      ? `${paraBr(de)} — ${paraBr(ate)}`
      : PERIODOS.personalizado;

  /**
   * A forma dos controles, sem cor nenhuma.
   *
   * Fundo e borda ficam de fora de propósito: com `bg-white` aqui e
   * `bg-neutral-900` no estado ativo, as duas classes têm a mesma
   * especificidade e quem vence é a ordem da folha gerada — não a ordem em que
   * foram escritas. O botão ativo saía branco com texto branco, ou seja, vazio.
   */
  const controle = "h-10 rounded-lg border px-3 text-sm transition duration-100";

  const inativo = "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-100";
  const ativo = "border-neutral-900 bg-neutral-900 text-white";

  return (
    <div className="mt-4">
      {/*
        Um bloco só, com fundo mais claro que os cartões brancos por cima dele:
        é o que faz os três controles lerem como um conjunto, e não como três
        coisas soltas acima do painel.
      */}
      {/*
        Dois grupos, e `justify-between` os separa: os atalhos do dia a dia à
        esquerda, a lista inteira e o calendário à direita. No celular cada um
        ocupa a largura toda e eles empilham na ordem em que estão escritos —
        atalhos em cima, porque são o que se usa sem pensar.
      */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-neutral-200 bg-neutral-50 p-2">
        <div className="flex w-full gap-1 sm:w-auto">
          {ATALHOS_RAPIDOS.map((a) => {
            const aceso = chave === a.chave;
            return (
              <button
                key={a.chave}
                onClick={() => ir({ periodo: a.chave })}
                aria-pressed={aceso}
                className={`realce-ao-toque flex-1 touch-manipulation font-medium active:scale-95 sm:flex-none ${controle} ${
                  aceso ? ativo : inativo
                }`}
              >
                {a.rotulo}
              </button>
            );
          })}
        </div>

        <div className="flex w-full items-center gap-2 sm:w-auto">
          <span className="pl-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Período
          </span>

          {/*
            `select` nativo, como no Diário: no celular ele abre a rodinha do
            sistema, que é mais rápida e mais acessível que qualquer lista feita
            à mão — e é o padrão que o resto da gestão já usa.

            `flex-1` no celular para ele preencher o que sobra ao lado do
            calendário, em vez de deixar um vão à direita.
          */}
          <select
            value={chave}
            onChange={(e) => {
              const escolha = e.target.value as ChaveDePeriodo;
              // Personalizado sem datas não é um período: abre o formulário em
              // vez de navegar para algo que cairia no padrão.
              if (escolha === "personalizado") {
                setCamposAbertos(true);
                return;
              }
              ir({ periodo: escolha });
            }}
            aria-label="Período do painel"
            className={`${controle} min-w-0 flex-1 border-neutral-200 bg-white font-semibold text-neutral-900 sm:min-w-[11rem] sm:flex-none`}
          >
            {ORDEM_DOS_ATALHOS.map((valor) => (
              <option key={valor} value={valor}>
                {PERIODOS[valor]}
              </option>
            ))}
            <option value="personalizado">{rotuloPersonalizado}</option>
          </select>

          <button
            onClick={() => (camposAbertos ? cancelar() : setCamposAbertos(true))}
            aria-expanded={camposAbertos}
            aria-label="Escolher um período personalizado"
            className={`realce-ao-toque grid w-10 shrink-0 touch-manipulation place-items-center px-0 active:scale-95 ${controle} ${
              chave === "personalizado" || camposAbertos ? ativo : inativo
            }`}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="h-4 w-4"
            >
              <rect x="3" y="5" width="18" height="16" rx="2" />
              <path d="M3 10h18M8 3v4M16 3v4" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/*
          O formulário abre dentro do mesmo bloco, e não sobreposto: um popover
          exigiria fechar ao clicar fora, travar rolagem e devolver o foco — e
          aqui embaixo há espaço de sobra.
        */}
        {camposAbertos && (
          <div className="flex w-full flex-wrap items-center gap-2 border-t border-neutral-200 px-1 pt-3">
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

            <div className="flex gap-2">
              <button
                onClick={aplicarPersonalizado}
                disabled={!abertoDe || !abertoAte}
                className="realce-ao-toque touch-manipulation rounded-lg bg-neutral-900 px-4 py-1.5 text-sm font-semibold text-white transition duration-100 active:scale-95 disabled:opacity-40"
              >
                Aplicar
              </button>
              <button
                onClick={cancelar}
                className="realce-ao-toque touch-manipulation rounded-lg bg-white px-3 py-1.5 text-sm text-neutral-600 ring-1 ring-neutral-200 transition duration-100 hover:bg-neutral-50 active:scale-95"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
