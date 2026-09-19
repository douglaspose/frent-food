import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { ACOES, type Acao } from "@/lib/auditoria";
import { exigirSessao, temPermissao } from "@/lib/session";
import { Filtros } from "./filtros";
import { Detalhe } from "./detalhe";

export const metadata: Metadata = { title: "Diário" };
export const dynamic = "force-dynamic";

/** Quanto tempo cada faixa cobre, em dias. */
const PERIODOS = { hoje: 1, "7": 7, "30": 30, "90": 90 } as const;
type Periodo = keyof typeof PERIODOS;

/** Página cheia cansa e ninguém lê a milésima linha. */
const POR_PAGINA = 100;

export default async function AuditoriaPage({
  searchParams,
}: {
  searchParams: Promise<{ acao?: string; periodo?: string; pagina?: string }>;
}) {
  const sessao = await exigirSessao();
  /**
   * Só quem manda no dinheiro lê o diário. Ele diz quem deu desconto e quem
   * fechou caixa com falta — numa mão errada vira mapa de quem vigiar.
   */
  if (!temPermissao(sessao, "auditoria.ver")) redirect("/gestao");

  const params = await searchParams;
  const periodo: Periodo = params.periodo && params.periodo in PERIODOS
    ? (params.periodo as Periodo)
    : "7";
  const acao = params.acao && params.acao in ACOES ? (params.acao as Acao) : null;
  const pagina = Math.max(1, Number(params.pagina) || 1);

  const desde = new Date();
  if (periodo === "hoje") desde.setHours(0, 0, 0, 0);
  else desde.setDate(desde.getDate() - PERIODOS[periodo]);

  const filtro = {
    tenantId: sessao.tenantId,
    criadoEm: { gte: desde },
    ...(acao ? { acao } : {}),
  };

  const [registros, total] = await Promise.all([
    db.auditLog.findMany({
      where: filtro,
      orderBy: { criadoEm: "desc" },
      take: POR_PAGINA,
      skip: (pagina - 1) * POR_PAGINA,
      include: { usuario: { select: { nome: true } } },
    }),
    db.auditLog.count({ where: filtro }),
  ]);

  const ultimaPagina = Math.max(1, Math.ceil(total / POR_PAGINA));

  return (
    <>
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Diário</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Quem mexeu no dinheiro e quando. O registro é gravado junto com a
          alteração, então não existe desconto sem linha aqui.
        </p>
      </header>

      <Filtros acao={acao} periodo={periodo} />

      {registros.length === 0 ? (
        <p className="rounded-xl border border-neutral-200 bg-white px-6 py-16 text-center text-neutral-500">
          Nada registrado neste período.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-4 py-3 font-medium">Quando</th>
                <th className="px-4 py-3 font-medium">Quem</th>
                <th className="px-4 py-3 font-medium">O quê</th>
                <th className="px-4 py-3 font-medium">Detalhe</th>
                <th className="px-4 py-3 font-medium">Origem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {registros.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums text-neutral-600">
                    {r.criadoEm.toLocaleString("pt-BR", {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 font-medium">
                    {/* Usuário desativado continua aparecendo: o diário guarda
                        o que aconteceu, não quem ainda trabalha aqui. */}
                    {r.usuario?.nome ?? <span className="text-neutral-400">removido</span>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {ACOES[r.acao as Acao] ?? r.acao}
                  </td>
                  <td className="px-4 py-3 text-neutral-600">
                    <Detalhe antes={r.antes} depois={r.depois} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs tabular-nums text-neutral-400">
                    {r.ip ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {ultimaPagina > 1 && (
        <nav className="mt-4 flex items-center justify-between text-sm">
          <span className="text-neutral-500">
            {total} registro(s) · página {pagina} de {ultimaPagina}
          </span>
          <div className="flex gap-2">
            <Paginar
              destino={pagina - 1}
              ativa={pagina > 1}
              acao={acao}
              periodo={periodo}
              rotulo="Anterior"
            />
            <Paginar
              destino={pagina + 1}
              ativa={pagina < ultimaPagina}
              acao={acao}
              periodo={periodo}
              rotulo="Próxima"
            />
          </div>
        </nav>
      )}
    </>
  );
}

function Paginar({
  destino,
  ativa,
  acao,
  periodo,
  rotulo,
}: {
  destino: number;
  ativa: boolean;
  acao: Acao | null;
  periodo: Periodo;
  rotulo: string;
}) {
  if (!ativa) {
    return <span className="rounded-lg px-3 py-1.5 text-neutral-300">{rotulo}</span>;
  }

  const busca = new URLSearchParams({ periodo, pagina: String(destino) });
  if (acao) busca.set("acao", acao);

  return (
    <a
      href={`/gestao/auditoria?${busca}`}
      className="rounded-lg border border-neutral-200 px-3 py-1.5 font-medium hover:bg-neutral-50"
    >
      {rotulo}
    </a>
  );
}
