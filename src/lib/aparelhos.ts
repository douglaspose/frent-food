import { randomBytes } from "node:crypto";
import { db, dbSemRls } from "@/lib/db";
import { atravessandoRestaurantes } from "@/lib/tenant-atual";
import { ErroDeOperacao } from "@/lib/erro-de-operacao";

/**
 * Os aparelhos da casa que falam com o servidor por token, e não por sessão de
 * gente: a maquininha no bolso do garçom, o agente de impressão do balcão.
 *
 * A credencial era uma só, a da unidade, e todos usavam a mesma. Funcionava
 * enquanto havia um agente por restaurante; com uma maquininha por garçom,
 * cortar a que sumiu significava regerar o token e derrubar todas as outras no
 * meio do turno.
 */

/** O que uma chamada de aparelho prova sobre si mesma. */
export type AparelhoReconhecido = {
  unidade: { id: string; nome: string; ativo: boolean; tenantId: string };
  /**
   * Nulo quando quem chamou usou o token da unidade — o agente de impressão
   * antigo, que ainda não foi cadastrado. Vale, e é de propósito: um cadastro
   * novo não pode parar quem já está imprimindo.
   */
  aparelho: { id: string; nome: string; tipo: string } | null;
};

/**
 * Quem está chamando, pelo token do cabeçalho.
 *
 * O token é a credencial e o endereço ao mesmo tempo: é ele que diz de qual
 * restaurante é a chamada, e por isso a pergunta atravessa o isolamento — o
 * que vem depois já roda declarado no restaurante dele.
 *
 * O aparelho vem antes da unidade na procura: quem tem cadastro é o caso novo,
 * e o token da unidade é o que sobrou do mundo com um agente só.
 */
export async function reconhecerPeloToken(token: string): Promise<AparelhoReconhecido | null> {
  const limpo = token.trim();
  if (!limpo) return null;

  return atravessandoRestaurantes("aparelho da casa: identificar pelo token", async () => {
    const aparelho = await dbSemRls.aparelho.findUnique({
      where: { token: limpo },
      select: {
        id: true,
        nome: true,
        tipo: true,
        ativo: true,
        unidade: { select: { id: true, nome: true, ativo: true, tenantId: true } },
      },
    });

    if (aparelho) {
      // Revogado responde como token inventado: dizer "este aparelho foi
      // cortado" ajudaria quem está com ele na mão a saber que acertou a casa.
      if (!aparelho.ativo) return null;
      return {
        unidade: aparelho.unidade,
        aparelho: { id: aparelho.id, nome: aparelho.nome, tipo: aparelho.tipo },
      };
    }

    const unidade = await dbSemRls.unidade.findUnique({
      where: { tokenImpressao: limpo },
      select: { id: true, nome: true, ativo: true, tenantId: true },
    });
    return unidade ? { unidade, aparelho: null } : null;
  });
}

/**
 * Quanto tempo o "último contato" vale sem ser reescrito.
 *
 * A maquininha busca a fila a cada poucos segundos: um UPDATE por busca seria
 * escrita constante para responder a mesma pergunta — "ele está vivo?" —, e um
 * minuto de defasagem não muda a resposta de ninguém que olha a tela.
 */
const CONTATO_VALE_POR_MS = 60_000;

/**
 * Marca que o aparelho falou agora.
 *
 * Só escreve quando a marca anterior já envelheceu: é a condição no próprio
 * `where`, e não uma leitura antes do UPDATE, para não trocar uma escrita por
 * duas idas ao banco.
 */
export async function registrarContato(
  aparelho: { id: string } | null,
  tenantId: string,
  apelido?: string | null
) {
  if (!aparelho) return;

  await db.aparelho.updateMany({
    where: {
      id: aparelho.id,
      tenantId,
      OR: [
        { ultimoContatoEm: null },
        { ultimoContatoEm: { lt: new Date(Date.now() - CONTATO_VALE_POR_MS) } },
      ],
    },
    data: {
      ultimoContatoEm: new Date(),
      ...(apelido ? { ultimoApelido: apelido } : {}),
    },
  });
}

/**
 * O aparelho, se ele for desta unidade.
 *
 * Unidade, e não restaurante: um aparelho mora numa casa só, e quem configura
 * a filial do centro não corta a maquininha da filial da praia. Não tinha
 * efeito enquanto `unidade.configurar` era do proprietário, que manda nas
 * duas; passa a ter no dia em que existir um gerente de filial com a chave —
 * e é a mesma régua que `abertura` e `conta` usam para mesa e comanda.
 */
export async function aparelhoDaUnidade(
  id: string,
  quem: { tenantId: string; unidadeId: string }
) {
  const aparelho = await db.aparelho.findUnique({ where: { id } });
  if (!aparelho || aparelho.tenantId !== quem.tenantId) {
    throw new ErroDeOperacao("Aparelho de outro restaurante.");
  }
  if (aparelho.unidadeId !== quem.unidadeId) {
    throw new ErroDeOperacao("Aparelho de outra unidade.");
  }
  return aparelho;
}

/**
 * Uma credencial nova.
 *
 * 32 bytes em base64url: é digitada uma vez, no teclado ruim do aparelho, e
 * depois só viaja em cabeçalho. Sorteada no servidor porque credencial
 * escolhida por gente vira o nome do restaurante com o ano no fim.
 */
export function sortearToken() {
  return randomBytes(24).toString("base64url");
}
