"use client";

import { useSyncExternalStore } from "react";

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
 *
 * Quem decide se a lembrança sobrevive à ida à comanda é o mapa, apagando-a
 * ao sair da tela. Aqui dentro não cabe: este módulo responde "qual área está
 * filtrada agora", e uma resposta só.
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

/** A área filtrada agora, ou `null` para o salão inteiro. */
export function useAreaLembrada() {
  return useSyncExternalStore(subscribe, snapshot, snapshotDoServidor);
}
