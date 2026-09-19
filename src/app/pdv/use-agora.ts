"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Relógio para tempos decorridos ("sentado há 40min").
 *
 * useSyncExternalStore em vez de useState + useEffect: o horário é estado
 * externo ao React. No servidor o snapshot é nulo — o relógio do servidor e o
 * do navegador nunca batem, e renderizar o tempo nos dois lados quebraria a
 * hidratação. O snapshot do cliente é arredondado para o intervalo, senão cada
 * render devolveria um valor novo e o React entraria em laço.
 */
export function useAgora(intervaloMs = 30_000) {
  const subscribe = useCallback(
    (notificar: () => void) => {
      const id = setInterval(notificar, intervaloMs);
      return () => clearInterval(id);
    },
    [intervaloMs]
  );

  const snapshot = useCallback(
    () => Math.floor(Date.now() / intervaloMs) * intervaloMs,
    [intervaloMs]
  );

  return useSyncExternalStore(subscribe, snapshot, () => null);
}

/** Formata a diferença como "45min" ou "2h05". */
export function decorrido(agora: number | null, desde: string) {
  if (agora === null) return "";
  const minutos = Math.max(0, Math.floor((agora - new Date(desde).getTime()) / 60000));
  if (minutos < 60) return `${minutos}min`;
  return `${Math.floor(minutos / 60)}h${String(minutos % 60).padStart(2, "0")}`;
}
