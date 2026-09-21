/**
 * O vocabulário da marca da casa — sem nada de servidor.
 *
 * Fica separado de `logomarca.ts` pelo mesmo motivo que `auditoria.ts` fica
 * separado de `auditoria-servidor.ts`: a tela de cadastro é componente de
 * cliente e precisa deste vocabulário, mas `logomarca.ts` tem `server-only` e
 * carrega o banco junto. Importar de lá quebrava a compilação da rota.
 */

/**
 * Para que fundo a versão foi desenhada — não de que cor ela é.
 *
 * Uma logo de letra branca é a versão `ESCURO`: é no escuro que ela se lê.
 * Mesma união do enum `FundoDaLogo` do Prisma, escrita à mão aqui para o
 * cliente não ter de importar o cliente do banco só por dois literais.
 */
export type FundoDaLogo = "CLARO" | "ESCURO";

/** O fundo de cada tela, para quem chama não ter de lembrar qual é qual. */
export const FUNDO_CLARO = "CLARO" as const;
export const FUNDO_ESCURO = "ESCURO" as const;

/**
 * O que uma tela precisa para desenhar a marca da casa.
 *
 * `src` é nulo enquanto ninguém enviou imagem — e é justamente aí que o nome
 * importa: sem ele, a tela não teria o que pôr no lugar.
 *
 * `corDeFundo` é a exceção, não a regra. Com as duas versões cadastradas, cada
 * tela recebe a que foi feita para o fundo dela e a desenha direto, sem
 * retângulo de cor nenhum — vem `null`. A cor só aparece quando a casa enviou
 * uma versão só e ela caiu na tela do fundo contrário: aí o retângulo é o que
 * impede a logo de sumir.
 */
export type Marca = {
  src: string | null;
  corDeFundo: string | null;
  /** O nome da casa, para o `alt` e para quando não há imagem. */
  nome: string;
};

/** O preto do sistema, quando a casa não escolheu uma cor de resgate. */
export const COR_DE_FUNDO_PADRAO = "#0a0a0a";

/**
 * Como o fundo aparece na URL da imagem: `/logo/<tenant>/escuro`.
 *
 * Minúsculo porque é endereço, e endereço em CAIXA ALTA é feio no histórico do
 * navegador e no log do servidor.
 */
export function noEndereco(fundo: FundoDaLogo) {
  return fundo.toLowerCase();
}

export function doEndereco(trecho: string): FundoDaLogo | null {
  const normalizado = trecho.toUpperCase();
  return normalizado === FUNDO_CLARO || normalizado === FUNDO_ESCURO ? normalizado : null;
}
