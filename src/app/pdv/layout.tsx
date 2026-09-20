import type { ReactNode } from "react";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "PDV" };

/**
 * Shell do PDV. Tema escuro fixo e alto contraste: a tela fica ligada a noite
 * inteira num salão com pouca luz, e o garçom lê de relance, de pé.
 */
export default function PdvLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-tela bg-neutral-950 text-neutral-100 antialiased">
      {children}
    </div>
  );
}
