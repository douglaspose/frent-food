"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { temErro } from "@/lib/erro-de-operacao";
import { alternarAtiva, criarForma, editarForma, excluirForma } from "./actions";
import {
  ROTULO_DO_TIPO,
  TIPOS,
  type DadosDaForma,
  type TipoDePagamento,
} from "./tipos";

export type FormaView = {
  id: string;
  nome: string;
  tipo: TipoDePagamento;
  taxaPct: number;
  prazoDias: number;
  codigoFiscal: string;
  ativo: boolean;
  /** Quantos pagamentos já entraram por ela. Zero libera o excluir. */
  usos: number;
};

const pct = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });

const VAZIA: DadosDaForma = { nome: "", tipo: "CREDITO", taxaPct: 0, prazoDias: 0 };

function prazoEmTexto(dias: number) {
  if (dias === 0) return "na hora";
  if (dias === 1) return "em 1 dia";
  return `em ${dias} dias`;
}

/**
 * O cadastro das formas de pagamento.
 *
 * Duas colunas carregam dinheiro e por isso ganham explicação na tela: a taxa,
 * que é quanto a adquirente fica de cada venda, e o prazo, que é quando o
 * dinheiro cai. Eram campos que só existiam no banco — o dono não tinha por
 * onde informar, e o painel estimava o custo do cartão com um número que
 * ninguém conseguia corrigir.
 */
