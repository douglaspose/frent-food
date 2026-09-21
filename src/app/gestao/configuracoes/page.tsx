import type { Metadata } from "next";
import Link from "next/link";
import { sessaoDaTela, temPermissao } from "@/lib/session";
import { SECOES_DE_CONFIGURACAO } from "../secoes";

export const metadata: Metadata = { title: "Configurações" };

export default async function ConfiguracoesPage() {
  const sessao = await sessaoDaTela();

  /**
   * Esconder o que a pessoa não pode abrir, em vez de deixar o link levar a um
   * redirecionamento. Um índice que oferece uma porta fechada é pior que um
   * índice menor: quem clica não entende se errou o caminho ou se perdeu o
   * acesso.
   */
  const visiveis = SECOES_DE_CONFIGURACAO.filter(
    (secao) => !secao.permissao || temPermissao(sessao, secao.permissao)
  );

  return (
    <>
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Configurações</h1>
        <p className="mt-1 text-sm text-neutral-500">
          O que se ajusta quando algo muda no restaurante. No dia a dia do
          turno, nada aqui precisa ser aberto.
        </p>
      </header>

      <ul className="grid gap-3 sm:grid-cols-2">
        {visiveis.map((secao) => (
          <li key={secao.href}>
            <Link
              href={secao.href}
              className="block rounded-xl border border-neutral-200 bg-white p-4 transition hover:border-neutral-300 hover:bg-neutral-50 active:bg-neutral-100"
            >
              <span className="block font-semibold">{secao.titulo}</span>
              <span className="mt-1 block text-sm leading-snug text-neutral-500">
                {secao.descricao}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
