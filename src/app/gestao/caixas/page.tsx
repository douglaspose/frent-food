import type { Metadata } from "next";
import Link from "next/link";
import { exigirSessao, temPermissao } from "@/lib/session";
import { historicoDeCaixa, TURNOS_POR_PAGINA } from "@/lib/historico-de-caixa";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Fechamentos de caixa" };
export const dynamic = "force-dynamic";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

const TURNO: Record<string, string> = {
  DIA: "dia",
  INTERMEDIARIO: "intermediário",
  NOITE: "noite",
  MADRUGADA: "madrugada",
};

/** "2026-09-20" → "20/09". Sem passar por `Date`, que traria fuso junto. */
function diaCurto(iso: string) {
  const [, mes, dia] = iso.split("-");
  return `${dia}/${mes}`;
}

function diaDaSemana(iso: string) {
  const [ano, mes, dia] = iso.split("-").map(Number);
  return new Date(ano!, mes! - 1, dia!).toLocaleDateString("pt-BR", { weekday: "short" });
}

export default async function CaixasPage() {
  const sessao = await exigirSessao();

  /**
   * Mesma permissão do Diário.
   *
   * Divergência de turno é o que o gerente confere ao fim da noite — é
   * literalmente o motivo de ele ler o diário. Garçom e caixa não: a tela diz
   * quem fechou com falta, e isso muda a conversa no salão.
   */
  if (!temPermissao(sessao, "auditoria.ver")) redirect("/gestao");

  const turnos = await historicoDeCaixa(sessao.unidadeId);

  const comDiferenca = turnos.filter((t) => t.divergencia !== null && t.divergencia !== 0).length;

  return (
    <>
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Fechamentos de caixa</h1>
        <p className="mt-1 max-w-2xl text-sm text-neutral-500">
          Os turnos já encerrados, com o que entrou, o que saiu da gaveta e a diferença de cada
          contagem. A tela do salão só mostra o caixa aberto; aqui fica o que passou.
        </p>
      </header>

      {turnos.length === 0 ? (
        <p className="rounded-xl border border-neutral-200 bg-white px-4 py-8 text-center text-sm text-neutral-500">
          Nenhum caixa foi aberto ainda.
        </p>
      ) : (
        <>
          {/*
            Rola em vez de cortar, como as outras tabelas da gestão: em 375px
            sobram 325px e esta pede bem mais.
          */}
          <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
            <table className="w-full min-w-[46rem] text-sm">
              <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Dia</th>
                  <th className="px-4 py-3 font-semibold">Fechou</th>
                  <th className="px-4 py-3 text-right font-semibold">Recebido</th>
                  <th className="px-4 py-3 text-right font-semibold">Na gaveta</th>
                  <th className="px-4 py-3 text-right font-semibold">Contado</th>
                  <th className="px-4 py-3 text-right font-semibold">Diferença</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>

              <tbody className="divide-y divide-neutral-100">
                {turnos.map((t) => {
                  const aberto = t.status === "ABERTO";
                  const diferente = t.divergencia !== null && t.divergencia !== 0;

                  return (
                    <tr key={t.id} className={aberto ? "bg-orange-50/50" : ""}>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className="font-medium">{diaCurto(t.data)}</span>
                        <span className="ml-2 text-xs text-neutral-500">
                          {diaDaSemana(t.data)} · {TURNO[t.turno] ?? t.turno.toLowerCase()}
                        </span>
                      </td>

                      <td className="whitespace-nowrap px-4 py-3 text-neutral-500">
                        {aberto ? (
                          <span className="rounded-md bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-700">
                            ainda aberto
                          </span>
                        ) : (
                          (t.fechadoPor ?? "—")
                        )}
                      </td>

                      <td className="px-4 py-3 text-right tabular-nums">
                        {brl.format(t.recebido)}
                        <span className="ml-2 text-xs text-neutral-500">
                          {t.comandas} comanda(s)
                        </span>
                      </td>

                      {/*
                        "Na gaveta" é o esperado em papel-moeda: fundo, mais o
                        que entrou em dinheiro, menos o que saiu. Cartão e Pix
                        não passam por ela.
                      */}
                      <td className="px-4 py-3 text-right tabular-nums text-neutral-500">
                        {t.valorApurado === null ? "—" : brl.format(t.valorApurado)}
                      </td>

                      <td className="px-4 py-3 text-right tabular-nums">
                        {t.valorInformado === null ? "—" : brl.format(t.valorInformado)}
                      </td>

                      <td
                        className={`px-4 py-3 text-right font-semibold tabular-nums ${
                          !diferente
                            ? "text-neutral-400"
                            : t.divergencia! < 0
                              ? "text-red-600"
                              : "text-amber-700"
                        }`}
                      >
                        {t.divergencia === null
                          ? "—"
                          : diferente
                            ? `${t.divergencia < 0 ? "−" : "+"}${brl.format(Math.abs(t.divergencia))}`
                            : "bateu"}
                      </td>

                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/gestao/caixas/${t.id}`}
                          className="whitespace-nowrap text-neutral-500 underline-offset-2 hover:text-neutral-900 hover:underline"
                        >
                          detalhes
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="mt-4 text-xs text-neutral-500">
            {comDiferenca === 0
              ? "Nenhum fechamento do período saiu com diferença."
              : `${comDiferenca} de ${turnos.length} fechamentos saíram com diferença.`}
            {turnos.length === TURNOS_POR_PAGINA &&
              ` Mostrando os ${TURNOS_POR_PAGINA} turnos mais recentes.`}
          </p>
        </>
      )}
    </>
  );
}
