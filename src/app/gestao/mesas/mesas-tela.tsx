"use client";

import { temErro } from "@/lib/erro-de-operacao";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import {
  alternarAreaAtiva,
  alternarMesaAtiva,
  atualizarMesa,
  criarArea,
  criarMesasEmLote,
  excluirMesa,
  gerarQrFaltantes,
  moverArea,
  renomearArea,
} from "./actions";

type MesaView = {
  id: string;
  numero: string;
  capacidade: number;
  status: string;
  ativo: boolean;
  areaId: string;
  temQr: boolean;
};

type AreaView = { id: string; nome: string; ativo: boolean; mesas: MesaView[] };

const CORES_STATUS: Record<string, string> = {
  LIVRE: "bg-emerald-100 text-emerald-800",
  OCUPADA: "bg-sky-100 text-sky-800",
  FECHANDO: "bg-orange-100 text-orange-800",
  RESERVADA: "bg-violet-100 text-violet-800",
  SUJA: "bg-neutral-200 text-neutral-600",
};

export function MesasTela({
  areas,
  mesasSemArea,
  semQr,
  podeEditar,
  rodape,
}: {
  areas: AreaView[];
  mesasSemArea: MesaView[];
  semQr: number;
  podeEditar: boolean;
  rodape: ReactNode;
}) {
  const [novaArea, setNovaArea] = useState("");
  const [editandoArea, setEditandoArea] = useState<{ id: string; nome: string } | null>(null);
  const [editandoMesa, setEditandoMesa] = useState<MesaView | null>(null);
  const [loteEm, setLoteEm] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  const router = useRouter();

  const totalMesas = areas.reduce((s, a) => s + a.mesas.length, 0) + mesasSemArea.length;
  const ativas = [...areas.flatMap((a) => a.mesas), ...mesasSemArea].filter((m) => m.ativo).length;

  function agir(fn: () => Promise<unknown>, aoTerminar?: () => void) {
    setErro(null);
    setAviso(null);
    iniciar(async () => {
      try {
        // Regra de negócio violada volta como valor, não como exceção: a
        // mensagem de uma exceção não atravessa a server action em produção.
        const r = await fn();
        if (temErro(r)) {
          setErro(r.erro);
          return;
        }
        aoTerminar?.();
        router.refresh();
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Algo deu errado.");
      }
    });
  }

  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Mesas e áreas</h1>
          <p className="mt-1 text-sm text-neutral-500">
            {ativas} mesa(s) ativa(s) de {totalMesas} · {areas.length} área(s)
          </p>
        </div>
        <span className="text-sm">{rodape}</span>
      </div>

      {erro && <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{erro}</p>}
      {aviso && (
        <p className="mt-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{aviso}</p>
      )}

      {semQr > 0 && podeEditar && (
        <p className="mt-4 flex flex-wrap items-center gap-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {semQr} mesa(s) sem QR Code — o cliente não consegue chamar o garçom nelas.
          <button
            onClick={() =>
              agir(async () => {
                const r = await gerarQrFaltantes();
                if (temErro(r)) return r;
                setAviso(`${r.geradas} QR Code(s) gerado(s).`);
              })
            }
            className="rounded-md bg-amber-800 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-900"
          >
            Gerar agora
          </button>
        </p>
      )}

      {podeEditar && (
        <div className="mt-6 flex flex-wrap gap-2">
          <input
            value={novaArea}
            onChange={(e) => setNovaArea(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && novaArea.trim()) {
                agir(() => criarArea(novaArea), () => setNovaArea(""));
              }
            }}
            placeholder="Nova área (salão, deck, varanda...)"
            className="w-64 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
          />
          <button
            onClick={() => agir(() => criarArea(novaArea), () => setNovaArea(""))}
            disabled={pendente || !novaArea.trim()}
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-700 disabled:opacity-40"
          >
            Criar área
          </button>
        </div>
      )}

      {areas.length === 0 && mesasSemArea.length === 0 && (
        <p className="mt-8 rounded-xl border border-dashed border-neutral-300 py-16 text-center text-sm text-neutral-500">
          Nenhuma área cadastrada. Comece criando uma — &quot;Salão&quot; resolve para a maioria
          das casas — e depois crie as mesas em lote.
        </p>
      )}

      {areas.map((area, indice) => (
        <section
          key={area.id}
          className={`mt-6 overflow-hidden rounded-xl border border-neutral-200 bg-white ${
            area.ativo ? "" : "opacity-60"
          }`}
        >
          <header className="flex flex-wrap items-center gap-3 border-b border-neutral-200 bg-neutral-50 px-5 py-3">
            {editandoArea?.id === area.id ? (
              <>
                <input
                  value={editandoArea.nome}
                  autoFocus
                  onChange={(e) => setEditandoArea({ id: area.id, nome: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      agir(() => renomearArea(area.id, editandoArea.nome), () =>
                        setEditandoArea(null)
                      );
                    }
                    if (e.key === "Escape") setEditandoArea(null);
                  }}
                  className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm"
                />
                <button
                  onClick={() =>
                    agir(() => renomearArea(area.id, editandoArea.nome), () =>
                      setEditandoArea(null)
                    )
                  }
                  className="text-sm font-semibold text-neutral-900"
                >
                  salvar
                </button>
                <button
                  onClick={() => setEditandoArea(null)}
                  className="text-sm text-neutral-500"
                >
                  cancelar
                </button>
              </>
            ) : (
              <>
                <h2 className="text-sm font-bold uppercase tracking-widest">{area.nome}</h2>
                <span className="text-xs text-neutral-500">{area.mesas.length} mesa(s)</span>
                {!area.ativo && (
                  <span className="rounded-md bg-neutral-200 px-2 py-0.5 text-[10px] font-bold text-neutral-600">
                    INATIVA
                  </span>
                )}
              </>
            )}

            {podeEditar && editandoArea?.id !== area.id && (
              <span className="ml-auto flex flex-wrap items-center gap-3 text-sm">
                <button
                  onClick={() => agir(() => moverArea(area.id, -1))}
                  disabled={indice === 0}
                  title="Subir no mapa de mesas"
                  className="text-neutral-500 hover:text-neutral-900 disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  onClick={() => agir(() => moverArea(area.id, 1))}
                  disabled={indice === areas.length - 1}
                  title="Descer no mapa de mesas"
                  className="text-neutral-500 hover:text-neutral-900 disabled:opacity-30"
                >
                  ↓
                </button>
                <button
                  onClick={() => setEditandoArea({ id: area.id, nome: area.nome })}
                  className="text-neutral-500 hover:text-neutral-900"
                >
                  renomear
                </button>
                <button
                  onClick={() => setLoteEm(loteEm === area.id ? null : area.id)}
                  className="font-semibold text-neutral-900"
                >
                  + mesas
                </button>
                <button
                  onClick={() => agir(() => alternarAreaAtiva(area.id, !area.ativo))}
                  className="text-neutral-500 hover:text-red-600"
                >
                  {area.ativo ? "desativar" : "reativar"}
                </button>
              </span>
            )}
          </header>

          {loteEm === area.id && podeEditar && (
            <LoteForm
              pendente={pendente}
              onCancelar={() => setLoteEm(null)}
              onCriar={(dados) =>
                agir(
                  async () => {
                    const r = await criarMesasEmLote({ areaId: area.id, ...dados });
                    if (temErro(r)) return r;
                    setAviso(
                      r.ignoradas > 0
                        ? `${r.criadas} mesa(s) criada(s). ${r.ignoradas} já existiam e foram mantidas.`
                        : `${r.criadas} mesa(s) criada(s).`
                    );
                  },
                  () => setLoteEm(null)
                )
              }
            />
          )}

          <ListaMesas
            mesas={area.mesas}
            areas={areas}
            podeEditar={podeEditar}
            pendente={pendente}
            editando={editandoMesa}
            setEditando={setEditandoMesa}
            agir={agir}
          />
        </section>
      ))}

      {mesasSemArea.length > 0 && (
        <section className="mt-6 overflow-hidden rounded-xl border border-amber-300 bg-white">
          <header className="border-b border-amber-200 bg-amber-50 px-5 py-3">
            <h2 className="text-sm font-bold uppercase tracking-widest text-amber-800">
              Sem área
            </h2>
            <p className="mt-0.5 text-xs text-amber-700">
              Estas mesas não aparecem no mapa do PDV, que agrupa por área. Atribua uma área a
              elas.
            </p>
          </header>
          <ListaMesas
            mesas={mesasSemArea}
            areas={areas}
            podeEditar={podeEditar}
            pendente={pendente}
            editando={editandoMesa}
            setEditando={setEditandoMesa}
            agir={agir}
          />
        </section>
      )}
    </>
  );
}

