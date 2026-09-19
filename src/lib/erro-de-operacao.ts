/**
 * Erro que o usuário precisa ler.
 *
 * Em produção, a mensagem de uma exceção lançada dentro de uma server action
 * **não chega ao navegador**: o React manda um código minificado com um link
 * para o react.dev. Foi o que o operador de caixa viu ao tentar uma sangria
 * maior que a gaveta — em vez de "A gaveta tem R$ 200,00".
 *
 * A doutrina do Next é clara: erro esperado é valor de retorno, não exceção.
 * "Esperado" aqui quer dizer regra de negócio — conta já paga, gaveta sem
 * saldo, PIN repetido. Bug de programação continua sendo exceção: a mensagem
 * dele não serve para quem está no salão, e virar código minificado é o
 * destino correto.
 */
export class ErroDeOperacao extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroDeOperacao";
  }
}

export type ComErro = { erro: string };

export function temErro(r: unknown): r is ComErro {
  return typeof r === "object" && r !== null && "erro" in r && typeof r.erro === "string";
}

/**
 * Roda a ação e traduz a regra de negócio violada em valor de retorno.
 *
 * Só `ErroDeOperacao` é convertido. Qualquer outra coisa sobe: uma falha do
 * Prisma traz consulta e nomes de coluna na mensagem, e isso não vai para a
 * tela de ninguém.
 */
export async function emResultado<T>(corpo: () => Promise<T>): Promise<T | ComErro> {
  try {
    return await corpo();
  } catch (e) {
    if (e instanceof ErroDeOperacao) return { erro: e.message };
    throw e;
  }
}
