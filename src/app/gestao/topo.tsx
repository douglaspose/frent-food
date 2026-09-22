"use client";

import { useState, type ReactNode } from "react";

/**
 * O topo da gestão: a barra de ambientes recolhida, e o cabeçalho branco com
 * o botão que a desce.
 *
 * Na retaguarda a barra preta é caminho de saída, não de trabalho — quem está
 * lendo relatório usa o menu branco. Recolhida, devolve à tela a faixa que ela
 * ocupava; o botão a traz de volta deslizando, para ir às mesas ou sair.
 *
 * Só no computador. No celular a barra mora no rodapé e é a única navegação
 * entre os ambientes: escondê-la deixaria quem entrou na gestão sem volta, que
 * é justamente o defeito que a trouxe para cá.
 *
 * O estado vive no layout, que o Next mantém montado entre as páginas da
 * gestão: aberta, a barra continua aberta ao trocar de relatório, e volta a
 * começar recolhida quando a página é recarregada.
 */
export function TopoDaGestao({ barra, children }: { barra: ReactNode; children: ReactNode }) {
  const [aberta, setAberta] = useState(false);

  return (
    <>
      {/*
        A altura anima pela linha da grade (de 0fr a 1fr), que acompanha a
        altura real da barra sem medir nada. `invisible` tira a barra
        recolhida da ordem do Tab — senão o teclado passaria por botões que
        não aparecem —, e só troca depois que o deslize termina.

        Tudo com prefixo `sm:`: abaixo disso a barra do rodapé mora aqui
        dentro e não pode ser afetada.
      */}
      <div
        id="barra-de-ambientes"
        className={`bg-neutral-950 sm:grid sm:transition-[grid-template-rows,visibility] sm:duration-300 sm:ease-out ${
          aberta ? "sm:grid-rows-[1fr]" : "sm:invisible sm:grid-rows-[0fr]"
        }`}
      >
        <div className="sm:min-h-0 sm:overflow-hidden">{barra}</div>
      </div>

      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-x-6 gap-y-2 px-6 py-3">
          {children}

          <button
            onClick={() => setAberta((a) => !a)}
            aria-expanded={aberta}
            aria-controls="barra-de-ambientes"
            className="ml-auto hidden shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900 sm:flex"
          >
            {aberta ? "Ocultar ambientes" : "Mesas, cozinha e caixa"}
            <svg
              viewBox="0 0 24 24"
              aria-hidden
              className={`h-4 w-4 transition-transform duration-300 ${aberta ? "rotate-180" : ""}`}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
        </div>
      </header>
    </>
  );
}
