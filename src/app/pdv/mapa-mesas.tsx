"use client";

import Link from "next/link";
import { TEXTO_DE_CAMPO } from "@/lib/campo";
import { useEffect, useMemo, useRef, useState } from "react";
import { decorrido, useAgora } from "./use-agora";
import { useAoVivo } from "./use-ao-vivo";
import { SeloAoVivo } from "./selo-ao-vivo";
import { guardarArea, useAreaLembrada } from "./area-lembrada";
import { useTemTeclado } from "./teclado";

type StatusMesa = "LIVRE" | "OCUPADA" | "FECHANDO" | "RESERVADA" | "SUJA";

export type MesaView = {
  id: string;
  numero: string;
  capacidade: number;
  status: StatusMesa;
  comanda: {
    id: string;
    total: number;
    abertaEm: string;
    pessoas: number;
    itensNoCarrinho: number;
    semPedido: boolean;
    chamadoEm: string | null;
  } | null;
};

/**
 * Ícones em SVG, não emoji.
 *
 * Emoji fica embaçado em tamanho pequeno, muda de desenho conforme o sistema e
 * não aceita a cor do selo. Num tablet visto de dois metros, isso é a
 * diferença entre ler e adivinhar.
 */
const TRACO = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

const ICONE = {
  sino: (
    <svg viewBox="0 0 24 24" className="h-6 w-6" {...TRACO} aria-hidden>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  ),
  carrinho: (
    <svg viewBox="0 0 24 24" className="h-6 w-6" {...TRACO} aria-hidden>
      <circle cx="9" cy="20" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="18" cy="20" r="1.4" fill="currentColor" stroke="none" />
      <path d="M2 3h2.2l2.3 12.2a2 2 0 0 0 2 1.6h8.6a2 2 0 0 0 2-1.6L21 7H5.4" />
    </svg>
  ),
  relogio: (
    <svg viewBox="0 0 24 24" className="h-6 w-6" {...TRACO} aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5.5l3.5 2" />
    </svg>
  ),
};

/**
 * Um único selo por mesa, em ordem de urgência — o mesmo princípio do Vuca.
 * Empilhar três avisos no mesmo card faria o garçom não ler nenhum.
 */
function selo(mesa: MesaView, agora: number | null, alertaSemPedidoMin: number) {
  const c = mesa.comanda;
  if (!c) return null;

  if (c.chamadoEm) {
    const minutos = agora === null ? 0 : Math.floor((agora - new Date(c.chamadoEm).getTime()) / 60000);
    return {
      icone: ICONE.sino,
      titulo: `Cliente chamou há ${minutos}min`,
      // A cor escala com a espera: quanto mais tempo, mais agressivo.
      classe:
        minutos >= 5
          ? "bg-red-600 text-white animate-pulse"
          : minutos >= 3
            ? "bg-orange-500 text-white"
            : "bg-amber-400 text-neutral-900",
    };
  }

  if (c.itensNoCarrinho > 0) {
    // Branco: o card da mesa ocupada agora é azul, e um selo azul sobre azul
    // deixaria de saltar aos olhos.
    return {
      icone: ICONE.carrinho,
      titulo: `${c.itensNoCarrinho} item(ns) no carrinho sem enviar para a cozinha`,
      classe: "bg-white text-sky-700",
    };
  }

  if (c.semPedido) {
    // O aviso só acende depois do tempo configurado: mesa que acabou de
    // sentar ainda está lendo o cardápio, e um alarme aí é ruído.
    const minutos = agora === null ? 0 : Math.floor((agora - new Date(c.abertaEm).getTime()) / 60000);
    if (minutos < alertaSemPedidoMin) return null;

    // Discreto de propósito: é aviso, não alarme — mas ainda legível de longe.
    return {
      icone: ICONE.relogio,
      titulo: `Sentou há ${minutos}min e ainda não pediu nada`,
      classe: "bg-neutral-600 text-neutral-200",
    };
  }

  return null;
}

type AreaView = { id: string; nome: string; mesas: MesaView[] };

/**
 * Cor é informação, não decoração: o garçom lê o salão de longe pelo tom do
 * card. Azul é mesa em consumo; laranja é mesa fechando, que é onde o caixa
 * precisa olhar.
 */
const ESTILO: Record<StatusMesa, { rotulo: string; classe: string }> = {
  LIVRE: { rotulo: "LIVRE", classe: "border-emerald-600/60 bg-emerald-950/30 text-emerald-400" },
  OCUPADA: { rotulo: "OCUPADA", classe: "border-sky-500/70 bg-sky-950/40 text-sky-400" },
  FECHANDO: { rotulo: "FECHANDO", classe: "border-orange-500/70 bg-orange-950/40 text-orange-400" },
  RESERVADA: { rotulo: "RESERVADA", classe: "border-violet-500/70 bg-violet-950/40 text-violet-400" },
  SUJA: { rotulo: "LIMPAR", classe: "border-neutral-600 bg-neutral-900 text-neutral-400" },
};

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export type AjustesDoMapa = {
  alertaSemPedidoMin: number;
  /** Ao voltar de uma conta, mostra todas as áreas em vez da última filtrada. */
  voltarParaAreas: boolean;
};

