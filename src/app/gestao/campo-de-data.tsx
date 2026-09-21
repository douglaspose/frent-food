"use client";

import { useRef, useState } from "react";

/**
 * Campo de data no formato brasileiro, com o calendário nativo ao lado.
 *
 * Existe porque `<input type="date">` **não** aceita formato: ele desenha a
 * data no idioma do navegador, e num Chrome em inglês aparecia "09/11/2026"
 * para 11 de setembro — dia e mês trocados, que num relatório financeiro é o
 * tipo de engano que ninguém percebe até a conta não bater.
 *
 * A solução é digitar em texto, com máscara. O que se perderia era o
 * calendário, então ele fica num botão ao lado: um `input type="date"`
 * invisível que o botão abre com `showPicker()`. No celular isso também
 * devolve a rodinha de data do sistema, que é mais rápida que digitar.
 */

/** "2026-09-11" → "11/09/2026" */
export function paraBr(iso: string) {
  if (!iso) return "";
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
}

/** "11/09/2026" → "2026-09-11", ou "" quando a data não existe. */
export function paraIso(br: string) {
  const casa = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(br);
  if (!casa) return "";

  const [, dia, mes, ano] = casa.map(Number);
  const data = new Date(ano!, mes! - 1, dia!);
  // Rejeita 31/02/2026, que o Date aceitaria virando 3 de março.
  const bate = data.getFullYear() === ano && data.getMonth() === mes! - 1 && data.getDate() === dia;
  if (!bate) return "";

  const doisDigitos = (n: number) => String(n).padStart(2, "0");
  return `${ano}-${doisDigitos(mes!)}-${doisDigitos(dia!)}`;
}

/**
 * Põe as barras enquanto a pessoa digita: "1109" vira "11/09".
 *
 * Trabalha só com os dígitos, e não com o texto como veio. Assim apagar com
 * backspace funciona sem caso especial — some um dígito, a máscara se refaz — e
 * colar "11-09-2026" ou "11.09.2026" entra igual.
 */
export function mascarar(texto: string) {
  const digitos = texto.replace(/\D/g, "").slice(0, 8);
  return [digitos.slice(0, 2), digitos.slice(2, 4), digitos.slice(4, 8)]
    .filter((parte) => parte.length > 0)
    .join("/");
}

export function CampoDeData({
  rotulo,
  valor,
  aoMudar,
  min,
  max,
}: {
  rotulo: string;
  /** Sempre em ISO ("2026-09-11"), que é o que o resto do painel fala. */
  valor: string;
  aoMudar: (iso: string) => void;
  min?: string;
  max?: string;
}) {
  const [texto, setTexto] = useState(paraBr(valor));
  const calendario = useRef<HTMLInputElement>(null);

  // Oito dígitos que não formam data — 31/02, por exemplo. Enquanto está pela
  // metade não é erro, é alguém digitando.
  const invalido = texto.replace(/\D/g, "").length === 8 && paraIso(texto) === "";

  function digitou(bruto: string) {
    const mascarado = mascarar(bruto);
    setTexto(mascarado);
    aoMudar(paraIso(mascarado));
  }

  function escolheuNoCalendario(iso: string) {
    setTexto(paraBr(iso));
    aoMudar(iso);
  }

  function abrirCalendario() {
    const campo = calendario.current;
    if (!campo) return;
    // `showPicker` não existe em navegador antigo; aí o foco ao menos leva a
    // pessoa até o controle nativo em vez de o botão não fazer nada.
    if (typeof campo.showPicker === "function") campo.showPicker();
    else campo.focus();
  }

  return (
    <div
      className={`flex items-center rounded-lg border bg-white ${
        invalido ? "border-red-400" : "border-neutral-200"
      }`}
    >
      <input
        type="text"
        value={texto}
        onChange={(e) => digitou(e.target.value)}
        inputMode="numeric"
        placeholder="dd/mm/aaaa"
        maxLength={10}
        aria-label={rotulo}
        aria-invalid={invalido}
        className="w-[7.5rem] bg-transparent px-3 py-1.5 text-sm tabular-nums outline-none"
      />

      <button
        type="button"
        onClick={abrirCalendario}
        aria-label={`Escolher ${rotulo.toLowerCase()} no calendário`}
        className="realce-ao-toque touch-manipulation rounded-r-lg px-2 py-1.5 text-neutral-500 transition duration-100 hover:text-neutral-900 active:scale-90"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M3 10h18M8 3v4M16 3v4" strokeLinecap="round" />
        </svg>
      </button>

      {/*
        O calendário de verdade. Fica sem tamanho e transparente porque
        `display: none` faria o `showPicker()` falhar — o navegador se recusa a
        abrir o seletor de um campo que não está desenhado.
      */}
      <input
        ref={calendario}
        type="date"
        value={valor}
        min={min}
        max={max}
        onChange={(e) => escolheuNoCalendario(e.target.value)}
        tabIndex={-1}
        aria-hidden
        className="h-0 w-0 opacity-0"
      />
    </div>
  );
}
