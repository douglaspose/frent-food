"use client";

import { temErro, mensagemDeFalha } from "@/lib/erro-de-operacao";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Recusa } from "../recusa";
import { CONEXOES, precisaEndereco } from "@/lib/impressoras";
import {
  alternarImpressoraAtiva,
  atualizarImpressora,
  cadastrarImpressora,
  descartar,
  excluirImpressora,
  gerarTokenImpressao,
  imprimirTeste,
  ligarPracaNaImpressora,
  reimprimir,
  type DadosImpressora,
} from "./actions";

type Trabalho = {
  id: string;
  tipo: string;
  titulo: string;
  status: string;
  /** O papel linha a linha; `grande` é letra dupla, como sai na térmica. */
  linhas: { texto: string; grande: boolean }[];
  impressora: string | null;
  tentativas: number;
  erro: string | null;
  criadoEm: string;
  /** Quem levou o papel; nulo enquanto ninguém buscou, ou se não se identificou. */
  agente: string | null;
};

type Impressora = {
  id: string;
  nome: string;
  conexao: string;
  endereco: string | null;
  modelo: string | null;
  ativo: boolean;
};

type Praca = { id: string; nome: string; impressoraId: string | null; ativo: boolean };

const VAZIA: DadosImpressora = { nome: "", conexao: "rede", endereco: "", modelo: "" };

const CORES: Record<string, string> = {
  PENDENTE: "bg-amber-100 text-amber-800",
  IMPRESSO: "bg-emerald-100 text-emerald-800",
  ERRO: "bg-red-100 text-red-700",
};

