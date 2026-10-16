import { NextResponse, type NextRequest } from "next/server";
import { db, dbSemRls } from "@/lib/db";
import { atravessandoRestaurantes, declararTenant } from "@/lib/tenant-atual";
import { LEVA_MARCA, marcaParaImpressora } from "@/lib/marca-impressa";
import { COLUNAS, paraImpressora, remontar } from "@/lib/impressao";

export const dynamic = "force-dynamic";

/**
 * Quanto tempo a entrega segura o trabalho.
 *
 * Enquanto a marca for recente, o trabalho não sai para mais ninguém: é o que
 * impede o agente do balcão e a maquininha de imprimirem a mesma comanda.
 * Vencida, ele volta à fila — o agente que o levou pode ter perdido a rede ou
 * morrido no meio, e papel que não saiu merece outra chance.
 *
 * Dois minutos: imprimir uma comanda leva segundos, e o agente confirma logo
 * depois. O risco do prazo curto é a segunda via de um papel que saiu; o do
 * prazo longo é a cozinha esperando por um papel que não saiu.
 */
const ENTREGA_VALE_POR_SEGUNDOS = 120;

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

  /*
   * A largura de quem está buscando.
   *
   * A térmica de 80mm do balcão faz 48 colunas e é o padrão; a embutida numa
   * maquininha faz 32. Quem não disser nada recebe 48, como sempre recebeu —
   * é o que mantém o agente de impressão em Node funcionando sem mudar uma
   * linha.
   *
   * Fora da faixa, ignora: um `?colunas=2` montaria um papel de duas letras
   * por linha, e um valor absurdo não deve virar papel absurdo.
   */
  const pedidas = Number(request.nextUrl.searchParams.get("colunas"));
  const colunas =
    Number.isInteger(pedidas) && pedidas >= 24 && pedidas <= 96 ? pedidas : COLUNAS;

  /*
   * Quem busca leva, e quem levou segura.
   *
   * Antes a fila entregava a quem perguntasse: dois agentes buscando ao mesmo
   * tempo recebiam os mesmos trabalhos, e a cozinha ganhava duas vias de cada
   * comanda. Era hipótese enquanto só o balcão imprimia; deixou de ser quando
   * a maquininha virou agente e passou a buscar na mesma fila.
   *
   * `FOR UPDATE SKIP LOCKED` é o que faz as duas buscas simultâneas saírem com
   * listas diferentes em vez de uma esperar a outra: cada uma pula as linhas
   * que a outra já pegou. A marca de entrega é gravada na mesma instrução que
   * as escolhe — entre selecionar e marcar não cabe um segundo agente.
   */
  const agente = (request.nextUrl.searchParams.get("agente") ?? "").slice(0, 60) || null;
  const reservados = await db.$queryRaw<{ id: string }[]>`
    UPDATE fila_impressao
       SET "entregueEm" = now(), "entregueA" = ${agente}
     WHERE id IN (
       SELECT id
         FROM fila_impressao
        WHERE "unidadeId" = ${unidade.id}
          AND status = 'PENDENTE'
          AND ("entregueEm" IS NULL
               OR "entregueEm" < now() - (${ENTREGA_VALE_POR_SEGUNDOS} * interval '1 second'))
        ORDER BY "criadoEm" ASC
        LIMIT 20
        FOR UPDATE SKIP LOCKED
     )
    RETURNING id`;

  const trabalhos = await db.filaImpressao.findMany({
    where: { unidadeId: unidade.id, id: { in: reservados.map((r) => r.id) } },
    orderBy: { criadoEm: "asc" },
    include: { impressora: { select: { nome: true, conexao: true, endereco: true } } },
  });

  /*
   * A marca vem uma vez por resposta, e não dentro de cada trabalho.
   *
   * São os mesmos 9 KB de raster para os vinte trabalhos do lote; repeti-los
   * em cada um multiplicaria a resposta por vinte sem dizer nada de novo. O
   * trabalho diz apenas se leva marca, e o agente busca aqui em cima.
   *
   * Fora do lote vazio: sem nada para imprimir não há por que converter
   * imagem, e esta é a chamada que o agente repete o dia inteiro.
   */
  const levaMarca = trabalhos.some((t) => LEVA_MARCA.has(t.tipo));
  const marca = levaMarca ? await marcaParaImpressora(unidade.tenantId) : null;

  return NextResponse.json({
    unidade: unidade.nome,
    marca,
    colunas,
    trabalhos: trabalhos.map((t) => ({
      id: t.id,
      tipo: t.tipo,
      titulo: t.titulo,
      /*
       * Na largura pedida, quando dá para remontar.
       *
       * O `conteudo` guardado é o que saiu em 48 colunas e continua sendo a
       * fonte da segunda via. Para outra largura, o papel é montado de novo a
       * partir dos argumentos — refluir um texto já formatado é como se perde
       * o valor no fim da linha. Sem `dados` (trabalho antigo, ou DANFE), sai
       * o texto guardado como sempre saiu.
       *
       * A fila guarda marcadores no lugar dos comandos de letra dupla (o
       * Postgres não aceita o byte zero do comando); aqui eles viram ESC/POS.
       */
      conteudo: paraImpressora(
        (colunas !== COLUNAS ? remontar(t.tipo, t.dados, colunas) : null) ?? t.conteudo
      ),
      /*
       * Campo novo, e por isso um booleano em vez de mudar o `conteudo`: o
       * agente que não souber de marca nenhuma ignora e continua imprimindo
       * o texto como sempre imprimiu.
       */
      comMarca: LEVA_MARCA.has(t.tipo) && Boolean(marca),
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

  // Corpo quebrado é erro de quem chamou: 400 com motivo, e não um 500 que
  // no log do agente parece servidor fora do ar.
  let corpo: { id?: string; ok?: boolean; erro?: string };
  try {
    corpo = (await request.json()) as typeof corpo;
  } catch {
    return NextResponse.json({ erro: "Corpo inválido: envie JSON." }, { status: 400 });
  }
  if (typeof corpo?.id !== "string" || !corpo.id) {
    return NextResponse.json({ erro: "Informe o id." }, { status: 400 });
  }

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
          // A entrega é devolvida junto: o agente avisou que não saiu, e
          // esperar os dois minutos da janela seria a cozinha esperando à toa.
          entregueEm: null,
        },
  });

  return NextResponse.json({ ok: true });
}
