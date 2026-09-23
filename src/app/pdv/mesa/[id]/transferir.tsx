"use client";

import { temErro, mensagemDeFalha } from "@/lib/erro-de-operacao";
import { TEXTO_DE_CAMPO } from "@/lib/campo";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { mesasLivres, transferirMesa } from "../../transferencia-actions";

type MesaLivre = {
  id: string;
  numero: string;
  capacidade: number;
  status: string;
  area: string | null;
};

/**
 * Troca de mesa em dois toques.
 *
 * A lista só carrega quando o garçom abre o painel — num salão de 46 mesas,
 * buscá-la em toda renderização da comanda seria uma consulta por nada em
 * quase todas as vezes.
 */
export function Transferir({
  comandaId,
  mesaAtual,
  aoTransferir,
}: {
  comandaId: string;
  mesaAtual: string;
  aoTransferir: (mesaId: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [mesas, setMesas] = useState<MesaLivre[] | null>(null);
  const [busca, setBusca] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  const router = useRouter();

  useEffect(() => {
    if (!aberto || mesas) return;
    let vivo = true;
    mesasLivres(comandaId)
      .then((lista) => {
        if (!vivo) return;
        if (temErro(lista)) setErro(lista.erro);
        else setMesas(lista);
      })
      .catch((e) => vivo && setErro(mensagemDeFalha(e, "Não consegui listar as mesas.")));
    return () => {
      vivo = false;
    };
  }, [aberto, mesas, comandaId]);

  function transferir(mesaId: string) {
    setErro(null);
    iniciar(async () => {
      try {
        const r = await transferirMesa(comandaId, mesaId);
        if (temErro(r)) {
          setErro(r.erro);
          // A lista envelheceu: alguém abriu a mesa enquanto o painel estava
          // aberto. Buscar de novo tira a opção que já não existe.
          setMesas(null);
          router.refresh();
          return;
        }
        setAberto(false);
        // A comanda vive noutra URL agora: ficar na antiga mostraria a mesa
        // velha, já livre, como se a conta tivesse sumido.
        aoTransferir(mesaId);
      } catch (e) {
        setErro(mensagemDeFalha(e, "Não foi possível transferir."));
        setMesas(null);
        router.refresh();
      }
    });
  }

  if (!aberto) {
    return (
      <button
        onClick={() => setAberto(true)}
        className="rounded-lg border border-neutral-800 px-3 py-1.5 text-xs font-semibold text-neutral-400 transition hover:border-neutral-600 hover:text-neutral-200"
      >
        Transferir mesa
      </button>
    );
  }

  const visiveis = busca.trim()
    ? (mesas ?? []).filter((m) => m.numero.startsWith(busca.trim()))
    : (mesas ?? []);

  return (
    <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-[70vh] overflow-y-auto rounded-xl border border-neutral-800 bg-neutral-950 p-4 shadow-2xl">
      <div className="mb-3 flex items-center gap-3">
        <p className="text-sm font-semibold">Transferir a mesa {mesaAtual} para:</p>
        <button
          onClick={() => setAberto(false)}
          className="ml-auto rounded-lg bg-neutral-900 px-3 py-1.5 text-xs text-neutral-400 transition hover:bg-neutral-800"
        >
          Fechar
        </button>
      </div>

      <input
        autoFocus
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        inputMode="numeric"
        placeholder="número da mesa"
        className={`mb-3 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 placeholder:text-neutral-600 focus:border-orange-600 focus:outline-none ${TEXTO_DE_CAMPO}`}
      />

      {erro && <p className="mb-3 text-sm text-red-400">{erro}</p>}

      {mesas === null && !erro && <p className="py-6 text-center text-sm text-neutral-500">Carregando…</p>}

      {mesas !== null && visiveis.length === 0 && (
        <p className="py-6 text-center text-sm text-neutral-500">
          {mesas.length === 0 ? "Nenhuma mesa livre no salão." : "Nenhuma mesa com esse número."}
        </p>
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(5rem,1fr))] gap-2">
        {visiveis.map((m) => (
          <button
            key={m.id}
            onClick={() => transferir(m.id)}
            disabled={pendente}
            title={`${m.area ?? "Sem área"} · ${m.capacidade} lugares`}
            className={`flex h-20 flex-col items-center justify-center rounded-lg border-2 transition disabled:opacity-40 ${
              // Mesa suja continua escolhível, mas avisa: alguém vai ter que
              // passar um pano antes de sentar o grupo.
              m.status === "SUJA"
                ? "border-neutral-700 bg-neutral-900 text-neutral-400 hover:border-neutral-500"
                : "border-emerald-700/60 bg-emerald-950/30 text-emerald-400 hover:border-emerald-500"
            }`}
          >
            <span className="text-xl font-bold tabular-nums text-neutral-100">{m.numero}</span>
            <span className="text-[10px] font-bold tracking-widest">
              {m.status === "SUJA" ? "LIMPAR" : `${m.capacidade} LUG`}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
