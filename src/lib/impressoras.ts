/**
 * O cadastro de uma impressora da casa.
 *
 * O modelo existia desde o início e a fila sempre soube endereçar papel, mas
 * **não havia onde cadastrar**: a tela de Impressão listava as impressoras e
 * nada no sistema criava uma. Quem comprava uma térmica para a cozinha
 * precisava de alguém com acesso ao banco — e, sem cadastro, todo papel de
 * produção saía "na mão", em qualquer agente que buscasse a fila.
 *
 * Sem `server-only`: a tela usa as mesmas conexões e a mesma conferência de
 * endereço para avisar antes de salvar.
 */

/**
 * Como o agente chega à impressora.
 *
 * - `rede`: a comum em restaurante. O agente abre um socket na porta RAW/9100,
 *   que é o que quase toda térmica de rede fala.
 * - `usb` e `agente`: a impressora está pendurada na máquina do agente, que
 *   decide o caminho local. Não têm endereço, e é de propósito: endereço aqui
 *   seria um campo que ninguém sabe preencher.
 */
export const CONEXOES = [
  { valor: "rede", rotulo: "Rede (IP)", precisaEndereco: true },
  { valor: "usb", rotulo: "USB na máquina do agente", precisaEndereco: false },
  { valor: "agente", rotulo: "Impressora padrão do agente", precisaEndereco: false },
] as const;

export type Conexao = (typeof CONEXOES)[number]["valor"];

export const conexaoValida = (bruto: unknown): bruto is Conexao =>
  CONEXOES.some((c) => c.valor === bruto);

export const precisaEndereco = (conexao: string) =>
  CONEXOES.find((c) => c.valor === conexao)?.precisaEndereco ?? false;

/** A porta que o agente usa quando o endereço não diz outra. */
export const PORTA_PADRAO = 9100;

/**
 * O endereço como o agente vai usá-lo, ou o motivo de não servir.
 *
 * O agente faz `endereco.split(":")` e cai na porta 9100 quando não há
 * número — então o que entra aqui tem de ser `host` ou `host:porta`, e nada
 * mais. Sem esta conferência, um "192.168.0.10/porta-9100" ou um
 * "http://192.168.0.10" era aceito no cadastro e só aparecia como papel que
 * não sai, num sábado, sem ninguém ligar uma coisa à outra.
 *
 * Devolve `{ erro }` em vez de lançar porque quem chama é um formulário: a
 * frase vai para a tela, ao lado do campo.
 */
export function conferirEndereco(bruto: string): { endereco: string } | { erro: string } {
  const limpo = bruto.trim();
  if (!limpo) return { erro: "Informe o endereço da impressora na rede." };
  if (/\s/.test(limpo)) return { erro: "O endereço não leva espaços." };
  if (limpo.includes("/")) {
    return { erro: "Só o endereço, sem http:// e sem caminho — por exemplo 192.168.0.10:9100." };
  }

  const partes = limpo.split(":");
  if (partes.length > 2) return { erro: "Use host ou host:porta — por exemplo 192.168.0.10:9100." };

  const [host, porta] = partes;
  if (!host) return { erro: "Informe o IP ou o nome da impressora." };

  /*
   * IP ou nome de máquina. A térmica da casa costuma ter IP fixo; algumas
   * aparecem por nome no DNS do roteador, e recusar nome obrigaria o dono a
   * descobrir o IP de algo que já funciona pelo nome.
   */
  const ehIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  if (ehIp) {
    if (host.split(".").some((n) => Number(n) > 255)) {
      return { erro: "Este IP não existe: cada número vai até 255." };
    }
  } else if (!/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9-]+)*$/.test(host)) {
    return { erro: "Endereço inválido. Informe o IP (192.168.0.10) ou o nome da impressora." };
  }

  if (porta !== undefined) {
    const n = Number(porta);
    if (!Number.isInteger(n) || n < 1 || n > 65535) {
      return { erro: "A porta vai de 1 a 65535. A das térmicas de rede é 9100." };
    }
  }

  return { endereco: limpo };
}
