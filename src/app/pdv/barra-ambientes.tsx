"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { sair } from "../login/actions";
import type { DadosBarra } from "@/lib/barra";

const TRACO = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

const ICONE = {
  mesas: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" {...TRACO} aria-hidden>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  ),
  /**
   * O cifrão tem círculo porque o KDS já usa um cifrão solto no ticket de
   * "conta pedida". São telas diferentes, mas a barra aparece dentro do KDS:
   * o círculo e a palavra ao lado separam um do outro.
   */
  caixa: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" {...TRACO} aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 6.5v11" />
      <path d="M14.5 9.2C14.5 8 13.4 7.2 12 7.2S9.5 8 9.5 9.2s1.1 1.9 2.5 2.2 2.5 1 2.5 2.2-1.1 2-2.5 2-2.5-.8-2.5-2" />
    </svg>
  ),
  /** Panela com vapor: a chama anterior, em traço fino, lia-se como gota. */
  cozinha: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" {...TRACO} aria-hidden>
      <path d="M4 11h16v5a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4v-5z" />
      <path d="M2 11h2" />
      <path d="M20 11h2" />
      <path d="M9.5 7.5c0-1.2 1-1.6 1-2.7S9.5 3 9.5 3" />
      <path d="M14.5 7.5c0-1.2 1-1.6 1-2.7S14.5 3 14.5 3" />
    </svg>
  ),
  gestao: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" {...TRACO} aria-hidden>
      <path d="M3 21h18" />
      <rect x="5" y="12" width="4" height="7" rx="1" />
      <rect x="11" y="8" width="4" height="11" rx="1" />
      <rect x="17" y="4" width="4" height="15" rx="1" />
    </svg>
  ),
};

/**
 * Navegação entre ambientes.
 *
 * Antes eram links de texto de 14px separados por pontos, misturados com o
 * nome da unidade — que parecia link e não era. Num tablet operado com o dedo,
 * muitas vezes por alguém segurando bandeja, isso não é alvo de toque.
 *
 * Os contadores são o ponto: a barra deixa de ser só navegação e passa a
 * responder "preciso ir lá agora?" sem ninguém precisar ir olhar.
 */
export function BarraAmbientes({ dados }: { dados: DadosBarra }) {
  const caminho = usePathname();

  /**
   * F12 sai do turno. O atalho vivia no mapa de mesas; morava no lugar errado —
   * quem está no KDS ou no caixa também precisa trocar de operador. Aqui ele
   * vale em todo ambiente, porque a barra está em todos.
   */
  useEffect(() => {
    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.key !== "F12") return;
      evento.preventDefault();
      void sair();
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, []);

  const ambientes = [
    { href: "/pdv", rotulo: "Mesas", icone: ICONE.mesas },
    /**
     * A cozinha vem logo depois das mesas porque é a única que chama.
     *
     * O contador de atraso é o motivo de alguém olhar para a barra sem ter
     * decidido ir a lugar nenhum — e o olho vai ao segundo lugar antes de
     * varrer o resto. O caixa se consulta quando se quer; a cozinha avisa.
     */
    {
      href: "/kds",
      rotulo: "Cozinha",
      icone: ICONE.cozinha,
      contador: dados.cozinhaAlertas,
      titulo: dados.cozinhaDetalhe,
    },
    /**
     * O caixa só aparece para quem o opera.
     *
     * A tela mostra quanto há na gaveta, o faturamento do turno e as sangrias
     * do dia — não é informação de quem está atendendo mesa. O garçom fica
     * sabendo que o caixa está fechado onde isso muda o que ele faz: na tela
     * de pagamento, que já avisa antes de deixá-lo tentar receber.
     */
    ...(dados.usuario.podeVerCaixa
      ? [
          {
            href: "/pdv/caixa",
            rotulo: "Caixa",
            icone: ICONE.caixa,
            etiqueta: dados.caixaAberto ? null : "fechado",
            titulo: dados.caixaAberto
              ? "Caixa aberto"
              : "Caixa fechado — não é possível receber pagamento",
          },
        ]
      : []),
    ...(dados.usuario.podeGerir
      ? [{ href: "/gestao", rotulo: "Gestão", icone: ICONE.gestao }]
      : []),
  ];

  return (
    <nav className="flex flex-wrap items-center gap-2 border-b border-neutral-900 bg-neutral-950/80 px-3 py-2">
      {/* Rolagem horizontal no celular mantém o alvo de toque em vez de
          espremer os botões até virarem inalcançáveis. */}
      <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto">
        {ambientes.map((item) => {
          // "/pdv" casaria com "/pdv/caixa" num startsWith — daí a exatidão.
          const ativo =
            item.href === "/pdv" ? caminho === "/pdv" : caminho.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              title={item.titulo}
              aria-current={ativo ? "page" : undefined}
              className={`flex h-11 shrink-0 items-center gap-2 rounded-xl px-4 text-sm font-semibold transition ${
                ativo
                  ? "bg-neutral-100 text-neutral-900"
                  : "bg-neutral-900 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
              }`}
            >
              {item.icone}
              {item.rotulo}

              {item.contador !== undefined && item.contador > 0 && (
                <span
                  className={`flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-bold ${
                    ativo ? "bg-amber-500 text-neutral-900" : "bg-amber-400 text-neutral-900"
                  }`}
                >
                  {item.contador}
                </span>
              )}

              {item.etiqueta && (
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                    ativo ? "bg-amber-500 text-neutral-900" : "bg-amber-500/20 text-amber-400"
                  }`}
                >
                  {item.etiqueta}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      {/* Identidade fica separada da navegação: a unidade é onde você está,
          não para onde você vai. */}
      <div className="flex shrink-0 items-center gap-3 pl-2 text-right">
        <div className="leading-tight">
          <p className="text-[10px] uppercase tracking-wide text-neutral-500">
            {dados.unidade} · {dados.usuario.cargo.toLowerCase()}
          </p>
          <p className="text-sm font-semibold text-neutral-200">{dados.usuario.nome}</p>
        </div>
        <button
          onClick={() => sair()}
          title="Sair (F12)"
          className="flex h-11 w-11 items-center justify-center rounded-xl bg-neutral-900 text-neutral-500 transition hover:bg-neutral-800 hover:text-red-400"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" {...TRACO} aria-hidden>
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <path d="M16 17l5-5-5-5" />
            <path d="M21 12H9" />
          </svg>
        </button>
      </div>
    </nav>
  );
}
