"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { sair } from "../login/actions";
import type { DadosBarra } from "@/lib/barra";

const TRACO = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/**
 * O ícone recebe o tamanho de fora porque os dois lugares pedem tamanhos
 * diferentes: 20px ao lado do rótulo na barra de cima, 28px acima dele no
 * rodapé do celular, onde o ícone é quem carrega o reconhecimento — a barra é
 * lida de relance, com o celular na mão e a mesa falando.
 */
const ICONE = {
  mesas: (classe: string) => (
    <svg viewBox="0 0 24 24" className={classe} {...TRACO} aria-hidden>
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
  caixa: (classe: string) => (
    <svg viewBox="0 0 24 24" className={classe} {...TRACO} aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 6.5v11" />
      <path d="M14.5 9.2C14.5 8 13.4 7.2 12 7.2S9.5 8 9.5 9.2s1.1 1.9 2.5 2.2 2.5 1 2.5 2.2-1.1 2-2.5 2-2.5-.8-2.5-2" />
    </svg>
  ),
  /** Panela com vapor: a chama anterior, em traço fino, lia-se como gota. */
  cozinha: (classe: string) => (
    <svg viewBox="0 0 24 24" className={classe} {...TRACO} aria-hidden>
      <path d="M4 11h16v5a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4v-5z" />
      <path d="M2 11h2" />
      <path d="M20 11h2" />
      <path d="M9.5 7.5c0-1.2 1-1.6 1-2.7S9.5 3 9.5 3" />
      <path d="M14.5 7.5c0-1.2 1-1.6 1-2.7S14.5 3 14.5 3" />
    </svg>
  ),
  gestao: (classe: string) => (
    <svg viewBox="0 0 24 24" className={classe} {...TRACO} aria-hidden>
      <path d="M3 21h18" />
      <rect x="5" y="12" width="4" height="7" rx="1" />
      <rect x="11" y="8" width="4" height="11" rx="1" />
      <rect x="17" y="4" width="4" height="15" rx="1" />
    </svg>
  ),
  /**
   * Quem está no turno. No lugar das iniciais num disco, que pesavam como um
   * sexto destaque numa fileira de traços finos — o nome logo abaixo já diz
   * quem é, e diz melhor que duas letras.
   */
  identidade: (classe: string) => (
    <svg viewBox="0 0 24 24" className={classe} {...TRACO} aria-hidden>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
    </svg>
  ),
};

const SAIDA = (classe: string) => (
  <svg viewBox="0 0 24 24" className={classe} {...TRACO} aria-hidden>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="M16 17l5-5-5-5" />
    <path d="M21 12H9" />
  </svg>
);

/**
 * Navegação entre ambientes.
 *
 * Antes eram links de texto de 14px separados por pontos, misturados com o
 * nome da unidade — que parecia link e não era. Num tablet operado com o dedo,
 * muitas vezes por alguém segurando bandeja, isso não é alvo de toque.
 *
 * Os contadores são o ponto: a barra deixa de ser só navegação e passa a
 * responder "preciso ir lá agora?" sem ninguém precisar ir olhar.
 *
 * No celular ela troca de lado. Em 375px a barra de cima cabia só até
 * "Mesas": o resto ficava atrás do bloco de identidade, e com ele sumia o
 * contador de atraso da cozinha — o único aviso que a barra existe para dar.
 * Abaixo de `sm` os ambientes viram rodapé fixo, onde o polegar alcança e a
 * largura é dividida por igual, e a identidade vira o último item.
 */
export function BarraAmbientes({ dados }: { dados: DadosBarra }) {
  const caminho = usePathname();
  /**
   * O menu guarda em que tela foi aberto, em vez de um booleano.
   *
   * Assim trocar de ambiente o fecha por dedução — um efeito sincronizando
   * isso custaria um render em cascata a cada navegação.
   */
  const [menuEm, setMenuEm] = useState<string | null>(null);

  /**
   * F12 sai do turno. O atalho vivia no mapa de mesas; morava no lugar errado —
   * quem está no KDS ou no caixa também precisa trocar de operador. Aqui ele
   * vale em todo ambiente, porque a barra está em todos.
   *
   * No celular não existe F12, e é por isso que o "sair" precisa de um lugar
   * visível em vez de ficar só no atalho.
   */
  useEffect(() => {
    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") return setMenuEm(null);
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

  const menuAberto = menuEm === caminho;

  // "/pdv" casaria com "/pdv/caixa" num startsWith — daí a exatidão.
  const estaAtivo = (href: string) =>
    href === "/pdv" ? caminho === "/pdv" : caminho.startsWith(href);

  return (
    <>
      <nav className="hidden flex-wrap items-center gap-2 border-b border-neutral-900 bg-neutral-950/80 px-3 py-2 sm:flex">
        {/* Rolagem horizontal no tablet estreito mantém o alvo de toque em vez
            de espremer os botões até virarem inalcançáveis. */}
        <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto">
          {ambientes.map((item) => {
            const ativo = estaAtivo(item.href);

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
                {item.icone("h-5 w-5")}
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
            {SAIDA("h-5 w-5")}
          </button>
        </div>
      </nav>

      {/* ── Celular ───────────────────────────────────────────────────────── */}

      <nav className="barra-do-celular fixed inset-x-0 bottom-0 z-40 flex divide-x divide-neutral-800 border-t border-neutral-800 bg-neutral-900 pb-[env(safe-area-inset-bottom)] sm:hidden">
        {ambientes.map((item) => {
          const ativo = estaAtivo(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={ativo ? "page" : undefined}
              className={`relative flex h-16 min-w-0 flex-1 flex-col items-center justify-center gap-1 transition ${
                ativo ? "selecionado-na-barra text-neutral-50" : "text-neutral-400"
              }`}
            >
              {/*
                São dois sinais que se somam, e o poço é só dos ambientes: ele
                marca a tela aberta, e o traço diz qual das cinco é. O botão da
                identidade fica de fora de propósito — abrir o menu do turno não
                é ir a lugar nenhum, e um segundo poço aceso ao mesmo tempo
                tiraria do primeiro o que ele tem de dizer. Só a cor não
                bastaria: num salão claro a diferença entre os cinzas some.
              */}
              {ativo && (
                <span className="absolute inset-x-[30%] top-0 h-0.5 rounded-full bg-neutral-50" />
              )}

              <span className="relative block">
                {item.icone("h-7 w-7")}

                {item.contador !== undefined && item.contador > 0 && (
                  <span className="absolute -right-2.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-amber-400 px-1 text-[10px] font-extrabold text-neutral-900">
                    {item.contador}
                  </span>
                )}

                {/* A palavra "fechado" não cabe aqui; o ponto diz que há algo
                    fora do normal e a tela do caixa diz o quê. */}
                {item.etiqueta && (
                  <span className="absolute -right-1.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-amber-400 ring-2 ring-neutral-900" />
                )}
              </span>

              <span className="max-w-full truncate px-1 text-xs font-semibold">
                {item.rotulo}
              </span>
            </Link>
          );
        })}

        <button
          onClick={() => setMenuEm((v) => (v === caminho ? null : caminho))}
          aria-expanded={menuAberto}
          aria-label="Turno e saída"
          /**
           * Mesma largura dos outros: `flex-1` no lugar da medida fixa de
           * 4,5rem. Ele era o único estreito da fileira, e a sobra caía toda
           * nos vizinhos — com cinco itens a barra ficava torta, e com três
           * ficava mais ainda.
           */
          className={`flex h-16 min-w-0 flex-1 flex-col items-center justify-center gap-1 transition ${
            menuAberto ? "text-neutral-50" : "text-neutral-400"
          }`}
        >
          {ICONE.identidade("h-7 w-7")}
          <span className="max-w-full truncate px-1 text-xs font-semibold">
            {dados.usuario.nome.split(/\s+/)[0]}
          </span>
        </button>
      </nav>

      {menuAberto && (
        <>
          <button
            onClick={() => setMenuEm(null)}
            aria-label="Fechar"
            /**
             * O véu para na altura do rodapé em vez de cobrir a tela toda.
             *
             * Se ele cobrisse, o painel ficaria por cima do botão que o abriu
             * — e "Sair do turno" cairia debaixo do dedo que acabou de tocar
             * em "Dono". Deixando o rodapé à mostra, o segundo toque volta ao
             * mesmo botão, que fecha o menu.
             */
            className="fixed inset-x-0 top-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-50 bg-black/60 sm:hidden"
          />
          <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-[60] rounded-t-xl border-t border-neutral-800 bg-neutral-950 px-4 pb-4 pt-3 sm:hidden">
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-neutral-800" />

            <p className="text-[10px] uppercase tracking-wide text-neutral-500">
              {dados.unidade} · {dados.usuario.cargo.toLowerCase()}
            </p>
            <p className="text-lg font-semibold text-neutral-100">{dados.usuario.nome}</p>

            <button
              onClick={() => sair()}
              className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-neutral-900 text-sm font-semibold text-red-400 transition active:bg-neutral-800"
            >
              {SAIDA("h-5 w-5")}
              Sair do turno
            </button>
          </div>
        </>
      )}
    </>
  );
}
