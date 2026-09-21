"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CONFIGURACOES, SECOES_DE_CONFIGURACAO } from "./secoes";

/**
 * Cinco seções, e uma porta para as outras cinco.
 *
 * Eram dez soltas. O critério para separar não foi frequência de uso — essa
 * envelhece, e é diferente em cada restaurante — e sim o que a seção responde:
 * estas cinco mudam durante o turno, as outras mudam quando algo muda na casa.
 *
 * "Configurações" é um link comum, e não um menu que desce. Menu suspenso
 * precisaria virar outra coisa no celular, e uma página tem duas vantagens que
 * um painel não tem: cabe uma frase explicando cada seção — o que importa em
 * telas abertas a cada dois meses — e tem endereço próprio, que se manda para
 * um cliente.
 */
const MENU = [
  { href: "/gestao", rotulo: "Painel" },
  { href: "/gestao/cardapio", rotulo: "Cardápio" },
  { href: "/gestao/produtos", rotulo: "Produtos" },
  { href: "/gestao/estoque", rotulo: "Estoque" },
  { href: "/gestao/auditoria", rotulo: "Diário" },
  { href: CONFIGURACOES, rotulo: "Configurações" },
];

/**
 * Este menu é componente de cliente só por causa do `usePathname`: o layout da
 * gestão é servidor, e o servidor não sabe em que rota o navegador está.
 */
export function MenuDaGestao() {
  const caminho = usePathname();

  /**
   * "/gestao" casaria com tudo num `startsWith` — daí a exatidão para o
   * Painel.
   *
   * E "Configurações" acende também quando se está dentro de qualquer uma das
   * cinco que ela guarda. Sem isso, quem entrasse em Ajustes veria o menu
   * inteiro apagado e perderia a única pista de onde está — que é justamente o
   * risco de esconder seções atrás de uma porta.
   */
  function estaAtivo(href: string) {
    if (href === "/gestao") return caminho === "/gestao";
    if (href === CONFIGURACOES) {
      return (
        caminho.startsWith(CONFIGURACOES) ||
        SECOES_DE_CONFIGURACAO.some((s) => caminho.startsWith(s.href))
      );
    }
    return caminho.startsWith(href);
  }

  return (
    /*
      A rolagem de lado continua sendo necessária no celular, e vale saber a
      conta: os seis itens somam 558px, mais 54 da marca e o padding, o que
      pede 685px para caber sem arrastar. Em 375px ainda sobram 261px para
      fora.

      O que mudou não foi o menu passar a caber — foi o que fica de fora dele.
      Antes eram cinco seções escondidas depois do quinto item, cada uma um
      assunto diferente; agora é só o rabo de "Configurações", e as cinco que
      ela guarda estão listadas com descrição na primeira tela de quem entra.

      A sangria negativa deixa o primeiro e o último encostarem na borda da
      tela em vez de morrerem dentro do padding.
    */
    <nav className="sem-barra-de-rolagem -mx-6 flex min-w-0 flex-1 gap-1 overflow-x-auto px-6 sm:mx-0 sm:flex-wrap sm:px-0">
      {MENU.map((item) => {
        const ativo = estaAtivo(item.href);

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={ativo ? "page" : undefined}
            // `py-2` no celular, e não a camada invisível do globals.css: a
            // faixa rola de lado, e contêiner com rolagem corta o que passa da
            // borda — a camada ficava de fora e o toque seguia com 32px.
            className={`realce-ao-toque shrink-0 touch-manipulation rounded-lg px-3 py-2 text-sm font-medium transition duration-100 active:scale-95 sm:py-1.5 ${
              ativo
                ? "bg-neutral-900 text-white"
                : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
            }`}
          >
            {item.rotulo}
          </Link>
        );
      })}
    </nav>
  );
}