function ListaMesas({
  mesas,
  areas,
  podeEditar,
  pendente,
  editando,
  setEditando,
  agir,
}: {
  mesas: MesaView[];
  areas: AreaView[];
  podeEditar: boolean;
  pendente: boolean;
  editando: MesaView | null;
  setEditando: (m: MesaView | null) => void;
  agir: (fn: () => Promise<unknown>, aoTerminar?: () => void) => void;
}) {
  if (mesas.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-neutral-500">
        Nenhuma mesa nesta área ainda.
      </p>
    );
  }

  return (
    <table className="w-full text-sm">
      <tbody className="divide-y divide-neutral-100">
        {mesas.map((mesa) =>
          editando?.id === mesa.id ? (
            <tr key={mesa.id} className="bg-neutral-50">
              <td colSpan={4} className="px-5 py-4">
                <div className="flex flex-wrap items-end gap-3">
                  <label>
                    <span className="mb-1 block text-xs font-semibold uppercase text-neutral-500">
                      Número
                    </span>
                    <input
                      value={editando.numero}
                      autoFocus
                      onChange={(e) => setEditando({ ...editando, numero: e.target.value })}
                      className="w-24 rounded-lg border border-neutral-300 px-3 py-2"
                    />
                  </label>
                  <label>
                    <span className="mb-1 block text-xs font-semibold uppercase text-neutral-500">
                      Lugares
                    </span>
                    <input
                      value={editando.capacidade}
                      inputMode="numeric"
                      onChange={(e) =>
                        setEditando({ ...editando, capacidade: Number(e.target.value) || 0 })
                      }
                      className="w-20 rounded-lg border border-neutral-300 px-3 py-2 tabular-nums"
                    />
                  </label>
                  <label>
                    <span className="mb-1 block text-xs font-semibold uppercase text-neutral-500">
                      Área
                    </span>
                    <select
                      value={editando.areaId}
                      onChange={(e) => setEditando({ ...editando, areaId: e.target.value })}
                      className="rounded-lg border border-neutral-300 bg-white px-3 py-2"
                    >
                      <option value="">Sem área</option>
                      {areas.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.nome}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    onClick={() =>
                      agir(
                        () =>
                          atualizarMesa({
                            mesaId: editando.id,
                            numero: editando.numero,
                            capacidade: editando.capacidade,
                            areaId: editando.areaId,
                          }),
                        () => setEditando(null)
                      )
                    }
                    disabled={pendente}
                    className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
                  >
                    Salvar
                  </button>
                  <button
                    onClick={() => setEditando(null)}
                    className="px-2 py-2 text-sm text-neutral-500 hover:text-neutral-900"
                  >
                    Cancelar
                  </button>
                </div>
              </td>
            </tr>
          ) : (
            <tr key={mesa.id} className={mesa.ativo ? "" : "opacity-50"}>
              <td className="px-5 py-3">
                <span className="text-base font-bold tabular-nums">{mesa.numero}</span>
                {!mesa.ativo && (
                  <span className="ml-2 text-[10px] font-bold uppercase text-neutral-500">
                    inativa
                  </span>
                )}
              </td>
              <td className="px-5 py-3 text-neutral-500">{mesa.capacidade} lugares</td>
              <td className="px-5 py-3">
                <span
                  className={`rounded-md px-2 py-1 text-xs font-semibold ${
                    CORES_STATUS[mesa.status] ?? ""
                  }`}
                >
                  {mesa.status}
                </span>
                {!mesa.temQr && (
                  <span className="ml-2 text-xs text-amber-700">sem QR</span>
                )}
              </td>
              <td className="px-5 py-3 text-right">
                {podeEditar && (
                  <span className="flex justify-end gap-3 whitespace-nowrap">
                    <button
                      onClick={() => setEditando(mesa)}
                      className="text-neutral-500 hover:text-neutral-900"
                    >
                      editar
                    </button>
                    <button
                      onClick={() => agir(() => alternarMesaAtiva(mesa.id, !mesa.ativo))}
                      className="text-neutral-500 hover:text-neutral-900"
                    >
                      {mesa.ativo ? "desativar" : "reativar"}
                    </button>
                    <button
                      onClick={() => agir(() => excluirMesa(mesa.id))}
                      className="text-neutral-500 hover:text-red-600"
                      title="Só é possível excluir mesa que nunca teve comanda"
                    >
                      excluir
                    </button>
                  </span>
                )}
              </td>
            </tr>
          )
        )}
      </tbody>
    </table>
  );
}

