import type { ReactNode } from "react";
import type { Viewport } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { exigirSessao, temPermissao } from "@/lib/session";
import { dadosDaBarra } from "@/lib/barra";
import { BarraAmbientes } from "../pdv/barra-ambientes";

/**
 * Chave que separa o escritório do salão. Gerente e proprietário têm; garçom e
 * caixa não — e a retaguarda mostra faturamento, que não é informação de quem
 * está atendendo mesa.
 */
const PERMISSAO_DE_GESTAO = "produto.editar";

/**
 * A retaguarda pinta a barra de status do celular de branco.
 *
 * Instalado na tela de início, o sistema não mostra barra de endereço: a faixa
 * do relógio assume a cor declarada aqui. Herdar o preto do salão deixaria uma
 * tarja escura em cima de uma tela clara, como se a página não tivesse
 * terminado de carregar.
 */
export const viewport: Viewport = { themeColor: "#ffffff" };

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
 *
 * A barra de ambientes entra aqui escura mesmo, como nas outras telas: ela não
 * é parte da retaguarda, é o trilho por onde se sai dela. Antes esta era a
 * única tela sem barra, e no celular quem entrava ficava sem volta — o
 * "Ir para o PDV" do canto sumia junto com o resto do cabeçalho.
 */
export default async function GestaoLayout({ children }: { children: ReactNode }) {
  const sessao = await exigirSessao();
  if (!temPermissao(sessao, PERMISSAO_DE_GESTAO)) redirect("/pdv");

  /*
   * O véu da barra do celular precisa sumir no fundo desta tela, não no do
   * salão. Vai por `style` porque a classe de propriedade arbitrária do
   * Tailwind não chegou a gerar regra: a classe ficava no elemento e o CSS
   * não existia, o que deixava uma faixa preta sobre o cinza claro.
   */
  return (
    <div
      className="min-h-tela bg-neutral-100 text-neutral-900"
      style={{ "--cor-do-veu": "#f5f5f5" } as React.CSSProperties}
    >
      <BarraAmbientes dados={await dadosDaBarra(sessao)} />

      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-x-6 gap-y-2 px-6 py-3">
          <span className="shrink-0 font-bold tracking-tight">Gestão</span>

          {/*
            São dez seções: no celular elas viravam quatro linhas de cabeçalho
            antes de qualquer conteúdo. Aqui rolam de lado numa faixa só, e a
            sangria negativa deixa a primeira e a última encostarem na borda da
            tela em vez de morrerem dentro do padding.
          */}
          <nav className="-mx-6 flex min-w-0 flex-1 gap-1 overflow-x-auto px-6 sm:mx-0 sm:flex-wrap sm:px-0">
            {MENU.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-900"
              >
                {item.rotulo}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 pt-8 pb-28 sm:pb-8">{children}</main>
    </div>
  );
}
