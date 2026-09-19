"use client";

import { useCallback, useSyncExternalStore } from "react";

const CHAVE = "pdv.areaFiltrada";

/**
 * A área filtrada, lembrada entre visitas ao mapa.
 *
 * Quem atende sempre o mesmo setor não quer refiltrar a cada conta fechada.
 * Fica no aparelho, não no servidor: o tablet do deck e o do salão interno
 * filtram coisas diferentes, e os dois podem estar logados com o mesmo usuário.
 *
 * `useSyncExternalStore` em vez de `useState` + efeito, pelo mesmo motivo do
 * relógio em `use-agora`: o sessionStorage é estado externo ao React. No
 * servidor o snapshot é nulo — ler o armazenamento do navegador durante o
 * render do servidor não existe, e fingir que sim quebraria a hidratação.
 */
const ouvintes = new Set<() => void>();

function subscribe(notificar: () => void) {
  ouvintes.add(notificar);
  return () => {
    ouvintes.delete(notificar);
  };
}

function snapshot(): string | null {
  try {
    return sessionStorage.getItem(CHAVE);
  } catch {
    // Navegador com armazenamento bloqueado: segue sem a lembrança.
    return null;
  }
}

/** No servidor não há armazenamento — e a ausência é a resposta certa. */
function snapshotDoServidor(): string | null {
  return null;
}

export function guardarArea(areaId: string | null) {
  try {
    if (areaId) sessionStorage.setItem(CHAVE, areaId);
    else sessionStorage.removeItem(CHAVE);
  } catch {
    // idem
  }
  for (const notificar of ouvintes) notificar();
}

/**
 * Devolve a área lembrada, ou `null` quando a unidade prefere sempre abrir
 * mostrando o salão inteiro.
 */
export function useAreaLembrada(lembrar: boolean) {
  const ler = useCallback(() => (lembrar ? snapshot() : null), [lembrar]);
  return useSyncExternalStore(subscribe, ler, snapshotDoServidor);
}