function LoteForm({
  pendente,
  onCriar,
  onCancelar,
}: {
  pendente: boolean;
  onCriar: (dados: { de: number; ate: number; capacidade: number }) => void;
  onCancelar: () => void;
}) {
  const [de, setDe] = useState("1");
  const [ate, setAte] = useState("10");
  const [capacidade, setCapacidade] = useState("4");

  const quantidade = Math.max(0, (Number(ate) || 0) - (Number(de) || 0) + 1);

  return (
    <div className="border-b border-neutral-200 bg-neutral-50 px-5 py-4">
      <div className="flex flex-wrap items-end gap-3">
        <label>
          <span className="mb-1 block text-xs font-semibold uppercase text-neutral-500">
            Da mesa
          </span>
          <input
            value={de}
            onChange={(e) => setDe(e.target.value)}
            inputMode="numeric"
            autoFocus
            className="w-20 rounded-lg border border-neutral-300 px-3 py-2 tabular-nums"
          />
        </label>
        <label>
          <span className="mb-1 block text-xs font-semibold uppercase text-neutral-500">Até</span>
          <input
            value={ate}
            onChange={(e) => setAte(e.target.value)}
            inputMode="numeric"
            className="w-20 rounded-lg border border-neutral-300 px-3 py-2 tabular-nums"
          />
        </label>
        <label>
          <span className="mb-1 block text-xs font-semibold uppercase text-neutral-500">
            Lugares
          </span>
          <input
            value={capacidade}
            onChange={(e) => setCapacidade(e.target.value)}
            inputMode="numeric"
            className="w-20 rounded-lg border border-neutral-300 px-3 py-2 tabular-nums"
          />
        </label>

        <button
          onClick={() =>
            onCriar({
              de: Number(de) || 0,
              ate: Number(ate) || 0,
              capacidade: Number(capacidade) || 4,
            })
          }
          disabled={pendente || quantidade < 1}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          {pendente ? "Criando..." : `Criar ${quantidade} mesa(s)`}
        </button>
        <button
          onClick={onCancelar}
          className="px-2 py-2 text-sm text-neutral-500 hover:text-neutral-900"
        >
          Cancelar
        </button>
      </div>
      <p className="mt-2 text-xs text-neutral-500">
        Números já existentes são mantidos como estão — a criação não sobrescreve nada.
      </p>
    </div>
  );
}
