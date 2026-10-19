import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { declararTenant } from "@/lib/tenant-atual";
import { reconhecerPeloToken, registrarContato } from "@/lib/aparelhos";
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
 * Quem está puxando a fila.
 *
 * Dois tipos de token abrem esta porta: o do aparelho cadastrado — que se
 * corta sozinho quando ele some — e o da unidade, que é o que o agente
 * instalado nos restaurantes usa desde sempre e continua valendo.
 *
 * A procura mora em `@/lib/aparelhos`, compartilhada com a porta da
 * maquininha: são a mesma pergunta feita por duas portas, e o que ela
 * atravessa (o token é credencial e endereço ao mesmo tempo) está explicado lá.
 */
async function quemEsta(request: NextRequest) {
  const cabecalho = request.headers.get("authorization") ?? "";
  return reconhecerPeloToken(cabecalho.replace(/^Bearer /i, "").trim());
}

/** GET — devolve o que está esperando para ser impresso. */
export async function GET(request: NextRequest) {
  const quem = await quemEsta(request);
  if (!quem?.unidade.ativo) {
    return NextResponse.json({ erro: "Token inválido." }, { status: 401 });
  }
  const unidade = quem.unidade;

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
  /*
   * O agente que só tem a bobina da mão não leva papel endereçado a outra
   * impressora.
   *
   * A maquininha imprime na própria bobina o que quer que a fila entregue a
   * ela. Enquanto a fila entregava tudo a todos, isso só gastava papel: a
   * comanda da cozinha saía na térmica da cozinha pelo agente do balcão, e uma
   * segunda via inútil saía no bolso do garçom. Com a reserva, quem leva é um
   * só — e a comanda da cozinha passou a poder sair **apenas** no bolso do
   * garçom, deixando a praça sem o papel.
   *
   * Então o agente diz o que consegue imprimir, e a fila respeita: com
   * `embutida`, só o papel da mão — a conferência e o cupom, que são os que o
   * garçom quer em mãos.
   *
   * "Papel da mão" é o tipo, e não a falta de endereço. O endereço vem da
   * estação, e a casa que comprou a térmica do bar e deixou a cozinha no agente
   * do balcão tem a comanda da cozinha **sem** impressora endereçada: pela
   * falta de endereço ela voltava a caber no bolso do garçom, e com a reserva o
   * balcão deixava de vê-la — a praça esperando um prato que ninguém mandou
   * fazer, que é justamente o que esta regra veio impedir.
   *
   * Numa casa sem impressora cadastrada, porém, a bobina do bolso é o único
   * destino que existe, e ali ele continua levando tudo: recusar a comanda da
   * cozinha seria trocar "o papel saiu no lugar errado" por "o papel não saiu".
   */
  const soEmbutida = request.nextUrl.searchParams.get("embutida") === "1";
  const soDaMao =
    soEmbutida &&
    (await db.impressora.count({ where: { unidadeId: unidade.id, ativo: true } })) > 0;
  const agente = (request.nextUrl.searchParams.get("agente") ?? "").slice(0, 60) || null;
  // Marca que este aparelho está vivo. Na busca, e não na confirmação: a busca
  // é a chamada que ele repete mesmo quando não há nada para imprimir.
  await registrarContato(quem.aparelho, unidade.tenantId, agente);
  /*
   * `timezone('UTC', now())`, e não `now()`.
   *
   * As colunas de data do banco são `timestamp without time zone` e guardam
   * UTC — é o que o Prisma grava e relê em todo o resto do sistema. Mas `now()`
   * é `timestamptz`, e atribuí-lo a uma coluna sem fuso o converte para o fuso
   * da sessão do Postgres: a marca de entrega nascia no relógio de parede
   * (três horas atrás, aqui) enquanto toda data vizinha estava em UTC.
   *
   * Enquanto só esta consulta escreve e lê a coluna, a janela de dois minutos
   * fecha certo pelos dois lados errados. Basta uma rotina gravar a marca pelo
   * Prisma — ou o banco mudar de fuso entre dois servidores — para o prazo
   * virar o fuso inteiro: o papel que o agente levou e não imprimiu some da
   * fila por três horas, com a cozinha esperando. Em fuso a leste de Greenwich,
   * ao contrário: todo trabalho entregue volta elegível na busca seguinte, e os
   * dois agentes imprimem a mesma comanda — que é o que esta reserva existe
   * para impedir.
   */
  /*
   * O dono da reserva é o cadastro do aparelho, não o apelido.
   *
   * `entregueA` é o que o agente diz ser (`?agente=balcao`), e serve para a
   * tela mostrar; quem decide é o id do aparelho, que é a credencial com que
   * ele entrou. Nulo para o agente que ainda usa o token da unidade.
   */
  const dono = quem.aparelho?.id ?? null;
  const reservados = await db.$queryRaw<{ id: string }[]>`
    UPDATE fila_impressao
       SET "entregueEm" = timezone('UTC', now()),
           "entregueA" = ${agente},
           "entregueAoAparelhoId" = ${dono}
     WHERE id IN (
       SELECT id
         FROM fila_impressao
        WHERE "unidadeId" = ${unidade.id}
          AND status = 'PENDENTE'
          AND (${soEmbutida} = false OR "impressoraId" IS NULL)
          AND (${soDaMao} = false OR tipo IN ('CONFERENCIA', 'CUPOM'))
          AND ("entregueEm" IS NULL
               OR "entregueEm" <
                  timezone('UTC', now()) - (${ENTREGA_VALE_POR_SEGUNDOS} * interval '1 second'))
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
  const quem = await quemEsta(request);
  if (!quem?.unidade.ativo) {
    return NextResponse.json({ erro: "Token inválido." }, { status: 401 });
  }
  const unidade = quem.unidade;

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

  /*
   * A baixa é de quem levou o papel.
   *
   * A fila entrega cada trabalho a um agente só, mas a confirmação aceitava
   * qualquer token da unidade: o aparelho do bolso dava baixa no papel
   * reservado pelo balcão. Era inofensivo quando todos imprimiam a mesma fila;
   * deixou de ser quando a reserva passou a entregar listas diferentes de
   * propósito — dar baixa no papel do outro marca como impresso um papel que
   * não saiu, e a cozinha espera um prato que ninguém mandou fazer.
   *
   * Vale também para o atraso legítimo: se a reserva venceu e outro aparelho
   * levou o trabalho, a confirmação do primeiro chega quando o papel já é do
   * segundo, e é a dele que conta.
   *
   * Reserva sem dono (o agente do token da unidade, que não tem cadastro) é a
   * que continua aberta: dois agentes com a mesma credencial são a mesma
   * credencial, e o servidor não tem como separá-los. Quem quiser isso fechado
   * cadastra o aparelho em `/gestao/impressao` — o cadastro já existe.
   */
  const dono = trabalho.entregueAoAparelhoId;
  if (dono && dono !== quem.aparelho?.id) {
    return NextResponse.json({ erro: "Este papel foi entregue a outro aparelho." }, { status: 409 });
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
          // O dono vai com ela — reserva devolvida não tem dono, e "sem
          // entrega mas com dono" seria um estado que não quer dizer nada.
          entregueEm: null,
          entregueAoAparelhoId: null,
        },
  });

  return NextResponse.json({ ok: true });
}
