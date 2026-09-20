"use client";

import { temErro } from "@/lib/erro-de-operacao";
import { tituloDeTodasAsEstacoes } from "@/lib/estacoes";
import { guardarEstacao, useEstacaoLembrada } from "./estacao-lembrada";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { avancarPedido } from "./actions";
import { useAgora } from "../pdv/use-agora";
import { useAoVivo } from "../pdv/use-ao-vivo";
import { SeloAoVivo } from "../pdv/selo-ao-vivo";

type PedidoView = {
  id: string;
  numero: number;
  status: string;
  estacaoId: string;
  estacaoNome: string;
  estacaoCor: string | null;
  comandaNumero: number;
  mesaNumero: string | null;
  contaPedida: boolean;
  criadoEm: string;
  prontoEm: string | null;
  itens: {
    id: string;
    titulo: string;
    quantidade: number;
    pontoCarne: string | null;
    observacao: string | null;
    cancelado: boolean;
  }[];
};

/**
 * Ícones em SVG, como no mapa de mesas: a cozinha olha a tela de longe, com
 * as mãos ocupadas, e emoji some nesse contexto.
 */
const TRACO = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

const ICONE = {
  relogio: (
    <svg viewBox="0 0 24 24" className="h-6 w-6" {...TRACO} aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5.5l3.5 2" />
    </svg>
  ),
  bandeja: (
    <svg viewBox="0 0 24 24" className="h-6 w-6" {...TRACO} aria-hidden>
      <path d="M3 17h18" />
      <path d="M5 17a7 7 0 0 1 14 0" />
      <path d="M12 7V4" />
    </svg>
  ),
  cifrao: (
    <svg viewBox="0 0 24 24" className="h-6 w-6" {...TRACO} aria-hidden>
      <path d="M12 2v20" />
      <path d="M16 7.5C16 5.6 14.2 4 12 4S8 5.6 8 7.5s1.8 3 4 3.5 4 1.6 4 3.5-1.8 3.5-4 3.5-4-1.6-4-3.5" />
    </svg>
  ),
  alerta: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" {...TRACO} aria-hidden>
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    </svg>
  ),
  fogo: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" {...TRACO} aria-hidden>
      <path d="M12 2s5 4.5 5 9a5 5 0 0 1-10 0c0-1.5.6-2.8 1.3-3.8C9 8.5 12 6 12 2z" />
    </svg>
  ),
};

type Estacao = { id: string; nome: string; corHex: string | null };

/**
 * Um selo por ticket, em ordem de urgência — mesmo princípio do mapa de mesas.
 *
 * A ordem não é estética: conta pedida vem antes de atraso porque ali alguém
 * precisa *decidir* (apressa ou cancela?), enquanto atraso só precisa de
 * pressa.
 */
function selo(
  pedido: PedidoView,
  minutosNaFila: number | null,
  minutosPronto: number | null,
  alertaAtrasoMin: number,
  alertaRetiradaMin: number
) {
  if (pedido.contaPedida && pedido.status !== "ENTREGUE") {
    return {
      icone: ICONE.cifrao,
      titulo: "A mesa já pediu a conta — apresse ou fale com o salão",
      classe: "bg-orange-500 text-white",
    };
  }

  if (pedido.status === "PRONTO" && minutosPronto !== null && minutosPronto >= alertaRetiradaMin) {
    // Prato pronto parado no balcão é comida esfriando — e o cliente achando
    // que a cozinha está devendo.
    return {
      icone: ICONE.bandeja,
      titulo: `Pronto há ${minutosPronto}min e ninguém levou`,
      classe:
        minutosPronto >= alertaRetiradaMin * 2
          ? "bg-red-600 text-white animate-pulse"
          : "bg-amber-400 text-neutral-900",
    };
  }

  if (
    pedido.status !== "PRONTO" &&
    minutosNaFila !== null &&
    minutosNaFila >= alertaAtrasoMin
  ) {
    return {
      icone: ICONE.relogio,
      titulo: `Na cozinha há ${minutosNaFila}min`,
      classe:
        minutosNaFila >= alertaAtrasoMin * 1.5
          ? "bg-red-600 text-white animate-pulse"
          : "bg-orange-500 text-white",
    };
  }

  return null;
}

