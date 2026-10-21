import type { Metadata } from "next";
import { db } from "@/lib/db";
import { sessaoDaTela, temPermissao } from "@/lib/session";
import { linhasParaTela } from "@/lib/impressao";
import { FilaTela } from "./fila-tela";

export const metadata: Metadata = { title: "Impressão" };
export const dynamic = "force-dynamic";

export default async function ImpressaoPage() {
  const sessao = await sessaoDaTela();

  const [unidade, trabalhos, naFila, impressoras, pracas] = await Promise.all([
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
    /*
     * O que espera na unidade inteira, contado no banco.
     *
     * A tela contava os PENDENTE dentro da lista acima, que traz 50: com a
     * impressora fora do ar e centenas de papéis parados, ela dizia "50 na
     * fila" e ficava nesse número para sempre. É o oposto do que esta tela
     * serve para responder — alguém só a abre quando a cozinha reclama que não
     * está saindo papel, e o tamanho do atraso é a primeira coisa a saber.
     */
    db.filaImpressao.count({
      where: { unidadeId: sessao.unidadeId, status: "PENDENTE" },
    }),
    db.impressora.findMany({
      where: { unidadeId: sessao.unidadeId },
      orderBy: { nome: "asc" },
      select: { id: true, nome: true, conexao: true, endereco: true, modelo: true, ativo: true },
    }),
    /*
     * As praças, para ligar cada uma à sua térmica.
     *
     * É nesta tela porque é aqui que as impressoras moram — e porque o vínculo
     * só faz sentido olhando as duas listas juntas: praça sem impressora manda
     * o papel "na mão", em qualquer agente que buscar a fila.
     */
    db.estacao.findMany({
      where: { unidadeId: sessao.unidadeId },
      orderBy: { ordem: "asc" },
      select: { id: true, nome: true, impressoraId: true, ativo: true },
    }),
  ]);

  return (
    <FilaTela
      podeEditar={temPermissao(sessao, "produto.editar")}
      /*
       * Gerar a credencial da unidade é da mesma régua que cadastrar ou cortar
       * um aparelho: ela abre a fila de impressão da casa e a porta da
       * maquininha, e regerá-la derruba todos os aparelhos de uma vez. Operar
       * a fila — reimprimir, descartar, testar — continua sendo `produto.editar`.
       */
      podeConfigurar={temPermissao(sessao, "unidade.configurar")}
      unidade={unidade.nome}
      /*
       * Só se existe, não qual é.
       *
       * A tela nunca mostrou o valor — ela diz "Token configurado" e só exibe o
       * que acabou de ser gerado. Mas a credencial inteira descia no payload
       * para qualquer um que abrisse a retaguarda, que é o mesmo vazamento que
       * a tela de aparelhos teve. O que a tela precisa saber é se já existe.
       */
      temToken={Boolean(unidade.tokenImpressao)}
      impressoras={impressoras}
      pracas={pracas}
      naFila={naFila}
      trabalhos={trabalhos.map((t) => ({
        id: t.id,
        tipo: t.tipo,
        titulo: t.titulo,
        status: t.status,
        // Linha a linha, marcando as de letra dupla: a prévia desenha o papel.
        linhas: linhasParaTela(t.conteudo),
        impressora: t.impressora?.nome ?? null,
        tentativas: t.tentativas,
        erro: t.erro,
        criadoEm: t.criadoEm.toISOString(),
        // Qual aparelho levou este papel. Com duas maquininhas e o agente do
        // balcão puxando a mesma fila, é a resposta para "saiu em qual?".
        agente: t.entregueA,
      }))}
    />
  );
}
