"use client";

import type { EstadoAoVivo } from "./use-ao-vivo";

const APARENCIA: Record<EstadoAoVivo, { cor: string; ponto: string; texto: string; dica: string }> = {
  "ao-vivo": {
    cor: "text-emerald-500",
    ponto: "bg-emerald-500",
    texto: "ao vivo",
    dica: "Recebendo mudanças do servidor na hora",
  },
  conectando: {
    cor: "text-amber-500",
    ponto: "bg-amber-500 animate-pulse",
    texto: "reconectando",
    dica: "Sem ligação com o servidor — a tela ainda atualiza a cada 15s",
  },
  offline: {
    cor: "text-neutral-500",
    ponto: "bg-neutral-600",
    texto: "sem tempo real",
    dica: "A tela atualiza a cada 15s. Recarregue a página para tentar de novo.",
  },
};

/**
 * Diz se a tela está viva.
 *
 * Numa cozinha, um quadro congelado e um quadro sem pedidos são idênticos — e
 * a diferença entre eles é um cliente esperando. O ponto verde é o que separa
 * "não chegou nada" de "não estou mais recebendo".
 */
export function SeloAoVivo({ estado }: { estado: EstadoAoVivo }) {
  const { cor, ponto, texto, dica } = APARENCIA[estado];

  return (
    <span
      title={dica}
      className={`flex shrink-0 items-center gap-1.5 text-xs font-semibold ${cor}`}
    >
      <span className={`h-2 w-2 rounded-full ${ponto}`} aria-hidden />
      {texto}
    </span>
  );
}
