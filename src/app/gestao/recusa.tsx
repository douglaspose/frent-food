"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * A recusa que vem até o dedo, em vez de esperar que o dedo a ache.
 *
 * Todas as telas da gestão mostram o erro numa caixa no alto da página, e no
 * celular é onde ele menos serve: medido a 375 px, a recusa do cadastro de
 * impressora nascia **723 px acima** do botão que a provocou, e o "descartar"
 * da última linha da fila fica a 3.551 px dela. Quem toca não vê nada
 * acontecer — e toca de novo, que é a pior coisa que se pode fazer com um
 * botão que acabou de ser recusado.
 *
 * O desenho não muda: a caixa continua onde estava, no lugar que cada tela
 * reservou para ela. O que muda é que, se ela nascer fora da vista, a tela
 * **rola até ela**. Mexer no desenho de doze telas para pôr o aviso junto de
 * cada ação seria doze decisões; isto é uma, e resolve o que foi medido.
 *
 * `role="alert"` por cima: quem usa leitor de tela ouve a recusa sem depender
 * de rolagem nenhuma, e é a mesma informação chegando pelo caminho de cada um.
 */
export function Recusa({
  children,
  /** O espaçamento que a tela já usava — `mt-4` em cima, `mb-4` embaixo. */
  className = "mt-4",
}: {
  children: ReactNode;
  className?: string;
}) {
  const caixa = useRef<HTMLParagraphElement>(null);

  /*
   * Depende do texto, e não só de aparecer: a segunda recusa diferente, com a
   * primeira ainda na tela, também precisa ser vista. Recusa idêntica repetida
   * não rola de novo — a caixa já está onde o olho está.
   */
  useEffect(() => {
    const el = caixa.current;
    if (!el) return;

    const r = el.getBoundingClientRect();
    if (r.top >= 0 && r.bottom <= window.innerHeight) return;

    /*
     * Salto seco, e não rolagem animada.
     *
     * Duas razões, e a primeira é medida: com behavior smooth a rolagem
     * simplesmente não acontece no navegador embutido do aplicativo — a
     * recusa continuava nascendo a 363px acima da tela com o efeito rodando
     * certo. A segunda é desenho: animação atrasa a recusa em alguns
     * centésimos e qualquer toque do dedo no meio do caminho a cancela.
     * Quem tem menos movimento no sistema também ganha com isto.
     */
    el.scrollIntoView({ block: "center", behavior: "auto" });
  }, [children]);

  return (
    <p
      ref={caixa}
      role="alert"
      className={`${className} rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700`}
    >
      {children}
    </p>
  );
}
