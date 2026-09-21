import type { ReactNode } from "react";
import type { Viewport } from "next";
import { redirect } from "next/navigation";
import { exigirSessao, temPermissao } from "@/lib/session";
import { dadosDaBarra } from "@/lib/barra";
import { MenuDaGestao } from "./menu";
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
      className="area-de-gestao min-h-tela bg-neutral-100 text-neutral-900"
      style={{ "--cor-do-veu": "#f5f5f5" } as React.CSSProperties}
    >
      {/*
        O preto por trás da barra de ambientes.

        Ela é `bg-neutral-950/80` — translúcida —, e sobre o cinza claro da
        gestão desbotava: a mesma barra ficava de um tom em Mesas e de outro
        aqui. Com o preto por trás, a translucidez cai sobre o mesmo fundo do
        salão, e as duas telas passam a mostrar exatamente a mesma cor.

        Só ela: o menu da gestão, logo abaixo, continua branco.
      */}
      <div className="bg-neutral-950">
        <BarraAmbientes dados={await dadosDaBarra(sessao)} />
      </div>

      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-x-6 gap-y-2 px-6 py-3">
          <span className="shrink-0 font-bold tracking-tight">Gestão</span>

          <MenuDaGestao />
        </div>
      </header>

      {/*
        A faixa decorativa atrás dos títulos.

        Mora no layout, e não em cada página: são treze títulos espalhados por
        onze arquivos, com estruturas diferentes — alguns com botão à direita —,
        e repetir a faixa em cada um seria treze lugares para esquecer de mudar.
        Aqui ela cobre tudo que vive sob /gestao e nada do salão.
      */}
      <div className="relative">
        {/* O desenho vive em `.faixa-da-gestao`, no globals.css: são duas
            máscaras combinadas, e escrevê-las como valor arbitrário do Tailwind
            deixaria a classe ilegível. */}
        <div aria-hidden className="faixa-da-gestao pointer-events-none absolute inset-x-0 top-0" />

        <main className="relative mx-auto max-w-6xl px-6 pt-8 pb-28 sm:pb-8">{children}</main>
      </div>
    </div>
  );
}
