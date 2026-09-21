import type { Metadata } from "next";
import { db } from "@/lib/db";
import { sessaoDaTela, temPermissao } from "@/lib/session";
import { FilaTela } from "./fila-tela";

export const metadata: Metadata = { title: "Impressão" };
export const dynamic = "force-dynamic";

export default async function ImpressaoPage() {
  const sessao = await sessaoDaTela();

  const [unidade, trabalhos, impressoras] = await Promise.all([
    db.unidade.findUniqueOrThrow({
      where: { id: sessao.unidadeId },
      select: { nome: true, tokenImpressao: true },
    }),
    db.filaImpressao.findMany({
      where: { unidadeId: sessao.unidadeId },
      orderBy: { criadoEm: "desc" },
      take: 50,
      include: { impressora: { select: { nome: true } } },
    }),
    db.impressora.findMany({
      where: { unidadeId: sessao.unidadeId },
      orderBy: { nome: "asc" },
      select: { id: true, nome: true, conexao: true, endereco: true, ativo: true },
    }),
  ]);

  return (
    <FilaTela
      podeEditar={temPermissao(sessao, "produto.editar")}
      unidade={unidade.nome}
      token={unidade.tokenImpressao}
      impressoras={impressoras}
      trabalhos={trabalhos.map((t) => ({
        id: t.id,
        tipo: t.tipo,
        titulo: t.titulo,
        status: t.status,
        conteudo: t.conteudo,
        impressora: t.impressora?.nome ?? null,
        tentativas: t.tentativas,
        erro: t.erro,
        criadoEm: t.criadoEm.toISOString(),
      }))}
    />
  );
}
