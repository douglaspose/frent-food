import { NextResponse, type NextRequest } from "next/server";
import { declararTenant } from "@/lib/tenant-atual";
import { reconhecerPeloToken } from "@/lib/aparelhos";
import { resumoDaContingencia, transmitirContingencias } from "@/lib/fiscal/contingencia";

export const dynamic = "force-dynamic";

/**
 * A porta do agendador para a fila da contingência.
 *
 * A nota emitida offline tem prazo legal para ser transmitida, e o botão da
 * retaguarda só aperta quando alguém está olhando a tela. Esta porta é para
 * quem olha sozinho: `cron` da VPS, agendador da Vercel, ou o próprio agente de
 * impressão da casa, que já fala com o servidor a cada poucos segundos.
 *
 * **A credencial é a do aparelho**, a mesma da fila de impressão — e não um
 * segredo novo de agendador. Três razões: ela já existe em toda instalação, já
 * diz de qual unidade é a chamada (o agendador não tem sessão nem subdomínio),
 * e o dono já sabe cortá-la na tela de Aparelhos quando a máquina sai de uso.
 *
 * Varre uma unidade, a do token. Quem tem filial agenda uma chamada por
 * filial, com o token de cada uma — é o mesmo desenho da fila de impressão, e
 * mantém esta porta sem nenhum poder sobre a casa do vizinho.
 */
export async function POST(request: NextRequest) {
  const cabecalho = request.headers.get("authorization") ?? "";
  const quem = await reconhecerPeloToken(cabecalho.replace(/^Bearer /i, "").trim());

  if (!quem?.unidade.ativo) {
    return NextResponse.json({ erro: "Token inválido." }, { status: 401 });
  }
  const unidade = quem.unidade;

  // Declarado aqui, e não dentro da busca do token: `enterWith` não sobe para
  // quem chamou, e o agendador não tem cookie de onde tirar o restaurante.
  declararTenant(unidade.tenantId);

  const alvo = { tenantId: unidade.tenantId, unidadeId: unidade.id };
  const resultado = await transmitirContingencias(alvo);
  const resumo = await resumoDaContingencia(alvo);

  /*
   * Responde 200 mesmo com a SEFAZ fora, e o corpo conta o que houve.
   *
   * Um 5xx aqui faria o agendador tratar "o serviço do governo está fora" como
   * "esta porta está quebrada" — e é justamente quando ela precisa continuar
   * sendo chamada. Quem lê o log vê `aindaParadas` e `vencidas`.
   */
  return NextResponse.json({ unidade: unidade.nome, ...resultado, esperando: resumo });
}
