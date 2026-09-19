"use client";

import { temErro } from "@/lib/erro-de-operacao";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  alternarUsuarioAtivo,
  atualizarUsuario,
  criarUsuario,
  type DadosUsuario,
} from "./actions";

type Cargo = { id: string; nome: string };

export type UsuarioView = {
  id: string;
  nome: string;
  email: string;
  cargoId: string;
  cargoNome: string;
  temPin: boolean;
  ativo: boolean;
};

const VAZIO: DadosUsuario = { nome: "", email: "", cargoId: "", pin: "", senha: "" };

export function EquipeTela({
  usuarios,
  cargos,
  podeEditar,
  usuarioAtualId,
}: {
  usuarios: UsuarioView[];
  cargos: Cargo[];
  podeEditar: boolean;
  usuarioAtualId: string;
}) {
  const [editando, setEditando] = useState<UsuarioView | "novo" | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  const router = useRouter();

  function agir(fn: () => Promise<unknown>, aoTerminar?: () => void) {
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
        aoTerminar?.();
        router.refresh();
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Algo deu errado.");
      }
    });
  }

  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Equipe</h1>
          <p className="mt-1 text-sm text-neutral-500">
            {usuarios.filter((u) => u.ativo).length} ativos de {usuarios.length}
          </p>
        </div>
        {podeEditar && (
          <button
            onClick={() => setEditando("novo")}
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-700"
          >
            Nova pessoa
          </button>
        )}
      </div>

      {!podeEditar && (
        <p className="mt-4 rounded-lg bg-neutral-200 px-4 py-3 text-sm text-neutral-600">
          Somente leitura — cadastrar e alterar pessoas é com o proprietário.
        </p>
      )}

      {erro && <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{erro}</p>}

      {editando && (
        <UsuarioForm
          novo={editando === "novo"}
          inicial={
            editando === "novo"
              ? VAZIO
              : {
                  nome: editando.nome,
                  email: editando.email,
                  cargoId: editando.cargoId,
                  pin: "",
                  senha: "",
                }
          }
          cargos={cargos}
          pendente={pendente}
          onCancelar={() => setEditando(null)}
          onSalvar={(dados) =>
            agir(
              () =>
                editando === "novo" ? criarUsuario(dados) : atualizarUsuario(editando.id, dados),
              () => setEditando(null)
            )
          }
        />
      )}

      <div className="mt-6 overflow-hidden rounded-xl border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-4 py-3 font-semibold">Nome</th>
              <th className="px-4 py-3 font-semibold">E-mail</th>
              <th className="px-4 py-3 font-semibold">Cargo</th>
              <th className="px-4 py-3 font-semibold">PIN</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {usuarios.map((u) => (
              <tr key={u.id} className={u.ativo ? "" : "opacity-50"}>
                <td className="px-4 py-3 font-medium">
                  {u.nome}
                  {u.id === usuarioAtualId && (
                    <span className="ml-2 text-xs font-normal text-neutral-400">você</span>
                  )}
                </td>
                <td className="px-4 py-3 text-neutral-500">{u.email}</td>
                <td className="px-4 py-3">
                  <span className="rounded bg-neutral-100 px-2 py-1 text-xs font-semibold text-neutral-600">
                    {u.cargoNome}
                  </span>
                </td>
                <td className="px-4 py-3 text-neutral-400">
                  {u.temPin ? "configurado" : "sem PIN"}
                </td>
                <td className="px-4 py-3 text-right">
                  {podeEditar && (
                    <span className="flex justify-end gap-3">
                      <button
                        onClick={() => setEditando(u)}
                        className="text-neutral-500 hover:text-neutral-900"
                      >
                        editar
                      </button>
                      {u.id !== usuarioAtualId && (
                        <button
                          onClick={() => agir(() => alternarUsuarioAtivo(u.id, !u.ativo))}
                          className="text-neutral-400 hover:text-red-600"
                        >
                          {u.ativo ? "desativar" : "reativar"}
                        </button>
                      )}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function UsuarioForm({
  inicial,
  novo,
  cargos,
  pendente,
  onSalvar,
  onCancelar,
}: {
  inicial: DadosUsuario;
  novo: boolean;
  cargos: Cargo[];
  pendente: boolean;
  onSalvar: (dados: DadosUsuario) => void;
  onCancelar: () => void;
}) {
  const [dados, setDados] = useState<DadosUsuario>(inicial);

  function campo<K extends keyof DadosUsuario>(chave: K, valor: DadosUsuario[K]) {
    setDados((d) => ({ ...d, [chave]: valor }));
  }

  return (
    <div className="mt-6 rounded-xl border border-neutral-300 bg-white p-6">
      <h2 className="mb-4 font-semibold">{novo ? "Nova pessoa" : "Editar pessoa"}</h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <label>
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Nome
          </span>
          <input
            value={dados.nome}
            onChange={(e) => campo("nome", e.target.value)}
            autoFocus
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 focus:border-neutral-900 focus:outline-none"
          />
        </label>

        <label>
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
            E-mail
          </span>
          <input
            value={dados.email}
            onChange={(e) => campo("email", e.target.value)}
            type="email"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 focus:border-neutral-900 focus:outline-none"
          />
        </label>

        <label>
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Cargo
          </span>
          <select
            value={dados.cargoId}
            onChange={(e) => campo("cargoId", e.target.value)}
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 focus:border-neutral-900 focus:outline-none"
          >
            <option value="">Escolha</option>
            {cargos.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
            PIN do PDV
          </span>
          <input
            value={dados.pin}
            onChange={(e) => campo("pin", e.target.value.replace(/\D/g, "").slice(0, 4))}
            inputMode="numeric"
            placeholder={novo ? "4 dígitos" : "em branco mantém o atual"}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 tabular-nums placeholder:text-xs placeholder:text-neutral-400 focus:border-neutral-900 focus:outline-none"
          />
        </label>

        <label className="sm:col-span-2">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Senha
          </span>
          <input
            value={dados.senha}
            onChange={(e) => campo("senha", e.target.value)}
            type="password"
            autoComplete="new-password"
            placeholder={novo ? "senha inicial" : "em branco mantém a atual"}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 placeholder:text-xs placeholder:text-neutral-400 focus:border-neutral-900 focus:outline-none"
          />
        </label>
      </div>

      <div className="mt-6 flex gap-3">
        <button
          onClick={() => onSalvar(dados)}
          disabled={pendente}
          className="rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-neutral-700 disabled:opacity-40"
        >
          {pendente ? "Salvando..." : "Salvar"}
        </button>
        <button
          onClick={onCancelar}
          className="rounded-lg px-5 py-2.5 text-sm font-semibold text-neutral-500 transition hover:text-neutral-900"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