export function MapaMesas({
  areas,
  ajustes,
}: {
  areas: AreaView[];
  ajustes: AjustesDoMapa;
}) {
  // A área filtrada vive fora do React para sobreviver à ida e volta da tela
  // da comanda.
  const areaAtiva = useAreaLembrada();
  const [busca, setBusca] = useState("");
  const [soOcupadas, setSoOcupadas] = useState(false);
  const buscaRef = useRef<HTMLInputElement>(null);
  const temTeclado = useTemTeclado();

  /**
   * "Mostrar todas as áreas ao voltar de uma conta" é esquecer na saída, não
   * ignorar na leitura.
   *
   * Antes o ajuste zerava a área em toda leitura, e como o padrão é ligado os
   * botões de área não filtravam nada: o clique gravava, o chip não acendia e
   * a lista não mudava. O ajuste fala da próxima visita ao mapa, então é na
   * saída desta tela que ele age.
   */
  useEffect(() => {
    if (!ajustes.voltarParaAreas) return;
    return () => guardarArea(null);
  }, [ajustes.voltarParaAreas]);

  // Dois relógios diferentes: este conta o tempo que passa no próprio
  // navegador ("chamou há 4min" sobe sozinho), enquanto o useAoVivo traz os
  // dados novos do servidor quando algo de fato muda.
  const agora = useAgora(15_000);
  const aoVivo = useAoVivo();

  // F4 foca a busca, Esc limpa — o PDV é operado sem tirar a mão do teclado.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "F4") {
        e.preventDefault();
        buscaRef.current?.focus();
      }
      if (e.key === "Escape") {
        setBusca("");
        buscaRef.current?.blur();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const visiveis = useMemo(() => {
    return areas
      .filter((a) => !areaAtiva || a.id === areaAtiva)
      .map((a) => ({
        ...a,
        mesas: a.mesas.filter((m) => {
          if (soOcupadas && m.status === "LIVRE") return false;
          if (busca && !m.numero.startsWith(busca.trim())) return false;
          return true;
        }),
      }))
      .filter((a) => a.mesas.length > 0);
  }, [areas, areaAtiva, busca, soOcupadas]);

  const todas = areas.flatMap((a) => a.mesas);
  const ocupadas = todas.filter((m) => m.status !== "LIVRE").length;
  const emAberto = todas.reduce((soma, m) => soma + (m.comanda?.total ?? 0), 0);
  const chamando = todas.filter((m) => m.comanda?.chamadoEm).length;
  const carrinhosParados = todas.filter((m) => (m.comanda?.itensNoCarrinho ?? 0) > 0).length;

  return (
    <main className="mx-auto max-w-7xl px-4 pt-6 pb-24 sm:pb-6">
      {/*
        `items-end`, não `items-baseline`.

        A propriedade com "baseline" no nome é a que erra aqui: o bloco da
        direita é um flex, e a primeira linha de base dele vem do rótulo
        pequeno ("OCUPADAS"), não dos números. O título acabava alinhado à
        legenda e flutuava 24px acima do valor.

        Com `items-end` a base de "Mesas" cai exatamente sobre a de "4/46" —
        medido, não estimado.
      */}
      {/*
        As duas linhas dividem a tela em três faixas, como na comanda: quem
        você é (título e números do turno), como filtrar, e o salão. A sangria
        negativa faz a linha atravessar o padding do container em vez de parar
        onde o texto para.
      */}
      <header className="-mx-4 mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-neutral-900 px-4 pb-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">Mesas</h1>
          <SeloAoVivo estado={aoVivo} />
        </div>
        <dl className="flex items-end gap-6 text-right">
          <div>
            <dt className="text-xs uppercase tracking-wide text-neutral-500">Ocupadas</dt>
            <dd className="text-lg font-semibold tabular-nums">
              {ocupadas}
              <span className="text-neutral-500">/{todas.length}</span>
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-neutral-500">Em aberto</dt>
            <dd className="text-lg font-semibold tabular-nums text-orange-400">{brl.format(emAberto)}</dd>
          </div>
        </dl>
      </header>

      {(chamando > 0 || carrinhosParados > 0) && (
        <div className="mb-4 flex flex-wrap gap-3 text-sm">
          {chamando > 0 && (
            <p className="rounded-lg bg-red-950/60 px-4 py-2 font-semibold text-red-300">
              {chamando} mesa(s) chamando o garçom
            </p>
          )}
          {carrinhosParados > 0 && (
            <p className="rounded-lg bg-sky-950/60 px-4 py-2 text-sky-300">
              {carrinhosParados} carrinho(s) sem enviar para a cozinha
            </p>
          )}
        </div>
      )}

      {/*
        No celular isto ocupava três faixas antes da primeira mesa: as áreas
        quebravam em duas linhas e a busca tomava a terceira. Agora são duas —
        as áreas rolam de lado numa faixa só, e busca e "só ocupadas" dividem
        a de baixo. No desktop, `sm:contents` desfaz os agrupamentos e devolve
        exatamente a linha única de antes.
      */}
      <div className="-mx-4 mb-5 space-y-2 border-b border-neutral-900 px-4 pb-4 sm:flex sm:flex-wrap sm:items-center sm:gap-2 sm:space-y-0">
        {/* A sangria negativa deixa o primeiro e o último chip encostarem na
            borda da tela ao rolar, em vez de morrerem dentro do padding. */}
        <div className="sem-barra-de-rolagem -mx-4 flex gap-2 overflow-x-auto px-4 sm:contents">
          <button
            onClick={() => guardarArea(null)}
            className={`shrink-0 rounded-lg px-3 py-2 text-sm font-medium transition ${
              areaAtiva === null
                ? "bg-orange-700 text-white"
                : "bg-neutral-900 text-neutral-400 hover:bg-neutral-800"
            }`}
          >
            Todas
          </button>
          {areas.map((a) => (
            <button
              key={a.id}
              onClick={() => guardarArea(a.id)}
              className={`shrink-0 rounded-lg px-3 py-2 text-sm font-medium transition ${
                areaAtiva === a.id
                  ? "bg-orange-700 text-white"
                  : "bg-neutral-900 text-neutral-400 hover:bg-neutral-800"
              }`}
            >
              {a.nome}
            </button>
          ))}
        </div>

        <div className="flex items-stretch gap-3 sm:contents">
          <input
            ref={buscaRef}
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            inputMode="numeric"
            placeholder={temTeclado ? "buscar mesa (F4)" : "buscar mesa"}
            className={`campo-de-busca min-w-0 flex-1 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 placeholder:text-neutral-600 focus:border-orange-600 focus:outline-none sm:order-2 sm:w-44 sm:flex-none ${TEXTO_DE_CAMPO}`}
          />

          {/*
            Ganha corpo de chip para parar de flutuar entre a busca e os
            filtros de área — ele é um filtro como os outros e estava escrito
            como legenda solta.

            Aceso, usa laranja translúcido com um fio em volta, e não o
            laranja sólido dos chips de área: aqueles são exclusivos entre si,
            este soma. Cor igual faria parecer que ligar aqui desliga a área.

            A caixinha continua à vista de propósito — é o que diz, sem
            precisar tocar, que este liga e desliga.
          */}
          <label
            /* A borda existe nos dois estados, só muda de cor: é ela que
               fecha os 2px que faltavam para bater com a altura da busca, que
               tem borda e este não tinha. */
            className={`flex shrink-0 cursor-pointer select-none items-center gap-2 rounded-lg border px-3 text-sm font-medium transition sm:order-1 sm:ml-auto sm:py-2 ${
              soOcupadas
                ? "border-orange-600/50 bg-orange-600/15 text-orange-300"
                : "border-neutral-800 bg-neutral-900 text-neutral-400 hover:bg-neutral-800"
            }`}
          >
            <input
              type="checkbox"
              checked={soOcupadas}
              onChange={(e) => setSoOcupadas(e.target.checked)}
              className="h-4 w-4 accent-orange-600"
            />
            Mesas ocupadas
          </label>
        </div>
      </div>

      {visiveis.length === 0 ? (
        <p className="py-16 text-center text-neutral-500">Nenhuma mesa encontrada.</p>
      ) : (
        visiveis.map((area) => (
          <section key={area.id} className="mb-8">
            <h2 className="mb-3 texto-etiqueta text-neutral-400">
              {area.nome}
              <span className="ml-2 font-normal text-neutral-500">{area.mesas.length}</span>
            </h2>

            <div className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-3">
              {area.mesas.map((mesa) => {
                const estilo = ESTILO[mesa.status];
                const aviso = selo(mesa, agora, ajustes.alertaSemPedidoMin);

                return (
                  <Link
                    key={mesa.id}
                    href={`/pdv/mesa/${mesa.id}`}
                    className={`relative flex h-28 flex-col items-center justify-center rounded-xl border-2 transition hover:brightness-125 focus:outline-none focus:ring-2 focus:ring-orange-500 ${estilo.classe}`}
                  >
                    {aviso && (
                      <span
                        title={aviso.titulo}
                        // O anel na cor do fundo da página separa o selo do
                        // card, qualquer que seja a cor do status. A sombra
                        // dá relevo para quem olha o salão de longe.
                        className={`absolute -right-1 -top-1 z-10 flex h-10 w-10 items-center justify-center rounded-full shadow-lg ring-2 ring-neutral-950 ${aviso.classe}`}
                      >
                        {aviso.icone}
                      </span>
                    )}

                    <span className="texto-tela tabular-nums text-neutral-100">
                      {mesa.numero}
                    </span>

                    {mesa.comanda ? (
                      <>
                        <span className="mt-1 text-sm font-semibold tabular-nums text-neutral-200">
                          {brl.format(mesa.comanda.total)}
                        </span>
                        <span className="text-[11px] tabular-nums opacity-80">
                          {decorrido(agora, mesa.comanda.abertaEm)} · {mesa.comanda.pessoas}p
                        </span>
                      </>
                    ) : (
                      <span className="mt-2 text-[11px] font-bold tracking-widest">
                        {estilo.rotulo}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </section>
        ))
      )}
    </main>
  );
}
