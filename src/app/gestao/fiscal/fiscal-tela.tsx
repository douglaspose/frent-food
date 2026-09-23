"use client";

import { temErro, mensagemDeFalha } from "@/lib/erro-de-operacao";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  aplicarPerfilAosSemPerfil,
  cancelarNota,
  reemitirNota,
  salvarConfigFiscal,
  salvarPerfil,
  type ConfigFiscal,
  type DadosPerfil,
} from "./actions";

type Perfil = DadosPerfil & { id: string; produtos: number };

type Nota = {
  id: string;
  numero: number;
  serie: number;
  status: string;
  ambiente: string;
  valorTotal: number;
  chaveAcesso: string | null;
  motivoRejeicao: string | null;
  criadoEm: string;
  mesa: string | null;
  comandaId: string | null;
  comandaNumero: number | null;
};

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

const CORES: Record<string, string> = {
  AUTORIZADA: "bg-emerald-100 text-emerald-800",
  PROCESSANDO: "bg-sky-100 text-sky-800",
  PENDENTE: "bg-neutral-100 text-neutral-600",
  REJEITADA: "bg-red-100 text-red-700",
  DENEGADA: "bg-red-100 text-red-700",
  CONTINGENCIA: "bg-amber-100 text-amber-800",
  CANCELADA: "bg-neutral-200 text-neutral-500",
};

const PERFIL_VAZIO: DadosPerfil = {
  nome: "",
  cfop: "5102",
  origemMercadoria: 0,
  csosn: "102",
  cstIcms: "00",
  aliquotaIcms: 0,
  cstPis: "49",
  aliquotaPis: 0,
  cstCofins: "49",
  aliquotaCofins: 0,
  padrao: false,
};

