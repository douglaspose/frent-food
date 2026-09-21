import type { ResumoDeCaixa } from "@/lib/painel";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** "2026-09-19" → "19/09". Sem passar por `Date`, que traria fuso junto. */
function diaCurto(iso: string) {
  const [, mes, dia] = iso.split("-");
  return `${dia}/${mes}`;
}

const TURNO: Record<string, string> = {
  DIA: "dia",
  INTERMEDIARIO: "intermediário",
  NOITE: "noite",
  MADRUGADA: "madrugada",
};

function Linha({
  rotulo,
  valor,
  cor,
  nota,
}: {
  rotulo: string;
  valor: string;
  cor?: string;
  nota?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="min-w-0 text-neutral-600">
        {rotulo}
        {nota && <span className="ml-2 text-xs text-neutral-500">{nota}</span>}
      </span>
      <span className={`shrink-0 font-semibold tabular-nums ${cor ?? ""}`}>{valor}</span>
    </div>
  );
}

export function ResumoDeCaixaCard({ dados }: { dados: ResumoDeCaixa }) {
  const { divergencia } = dados;

  /**
   * Divergência negativa é dinheiro faltando — `valorInformado` menor que o
   * apurado. Sobra também merece cor, mas âmbar em vez de vermelha: sobra
   * costuma ser troco mal lançado, e não caixa dois.
   */
  const corDaDivergencia =
    divergencia < 0 ? "text-red-600" : divergencia > 0 ? "text-amber-700" : "text-emerald-700";

  const textoDaDivergencia =
    divergencia === 0
      ? "sem diferença"
      : `${divergencia < 0 ? "faltou " : "sobrou "}${brl.format(Math.abs(divergencia))}`;

  return (
    <div className="space-y-3">
      <Linha
        rotulo="Fechamentos no período"
        valor={String(dados.fechamentos)}
        nota={
          dados.fechamentosComDivergencia > 0
            ? `${dados.fechamentosComDivergencia} com diferença`
            : undefined
        }
      />
      <Linha rotulo="Diferença acumulada" valor={textoDaDivergencia} cor={corDaDivergencia} />
      <Linha rotulo="Sangrias" valor={brl.format(dados.sangrias)} />
      <Linha rotulo="Suprimentos" valor={brl.format(dados.suprimentos)} />

      <div className="border-t border-neutral-100 pt-3">
        {dados.caixaAberto ? (
          <Linha
            rotulo={`Caixa aberto · ${diaCurto(dados.caixaAberto.data)} ${
              TURNO[dados.caixaAberto.turno] ?? dados.caixaAberto.turno.toLowerCase()
            }`}
            valor={`${brl.format(dados.caixaAberto.fundo)} de fundo`}
            cor="text-orange-600"
          />
        ) : (
          <p className="text-sm text-neutral-500">Nenhum caixa aberto agora.</p>
        )}
      </div>
    </div>
  );
}
