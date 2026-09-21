import type { Metadata } from "next";
import { db } from "@/lib/db";
import { exigirSessao, temPermissao } from "@/lib/session";
import { FormasTela, type FormaView } from "./formas-tela";
import type { TipoDePagamento } from "./tipos";

export const metadata: Metadata = { title: "Formas de pagamento" };
export const dynamic = "force-dynamic";

export default async function FormasDePagamentoPage() {
  const sessao = await exigirSessao();

  /**
   * A contagem de uso vem junto, num `_count`, e não numa consulta por linha.
   *
   * Ela decide se o botão "excluir" aparece: forma que já recebeu pagamento não
   * pode sumir sem levar junto o registro de como o dinheiro entrou. Buscar uma
   * contagem por forma seria o N+1 clássico numa tela que lista poucas linhas
   * mas é aberta com pressa.
   */
  const formas = await db.formaPagamento.findMany({
    where: { tenantId: sessao.tenantId },
    orderBy: [{ ativo: "desc" }, { nome: "asc" }],
    include: { _count: { select: { pagamentos: true } } },
  });

  const lista: FormaView[] = formas.map((f) => ({
    id: f.id,
    nome: f.nome,
    tipo: f.tipo as TipoDePagamento,
    // Decimal do Prisma não atravessa a fronteira do servidor para o cliente:
    // vira número aqui, onde ainda dá para arredondar com intenção.
    taxaPct: Number(f.taxaPct),
    prazoDias: f.prazoDias,
    codigoFiscal: f.codigoFiscal,
    ativo: f.ativo,
    usos: f._count.pagamentos,
  }));

  return (
    <FormasTela formas={lista} podeEditar={temPermissao(sessao, "unidade.configurar")} />
  );
}
