import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { exigirSessao, temPermissao } from "@/lib/session";
import { sair } from "../login/actions";

/**
 * Chave que separa o escritório do salão. Gerente e proprietário têm; garçom e
 * caixa não — e a retaguarda mostra faturamento, que não é informação de quem
 * está atendendo mesa.
 */
const PERMISSAO_DE_GESTAO = "produto.editar";

const MENU = [
  { href: "/gestao", rotulo: "Painel" },
  { href: "/gestao/cardapio", rotulo: "Cardápio" },
  { href: "/gestao/produtos", rotulo: "Produtos" },
  { href: "/gestao/mesas", rotulo: "Mesas" },
  { href: "/gestao/estoque", rotulo: "Estoque" },
  { href: "/gestao/equipe", rotulo: "Equipe" },
  { href: "/gestao/impressao", rotulo: "Impressão" },
  { href: "/gestao/fiscal", rotulo: "Fiscal" },
  { href: "/gestao/auditoria", rotulo: "Diário" },
  { href: "/gestao/ajustes", rotulo: "Ajustes" },
];

/**
 * Shell da retaguarda. Tema claro de propósito: o PDV é escuro porque vive num
 * salão à noite; a gestão é usada de dia, num escritório, e ler relatório em
 * fundo preto cansa.
 */
export default async function GestaoLayout({ children }: { children: ReactNode }) {
  const sessao = await exigirSessao();
  if (!temPermissao(sessao, PERMISSAO_DE_GESTAO)) redirect("/pdv");

  return (
    <div className="min-h-screen bg-neutral-100 text-neutral-900">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3">
          <span className="font-bold tracking-tight">Gestão</span>

          <nav className="flex flex-wrap gap-1">
            {MENU.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-900"
              >
                {item.rotulo}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3 text-sm">
            <Link href="/pdv" className="text-neutral-500 hover:text-neutral-900">
              Ir para o PDV
            </Link>
            <span className="text-neutral-300">|</span>
            <span className="text-neutral-600">{sessao.nome}</span>
            <form action={sair}>
              <button className="text-neutral-400 hover:text-red-600">sair</button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