export function FormasTela({
  formas,
  podeEditar,
}: {
  formas: FormaView[];
  podeEditar: boolean;
}) {
  const [novaAberta, setNovaAberta] = useState(false);
  const [rascunho, setRascunho] = useState<DadosDaForma>(VAZIA);
  const [editando, setEditando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  const router = useRouter();

  function rodar(acao: () => Promise<unknown>, aoTerminar?: () => void) {
    setErro(null);
    iniciar(async () => {
      const r = await acao();
      if (temErro(r)) {
        setErro(r.erro);
        return;
      }
      aoTerminar?.();
      router.refresh();
    });
  }

  const taxaMedia = formas.filter((f) => f.ativo && f.taxaPct > 0);

  return (
    <>
      <header className="mb-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Formas de pagamento</h1>
            <p className="mt-1 max-w-2xl text-sm text-neutral-500">
              O que o caixa pode escolher ao fechar uma conta, quanto a maquininha cobra de cada
              uma e em quantos dias o dinheiro cai. A taxa alimenta o custo de cartão no painel.
            </p>
          </div>

          {podeEditar && !novaAberta && (
            <button
              onClick={() => {
                setRascunho(VAZIA);
                setNovaAberta(true);
                setEditando(null);
              }}
              className="realce-ao-toque shrink-0 touch-manipulation rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white transition duration-100 active:scale-95"
            >
              Nova forma
            </button>
          )}
        </div>
      </header>

      {erro && (
        <p className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{erro}</p>
      )}

      {novaAberta && (
        <div className="mb-4 rounded-xl border border-neutral-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold">Nova forma de pagamento</h2>
          <Formulario
            valor={rascunho}
            aoMudar={setRascunho}
            pendente={pendente}
            aoSalvar={() => rodar(() => criarForma(rascunho), () => setNovaAberta(false))}
            aoCancelar={() => setNovaAberta(false)}
          />
        </div>
      )}

      {/*
        `overflow-x-auto` e largura mínima, como no Diário: em 375px a tabela
        espremia "Cartão de Crédito" em três linhas e escondia as colunas de
        prazo e de ações — os botões ficavam inalcançáveis no celular.
      */}
      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
        <table className="w-full min-w-[34rem] text-sm">
          <thead className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-4 py-3 font-semibold">Forma</th>
              <th className="px-4 py-3 font-semibold">Tipo</th>
              <th className="px-4 py-3 text-right font-semibold">Taxa</th>
              <th className="px-4 py-3 font-semibold">Recebimento</th>
              {podeEditar && <th className="px-4 py-3" />}
            </tr>
          </thead>

          <tbody>
            {formas.map((f) =>
              editando === f.id ? (
                <tr key={f.id}>
                  <td colSpan={podeEditar ? 5 : 4} className="px-4 py-4">
                    <Formulario
                      valor={rascunho}
                      aoMudar={setRascunho}
                      pendente={pendente}
                      aoSalvar={() =>
                        rodar(() => editarForma(f.id, rascunho), () => setEditando(null))
                      }
                      aoCancelar={() => setEditando(null)}
                    />
                  </td>
                </tr>
              ) : (
                <tr
                  key={f.id}
                  className={`border-b border-neutral-100 last:border-0 ${
                    f.ativo ? "" : "text-neutral-400"
                  }`}
                >
                  <td className="whitespace-nowrap px-4 py-3">
                    {f.nome}
                    {!f.ativo && (
                      <span className="ml-2 rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-500">
                        inativa
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-neutral-500">
                    {ROTULO_DO_TIPO[f.tipo]}
                    {/* O código só é informação: quem o escolhe é o tipo. */}
                    <span className="ml-2 text-xs text-neutral-400">NFC-e {f.codigoFiscal}</span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {f.taxaPct > 0 ? `${pct.format(f.taxaPct)}%` : "—"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-neutral-500">{prazoEmTexto(f.prazoDias)}</td>

                  {podeEditar && (
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button
                        onClick={() => {
                          setRascunho({
                            nome: f.nome,
                            tipo: f.tipo,
                            taxaPct: f.taxaPct,
                            prazoDias: f.prazoDias,
                          });
                          setEditando(f.id);
                          setNovaAberta(false);
                        }}
                        disabled={pendente}
                        className="text-neutral-500 underline-offset-2 hover:text-neutral-900 hover:underline disabled:opacity-40"
                      >
                        editar
                      </button>

                      <button
                        onClick={() => rodar(() => alternarAtiva(f.id))}
                        disabled={pendente}
                        className="ml-3 text-neutral-500 underline-offset-2 hover:text-neutral-900 hover:underline disabled:opacity-40"
                      >
                        {f.ativo ? "desativar" : "reativar"}
                      </button>

                      {/*
                        Excluir só aparece em forma que nunca recebeu nada.
                        Oferecer o botão e depois recusar seria ensinar o dono a
                        clicar em algo que não funciona.
                      */}
                      {f.usos === 0 && (
                        <button
                          onClick={() => rodar(() => excluirForma(f.id))}
                          disabled={pendente}
                          className="ml-3 text-red-600 underline-offset-2 hover:underline disabled:opacity-40"
                        >
                          excluir
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              )
            )}
          </tbody>
        </table>
      </div>

      {taxaMedia.length > 0 && (
        <p className="mt-4 text-xs text-neutral-500">
          A taxa vale a partir de agora <strong className="font-semibold">e para trás</strong>: o
          painel estima o custo de cartão multiplicando cada pagamento pela taxa cadastrada hoje.
          Renegociou com a adquirente? O custo dos meses anteriores muda junto.
        </p>
      )}
    </>
  );
}

function Formulario({
  valor,
  aoMudar,
  aoSalvar,
  aoCancelar,
  pendente,
}: {
  valor: DadosDaForma;
  aoMudar: (d: DadosDaForma) => void;
  aoSalvar: () => void;
  aoCancelar: () => void;
  pendente: boolean;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-xs text-neutral-600">
        Nome
        <input
          value={valor.nome}
          onChange={(e) => aoMudar({ ...valor, nome: e.target.value })}
          placeholder="Cartão de Crédito"
          maxLength={40}
          className="rounded-lg border border-neutral-200 px-3 py-1.5 text-sm text-neutral-900"
        />
      </label>

      <label className="flex flex-col gap-1 text-xs text-neutral-600">
        Tipo
        <select
          value={valor.tipo}
          onChange={(e) => aoMudar({ ...valor, tipo: e.target.value as TipoDePagamento })}
          className="rounded-lg border border-neutral-200 px-3 py-1.5 text-sm text-neutral-900"
        >
          {TIPOS.map((t) => (
            <option key={t} value={t}>
              {ROTULO_DO_TIPO[t]}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-xs text-neutral-600">
        Taxa (%)
        <input
          type="number"
          inputMode="decimal"
          step="0.01"
          min={0}
          max={100}
          value={valor.taxaPct}
          onChange={(e) => aoMudar({ ...valor, taxaPct: Number(e.target.value) })}
          className="w-24 rounded-lg border border-neutral-200 px-3 py-1.5 text-sm tabular-nums text-neutral-900"
        />
      </label>

      <label className="flex flex-col gap-1 text-xs text-neutral-600">
        Prazo (dias)
        <input
          type="number"
          inputMode="numeric"
          step="1"
          min={0}
          max={365}
          value={valor.prazoDias}
          onChange={(e) => aoMudar({ ...valor, prazoDias: Number(e.target.value) })}
          className="w-24 rounded-lg border border-neutral-200 px-3 py-1.5 text-sm tabular-nums text-neutral-900"
        />
      </label>

      <div className="flex gap-2">
        <button
          onClick={aoSalvar}
          disabled={pendente || !valor.nome.trim()}
          className="realce-ao-toque touch-manipulation rounded-lg bg-neutral-900 px-4 py-1.5 text-sm font-semibold text-white transition duration-100 active:scale-95 disabled:opacity-40"
        >
          Salvar
        </button>
        <button
          onClick={aoCancelar}
          disabled={pendente}
          className="realce-ao-toque touch-manipulation rounded-lg px-3 py-1.5 text-sm text-neutral-600 ring-1 ring-neutral-200 transition duration-100 active:scale-95 disabled:opacity-40"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
