"use client";

import { useSyncExternalStore } from "react";

const CHAVE = "kds.estacao";

/**
 * A estação que este aparelho mostra.
 *
 * Num monitor de KDS o filtro não é um filtro: é a função do aparelho. O da
 * parede do bar mostra bar, o da cozinha mostra cozinha, e isso não muda
 * durante o turno. Antes vivia em `useState`, então toda recarga — uma queda
 * de rede, um reinício, uma revalidação — devolvia o bar para "Todas" e o
 * barman passava a olhar comanda de churrasco até alguém perceber.
 *
 * Fica em `localStorage`, e não em `sessionStorage` como a área do mapa de
 * mesas: o tablet do garçom troca de mão e de setor durante o serviço, este
 * monitor fica pendurado fazendo a mesma coisa por meses. Tem que sobreviver
 * a fechar o navegador.
 */
const ouvintes = new Set<() => void>();

function assinar(notificar: () => void) {
  ouvintes.add(notificar);
  return () => {
    ouvintes.delete(notificar);
  };
}

function snapshot(): string | null {
  try {
    return localStorage.getItem(CHAVE);
  } catch {
    // Navegador com armazenamento bloqueado: segue mostrando tudo.
    return null;
  }
}

/** No servidor não há armazenamento — e a ausência é a resposta certa. */
function snapshotDoServidor(): string | null {
  return null;
}

export function guardarEstacao(estacaoId: string | null) {
  try {
    if (estacaoId) localStorage.setItem(CHAVE, estacaoId);
    else localStorage.removeItem(CHAVE);
  } catch {
    // idem
  }
  for (const notificar of ouvintes) notificar();
}

export function useEstacaoLembrada() {
  return useSyncExternalStore(assinar, snapshot, snapshotDoServidor);
}