export function FiscalTela({
  unidade,
  perfis,
  notas,
  produtosSemPerfil,
  produtosSemNcm,
  podeEditar,
}: {
  unidade: {
    nome: string;
    cnpj: string | null;
    uf: string | null;
    emissor: string;
    temCsc: boolean;
    temToken: boolean;
    config: ConfigFiscal;
  };
  perfis: Perfil[];
  notas: Nota[];
  produtosSemPerfil: number;
  produtosSemNcm: number;
  podeEditar: boolean;
}) {
  const [config, setConfig] = useState(unidade.config);
  const [editandoPerfil, setEditandoPerfil] = useState<Perfil | "novo" | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  const router = useRouter();

  const simples = config.regimeTributario === "SIMPLES_NACIONAL";

  function agir(fn: () => Promise<unknown>, aoTerminar?: () => void) {
    setErro(null);
    setAviso(null);
    iniciar(async () => {
      try {
        // Regra de negócio violada volta como valor, não como exceção: a
        // mensagem de uma exceção não atravessa a server action em produção.
        const r = await fn();
        if (temErro(r)) {
          setErro(r.erro);
          return;
        }
        aoTerminar?.();
        router.refresh();
      } catch (e) {
        setErro(mensagemDeFalha(e, "Algo deu errado."));
      }
    });
  }

  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">Fiscal</h1>
      <p className="mt-1 text-sm text-neutral-500">
        NFC-e · {unidade.nome} {unidade.uf && `· ${unidade.uf}`}
      </p>

      {unidade.emissor === "SIMULADO" && (
        <p className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <strong>Emissor em modo simulado.</strong> As notas recebem chave de acesso válida e
          seguem todo o fluxo, mas <strong>não são transmitidas à SEFAZ e não têm valor fiscal</strong>.
          Para emitir de verdade é preciso certificado digital A1, credenciamento na SEFAZ e um
          emissor configurado.
        </p>
      )}

      {erro && <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{erro}</p>}
      {aviso && (
        <p className="mt-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{aviso}</p>
      )}

      {(produtosSemNcm > 0 || produtosSemPerfil > 0) && (
        <div className="mt-4 space-y-2 text-sm">
          {produtosSemNcm > 0 && (
            <p className="rounded-lg bg-red-50 px-4 py-3 text-red-700">
              <strong>{produtosSemNcm} produto(s) de venda sem NCM.</strong> A SEFAZ rejeita nota
              com NCM ausente — cada venda desses produtos vira uma rejeição.
            </p>
          )}
          {produtosSemPerfil > 0 && (
            <p className="rounded-lg bg-amber-50 px-4 py-3 text-amber-800">
              {produtosSemPerfil} produto(s) sem perfil fiscal. Eles usam a tributação padrão do
              Simples até receberem um perfil.
            </p>
          )}
        </div>
      )}

      {/* ─── Configuração ─── */}
      <section className="mt-8 rounded-xl border border-neutral-200 bg-white p-6">
        <h2 className="mb-4 text-sm font-semibold">Configuração da unidade</h2>

        <div className="grid gap-4 sm:grid-cols-3">
          <label>
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Inscrição Estadual
            </span>
            <input
              value={config.inscricaoEstadual}
              disabled={!podeEditar}
              onChange={(e) => setConfig({ ...config, inscricaoEstadual: e.target.value })}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 disabled:bg-neutral-50"
            />
          </label>

          <label>
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Regime tributário
            </span>
            <select
              value={config.regimeTributario}
              disabled={!podeEditar}
              onChange={(e) =>
                setConfig({
                  ...config,
                  regimeTributario: e.target.value as ConfigFiscal["regimeTributario"],
                })
              }
              className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 disabled:bg-neutral-50"
            >
              <option value="SIMPLES_NACIONAL">Simples Nacional</option>
              <option value="NORMAL">Regime Normal</option>
            </select>
            <span className="mt-1 block text-xs text-neutral-500">
              {simples ? "Usa CSOSN, sem destaque de ICMS" : "Usa CST, com destaque de ICMS"}
            </span>
          </label>

          <label>
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Série da NFC-e
            </span>
            <input
              value={config.serieNfce}
              disabled={!podeEditar}
              inputMode="numeric"
              onChange={(e) => setConfig({ ...config, serieNfce: Number(e.target.value) || 1 })}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 tabular-nums disabled:bg-neutral-50"
            />
          </label>

          <label>
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Ambiente
            </span>
            <select
              value={config.ambienteFiscal}
              disabled={!podeEditar}
              onChange={(e) =>
                setConfig({
                  ...config,
                  ambienteFiscal: e.target.value as ConfigFiscal["ambienteFiscal"],
                })
              }
              className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 disabled:bg-neutral-50"
            >
              <option value="HOMOLOGACAO">Homologação (sem valor fiscal)</option>
              <option value="PRODUCAO">Produção</option>
            </select>
          </label>

          <label>
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
              ID do CSC
            </span>
            <input
              value={config.cscId}
              disabled={!podeEditar}
              onChange={(e) => setConfig({ ...config, cscId: e.target.value })}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 disabled:bg-neutral-50"
            />
          </label>

          <label>
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
              CSC {unidade.temCsc && <span className="font-normal normal-case">· configurado</span>}
            </span>
            <input
              value={config.csc}
              disabled={!podeEditar}
              type="password"
              placeholder={unidade.temCsc ? "em branco mantém o atual" : "código da SEFAZ"}
              onChange={(e) => setConfig({ ...config, csc: e.target.value })}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 placeholder:text-xs disabled:bg-neutral-50"
            />
          </label>
        </div>

        <label className="mt-5 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={config.emiteNfce}
            disabled={!podeEditar}
            onChange={(e) => setConfig({ ...config, emiteNfce: e.target.checked })}
            className="h-4 w-4 accent-neutral-900"
          />
          Emitir NFC-e automaticamente ao fechar cada comanda
        </label>

        {podeEditar && (
          <button
            onClick={() => agir(() => salvarConfigFiscal(config), () => setAviso("Configuração salva."))}
            disabled={pendente}
            className="mt-5 rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-neutral-700 disabled:opacity-40"
          >
            {pendente ? "Salvando..." : "Salvar configuração"}
          </button>
        )}
      </section>

      {/* ─── Perfis ─── */}
      <div className="mt-10 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">
          Perfis de tributação
          <span className="ml-2 font-normal text-neutral-500">
            agrupam CFOP e situação fiscal para não repetir em cada produto
          </span>
        </h2>
        {podeEditar && (
          <button
            onClick={() => setEditandoPerfil("novo")}
            className="rounded-lg bg-neutral-200 px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-300"
          >
            Novo perfil
          </button>
        )}
      </div>

      {editandoPerfil && (
        <PerfilForm
          inicial={editandoPerfil === "novo" ? PERFIL_VAZIO : editandoPerfil}
          simples={simples}
          pendente={pendente}
          onCancelar={() => setEditandoPerfil(null)}
          onSalvar={(dados) =>
            agir(
              () => salvarPerfil(dados, editandoPerfil === "novo" ? undefined : editandoPerfil.id),
              () => setEditandoPerfil(null)
            )
          }
        />
      )}

      {/* Rola em vez de cortar: no celular sobram 325px e estas tabelas
          pedem mais de 500. Mesma solução do Diário. */}
      <div className="mt-3 overflow-x-auto rounded-xl border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-4 py-3 font-semibold">Perfil</th>
              <th className="px-4 py-3 font-semibold">CFOP</th>
              <th className="px-4 py-3 font-semibold">{simples ? "CSOSN" : "CST"}</th>
              <th className="px-4 py-3 text-right font-semibold">ICMS</th>
              <th className="px-4 py-3 text-right font-semibold">Produtos</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {perfis.map((p) => (
              <tr key={p.id}>
                <td className="whitespace-nowrap px-4 py-3">
                  {p.nome}
                  {p.padrao && (
                    <span className="ml-2 rounded-md bg-neutral-900 px-1.5 py-0.5 text-[10px] font-bold text-white">
                      PADRÃO
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 tabular-nums text-neutral-500">{p.cfop}</td>
                <td className="px-4 py-3 tabular-nums">{simples ? p.csosn : p.cstIcms}</td>
                <td className="px-4 py-3 text-right tabular-nums text-neutral-500">
                  {simples ? "—" : `${p.aliquotaIcms}%`}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{p.produtos}</td>
                <td className="px-4 py-3 text-right">
                  {podeEditar && (
                    <span className="flex justify-end gap-3">
                      <button
                        onClick={() => setEditandoPerfil(p)}
                        className="text-neutral-500 hover:text-neutral-900"
                      >
                        editar
                      </button>
                      {produtosSemPerfil > 0 && (
                        <button
                          onClick={() =>
                            agir(async () => {
                              const r = await aplicarPerfilAosSemPerfil(p.id);
                              if (temErro(r)) return r;
                              setAviso(`${r.atualizados} produto(s) receberam este perfil.`);
                            })
                          }
                          className="text-neutral-500 hover:text-neutral-900"
                        >
                          aplicar aos sem perfil
                        </button>
                      )}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {perfis.length === 0 && (
          <p className="py-12 text-center text-sm text-neutral-500">
            Nenhum perfil criado. Sem perfil, os produtos usam a tributação padrão do Simples.
          </p>
        )}
      </div>

      {/* ─── Notas ─── */}
      <h2 className="mt-10 text-sm font-semibold">Notas emitidas</h2>
      {/* Rola em vez de cortar: no celular sobram 325px e estas tabelas
          pedem mais de 500. Mesma solução do Diário. */}
      <div className="mt-3 overflow-x-auto rounded-xl border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-4 py-3 font-semibold">Nota</th>
              <th className="px-4 py-3 font-semibold">Origem</th>
              <th className="px-4 py-3 text-right font-semibold">Valor</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {notas.map((n) => (
              <tr key={n.id}>
                <td className="px-4 py-3">
                  <span className="tabular-nums">
                    {n.numero}/{n.serie}
                  </span>
                  {n.chaveAcesso && (
                    <span className="mt-0.5 block font-mono text-[10px] text-neutral-500">
                      {n.chaveAcesso}
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-neutral-500">
                  {n.mesa ? `Mesa ${n.mesa}` : n.comandaNumero ? `Comanda #${n.comandaNumero}` : "—"}
                  <span className="mt-0.5 block text-xs text-neutral-500">
                    {new Date(n.criadoEm).toLocaleString("pt-BR", {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{brl.format(n.valorTotal)}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-md px-2 py-1 text-xs font-semibold ${CORES[n.status] ?? ""}`}>
                    {n.status}
                  </span>
                  {n.ambiente === "HOMOLOGACAO" && (
                    <span className="ml-1 text-[10px] text-neutral-500">homolog.</span>
                  )}
                  {n.motivoRejeicao && (
                    <span className="mt-1 block max-w-xs text-xs text-red-600">
                      {n.motivoRejeicao}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  {podeEditar && (
                    <span className="flex justify-end gap-3 whitespace-nowrap">
                      {["REJEITADA", "CONTINGENCIA", "DENEGADA"].includes(n.status) &&
                        n.comandaId && (
                          <button
                            onClick={() =>
                              agir(async () => {
                                const r = await reemitirNota(n.comandaId!);
                                if (temErro(r)) return r;
                                setAviso(r.ok ? "Nota autorizada." : `Não autorizada: ${r.motivo}`);
                              })
                            }
                            className="text-neutral-500 hover:text-neutral-900"
                          >
                            reemitir
                          </button>
                        )}
                      {n.status === "AUTORIZADA" && (
                        <button
                          onClick={() => {
                            const motivo = prompt(
                              "Justificativa do cancelamento (mínimo 15 caracteres):"
                            );
                            if (motivo) agir(() => cancelarNota(n.id, motivo));
                          }}
                          className="text-neutral-500 hover:text-red-600"
                        >
                          cancelar
                        </button>
                      )}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {notas.length === 0 && (
          <p className="py-12 text-center text-sm text-neutral-500">Nenhuma nota emitida ainda.</p>
        )}
      </div>
    </>
  );
}

function PerfilForm({
  inicial,
  simples,
  pendente,
  onSalvar,
  onCancelar,
}: {
  inicial: DadosPerfil;
  simples: boolean;
  pendente: boolean;
  onSalvar: (dados: DadosPerfil) => void;
  onCancelar: () => void;
}) {
  const [dados, setDados] = useState<DadosPerfil>(inicial);

  const campo = <K extends keyof DadosPerfil>(chave: K, valor: DadosPerfil[K]) =>
    setDados((d) => ({ ...d, [chave]: valor }));

  const texto = (rotulo: string, chave: keyof DadosPerfil, dica?: string) => (
    <label>
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
        {rotulo}
      </span>
      <input
        value={String(dados[chave])}
        onChange={(e) =>
          campo(
            chave,
            (typeof inicial[chave] === "number"
              ? Number(e.target.value.replace(",", ".")) || 0
              : e.target.value) as DadosPerfil[typeof chave]
          )
        }
        className="w-full rounded-lg border border-neutral-300 px-3 py-2"
      />
      {dica && <span className="mt-1 block text-xs text-neutral-500">{dica}</span>}
    </label>
  );

  return (
    <div className="mt-4 rounded-xl border border-neutral-300 bg-white p-6">
      <h3 className="mb-4 font-semibold">{inicial.nome ? "Editar perfil" : "Novo perfil"}</h3>

      <div className="grid gap-4 sm:grid-cols-3">
        {texto("Nome", "nome")}
        {texto("CFOP", "cfop", "5102 é a venda mais comum")}
        {texto("Origem", "origemMercadoria", "0 = nacional")}

        {simples
          ? texto("CSOSN", "csosn", "102 = tributada sem crédito")
          : texto("CST ICMS", "cstIcms", "00 = tributada integralmente")}
        {!simples && texto("Alíquota ICMS (%)", "aliquotaIcms")}

        {texto("CST PIS", "cstPis")}
        {texto("Alíquota PIS (%)", "aliquotaPis")}
        {texto("CST COFINS", "cstCofins")}
        {texto("Alíquota COFINS (%)", "aliquotaCofins")}
      </div>

      <label className="mt-4 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={dados.padrao}
          onChange={(e) => campo("padrao", e.target.checked)}
          className="h-4 w-4 accent-neutral-900"
        />
        Usar como perfil padrão da unidade
      </label>

      <div className="mt-6 flex gap-3">
        <button
          onClick={() => onSalvar(dados)}
          disabled={pendente || !dados.nome.trim()}
          className="rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-neutral-700 disabled:opacity-40"
        >
          {pendente ? "Salvando..." : "Salvar"}
        </button>
        <button
          onClick={onCancelar}
          className="rounded-lg px-5 py-2.5 text-sm font-semibold text-neutral-500 hover:text-neutral-900"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
