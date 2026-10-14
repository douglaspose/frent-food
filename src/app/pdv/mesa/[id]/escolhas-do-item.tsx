"use client";

import { useState } from "react";
import type { GrupoDeOpcionais, OpcionalDoCardapio } from "@/lib/carrinho";
import type { CardapioItemView } from "./page";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/**
 * As escolhas do prato, antes de ele entrar no carrinho.
 *
 * O garçom está de pé, com a mesa falando, e o salão é a tela que mais produz
 * toque errado. Por isso o alvo é grande, o que o grupo exige vem escrito em
 * palavras ("escolha 1", "até 3") e o botão só libera quando o obrigatório foi
 * atendido — dizendo o que falta, em vez de ficar apagado sem explicação.
 *
 * É a mesma conversa que a maquininha faz, e de propósito: quem aprendeu a
 * lançar no tablet não deveria reaprender no aparelho.
 */
export function EscolhasDoItem({
  item,
  pendente,
  aoConfirmar,
  aoFechar,
}: {
  item: CardapioItemView;
  pendente: boolean;
  aoConfirmar: (escolhas: OpcionalDoCardapio[]) => void;
  aoFechar: () => void;
}) {
  const [marcados, setMarcados] = useState<Record<string, OpcionalDoCardapio[]>>({});

  const doGrupo = (grupoId: string) => marcados[grupoId] ?? [];
  const escolhas = item.grupos.flatMap((g) => doGrupo(g.id));
  const faltando = item.grupos.filter((g) => doGrupo(g.id).length < minimoDe(g));
  const extra = escolhas.reduce((soma, o) => soma + o.precoEmCentavos, 0) / 100;

  function alternar(grupo: GrupoDeOpcionais, opcional: OpcionalDoCardapio) {
    setMarcados((atual) => {
      const atuais = atual[grupo.id] ?? [];
      const jaMarcado = atuais.some((o) => o.opcionalId === opcional.opcionalId);

      const novos = jaMarcado
        ? atuais.filter((o) => o.opcionalId !== opcional.opcionalId)
        : // Grupo de uma escolha troca em vez de recusar: o garçom toca no
          // ponto certo sem precisar desmarcar o errado.
          grupo.maxEscolhas === 1
          ? [opcional]
          : atuais.length >= grupo.maxEscolhas
            ? atuais
            : [...atuais, opcional];

      return { ...atual, [grupo.id]: novos };
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/80 p-4">
      <div className="flex max-h-full w-full max-w-md flex-col rounded-xl border border-neutral-800 bg-neutral-900 shadow-2xl">
        <div className="shrink-0 border-b border-neutral-800 px-5 py-4">
          <p className="text-base font-semibold">{item.titulo}</p>
          <p className="text-sm text-neutral-400">{brl.format(item.preco + extra)}</p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          {item.grupos.map((grupo) => (
            <div key={grupo.id} className="mb-4 last:mb-0">
              <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-orange-400">
                {grupo.titulo} · {regraEmPalavras(grupo)}
              </p>
              <div className="flex flex-col gap-1.5">
                {grupo.itens.map((opcional) => {
                  const marcado = doGrupo(grupo.id).some(
                    (o) => o.opcionalId === opcional.opcionalId
                  );
                  const cheio =
                    grupo.maxEscolhas > 1 && doGrupo(grupo.id).length >= grupo.maxEscolhas;
                  return (
                    <button
                      key={opcional.opcionalId}
                      onClick={() => alternar(grupo, opcional)}
                      // Alvo de 48px: é o salão, não é um mouse.
                      className={`realce-ao-toque flex min-h-[48px] touch-manipulation items-center gap-3 rounded-lg border px-3 text-left transition duration-100 active:scale-[0.99] ${
                        marcado
                          ? "border-orange-600 bg-orange-950/40"
                          : "border-neutral-800 hover:bg-neutral-800"
                      } ${!marcado && cheio ? "opacity-40" : ""}`}
                    >
                      <span
                        className={`text-base ${marcado ? "text-orange-400" : "text-neutral-600"}`}
                      >
                        {marcado ? "●" : "○"}
                      </span>
                      <span className="flex-1 text-sm leading-tight">{opcional.titulo}</span>
                      {opcional.precoEmCentavos > 0 && (
                        <span className="shrink-0 text-xs tabular-nums text-neutral-400">
                          + {brl.format(opcional.precoEmCentavos / 100)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="flex shrink-0 gap-2 border-t border-neutral-800 px-5 py-4">
          <button
            onClick={aoFechar}
            className="h-12 flex-1 rounded-lg border border-neutral-700 text-sm font-semibold transition hover:bg-neutral-800"
          >
            Cancelar
          </button>
          <button
            onClick={() => aoConfirmar(escolhas)}
            disabled={faltando.length > 0 || pendente}
            className="h-12 flex-[2] rounded-lg bg-orange-600 text-sm font-bold transition hover:bg-orange-500 disabled:opacity-40"
          >
            {faltando.length > 0 ? `Falta ${faltando[0].titulo}` : "Lançar"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * O mínimo que vale de verdade.
 *
 * A casa marca "obrigatório" e às vezes esquece o mínimo; a intenção é clara, e
 * o servidor aplica a mesma regra — a tela não pode deixar passar o que ele vai
 * recusar depois.
 */
function minimoDe(grupo: GrupoDeOpcionais) {
  return grupo.obrigatorio ? Math.max(1, grupo.minEscolhas) : grupo.minEscolhas;
}

/** "min 1 / max 3" é como o banco guarda; isto é o que o garçom precisa ler. */
function regraEmPalavras(grupo: GrupoDeOpcionais) {
  const minimo = minimoDe(grupo);
  if (minimo === 0) {
    return grupo.maxEscolhas === 1 ? "opcional" : `até ${grupo.maxEscolhas}, opcional`;
  }
  if (minimo === grupo.maxEscolhas) return `escolha ${minimo}`;
  return `escolha ${minimo} a ${grupo.maxEscolhas}`;
}
