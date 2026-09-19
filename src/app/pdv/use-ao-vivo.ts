"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export type EstadoAoVivo = "conectando" | "ao-vivo" | "offline";

/** Uma rajada de eventos (enviar comanda com 5 itens) vira um refresh só. */
const AGRUPAR_MS = 250;

/**
 * Mesmo ao vivo, uma sincronização lenta continua rodando: é o piso que
 * conserta sozinho um aviso perdido entre uma reconexão e outra.
 */
const PISO_AO_VIVO_MS = 60_000;
const PISO_OFFLINE_MS = 15_000;

/**
 * Mantém a tela atualizada a partir dos avisos do servidor.
 *
 * Trocou o recarregamento cego a cada 10-15 segundos: agora a tela só vai ao
 * servidor quando algo mudou de verdade. Num salão de dez tablets parados, o
 * banco sai de seiscentas rodadas de consulta por minuto para dez.
 *
 * O piso periódico fica — se a rede do restaurante cair e voltar, ninguém vai
 * perceber que a tela congelou até um prato atrasar. Melhor recarregar de
 * graça uma vez por minuto do que confiar só no fluxo.
 */
export function useAoVivo(): EstadoAoVivo {
  const router = useRouter();
  const [estado, setEstado] = useState<EstadoAoVivo>("conectando");

  // O refresh entra numa ref para o efeito não reiniciar o EventSource a cada
  // render — reconectar por causa de um render seria pior que o polling antigo.
  const agendado = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let vivo = true;

    const atualizar = () => {
      // Aba escondida não desenha nada: recarregar aqui é gasto puro. Ao
      // voltar, o visibilitychange abaixo traz a tela para o presente.
      if (document.visibilityState === "hidden") return;
      if (agendado.current) return;
      agendado.current = setTimeout(() => {
        agendado.current = null;
        if (vivo) router.refresh();
      }, AGRUPAR_MS);
    };

    const fonte = new EventSource("/api/eventos");

    fonte.addEventListener("pronto", () => {
      if (vivo) setEstado("ao-vivo");
    });
    fonte.addEventListener("mudanca", atualizar);
    fonte.addEventListener("error", () => {
      if (!vivo) return;
      // CLOSED é falha definitiva (sessão expirada, por exemplo): o navegador
      // não tenta de novo, e o piso periódico passa a ser a única atualização.
      setEstado(fonte.readyState === EventSource.CLOSED ? "offline" : "conectando");
    });

    const aoVoltar = () => {
      if (document.visibilityState === "visible") atualizar();
    };
    document.addEventListener("visibilitychange", aoVoltar);

    return () => {
      vivo = false;
      if (agendado.current) clearTimeout(agendado.current);
      agendado.current = null;
      document.removeEventListener("visibilitychange", aoVoltar);
      fonte.close();
    };
  }, [router]);

  useEffect(() => {
    const passo = estado === "ao-vivo" ? PISO_AO_VIVO_MS : PISO_OFFLINE_MS;
    const id = setInterval(() => {
      if (document.visibilityState !== "hidden") router.refresh();
    }, passo);
    return () => clearInterval(id);
  }, [estado, router]);

  return estado;
}
