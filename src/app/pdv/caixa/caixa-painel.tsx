"use client";

import { temErro } from "@/lib/erro-de-operacao";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { abrirCaixa, fecharCaixa, registrarMovimentoCaixa } from "../pagamento-actions";
import { dinheiroNaGaveta, RETIRA_DA_GAVETA, saldoDeMovimentos } from "@/lib/caixa";
import { precisaAutorizacao } from "@/lib/autorizacao";
import { PainelAutorizacao } from "../painel-autorizacao";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

const TURNOS = [
  { valor: "DIA", rotulo: "Dia" },
  { valor: "INTERMEDIARIO", rotulo: "Intermediário" },
  { valor: "NOITE", rotulo: "Noite" },
  { valor: "MADRUGADA", rotulo: "Madrugada" },
] as const;

export type MovimentoView = {
  id: string;
  tipo: string;
  valor: number;
  descricao: string | null;
  usuario: string;
  criadoEm: string;
};

type CaixaAberto = {
  id: string;
  turno: string;
  fundoCaixa: number;
  recebidoPorForma: { nome: string; tipo: string; valor: number }[];
  movimentos: MovimentoView[];
};

/** Quem tira e quem põe. O sinal na tela vem daqui. */
const MOVIMENTOS = [
  { valor: "SANGRIA", rotulo: "Sangria", dica: "Dinheiro saindo da gaveta para o cofre" },
  { valor: "SUPRIMENTO", rotulo: "Suprimento", dica: "Troco entrando na gaveta" },
  { valor: "PAGAMENTO", rotulo: "Pagamento", dica: "Pago da gaveta: gás, gelo, entregador" },
  { valor: "RECEBIMENTO", rotulo: "Recebimento", dica: "Outro dinheiro entrando" },
] as const;

const RETIRA = RETIRA_DA_GAVETA;

