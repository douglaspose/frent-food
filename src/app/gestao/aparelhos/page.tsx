import type { Metadata } from "next";
import { db } from "@/lib/db";
import { sessaoDaTela, temPermissao } from "@/lib/session";
import { AparelhosTela } from "./aparelhos-tela";

export const metadata: Metadata = { title: "Aparelhos" };
export const dynamic = "force-dynamic";

export default async function AparelhosPage() {
  const sessao = await sessaoDaTela();

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
      podeEditar={temPermissao(sessao, "unidade.configurar")}
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
        token: a.token,
        ativo: a.ativo,
        apelido: a.ultimoApelido,
        ultimoContatoEm: a.ultimoContatoEm?.toISOString() ?? null,
      }))}
    />
  );
}
