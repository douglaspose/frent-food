import { NextResponse, type NextRequest } from "next/server";
import { db, dbSemRls } from "@/lib/db";
import { atravessandoRestaurantes, declararTenant } from "@/lib/tenant-atual";

export const dynamic = "force-dynamic";

/**
 * API do agente de impressão.
 *
 * O agente roda numa máquina dentro do restaurante (a mesma que enxerga as
 * impressoras da rede) e conversa com o servidor por aqui. Autentica com o
 * token da unidade no header, não com sessão de usuário: é um serviço, não
 * uma pessoa.
 */
async function unidadeDoToken(request: NextRequest) {
  const cabecalho = request.headers.get("authorization") ?? "";
  const token = cabecalho.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;

  /**
   * O token é a credencial e o endereço ao mesmo tempo: é ele que diz de qual
   * restaurante é esta chamada. Como a pergunta vem antes da resposta, ela
   * atravessa — e é a segunda e última do sistema que precisa disso.
   *
   * O que vem depois já roda declarado: o agente só enxerga a fila do próprio
   * restaurante mesmo que o `unidadeId` seja adulterado adiante.
   */
  return atravessandoRestaurantes("agente de impressão: identificar pelo token", () =>
    dbSemRls.unidade.findUnique({
      where: { tokenImpressao: token },
      select: { id: true, nome: true, ativo: true, tenantId: true },
    })
  );
}

/** GET — devolve o que está esperando para ser impresso. */
export async function GET(request: NextRequest) {
  const unidade = await unidadeDoToken(request);
  if (!unidade?.ativo) {
    return NextResponse.json({ erro: "Token inválido." }, { status: 401 });
  }

  /**
   * A declaração acontece aqui, e não dentro do `unidadeDoToken`, porque
   * `enterWith` não sobe para quem chamou: declarada lá, ela não valeria para
   * as consultas abaixo. O agente não tem sessão, então não há cookie de onde
   * o adapter pudesse tirar o restaurante sozinho.
   */
  declararTenant(unidade.tenantId);

  const trabalhos = await db.filaImpressao.findMany({
    where: { unidadeId: unidade.id, status: "PENDENTE" },
    orderBy: { criadoEm: "asc" },
    take: 20,
    include: { impressora: { select: { nome: true, conexao: true, endereco: true } } },
  });

  return NextResponse.json({
    unidade: unidade.nome,
    trabalhos: trabalhos.map((t) => ({
      id: t.id,
      tipo: t.tipo,
      titulo: t.titulo,
      conteudo: t.conteudo,
      impressora: t.impressora
        ? { nome: t.impressora.nome, conexao: t.impressora.conexao, endereco: t.impressora.endereco }
        : null,
    })),
  });
}

/** POST — o agente confirma o que saiu (ou relata a falha). */
export async function POST(request: NextRequest) {
  const unidade = await unidadeDoToken(request);
  if (!unidade?.ativo) {
    return NextResponse.json({ erro: "Token inválido." }, { status: 401 });
  }

  // No corpo do handler, pelo mesmo motivo do GET acima.
  declararTenant(unidade.tenantId);

  const corpo = (await request.json()) as { id?: string; ok?: boolean; erro?: string };
  if (!corpo.id) return NextResponse.json({ erro: "Informe o id." }, { status: 400 });

  const trabalho = await db.filaImpressao.findUnique({ where: { id: corpo.id } });
  // Confere a unidade: um token não confirma trabalho de outro restaurante.
  if (!trabalho || trabalho.unidadeId !== unidade.id) {
    return NextResponse.json({ erro: "Trabalho não encontrado." }, { status: 404 });
  }

  await db.filaImpressao.update({
    where: { id: corpo.id },
    data: corpo.ok
      ? { status: "IMPRESSO", impressoEm: new Date(), erro: null }
      : {
          // Falha volta para PENDENTE e tenta de novo, até desistir e virar ERRO
          // — papel preso não pode entupir a fila para sempre.
          status: trabalho.tentativas >= 4 ? "ERRO" : "PENDENTE",
          tentativas: { increment: 1 },
          erro: corpo.erro?.slice(0, 500) ?? "falha desconhecida",
        },
  });

  return NextResponse.json({ ok: true });
}
