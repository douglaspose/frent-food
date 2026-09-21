import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { sessaoDaTela, temPermissao } from "@/lib/session";
import { detalheDoTurno } from "@/lib/historico-de-caixa";
import { RETIRA_DA_GAVETA } from "@/lib/caixa";

export const metadata: Metadata = { title: "Fechamento de caixa" };
export const dynamic = "force-dynamic";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

const TURNO: Record<string, string> = {
  DIA: "dia",
  INTERMEDIARIO: "intermediário",
  NOITE: "noite",
  MADRUGADA: "madrugada",
};

const MOVIMENTO: Record<string, string> = {
  SANGRIA: "Sangria",
  SUPRIMENTO: "Suprimento",
  PAGAMENTO: "Pagamento pela gaveta",
  RECEBIMENTO: "Recebimento na gaveta",
};

/** "2026-09-20" → "20/09/2026", sem passar por `Date`. */
function diaPorExtenso(iso: string) {
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
}

function hora(d: Date) {
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function Numero({ rotulo, valor, nota, cor }: {
  rotulo: string;
  valor: string;
  nota?: string;
  cor?: string;
}) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{rotulo}</p>
      <p className={`mt-2 text-xl font-bold tabular-nums ${cor ?? ""}`}>{valor}</p>
      {nota && <p className="mt-1 text-xs text-neutral-500">{nota}</p>}
    </div>
  );
}

export default async function TurnoPage({ params }: { params: Promise<{ id: string }> }) {
  const sessao = await sessaoDaTela();
  if (!temPermissao(sessao, "auditoria.ver")) redirect("/gestao");

  const { id } = await params;
  const detalhe = await detalheDoTurno(sessao.unidadeId, id);
  if (!detalhe) notFound();

  const { turno, porForma, movimentos } = detalhe;
  const aberto = turno.status === "ABERTO";
  const diferente = turno.divergencia !== null && turno.divergencia !== 0;

  return (
    <>
      <header className="mb-6">
        <Link
          href="/gestao/caixas"
          className="text-sm text-neutral-500 underline-offset-2 hover:text-neutral-900 hover:underline"
        >
          ← Fechamentos de caixa
        </Link>

        <h1 className="mt-3 text-2xl font-bold tracking-tight">
          {diaPorExtenso(turno.data)}
          <span className="ml-2 text-base font-normal text-neutral-500">
            turno da {TURNO[turno.turno] ?? turno.turno.toLowerCase()}
          </span>
        </h1>

        <p className="mt-1 text-sm text-neutral-500">
          Aberto por {turno.abertoPor}
          {aberto
            ? " · ainda aberto"
            : turno.fechadoPor
              ? ` · fechado por ${turno.fechadoPor}${turno.fechadoEm ? ` às ${hora(turno.fechadoEm)}` : ""}`
              : ""}
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Numero
          rotulo="Recebido no turno"
          valor={brl.format(turno.recebido)}
          nota={`${turno.comandas} comanda(s)`}
        />
        {/*
          Estes três só existem depois da contagem. No caixa aberto ninguém
          contou nada ainda, e mostrar R$ 0,00 diria que a gaveta está vazia.
        */}
        <Numero
          rotulo="Esperado na gaveta"
          valor={turno.valorApurado === null ? "—" : brl.format(turno.valorApurado)}
          nota="fundo + dinheiro − saídas"
        />
        <Numero
          rotulo="Contado no fechamento"
          valor={turno.valorInformado === null ? "—" : brl.format(turno.valorInformado)}
        />
        <Numero
          rotulo="Diferença"
          valor={
            turno.divergencia === null
              ? "—"
              : diferente
                ? `${turno.divergencia < 0 ? "−" : "+"}${brl.format(Math.abs(turno.divergencia))}`
                : "bateu"
          }
          nota={
            turno.divergencia === null
              ? "o caixa ainda está aberto"
              : turno.divergencia < 0
                ? "faltou dinheiro na gaveta"
                : turno.divergencia > 0
                  ? "sobrou dinheiro na gaveta"
                  : undefined
          }
          cor={
            !diferente
              ? "text-emerald-700"
              : turno.divergencia! < 0
                ? "text-red-600"
                : "text-amber-700"
          }
        />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section className="min-w-0 rounded-xl border border-neutral-200 bg-white p-5">
          <h2 className="mb-4 text-sm font-semibold">
            Entrou por forma de pagamento
            <span className="ml-2 font-normal text-neutral-500">já sem o troco</span>
          </h2>

          {porForma.length === 0 ? (
            <p className="py-6 text-center text-sm text-neutral-500">
              Nenhum pagamento neste turno.
            </p>
          ) : (
            <ol className="space-y-2">
              {porForma.map((f) => (
                <li key={f.nome} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0">
                    {f.nome}
                    <span className="ml-2 text-xs text-neutral-500">
                      {f.pagamentos} pagamento(s)
                    </span>
                    {/* Só o dinheiro passa pela gaveta — é o que a contagem
                        precisa bater. Cartão e Pix caem na conta. */}
                    {f.tipo === "DINHEIRO" && (
                      <span className="ml-2 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
                        NA GAVETA
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums">
                    {brl.format(f.valor)}
                  </span>
                </li>
              ))}
            </ol>
          )}

          <p className="mt-4 border-t border-neutral-100 pt-3 text-xs text-neutral-500">
            Fundo de abertura: <strong className="font-semibold">{brl.format(turno.fundo)}</strong>
            {" · "}em dinheiro no turno:{" "}
            <strong className="font-semibold">{brl.format(turno.recebidoEmEspecie)}</strong>
          </p>
        </section>

        <section className="min-w-0 rounded-xl border border-neutral-200 bg-white p-5">
          <h2 className="mb-4 text-sm font-semibold">
            Movimentos da gaveta
            <span className="ml-2 font-normal text-neutral-500">o que entrou e saiu à mão</span>
          </h2>

          {movimentos.length === 0 ? (
            <p className="py-6 text-center text-sm text-neutral-500">
              Nenhuma sangria ou suprimento neste turno.
            </p>
          ) : (
            <ol className="space-y-3">
              {movimentos.map((m) => {
                const tira = RETIRA_DA_GAVETA.has(m.tipo);
                return (
                  <li key={m.id} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0">
                      {MOVIMENTO[m.tipo] ?? m.tipo}
                      <span className="ml-2 text-xs text-neutral-500">
                        {hora(m.criadoEm)} · {m.usuario}
                      </span>
                      {m.descricao && (
                        <span className="mt-0.5 block text-xs text-neutral-500">{m.descricao}</span>
                      )}
                    </span>
                    <span
                      className={`shrink-0 font-semibold tabular-nums ${
                        tira ? "text-red-600" : "text-emerald-700"
                      }`}
                    >
                      {tira ? "−" : "+"}
                      {brl.format(m.valor)}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}

          {(turno.sangrias > 0 || turno.suprimentos > 0) && (
            <p className="mt-4 border-t border-neutral-100 pt-3 text-xs text-neutral-500">
              Sangrias: <strong className="font-semibold">{brl.format(turno.sangrias)}</strong>
              {" · "}Suprimentos:{" "}
              <strong className="font-semibold">{brl.format(turno.suprimentos)}</strong>
            </p>
          )}
        </section>
      </div>
    </>
  );
}
