import type { Metadata } from "next";
import { db } from "@/lib/db";
import { sessaoDaTela, temPermissao } from "@/lib/session";
import { AparelhosTela } from "./aparelhos-tela";

export const metadata: Metadata = { title: "Aparelhos" };
export const dynamic = "force-dynamic";

export default async function AparelhosPage() {
  const sessao = await sessaoDaTela();
  const podeEditar = temPermissao(sessao, "unidade.configurar");

  const [aparelhos, unidade] = await Promise.all([
    db.aparelho.findMany({
      where: { unidadeId: sessao.unidadeId },
      // Os cortados no fim: continuam à vista porque o diário aponta para
      // eles, mas quem abre esta tela está cuidando dos que trabalham.
      orderBy: [{ ativo: "desc" }, { criadoEm: "asc" }],
    }),
    db.unidade.findUniqueOrThrow({
      where: { id: sessao.unidadeId },
      select: { nome: true, tokenImpressao: true },
    }),
  ]);

  return (
    <AparelhosTela
      podeEditar={podeEditar}
      unidade={unidade.nome}
      /*
       * A unidade ainda tem token, e ele ainda abre as duas portas: é o que o
       * agente instalado nos restaurantes usa. A tela diz isso em vez de
       * fingir que só há aparelhos cadastrados.
       */
      temTokenDaUnidade={Boolean(unidade.tokenImpressao)}
      aparelhos={aparelhos.map((a) => ({
        id: a.id,
        nome: a.nome,
        tipo: a.tipo,
        /*
         * O token só desce para quem configura aparelho.
         *
         * Ele é a credencial inteira: com ele se puxa a fila de impressão da
         * casa e se dá baixa nela sem papel sair. A tela esconde atrás de um
         * "mostrar", mas escondido na tela é diferente de ausente da página —
         * quem não pode cortar nem trocar um aparelho também não precisa ler a
         * credencial dele. É o mesmo motivo que mantém o token fora do diário.
         */
        token: podeEditar ? a.token : null,
        ativo: a.ativo,
        apelido: a.ultimoApelido,
        ultimoContatoEm: a.ultimoContatoEm?.toISOString() ?? null,
      }))}
    />
  );
}
