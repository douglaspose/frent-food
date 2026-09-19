"use client";

export function BotaoImprimir() {
  return (
    <button
      onClick={() => window.print()}
      className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-700"
    >
      Imprimir
    </button>
  );
}