export function FilaTela({
  unidade,
  temToken,
  trabalhos,
  naFila,
  impressoras,
  pracas,
  podeEditar,
  podeConfigurar,
}: {
  unidade: string;
  /** Se a unidade já tem credencial. O valor dela não vem para a tela. */
  temToken: boolean;
  /** Gerar credencial é da mesma régua de cadastrar aparelho. */
  podeConfigurar: boolean;
  trabalhos: Trabalho[];
  /**
   * Quantos papéis esperam na unidade inteira.
   *
   * Contado no banco, e não nesta lista: a lista traz os 50 últimos, e contar
   * dentro dela parava em 50 justamente quando o número importa — é esta tela
   * que alguém abre quando a cozinha reclama que não sai papel.
   */
  naFila: number;
  impressoras: Impressora[];
  /** As praças de produção da unidade, para ligar cada uma à sua térmica. */
  pracas: Praca[];
  podeEditar: boolean;
}) {
  const [vendo, setVendo] = useState<Trabalho | null>(null);
  /** O formulário aberto: uma impressora existente, "nova", ou nenhum. */
  const [editando, setEditando] = useState<Impressora | "nova" | null>(null);
  const [tokenNovo, setTokenNovo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  const router = useRouter();

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
        setErro(mensagemDeFalha(e, "Algo deu errado."));
      }
    });
  }

  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Impressão</h1>
          <p className="mt-1 text-sm text-neutral-500">
            {unidade} · {naFila} na fila
          </p>
        </div>
        {podeEditar && (
          <button
            onClick={() => agir(imprimirTeste)}
            disabled={pendente}
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-700 disabled:opacity-40"
          >
            Imprimir teste
          </button>
        )}
      </div>

      {erro && <Recusa>{erro}</Recusa>}

      <section className="mt-6 rounded-xl border border-neutral-200 bg-white p-5">
        <h2 className="text-sm font-semibold">Agente de impressão</h2>
        <p className="mt-1 text-sm text-neutral-500">
          O servidor não fala com a impressora: ele enfileira, e o agente instalado no restaurante
          busca e imprime. Se a internet cair, a fila espera e nada se perde.
        </p>

        {podeConfigurar && (
          <div className="mt-4">
            {tokenNovo ? (
              <div className="rounded-lg bg-neutral-900 p-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  Copie agora — não será mostrado de novo
                </p>
                <code className="block break-all font-mono text-sm text-emerald-400">
                  {tokenNovo}
                </code>
              </div>
            ) : (
              <p className="text-sm text-neutral-500">
                {temToken ? "Token configurado." : "Nenhum token gerado ainda."}
              </p>
            )}

            <button
              onClick={() =>
                agir(async () => {
                  const r = await gerarTokenImpressao();
                  if (temErro(r)) return r;
                  setTokenNovo(r);
                })
              }
              disabled={pendente}
              className="mt-3 rounded-lg bg-neutral-200 px-4 py-2 text-sm font-semibold text-neutral-700 transition hover:bg-neutral-300 disabled:opacity-40"
            >
              {temToken ? "Gerar novo token" : "Gerar token"}
            </button>
            {temToken && (
              <p className="mt-2 text-xs text-neutral-500">
                Gerar um novo invalida o anterior — o agente para até ser atualizado.
              </p>
            )}
          </div>
        )}

        <div className="mt-5 border-t border-neutral-100 pt-4">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Impressoras
            </h3>
            {podeConfigurar && editando === null && (
              <button
                onClick={() => setEditando("nova")}
                className="text-sm font-semibold text-neutral-900"
              >
                cadastrar impressora
              </button>
            )}
          </div>

          {impressoras.length === 0 && editando === null ? (
            <p className="text-sm text-neutral-500">
              Nenhuma impressora cadastrada. Sem endereço, o papel de produção sai &ldquo;na
              mão&rdquo;: em qualquer agente que buscar a fila, inclusive na bobina da maquininha.
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {impressoras.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className={`font-medium ${i.ativo ? "" : "text-neutral-400 line-through"}`}>
                    {i.nome}
                  </span>
                  <span className="text-neutral-500">
                    {CONEXOES.find((c) => c.valor === i.conexao)?.rotulo ?? i.conexao}
                    {i.endereco ? ` · ${i.endereco}` : ""}
                    {i.modelo ? ` · ${i.modelo}` : ""}
                  </span>
                  {!i.ativo && (
                    <span className="rounded-md bg-neutral-200 px-2 py-0.5 text-[10px] font-bold text-neutral-600">
                      DESLIGADA
                    </span>
                  )}
                  {podeConfigurar && (
                    <span className="ml-auto flex items-center gap-3 text-neutral-500">
                      <button onClick={() => setEditando(i)} className="hover:text-neutral-900">
                        editar
                      </button>
                      <button
                        onClick={() => agir(() => alternarImpressoraAtiva(i.id, !i.ativo))}
                        disabled={pendente}
                        className="hover:text-neutral-900"
                      >
                        {i.ativo ? "desligar" : "religar"}
                      </button>
                      <button
                        onClick={() => agir(() => excluirImpressora(i.id))}
                        disabled={pendente}
                        className="hover:text-red-600"
                      >
                        apagar
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}

          {podeConfigurar && editando !== null && (
            <FormularioDaImpressora
              inicial={editando === "nova" ? VAZIA : paraFormulario(editando)}
              nova={editando === "nova"}
              pendente={pendente}
              onCancelar={() => setEditando(null)}
              onSalvar={(dados) =>
                agir(async () => {
                  const r =
                    editando === "nova"
                      ? await cadastrarImpressora(dados)
                      : await atualizarImpressora(editando.id, dados);
                  if (temErro(r)) return r;
                  setEditando(null);
                })
              }
            />
          )}

          {/*
            As praças junto das impressoras, de propósito.

            O vínculo é o que faz a comanda da cozinha sair na térmica da
            cozinha, e ele só se entende olhando as duas listas: sem impressora,
            a praça manda o papel "na mão".
          */}
          {podeConfigurar && pracas.length > 0 && (
            <div className="mt-5 border-t border-neutral-100 pt-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Qual impressora atende cada praça
              </h3>
              <ul className="space-y-2 text-sm">
                {pracas.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-3">
                    <span className={`font-medium ${p.ativo ? "" : "text-neutral-400"}`}>
                      {p.nome}
                    </span>
                    <select
                      aria-label={`Impressora da praça ${p.nome}`}
                      value={p.impressoraId ?? ""}
                      disabled={pendente}
                      onChange={(e) =>
                        agir(() => ligarPracaNaImpressora(p.id, e.target.value || null))
                      }
                      className="ml-auto rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm disabled:opacity-50"
                    >
                      <option value="">Sai na mão (qualquer agente)</option>
                      {impressoras.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.nome}
                          {i.ativo ? "" : " (desligada)"}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      {vendo && (
        <section className="mt-6 rounded-xl border border-neutral-300 bg-white p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">{vendo.titulo}</h2>
            <button
              onClick={() => setVendo(null)}
              className="text-sm text-neutral-500 hover:text-neutral-900"
            >
              fechar
            </button>
          </div>
          {/*
            Fundo claro e monoespaçado: é a prévia de como sai no papel.

            A linha de letra dupla vai com o dobro do tamanho da fonte. Em fonte
            monoespaçada isso dobra também a largura de cada letra — as 24
            colunas dela ocupam as mesmas 48 das outras, como na térmica. Em
            tamanho normal, a mesa e o total apareciam encolhidos à esquerda.
          */}
          <pre className="overflow-x-auto rounded-lg bg-neutral-50 p-4 font-mono text-xs leading-tight text-neutral-800">
            {vendo.linhas.map((l, i) => (
              <span key={i} className={l.grande ? "block text-[2em] font-bold leading-snug" : "block"}>
                {l.texto || " "}
              </span>
            ))}
          </pre>
        </section>
      )}

      {/* Rola em vez de cortar: em 375px pede 641px, e o botão de reenviar
          ficava fora do alcance. Mesma solução do Diário. */}
      <div className="mt-6 overflow-x-auto rounded-xl border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-4 py-3 font-semibold">Hora</th>
              <th className="px-4 py-3 font-semibold">Documento</th>
              <th className="px-4 py-3 font-semibold">Impressora</th>
              <th className="px-4 py-3 font-semibold">Saiu por</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {trabalhos.map((t) => (
              <tr key={t.id}>
                <td className="whitespace-nowrap px-4 py-3 tabular-nums text-neutral-500">
                  {new Date(t.criadoEm).toLocaleTimeString("pt-BR", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </td>
                <td className="px-4 py-3">
                  {t.titulo}
                  {t.erro && <span className="ml-2 text-xs text-red-600">{t.erro}</span>}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-neutral-500">{t.impressora ?? "—"}</td>
                {/*
                  O agente que puxou, e não a impressora: são coisas
                  diferentes quando o salão tem duas maquininhas e o balcão.
                  O agente antigo não manda apelido, e aparece como "agente".
                */}
                <td className="whitespace-nowrap px-4 py-3 text-neutral-500">
                  {t.status === "PENDENTE" ? "—" : (t.agente ?? "agente")}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-md px-2 py-1 text-xs font-semibold ${CORES[t.status] ?? ""}`}
                  >
                    {t.status}
                  </span>
                  {t.tentativas > 0 && (
                    <span className="ml-2 text-xs text-neutral-500">{t.tentativas} tentativa(s)</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <span className="flex justify-end gap-3">
                    <button
                      onClick={() => setVendo(t)}
                      className="text-neutral-500 hover:text-neutral-900"
                    >
                      ver
                    </button>
                    {podeEditar && (
                      <button
                        onClick={() => agir(() => reimprimir(t.id))}
                        className="text-neutral-500 hover:text-neutral-900"
                      >
                        reimprimir
                      </button>
                    )}
                    {podeEditar && t.status === "PENDENTE" && (
                      <button
                        onClick={() => agir(() => descartar(t.id))}
                        className="text-neutral-500 hover:text-red-600"
                      >
                        descartar
                      </button>
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {trabalhos.length === 0 && (
          <p className="py-16 text-center text-sm text-neutral-500">Nada impresso ainda.</p>
        )}
      </div>
    </>
  );
}

/** O cadastro de uma impressora como o formulário o trata: tudo texto. */
function paraFormulario(i: Impressora): DadosImpressora {
  return {
    nome: i.nome,
    conexao: i.conexao,
    endereco: i.endereco ?? "",
    modelo: i.modelo ?? "",
  };
}

/**
 * O formulário da impressora.
 *
 * O endereço só aparece na conexão de rede — nas outras a impressora está
 * pendurada na máquina do agente, e um campo de endereço ali seria um campo
 * que ninguém sabe preencher. A dica da porta 9100 fica à vista porque é o
 * número que o dono não tem como adivinhar, e é o que quase toda térmica usa.
 */
function FormularioDaImpressora({
  inicial,
  nova,
  pendente,
  onCancelar,
  onSalvar,
}: {
  inicial: DadosImpressora;
  nova: boolean;
  pendente: boolean;
  onCancelar: () => void;
  onSalvar: (dados: DadosImpressora) => void;
}) {
  const [dados, setDados] = useState(inicial);
  const campo = (k: keyof DadosImpressora) => (v: string) => setDados((d) => ({ ...d, [k]: v }));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSalvar(dados);
      }}
      className="mt-4 grid gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-4 sm:grid-cols-2"
    >
      <label className="sm:col-span-2">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Nome
        </span>
        <input
          value={dados.nome}
          onChange={(e) => campo("nome")(e.target.value)}
          placeholder="Térmica da cozinha"
          autoFocus
          className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
        />
      </label>

      <label>
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Como o agente chega nela
        </span>
        <select
          value={dados.conexao}
          onChange={(e) => campo("conexao")(e.target.value)}
          className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
        >
          {CONEXOES.map((c) => (
            <option key={c.valor} value={c.valor}>
              {c.rotulo}
            </option>
          ))}
        </select>
      </label>

      {precisaEndereco(dados.conexao) && (
        <label>
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Endereço na rede
          </span>
          <input
            value={dados.endereco}
            onChange={(e) => campo("endereco")(e.target.value)}
            placeholder="192.168.0.10:9100"
            inputMode="url"
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
          />
          <span className="mt-1 block text-xs text-neutral-500">
            IP da impressora. Sem porta, vale a 9100 — a que quase toda térmica de rede usa.
          </span>
        </label>
      )}

      <label className="sm:col-span-2">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Modelo (opcional)
        </span>
        <input
          value={dados.modelo}
          onChange={(e) => campo("modelo")(e.target.value)}
          placeholder="Elgin i9"
          className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
        />
      </label>

      <div className="flex items-center gap-3 sm:col-span-2">
        <button
          type="submit"
          disabled={pendente}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          {pendente ? "Salvando..." : nova ? "Cadastrar" : "Salvar"}
        </button>
        <button type="button" onClick={onCancelar} className="text-sm text-neutral-500">
          cancelar
        </button>
      </div>
    </form>
  );
}