export function CaixaPainel({
  unidadeId,
  caixa,
  comandasAbertas,
  podeOperar,
  podeMovimentar = false,
}: {
  unidadeId: string;
  caixa: CaixaAberto | null;
  comandasAbertas: number;
  podeOperar: boolean;
  podeMovimentar?: boolean;
}) {
  const [turno, setTurno] = useState<(typeof TURNOS)[number]["valor"]>("NOITE");
  const [fundo, setFundo] = useState("200");
  const [conferido, setConferido] = useState("");
  const [tipoMov, setTipoMov] = useState<(typeof MOVIMENTOS)[number]["valor"]>("SANGRIA");
  const [valorMov, setValorMov] = useState("");
  const [descricaoMov, setDescricaoMov] = useState("");
  const [abrirMovimento, setAbrirMovimento] = useState(false);
  const [autorizandoMov, setAutorizandoMov] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ apurado: number; divergencia: number } | null>(null);
  const [pendente, iniciar] = useTransition();
  const router = useRouter();

  function abrir() {
    setErro(null);
    iniciar(async () => {
      try {
        const r = await abrirCaixa(unidadeId, turno, Number(fundo.replace(",", ".")) || 0);
        if (temErro(r)) {
          setErro(r.erro);
          return;
        }
        router.refresh();
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Não foi possível abrir o caixa.");
      }
    });
  }

  function movimentar(autorizacaoId?: string) {
    setErro(null);
    iniciar(async () => {
      try {
        const r = await registrarMovimentoCaixa(
          caixa!.id,
          tipoMov,
          Number(valorMov.replace(/\./g, "").replace(",", ".")) || 0,
          descricaoMov,
          autorizacaoId
        );
        // Não é erro: é o sistema pedindo a assinatura de quem pode.
        if (precisaAutorizacao(r)) {
          setAutorizandoMov(true);
          return;
        }
        // Sem esta guarda o formulário fechava levando a mensagem junto, e o
        // operador ficava sem saber por que a sangria não entrou.
        if (temErro(r)) {
          setErro(r.erro);
          return;
        }
        setValorMov("");
        setDescricaoMov("");
        setAbrirMovimento(false);
        setAutorizandoMov(false);
        router.refresh();
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Não foi possível registrar o movimento.");
      }
    });
  }

  function fechar() {
    setErro(null);
    iniciar(async () => {
      try {
        const r = await fecharCaixa(caixa!.id, Number(conferido.replace(",", ".")) || 0);
        if (temErro(r)) {
          setErro(r.erro);
          return;
        }
        // Sem refresh aqui de propósito: o refresh remonta a tela como "caixa
        // fechado" e o operador nunca chega a ver a divergência que acabou de
        // apurar. Ele confere e sai pelo botão.
        setResultado({ apurado: r.valorApurado, divergencia: r.divergencia });
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Não foi possível fechar o caixa.");
      }
    });
  }

  // O resultado vem antes de tudo: ao fechar, a server action revalida a rota
  // e o servidor já devolve "caixa fechado". Sem esta guarda, a tela voltaria
  // ao formulário de abertura e a divergência recém-apurada sumiria.
  if (resultado) {
    const bateu = Math.abs(resultado.divergencia) < 0.01;
    return (
      <div className="mt-8 space-y-4">
        <div className="space-y-1 rounded-xl border border-neutral-800 bg-neutral-900 p-5">
          <p className="flex justify-between text-sm text-neutral-400">
            <span>Apurado pelo sistema</span>
            <span className="tabular-nums">{brl.format(resultado.apurado)}</span>
          </p>
          <p className="flex justify-between text-sm text-neutral-400">
            <span>Contado na gaveta</span>
            <span className="tabular-nums">
              {brl.format(resultado.apurado + resultado.divergencia)}
            </span>
          </p>
          <p
            className={`flex justify-between border-t border-neutral-800 pt-2 text-lg font-bold ${
              bateu ? "text-emerald-400" : resultado.divergencia < 0 ? "text-red-400" : "text-amber-400"
            }`}
          >
            <span>{bateu ? "Caixa bateu certo" : resultado.divergencia < 0 ? "Falta" : "Sobra"}</span>
            <span className="tabular-nums">{brl.format(Math.abs(resultado.divergencia))}</span>
          </p>
        </div>
        <button
          onClick={() => {
            setResultado(null);
            setConferido("");
            router.refresh();
          }}
          className="w-full rounded-lg bg-neutral-100 py-3 font-semibold text-neutral-900 transition hover:bg-white"
        >
          Concluir
        </button>
      </div>
    );
  }

  if (!caixa) {
    return (
      <div className="mt-8 space-y-5">
        <div>
          <label className="mb-2 block text-xs font-semibold uppercase tracking-widest text-neutral-500">
            Turno
          </label>
          <div className="flex flex-wrap gap-2">
            {TURNOS.map((t) => (
              <button
                key={t.valor}
                onClick={() => setTurno(t.valor)}
                className={`rounded-lg px-4 py-3 text-sm font-semibold transition ${
                  turno === t.valor
                    ? "bg-orange-600 text-white"
                    : "bg-neutral-900 text-neutral-400 hover:bg-neutral-800"
                }`}
              >
                {t.rotulo}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-2 block text-xs font-semibold uppercase tracking-widest text-neutral-500">
            Fundo de caixa
          </label>
          <input
            value={fundo}
            onChange={(e) => setFundo(e.target.value)}
            inputMode="decimal"
            className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 text-lg tabular-nums focus:border-orange-600 focus:outline-none"
          />
        </div>

        {erro && <p className="text-sm text-red-400">{erro}</p>}

        {!podeOperar && (
          <p className="rounded-lg bg-neutral-900 px-3 py-2 text-sm text-neutral-400">
            Abrir o caixa é com o operador de caixa ou o gerente.
          </p>
        )}

        <button
          onClick={abrir}
          disabled={pendente || !podeOperar}
          className="w-full rounded-lg bg-orange-600 py-4 text-lg font-semibold text-white transition hover:bg-orange-500 disabled:opacity-50"
        >
          {pendente ? "Abrindo..." : "Abrir caixa"}
        </button>
      </div>
    );
  }

  const totalRecebido = caixa.recebidoPorForma.reduce((s, f) => s + f.valor, 0);
  const emEspecie = caixa.recebidoPorForma
    .filter((f) => f.tipo === "DINHEIRO")
    .reduce((s, f) => s + f.valor, 0);

  // A mesma conta que o fechamento usa. Repeti-la aqui faria a tela e o
  // apurado divergirem sem ninguém perceber.
  const saldoMovimentos = saldoDeMovimentos(caixa.movimentos);
  const esperado = dinheiroNaGaveta({
    fundoCaixa: caixa.fundoCaixa,
    recebidoEmEspecie: emEspecie,
    movimentos: caixa.movimentos,
  });

  return (
    <div className="mt-8 space-y-6">
      <section className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-neutral-500">
          Movimento
        </h2>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-neutral-400">Fundo de caixa</dt>
            <dd className="tabular-nums">{brl.format(caixa.fundoCaixa)}</dd>
          </div>
          {caixa.recebidoPorForma.map((f) => (
            <div key={f.nome} className="flex justify-between">
              <dt className="text-neutral-400">{f.nome}</dt>
              <dd className="tabular-nums">{brl.format(f.valor)}</dd>
            </div>
          ))}
          {caixa.recebidoPorForma.length === 0 && (
            <p className="py-2 text-neutral-600">Nenhum recebimento ainda.</p>
          )}
          <div className="flex justify-between border-t border-neutral-800 pt-3 text-base font-bold">
            <dt>Recebido</dt>
            <dd className="tabular-nums text-orange-400">{brl.format(totalRecebido)}</dd>
          </div>
          {saldoMovimentos !== 0 && (
            <div className="flex justify-between text-sm">
              <dt className="text-neutral-400">Sangrias e suprimentos</dt>
              <dd
                className={`tabular-nums ${saldoMovimentos < 0 ? "text-red-400" : "text-emerald-400"}`}
              >
                {saldoMovimentos > 0 ? "+" : "−"} {brl.format(Math.abs(saldoMovimentos))}
              </dd>
            </div>
          )}
          <div className="flex justify-between text-sm">
            <dt className="text-neutral-400">Esperado na gaveta</dt>
            <dd className="tabular-nums">{brl.format(esperado)}</dd>
          </div>
        </dl>
      </section>

      <section className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-neutral-500">
            Gaveta
          </h2>
          {!abrirMovimento && (
            <button
              onClick={() => setAbrirMovimento(true)}
              className="rounded-lg bg-neutral-800 px-3 py-1.5 text-xs font-semibold text-neutral-300 transition hover:bg-neutral-700"
            >
              Registrar movimento{podeMovimentar ? "" : " (com autorização)"}
            </button>
          )}
        </div>

        {abrirMovimento && (
          <div className="mb-4 space-y-3 rounded-lg bg-neutral-950 p-3">
            <div className="flex flex-wrap gap-2">
              {MOVIMENTOS.map((m) => (
                <button
                  key={m.valor}
                  onClick={() => setTipoMov(m.valor)}
                  title={m.dica}
                  className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${
                    tipoMov === m.valor
                      ? "bg-neutral-100 text-neutral-900"
                      : "bg-neutral-900 text-neutral-400 hover:bg-neutral-800"
                  }`}
                >
                  {m.rotulo}
                </button>
              ))}
            </div>

            <p className="text-xs text-neutral-500">
              {MOVIMENTOS.find((m) => m.valor === tipoMov)?.dica}
            </p>

            <input
              value={valorMov}
              onChange={(e) => setValorMov(e.target.value)}
              inputMode="decimal"
              placeholder="Valor"
              className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2.5 tabular-nums placeholder:text-neutral-600 focus:border-orange-600 focus:outline-none"
            />
            <input
              value={descricaoMov}
              onChange={(e) => setDescricaoMov(e.target.value)}
              placeholder="Para onde foi, quem levou (obrigatório)"
              className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2.5 text-sm placeholder:text-neutral-600 focus:border-orange-600 focus:outline-none"
            />

            {/* O erro tem que aparecer aqui, não lá no rodapé: quem clicou em
                "Registrar" está olhando para este bloco. */}
            {erro && <p className="text-sm text-red-400">{erro}</p>}

            {autorizandoMov && (
              <PainelAutorizacao
                tipo="SANGRIA"
                referenciaId={caixa.id}
                motivo={descricaoMov.trim()}
                aoLiberar={(id) => movimentar(id)}
                aoDesistir={() => setAutorizandoMov(false)}
              />
            )}

            <div className="flex gap-2">
              <button
                onClick={() => setAbrirMovimento(false)}
                className="rounded-lg bg-neutral-800 px-4 py-2.5 text-sm text-neutral-400 transition hover:bg-neutral-700"
              >
                Voltar
              </button>
              <button
                onClick={() => movimentar()}
                disabled={pendente || !valorMov.trim() || !descricaoMov.trim()}
                className="flex-1 rounded-lg bg-orange-600 py-2.5 text-sm font-semibold text-white transition hover:bg-orange-500 disabled:opacity-30"
              >
                {pendente ? "Registrando..." : "Registrar"}
              </button>
            </div>
          </div>
        )}

        {caixa.movimentos.length === 0 ? (
          <p className="text-sm text-neutral-600">
            Nenhuma sangria ou suprimento neste turno.
          </p>
        ) : (
          <ul className="space-y-2">
            {caixa.movimentos.map((m) => (
              <li key={m.id} className="flex items-start justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium">
                    {MOVIMENTOS.find((x) => x.valor === m.tipo)?.rotulo ?? m.tipo}
                  </p>
                  <p className="truncate text-xs text-neutral-500">
                    {new Date(m.criadoEm).toLocaleTimeString("pt-BR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}{" "}
                    · {m.usuario} · {m.descricao}
                  </p>
                </div>
                <span
                  className={`shrink-0 tabular-nums font-semibold ${
                    RETIRA.has(m.tipo) ? "text-red-400" : "text-emerald-400"
                  }`}
                >
                  {RETIRA.has(m.tipo) ? "−" : "+"} {brl.format(m.valor)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
        <h2 className="mb-1 text-xs font-semibold uppercase tracking-widest text-neutral-500">
          Fechar caixa
        </h2>
        <p className="mb-4 text-sm text-neutral-500">
          Conte o dinheiro da gaveta e informe o valor. A divergência fica registrada.
        </p>

        {!podeOperar && (
          <p className="mb-4 rounded-lg bg-neutral-950 px-3 py-2 text-sm text-neutral-400">
            Fechar o caixa é com o operador de caixa ou o gerente.
          </p>
        )}

        {comandasAbertas > 0 && (
          <p className="mb-4 rounded-lg bg-amber-950/50 px-3 py-2 text-sm text-amber-400">
            {comandasAbertas} comanda(s) ainda aberta(s) — feche todas antes.
          </p>
        )}

        <input
          value={conferido}
          onChange={(e) => setConferido(e.target.value)}
          inputMode="decimal"
          placeholder="Valor contado"
          className="mb-3 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-4 py-3 text-lg tabular-nums placeholder:text-neutral-600 focus:border-orange-600 focus:outline-none"
        />

        {/* Enquanto o formulário da gaveta está aberto, o erro é dele. */}
        {erro && !abrirMovimento && <p className="mb-3 text-sm text-red-400">{erro}</p>}

        <button
          onClick={fechar}
          disabled={pendente || comandasAbertas > 0 || !conferido || !podeOperar}
          className="w-full rounded-lg bg-neutral-100 py-3 font-semibold text-neutral-900 transition hover:bg-white disabled:opacity-30"
        >
          {pendente ? "Fechando..." : "Fechar caixa"}
        </button>
      </section>
    </div>
  );
}
