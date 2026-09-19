"use client";

import { useRouter } from "next/navigation";
import { ACOES, type Acao } from "@/lib/auditoria";

const PERIODOS: { valor: string; rotulo: string }[] = [
  { valor: "hoje", rotulo: "Hoje" },
  { valor: "7", rotulo: "7 dias" },
  { valor: "30", rotulo: "30 dias" },
  { valor: "90", rotulo: "90 dias" },
];

/**
 * Filtros na URL, não em estado local.
 *
 * "Olha aqui o desconto de sábado" é um link que o gerente manda no WhatsApp
 * para o dono. Com o filtro guardado só no componente, o link abriria noutra
 * tela e a conversa teria que recomeçar.
 */
export function Filtros({ acao, periodo }: { acao: Acao | null; periodo: string }) {
  const router = useRouter();

  const ir = (mudanca: Record<string, string>) => {
    const busca = new URLSearchParams({ periodo, ...(acao ? { acao } : {}), ...mudanca });
    // Trocar o filtro sempre volta para a primeira página: manter a página 4
    // de um filtro noutro mostraria uma tela vazia sem explicação.
    busca.delete("pagina");
    router.push(`/gestao/auditoria?${busca}`);
  };

  return (
    <div className="mb-5 flex flex-wrap items-center gap-3">
      <div className="flex gap-1">
        {PERIODOS.map((p) => (
          <button
            key={p.valor}
            onClick={() => ir({ periodo: p.valor })}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              periodo === p.valor
                ? "bg-neutral-900 text-white"
                : "bg-white text-neutral-600 ring-1 ring-neutral-200 hover:bg-neutral-50"
            }`}
          >
            {p.rotulo}
          </button>
        ))}
      </div>

      <select
        value={acao ?? ""}
        onChange={(e) => {
          const busca = new URLSearchParams({ periodo });
          if (e.target.value) busca.set("acao", e.target.value);
          router.push(`/gestao/auditoria?${busca}`);
        }}
        className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm"
      >
        <option value="">Todas as ações</option>
        {Object.entries(ACOES).map(([chave, rotulo]) => (
          <option key={chave} value={chave}>
            {rotulo}
          </option>
        ))}
      </select>
    </div>
  );
}
