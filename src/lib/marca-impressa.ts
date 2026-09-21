import "server-only";
import { dbSemRls } from "./db";
import { converterParaTermica, type Raster } from "./termica";

/**
 * A logomarca convertida para o que uma impressora térmica entende.
 *
 * Impressora térmica não tem tinta nem tons: cada ponto do papel é queimado ou
 * não é. Uma logo colorida com sombra precisa virar um bitmap de 1 bit antes
 * de chegar lá, e é isso que este arquivo faz — em ESC/POS, pronto para o
 * agente escrever no soquete sem precisar de biblioteca de imagem nenhuma.
 *
 * A versão usada é a de **fundo claro**: o papel é branco, e é a versão de
 * traço escuro que se lê nele. A de fundo escuro sairia como um borrão.
 */

/**
 * O raster de um restaurante, guardado entre chamadas.
 *
 * O agente pergunta pela fila de poucos em poucos segundos, e converter a
 * imagem de novo a cada pergunta seria queimar CPU para sempre chegar ao
 * mesmo resultado. A chave leva o instante da última troca: trocou a logo,
 * a chave muda e a conversão acontece uma vez só.
 */
const guardado = new Map<string, Raster>();

/**
 * Quais impressões levam a marca.
 *
 * O cupom e a conferência são os dois papéis que o cliente leva para casa ou
 * lê na mesa — é neles que a marca da casa tem função. O ticket da cozinha e o
 * aviso de cancelamento ficam de fora: ninguém de fora os vê, e a logo custa
 * dois centímetros de papel e um segundo de impressão em cada pedido, que numa
 * noite cheia é bobina inteira. A NFC-e também fica: o layout dela é ditado
 * pela SEFAZ, não por nós.
 */
export const LEVA_MARCA: ReadonlySet<string> = new Set(["CUPOM", "CONFERENCIA"]);

export async function marcaParaImpressora(tenantId: string): Promise<Raster | null> {
  const logo = await dbSemRls.logomarca.findUnique({
    where: { tenantId_fundo: { tenantId, fundo: "CLARO" } },
    select: { bytes: true, criadoEm: true },
  });

  if (!logo) return null;

  const chave = `${tenantId}:${logo.criadoEm.getTime()}`;
  const pronto = guardado.get(chave);
  if (pronto) return pronto;

  const raster = await converterParaTermica(logo.bytes);

  // Só a conversão corrente interessa: o processo é longo e a logo antiga não
  // volta a ser pedida.
  guardado.clear();
  guardado.set(chave, raster);

  return raster;
}