/** Cada coluna é uma etapa, e o botão leva o ticket para a próxima. */
const COLUNAS = [
  { status: "AGUARDANDO", titulo: "Na fila", acao: "Iniciar preparo", proximo: "EM_PREPARO" },
  { status: "EM_PREPARO", titulo: "Em preparo", acao: "Marcar pronto", proximo: "PRONTO" },
  { status: "PRONTO", titulo: "Pronto", acao: "Entregue", proximo: "ENTREGUE" },
] as const;

export function KdsBoard({
  estacoes,
  pedidos,
  alertaAtrasoMin,
  alertaRetiradaMin,
}: {
  estacoes: Estacao[];
  pedidos: PedidoView[];
  alertaAtrasoMin: number;
  alertaRetiradaMin: number;
}) {
  /**
   * A estação lembrada só vale se ainda existir.
   *
   * Quem apaga uma estação na retaguarda não sabe que há um monitor preso a
   * ela; sem esta conferência aquele aparelho ficaria com a tela vazia para
   * sempre, sem dizer por quê. Some da lista, volta a mostrar tudo.
   */
  const lembrada = useEstacaoLembrada();
  const estacaoAtiva = estacoes.some((e) => e.id === lembrada) ? lembrada : null;
  const estacao = estacoes.find((e) => e.id === estacaoAtiva);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  const router = useRouter();
  const agora = useAgora(10_000);

  // A cozinha não recarrega a página: o quadro recebe as mudanças do servidor.
  const aoVivo = useAoVivo();

  const visiveis = estacaoAtiva ? pedidos.filter((p) => p.estacaoId === estacaoAtiva) : pedidos;

  const idade = (iso: string) =>
    agora === null ? 0 : Math.max(0, Math.floor((agora - new Date(iso).getTime()) / 60000));

  const contaPedida = visiveis.filter((p) => p.contaPedida).length;
  const atrasados = visiveis.filter(
    (p) => p.status !== "PRONTO" && idade(p.criadoEm) >= alertaAtrasoMin
  ).length;
  const esperandoRetirada = visiveis.filter(
    (p) => p.status === "PRONTO" && p.prontoEm && idade(p.prontoEm) >= alertaRetiradaMin
  ).length;

  function avancar(pedidoId: string, para: "EM_PREPARO" | "PRONTO" | "ENTREGUE") {
    setErro(null);
    iniciar(async () => {
      try {
        const r = await avancarPedido(pedidoId, para);
        // Antes o resultado era descartado: o cozinheiro tocava "Marcar
        // pronto", nada acontecia e ele não tinha como saber por quê.
        if (temErro(r)) {
          setErro(r.erro);
          return;
        }
        router.refresh();
      } catch {
        // A cozinha não lê mensagem técnica. O que ela precisa saber é que o
        // toque não valeu e o quadro pode estar desatualizado.
        setErro("Não consegui falar com o servidor. Confira antes de seguir.");
      }
    });
  }

  function minutosDesde(iso: string) {
    if (agora === null) return null;
    return Math.max(0, Math.floor((agora - new Date(iso).getTime()) / 60000));
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-neutral-950 pb-16 text-neutral-100 sm:pb-0">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-neutral-900 px-4 py-3">
        {/*
          O título diz o que está na tela, não o nome do ambiente. Filtrado no
          bar, ele lê "Bar" — e some a duplicação de ter "Cozinha" no título e
          "Cozinha" também como uma das estações, onde o filtro parecia mostrar
          tudo o que o título prometia.

          A cor vem da estação e fica no ponto, não no texto: as cores são
          vivas para marcar ticket e não seguram contraste como letra.
        */}
        <h1 className="mr-4 flex items-center gap-2 text-lg font-bold tracking-tight">
          {estacao?.corHex && (
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: estacao.corHex }}
            />
          )}
          {estacao?.nome ?? tituloDeTodasAsEstacoes(estacoes.map((e) => e.nome))}
        </h1>

        <button
          onClick={() => guardarEstacao(null)}
          className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
            estacaoAtiva === null
              ? "bg-neutral-100 text-neutral-900"
              : "bg-neutral-900 text-neutral-400 hover:bg-neutral-800"
          }`}
        >
          Todas
        </button>
        {estacoes.map((e) => (
          <button
            key={e.id}
            onClick={() => guardarEstacao(e.id)}
            style={estacaoAtiva === e.id && e.corHex ? { backgroundColor: e.corHex } : undefined}
            className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
              estacaoAtiva === e.id
                ? "text-white"
                : "bg-neutral-900 text-neutral-400 hover:bg-neutral-800"
            }`}
          >
            {e.nome}
          </button>
        ))}

        <div className="ml-auto flex items-center gap-4">
          <SeloAoVivo estado={aoVivo} />
          <span className="text-sm tabular-nums text-neutral-500">
            {visiveis.length} {visiveis.length === 1 ? "ticket" : "tickets"}
          </span>
        </div>
      </header>

      {erro && (
        /* Acima dos outros avisos e em vermelho cheio: a cozinha olha a tela
           de longe, e este é o único aviso que diz que um toque não valeu. */
        <div className="flex shrink-0 items-center gap-3 bg-red-700 px-4 py-3">
          <p className="flex-1 text-base font-bold text-white">{erro}</p>
          <button
            onClick={() => setErro(null)}
            className="rounded-lg bg-red-900/60 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-900"
          >
            Entendi
          </button>
        </div>
      )}

      {(contaPedida > 0 || atrasados > 0 || esperandoRetirada > 0) && (
        <div className="flex shrink-0 flex-wrap gap-2 px-4 py-2 text-sm">
          {contaPedida > 0 && (
            <p className="rounded-lg bg-orange-950/60 px-3 py-1.5 font-semibold text-orange-300">
              {contaPedida} mesa(s) já pediram a conta
            </p>
          )}
          {atrasados > 0 && (
            <p className="rounded-lg bg-red-950/60 px-3 py-1.5 font-semibold text-red-300">
              {atrasados} ticket(s) passando de {alertaAtrasoMin}min
            </p>
          )}
          {esperandoRetirada > 0 && (
            <p className="rounded-lg bg-amber-950/60 px-3 py-1.5 font-semibold text-amber-300">
              {esperandoRetirada} prato(s) prontos esperando no balcão
            </p>
          )}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-px bg-neutral-900 md:grid-cols-3">
        {COLUNAS.map((coluna) => {
          const daColuna = visiveis.filter((p) => p.status === coluna.status);
          return (
            <section key={coluna.status} className="flex min-h-0 flex-col bg-neutral-950">
              <h2 className="shrink-0 px-4 py-3 texto-etiqueta text-neutral-400">
                {coluna.titulo}
                <span className="ml-2 font-normal text-neutral-500">{daColuna.length}</span>
              </h2>

              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 pb-4">
                {daColuna.length === 0 && (
                  <p className="py-10 text-center text-sm text-neutral-500">Vazio</p>
                )}

                {daColuna.map((pedido) => {
                  const minutos = minutosDesde(pedido.criadoEm);
                  const minutosPronto = pedido.prontoEm ? minutosDesde(pedido.prontoEm) : null;
                  const aviso = selo(
                    pedido,
                    minutos,
                    minutosPronto,
                    alertaAtrasoMin,
                    alertaRetiradaMin
                  );
                  const atrasado =
                    minutos !== null && minutos >= alertaAtrasoMin && pedido.status !== "PRONTO";

                  return (
                    <article
                      key={pedido.id}
                      /**
                       * O atraso é uma faixa na lateral, não um contorno.
                       *
                       * O cabeçalho deste cartão já é colorido — ele carrega a
                       * cor da estação. Um contorno vermelho em volta disputava
                       * com ela e ainda emoldurava o cartão: com vários
                       * atrasados, a tela virava um quadriculado.
                       *
                       * De longe, que é como a cozinha lê, as faixas se alinham
                       * numa coluna vertical e achar o atrasado vira uma
                       * olhada. De perto, não mexem no fundo atrás do nome dos
                       * pratos, que é o texto que precisa ser lido com pressa.
                       *
                       * Vai por sombra interna, e não por um filho posicionado
                       * com `overflow-hidden`: o selo do relógio fica para fora
                       * do cartão e seria cortado.
                       */
                      className={`relative rounded-xl border-2 bg-neutral-900 ${
                        pedido.contaPedida
                          ? "border-orange-500"
                          : atrasado
                            ? "border-neutral-800 shadow-[inset_6px_0_0_var(--color-red-600)]"
                            : "border-neutral-800"
                      }`}
                    >
                      {aviso && (
                        <span
                          title={aviso.titulo}
                          // Mesmo tratamento do mapa de mesas: selo grande,
                          // com anel na cor do fundo para destacar do card.
                          className={`absolute -right-2 -top-2 z-10 flex h-10 w-10 items-center justify-center rounded-full shadow-lg ring-2 ring-neutral-950 ${aviso.classe}`}
                        >
                          {aviso.icone}
                        </span>
                      )}

                      <div
                        className="flex items-center justify-between rounded-t-lg px-3 py-2"
                        style={{ backgroundColor: pedido.estacaoCor ?? "#404040" }}
                      >
                        <span className="text-sm font-bold text-white">
                          {pedido.mesaNumero ? `Mesa ${pedido.mesaNumero}` : `Comanda #${pedido.comandaNumero}`}
                        </span>
                        <span className="text-xs font-semibold text-white/80">
                          #{pedido.numero} · {pedido.estacaoNome}
                        </span>
                      </div>

                      <ul className="space-y-2 px-3 py-3">
                        {pedido.itens.map((item) => (
                          <li key={item.id}>
                            {/* Item cancelado continua na tela, riscado. Sumir
                                em silêncio deixaria o cozinheiro que já pegou
                                a carne preparando um prato que ninguém quer —
                                ele precisa ver que aquilo mudou. */}
                            <div
                              className={`flex gap-2 text-base font-semibold leading-tight ${
                                item.cancelado ? "text-neutral-500 line-through" : ""
                              }`}
                            >
                              <span
                                className={`tabular-nums ${
                                  item.cancelado ? "text-neutral-500" : "text-orange-400"
                                }`}
                              >
                                {item.quantidade}×
                              </span>
                              <span>{item.titulo}</span>
                            </div>
                            {item.cancelado && (
                              <span className="mt-1 inline-block rounded-md bg-neutral-700 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-neutral-200">
                                cancelado
                              </span>
                            )}
                            {/* Ponto da carne e observação são o que faz o
                                prato voltar. Merecem peso visual maior que o
                                nome do produto. */}
                            {item.pontoCarne && !item.cancelado && (
                              <span className="mt-1 inline-flex items-center gap-1.5 rounded-md bg-red-600 px-2 py-1 text-xs font-bold text-white">
                                {ICONE.fogo}
                                {item.pontoCarne}
                              </span>
                            )}
                            {item.observacao && !item.cancelado && (
                              <span className="mt-1 flex items-start gap-1.5 rounded-md bg-amber-400/15 px-2 py-1 text-sm font-semibold text-amber-300">
                                <span className="mt-0.5 shrink-0">{ICONE.alerta}</span>
                                {item.observacao}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>

                      <div className="flex items-center gap-2 border-t border-neutral-800 px-3 py-2">
                        {/* Na coluna Pronto o número útil é há quanto tempo o
                            prato espera no balcão, não há quanto tempo entrou
                            na cozinha. */}
                        <span
                          className={`text-sm font-bold tabular-nums ${
                            pedido.status === "PRONTO"
                              ? minutosPronto !== null && minutosPronto >= alertaRetiradaMin
                                ? "text-amber-400"
                                : "text-neutral-500"
                              : atrasado
                                ? "text-red-500"
                                : "text-neutral-500"
                          }`}
                        >
                          {pedido.status === "PRONTO"
                            ? minutosPronto === null
                              ? ""
                              : `pronto há ${minutosPronto}min`
                            : minutos === null
                              ? ""
                              : `${minutos}min`}
                        </span>
                        <button
                          onClick={() => avancar(pedido.id, coluna.proximo)}
                          disabled={pendente}
                          className="ml-auto rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-40"
                        >
                          {coluna.acao}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
