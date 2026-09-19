"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { decorrido, useAgora } from "./use-agora";
import { useAoVivo } from "./use-ao-vivo";
import { SeloAoVivo } from "./selo-ao-vivo";
import { guardarArea, useAreaLembrada } from "./area-lembrada";

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
  // A área filtrada vive fora do React quando a unidade pede para lembrá-la,
  // para sobreviver à ida e volta da tela da comanda.
  const areaAtiva = useAreaLembrada(!ajustes.voltarParaAreas);
  const [busca, setBusca] = useState("");
  const [soOcupadas, setSoOcupadas] = useState(false);
  const buscaRef = useRef<HTMLInputElement>(null);

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
    <main className="mx-auto max-w-7xl px-4 py-6">
      <header className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">Mesas</h1>
          <SeloAoVivo estado={aoVivo} />
        </div>
        <dl className="flex items-end gap-6 text-right">
          <div>
            <dt className="text-xs uppercase tracking-wide text-neutral-500">Ocupadas</dt>
            <dd className="text-lg font-semibold tabular-nums">
              {ocupadas}
              <span className="text-neutral-600">/{todas.length}</span>
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

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <button
          onClick={() => guardarArea(null)}
          className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
            areaAtiva === null
              ? "bg-orange-600 text-white"
              : "bg-neutral-900 text-neutral-400 hover:bg-neutral-800"
          }`}
        >
          Todas
        </button>
        {areas.map((a) => (
          <button
            key={a.id}
            onClick={() => guardarArea(a.id)}
            className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
              areaAtiva === a.id
                ? "bg-orange-600 text-white"
                : "bg-neutral-900 text-neutral-400 hover:bg-neutral-800"
            }`}
          >
            {a.nome}
          </button>
        ))}

        <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm text-neutral-400">
          <input
            type="checkbox"
            checked={soOcupadas}
            onChange={(e) => setSoOcupadas(e.target.checked)}
            className="h-4 w-4 accent-orange-600"
          />
          Só ocupadas
        </label>

        <input
          ref={buscaRef}
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          inputMode="numeric"
          placeholder="buscar mesa (F4)"
          className="w-44 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm placeholder:text-neutral-600 focus:border-orange-600 focus:outline-none"
        />
      </div>

      {visiveis.length === 0 ? (
        <p className="py-16 text-center text-neutral-600">Nenhuma mesa encontrada.</p>
      ) : (
        visiveis.map((area) => (
          <section key={area.id} className="mb-8">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-neutral-500">
              {area.nome}
              <span className="ml-2 font-normal text-neutral-700">{area.mesas.length}</span>
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

                    <span className="text-3xl font-bold tabular-nums text-neutral-100">
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
