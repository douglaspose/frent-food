import Link from "next/link";

/**
 * A volta para a tela anterior do salão.
 *
 * Existe como componente porque o tamanho é a razão de ser dele. Espalhado,
 * ele nascia do jeito que coubesse na hora — uma linha de texto de 14px aqui,
 * uma seta de 36px ali — e virava o menor alvo da tela justamente onde é o
 * toque mais repetido: quem entrou na mesa errada quer sair dela. Com 48px de
 * altura e um fundo visível, o próximo não nasce pequeno.
 *
 * O fundo não é enfeite. Área grande sem aparência de botão não resolve: a
 * pessoa continua mirando nas letras e erra igual, porque o que faz alguém
 * acertar é enxergar onde o botão começa e acaba.
 *
 * Sem rótulo ele vira quadrado — num cabeçalho que já diz "Mesa 4" ao lado, a
 * palavra só repetiria o título.
 *
 * A seta é desenhada, e não o caractere "←", por causa do alinhamento: um
 * glifo se apoia na linha de base da fonte, então fica abaixo do meio da
 * própria caixa. A caixa media centrada e o olho via torto, e não havia
 * padding que resolvesse. Num SVG a forma nasce centrada no quadro.
 */
type Comum = {
  /** Ausente vira um quadrado só com a seta. */
  rotulo?: string;
  /** Para telas onde esta é a única ação e ela merece outra cor. */
  className?: string;
};

/**
 * Ou navega, ou fecha o que está aberto por cima — nunca os dois.
 *
 * As folhas de carrinho e comanda no celular cobrem a tela inteira, então a
 * saída delas é um voltar como qualquer outro para quem usa; só que por baixo
 * não há página anterior, e sim a mesma tela com um painel a menos.
 */
type Props = Comum &
  ({ href: string; aoVoltar?: never } | { aoVoltar: () => void; href?: never });

export function BotaoVoltar({ href, aoVoltar, rotulo, className = "" }: Props) {
  const forma = rotulo ? "w-fit gap-2 px-4" : "w-12 justify-center";
  const aparencia = `inline-flex h-12 shrink-0 items-center rounded-xl bg-neutral-900 text-base font-medium text-neutral-300 transition hover:bg-neutral-800 hover:text-neutral-100 active:bg-neutral-700 ${forma} ${className}`;

  const miolo = (
    <>
      <svg
        viewBox="0 0 24 24"
        className="h-5 w-5 shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M19 12H5" />
        <path d="M12 19l-7-7 7-7" />
      </svg>
      {rotulo}
    </>
  );

  const etiqueta = rotulo ? undefined : "Voltar";

  if (href) {
    return (
      <Link href={href} aria-label={etiqueta} className={aparencia}>
        {miolo}
      </Link>
    );
  }

  return (
    <button type="button" onClick={aoVoltar} aria-label={etiqueta} className={aparencia}>
      {miolo}
    </button>
  );
}
