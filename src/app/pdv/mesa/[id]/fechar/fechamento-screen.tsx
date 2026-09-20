"use client";

import { temErro } from "@/lib/erro-de-operacao";
import { TEXTO_DE_CAMPO } from "@/lib/campo";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { calcularTotais, centavos, TOLERANCIA } from "@/lib/comanda";
import {
  aplicarDesconto,
  definirPessoas,
  definirTaxaServico,
  estornarPagamento,
  finalizarComanda,
  imprimirConferencia,
  reabrirComanda,
  registrarPagamento,
} from "../../../pagamento-actions";
import { precisaAutorizacao } from "@/lib/autorizacao";
import { PainelAutorizacao } from "../../../painel-autorizacao";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

type Forma = { id: string; nome: string; tipo: string };

type ComandaView = {
  id: string;
  numero: number;
  pessoas: number;
  nomeCliente: string | null;
  taxaServicoPct: number;
  descontoValor: number;
  descontoMotivo: string | null;
  itens: { id: string; titulo: string; quantidade: number; precoTotal: number }[];
  pagamentos: { id: string; forma: string; tipo: string; valor: number; troco: number }[];
};

export function FechamentoScreen({
  mesa,
  comanda,
  formas,
  caixaAberto,
  itensNoCarrinho,
  podeDescontar,
  podeReceber,
  podeFechar,
  podeEditarPessoas,
}: {
  mesa: { id: string; numero: string };
  comanda: ComandaView;
  formas: Forma[];
  caixaAberto: boolean;
  itensNoCarrinho: number;
  podeDescontar: boolean;
  podeReceber: boolean;
  podeFechar: boolean;
  podeEditarPessoas: boolean;
}) {
  const [formaSelecionada, setFormaSelecionada] = useState(formas[0]?.id ?? "");
  const [valorRecebido, setValorRecebido] = useState("");
  const [desconto, setDesconto] = useState(String(comanda.descontoValor || ""));
  const [motivo, setMotivo] = useState(comanda.descontoMotivo ?? "");
  const [erro, setErro] = useState<string | null>(null);
  // A partir da segunda impressão o papel sai marcado como 2ª via — evita o
  // cliente receber duas contas idênticas e achar que está pagando duas vezes.
  const [impressaCount, setImpressaCount] = useState(0);
  const [pessoas, setPessoas] = useState(comanda.pessoas);
  const [autorizandoDesconto, setAutorizandoDesconto] = useState(false);
  const [pendente, iniciar] = useTransition();
  const router = useRouter();

  const totais = calcularTotais(comanda);
  const recebido = centavos(
    comanda.pagamentos.reduce((s, p) => s + p.valor - p.troco, 0)
  );
  const falta = centavos(Math.max(0, totais.total - recebido));
  const quitada = falta <= TOLERANCIA;

  const forma = formas.find((f) => f.id === formaSelecionada);
  const digitado = Number(valorRecebido.replace(",", ".")) || 0;
  // Só dinheiro gera troco; cartão e Pix são cobrados no valor exato.
  const troco = forma?.tipo === "DINHEIRO" ? centavos(Math.max(0, digitado - falta)) : 0;

  function agir(fn: () => Promise<unknown>) {
    setErro(null);
    iniciar(async () => {
      try {
        // Regra de negócio violada volta como valor, não como exceção: a
        // mensagem de uma exceção não atravessa a server action em produção.
        const r = await fn();
        if (temErro(r)) {
          setErro(r.erro);
          return;
        }
        router.refresh();
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Algo deu errado.");
      }
    });
  }

  function aplicar(autorizacaoId?: string) {
    agir(async () => {
      const r = await aplicarDesconto(
        comanda.id,
        Number(desconto.replace(",", ".")) || 0,
        motivo,
        autorizacaoId
      );
      if (temErro(r)) return r;
      // Não é erro: é o sistema pedindo a assinatura de quem pode.
      setAutorizandoDesconto(precisaAutorizacao(r));
    });
  }

  function receber() {
    if (!formaSelecionada) return;
    const valor = digitado > 0 ? digitado : falta;
    agir(async () => {
      const r = await registrarPagamento(comanda.id, formaSelecionada, valor, troco);
      if (temErro(r)) return r;
      setValorRecebido("");
    });
  }

  function finalizar() {
    agir(async () => {
      const r = await finalizarComanda(comanda.id);
      // Sair para o mapa com a conta ainda aberta esconderia o motivo.
      if (temErro(r)) return r;
      router.push("/pdv");
    });
  }

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-4 py-6">
      <header className="mb-6 flex items-center gap-4">
        <Link
          href={`/pdv/mesa/${mesa.id}`}
          className="rounded-lg px-2 py-1 text-xl text-neutral-500 hover:bg-neutral-900 hover:text-neutral-200"
        >
          ←
        </Link>
        <div>
          <h1 className="text-xl font-bold">
            Fechar mesa {mesa.numero}
            {comanda.nomeCliente && (
              <span className="ml-2 font-normal text-neutral-400">· {comanda.nomeCliente}</span>
            )}
          </h1>
          <p className="text-xs text-neutral-500">
            Comanda #{comanda.numero} · {comanda.pessoas} pessoa(s)
          </p>
        </div>
      </header>

      {itensNoCarrinho > 0 && (
        <p className="mb-6 rounded-lg bg-sky-950/60 px-4 py-3 text-sm text-sky-300">
          <strong>{itensNoCarrinho} item(ns) ainda no carrinho</strong>, sem terem ido para a
          cozinha — não estão nesta conta.{" "}
          <Link href={`/pdv/mesa/${mesa.id}`} className="font-semibold underline">
            Voltar e enviar
          </Link>
        </p>
      )}

      {!podeReceber && (
        <p className="mb-6 rounded-lg bg-neutral-900 px-4 py-3 text-sm text-neutral-400">
          Você pode conferir a conta, mas receber pagamento é com o caixa ou o gerente.
        </p>
      )}

      {podeReceber && !caixaAberto && (
        <p className="mb-6 rounded-lg bg-amber-950/50 px-4 py-3 text-sm text-amber-400">
          Nenhum caixa aberto.{" "}
          <Link href="/pdv/caixa" className="font-semibold underline">
            Abrir caixa
          </Link>{" "}
          antes de receber.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Consumo e totais */}
        <section className="space-y-4">
          <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-neutral-500">
              Consumo
            </h2>
            <ul className="mb-4 max-h-64 space-y-2 overflow-y-auto">
              {comanda.itens.map((i) => (
                <li key={i.id} className="flex justify-between text-sm">
                  <span>
                    <span className="mr-1 text-neutral-500">{i.quantidade}×</span>
                    {i.titulo}
                  </span>
                  <span className="tabular-nums">{brl.format(i.precoTotal)}</span>
                </li>
              ))}
            </ul>

            <dl className="space-y-1 border-t border-neutral-800 pt-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-neutral-400">Subtotal</dt>
                <dd className="tabular-nums">{brl.format(totais.subtotal)}</dd>
              </div>
              {totais.desconto > 0 && (
                <div className="flex justify-between text-amber-400">
                  <dt>Desconto{comanda.descontoMotivo && ` · ${comanda.descontoMotivo}`}</dt>
                  <dd className="tabular-nums">− {brl.format(totais.desconto)}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-neutral-400">
                  Taxa de serviço {comanda.taxaServicoPct}%
                  {podeDescontar && comanda.taxaServicoPct > 0 && (
                    <button
                      onClick={() => agir(() => definirTaxaServico(comanda.id, 0))}
                      className="ml-2 text-xs text-neutral-500 underline hover:text-neutral-300"
                    >
                      retirar
                    </button>
                  )}
                  {podeDescontar && comanda.taxaServicoPct === 0 && (
                    <button
                      onClick={() => agir(() => definirTaxaServico(comanda.id, 10))}
                      className="ml-2 text-xs text-neutral-500 underline hover:text-neutral-300"
                    >
                      cobrar 10%
                    </button>
                  )}
                </dt>
                <dd className="tabular-nums">{brl.format(totais.taxaServico)}</dd>
              </div>
              <div className="flex justify-between border-t border-neutral-800 pt-2 text-xl font-bold">
                <dt>Total</dt>
                <dd className="tabular-nums text-orange-400">{brl.format(totais.total)}</dd>
              </div>
              {(pessoas > 1 || podeEditarPessoas) && (
                <div className="flex items-center justify-between text-xs text-neutral-500">
                  <dt className="flex items-center gap-1.5">
                    Por pessoa
                    {podeEditarPessoas ? (
                      <input
                        value={pessoas}
                        onChange={(e) => setPessoas(Number(e.target.value.replace(/\D/g, "")) || 0)}
                        onBlur={() => {
                          // Zero dividiria por zero e mostraria "R$ Infinity"
                          // na tela em que o cliente está olhando.
                          const n = Math.min(99, Math.max(1, pessoas || 1));
                          setPessoas(n);
                          if (n !== comanda.pessoas) agir(() => definirPessoas(comanda.id, n));
                        }}
                        inputMode="numeric"
                        aria-label="Número de pessoas"
                        className="w-10 rounded border border-neutral-800 bg-neutral-900 px-1.5 py-0.5 text-center tabular-nums text-neutral-300 focus:border-orange-600 focus:outline-none"
                      />
                    ) : (
                      `(${pessoas})`
                    )}
                  </dt>
                  <dd className="tabular-nums">
                    {brl.format(centavos(totais.total / Math.max(1, pessoas)))}
                  </dd>
                </div>
              )}
            </dl>

            <button
              onClick={() => {
                agir(() => imprimirConferencia(comanda.id, impressaCount > 0));
                setImpressaCount((n) => n + 1);
              }}
              disabled={pendente}
              className="mt-4 w-full rounded-lg bg-neutral-800 py-3 text-sm font-semibold transition hover:bg-neutral-700 disabled:opacity-40"
            >
              {impressaCount === 0 ? "Imprimir conferência (F10)" : "Imprimir 2ª via (F10)"}
            </button>
          </div>

          <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-neutral-500">
              Desconto
              {/* O bloco era escondido de quem não tem a permissão. Agora
                  aparece: sem o cargo, o caminho é o PIN de quem tem. */}
              {!podeDescontar && (
                <span className="ml-2 font-normal normal-case tracking-normal text-neutral-600">
                  precisa de autorização
                </span>
              )}
            </h2>

            {autorizandoDesconto && (
              <div className="mb-3">
                <PainelAutorizacao
                  tipo="DESCONTO"
                  referenciaId={comanda.id}
                  motivo={motivo.trim()}
                  aoLiberar={(id) => aplicar(id)}
                  aoDesistir={() => setAutorizandoDesconto(false)}
                />
              </div>
            )}
            <div className="flex gap-2">
              <input
                value={desconto}
                onChange={(e) => setDesconto(e.target.value)}
                inputMode="decimal"
                placeholder="0,00"
                className={`w-28 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 tabular-nums placeholder:text-neutral-600 focus:border-orange-600 focus:outline-none ${TEXTO_DE_CAMPO}`}
              />
              <input
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Motivo"
                className={`flex-1 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 placeholder:text-neutral-600 focus:border-orange-600 focus:outline-none ${TEXTO_DE_CAMPO}`}
              />
              <button
                onClick={() => aplicar()}
                disabled={pendente}
                className="rounded-lg bg-neutral-800 px-4 text-sm font-semibold hover:bg-neutral-700 disabled:opacity-40"
              >
                Aplicar
              </button>
            </div>
          </div>
        </section>

        {/* Recebimento */}
        <section className="space-y-4">
          <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-neutral-500">
              Receber
            </h2>

            <div className="mb-3 grid grid-cols-2 gap-2">
              {formas.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFormaSelecionada(f.id)}
                  className={`rounded-lg px-3 py-3 text-sm font-semibold transition ${
                    formaSelecionada === f.id
                      ? "bg-orange-600 text-white"
                      : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
                  }`}
                >
                  {f.nome}
                </button>
              ))}
            </div>

            <input
              value={valorRecebido}
              onChange={(e) => setValorRecebido(e.target.value)}
              inputMode="decimal"
              placeholder={`Valor (em branco = ${brl.format(falta)})`}
              className="mb-2 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-4 py-3 text-lg tabular-nums placeholder:text-sm placeholder:text-neutral-600 focus:border-orange-600 focus:outline-none"
            />

            {troco > 0 && (
              <p className="mb-2 text-sm text-emerald-400">
                Troco: <span className="font-bold tabular-nums">{brl.format(troco)}</span>
              </p>
            )}

            <button
              onClick={receber}
              disabled={pendente || quitada || !caixaAberto || !podeReceber}
              className="w-full rounded-lg bg-emerald-600 py-3 font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-30"
            >
              Lançar pagamento
            </button>
          </div>

          <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-neutral-500">
              Pagamentos
            </h2>
            {comanda.pagamentos.length === 0 && (
              <p className="py-3 text-center text-sm text-neutral-600">Nenhum pagamento ainda.</p>
            )}
            <ul className="space-y-2">
              {comanda.pagamentos.map((p) => (
                <li key={p.id} className="flex items-center justify-between text-sm">
                  <span>
                    {p.forma}
                    {p.troco > 0 && (
                      <span className="ml-2 text-xs text-neutral-500">
                        (troco {brl.format(p.troco)})
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="tabular-nums">{brl.format(p.valor - p.troco)}</span>
                    <button
                      onClick={() => agir(() => estornarPagamento(p.id))}
                      className="text-xs text-neutral-600 hover:text-red-400"
                    >
                      estornar
                    </button>
                  </span>
                </li>
              ))}
            </ul>

            <dl className="mt-4 space-y-1 border-t border-neutral-800 pt-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-neutral-400">Recebido</dt>
                <dd className="tabular-nums">{brl.format(recebido)}</dd>
              </div>
              <div className="flex justify-between font-bold">
                <dt>{quitada ? "Quitada" : "Falta"}</dt>
                <dd className={`tabular-nums ${quitada ? "text-emerald-400" : "text-red-400"}`}>
                  {brl.format(falta)}
                </dd>
              </div>
            </dl>
          </div>

          {erro && <p className="text-sm text-red-400">{erro}</p>}

          <button
            onClick={finalizar}
            disabled={pendente || !quitada || !podeFechar}
            className="w-full rounded-lg bg-orange-600 py-4 text-lg font-semibold text-white transition hover:bg-orange-500 disabled:opacity-30"
          >
            {pendente ? "Finalizando..." : "Finalizar e liberar mesa"}
          </button>

          {/* "Traz mais uma cerveja" depois de pedir a conta é rotina. Sem esta
              saída, o garçom lançaria na mesa do lado ou anotaria no papel. */}
          <button
            onClick={() =>
              agir(async () => {
                await reabrirComanda(comanda.id);
                router.push(`/pdv/mesa/${mesa.id}`);
              })
            }
            disabled={pendente}
            className="w-full rounded-lg border border-neutral-800 py-3 text-sm font-semibold text-neutral-400 transition hover:border-neutral-700 hover:text-neutral-200 disabled:opacity-40"
          >
            Reabrir mesa para lançar mais itens
          </button>
        </section>
      </div>
    </main>
  );
}
