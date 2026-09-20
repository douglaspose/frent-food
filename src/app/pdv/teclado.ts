"use client";

import { useSyncExternalStore } from "react";

/** A mesma largura em que a interface vira a de balcão (o `lg` do Tailwind). */
const TELA_COM_TECLADO = "(min-width: 1024px)";

function assinar(notificar: () => void) {
  const consulta = window.matchMedia(TELA_COM_TECLADO);
  consulta.addEventListener("change", notificar);
  return () => consulta.removeEventListener("change", notificar);
}

/**
 * Se vale falar de teclas de atalho nesta tela.
 *
 * Só serve para texto que não dá para esconder com CSS — o `placeholder` de um
 * campo é uma string, não um elemento, e não aceita `hidden lg:inline`. Onde o
 * atalho está dentro de um botão, prefira o CSS: é a mesma decisão sem
 * JavaScript nenhum.
 *
 * No servidor a resposta é "não há teclado". Não existe largura para consultar
 * ali, e das duas respostas possíveis esta é a certa: o celular nunca chega a
 * mostrar a tecla, e o balcão a ganha assim que a página hidrata. O contrário
 * faria o garçom ver por um instante justamente o que não lhe serve.
 */
export function useTemTeclado() {
  return useSyncExternalStore(
    assinar,
    () => window.matchMedia(TELA_COM_TECLADO).matches,
    () => false
  );
}
