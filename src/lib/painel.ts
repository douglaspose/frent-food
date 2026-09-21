import { db } from "./db";
import { CONSUMO } from "./itens";
import { centavos } from "./comanda";
import { comoTexto, type Intervalo, type Periodo } from "./periodo";

/**
 * Os números do painel.
 *
 * Duas decisões moldam este arquivo, e as duas vêm de como o banco é acessado.
 *
 * **Uma consulta cobre os dois períodos.** Cada chamada ao Prisma passa pelo
 * adaptador de RLS, que gasta `BEGIN`, `set_config`, a consulta e `COMMIT` —
 * quatro idas ao banco. Calcular o período atual e o anterior em chamadas
 * separadas dobrava isso à toa, e ainda abria a porta para a conta divergir de
 * um lado só depois de uma correção. Aqui as duas colunas saem do mesmo `SUM`.
 *
 * **As consultas rodam uma depois da outra, não em paralelo.** Em `Promise.all`
 * cada uma abre a sua transação ao mesmo tempo; o ganho é de milissegundos numa
 * rede local e o custo é um pico de conexões a cada carregamento de tela.
 *
 * Tudo filtra por **unidade**, não por restaurante: o custo é da unidade, e
 * faturamento de uma loja com custo de outra daria uma margem fantasia.
 */
export type ResumoDoPeriodo = {
  faturamento: number;
  /** Custo da mercadoria que saiu, já descontadas as devoluções. */
  cmv: number;
  perdas: number;
  lucroBruto: number;
  /** `null` quando não há custo lançado: sem base, a margem não existe. */
  margemBruta: number | null;
  comandas: number;
  pessoas: number;
  /** `null` quando não houve comanda paga no período. */
  ticketMedio: number | null;
};

/**
 * O fuso em que um dia começa, para o banco.
 *
 * As colunas são `timestamp without time zone` guardando **UTC** — é o que o
 * Prisma grava e o que ele relê. Cortar o dia direto nelas cortaria à
 * meia-noite UTC, que aqui são 21h: numa espetinharia, tudo que vende das 21h à
 * meia-noite cairia no dia seguinte, justo o horário de pico.
 *
 * Vem do servidor, e não fixo em "America/Sao_Paulo", porque é o mesmo fuso que
 * `periodo.ts` usa para decidir onde o dia começa. Fixar um aqui faria o
 * gráfico discordar dos cartões numa máquina em outro fuso.
 */
const FUSO_LOCAL = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Soma que o Postgres devolve como texto quando a coluna é `numeric`. */
type Soma = string | number | null;

const num = (v: Soma | undefined) => Number(v ?? 0);

/**
 * A janela que cobre os dois períodos de uma vez.
 *
 * Vale porque o intervalo anterior nunca encosta no atual — `periodo.ts` garante
 * isso, e há teste para ele. Sem este recorte no `WHERE`, cada `FILTER` varreria
 * a tabela inteira.
 */
function janelaDupla(periodo: Pick<Periodo, "atual" | "anterior">) {
  return { inicio: periodo.anterior.inicio, fim: periodo.atual.fim };
}

type LinhaDeVendas = {
  fat_atual: Soma;
  fat_anterior: Soma;
  comandas_atual: number;
  comandas_anterior: number;
  pessoas_atual: number;
  pessoas_anterior: number;
};

type LinhaDeCusto = { tipo: string; atual: Soma; anterior: Soma };

/** Qual das duas colunas de cada soma está sendo lida. */
type Coluna = "atual" | "anterior";

export type ResumoDosPeriodos = Record<Coluna, ResumoDoPeriodo>;

export async function resumoDosPeriodos(
  unidadeId: string,
  periodo: Pick<Periodo, "atual" | "anterior">
): Promise<ResumoDosPeriodos> {
  const { atual, anterior } = periodo;
  const tudo = janelaDupla(periodo);

  const [vendas] = await db.$queryRaw<LinhaDeVendas[]>`
    WITH pagos AS (
      SELECT
        -- Troco não é faturamento: é dinheiro que voltou para a mão do cliente.
        COALESCE(SUM(p.valor - p.troco) FILTER (
          WHERE p."criadoEm" >= ${atual.inicio} AND p."criadoEm" < ${atual.fim}), 0) AS fat_atual,
        COALESCE(SUM(p.valor - p.troco) FILTER (
          WHERE p."criadoEm" >= ${anterior.inicio} AND p."criadoEm" < ${anterior.fim}), 0) AS fat_anterior
        FROM pagamentos p
        JOIN comandas c ON c.id = p."comandaId"
       WHERE c."unidadeId" = ${unidadeId}
         AND p."criadoEm" >= ${tudo.inicio}
         AND p."criadoEm" < ${tudo.fim}
    ),
    fechadas AS (
      SELECT
        COUNT(*) FILTER (
          WHERE cm."fechadaEm" >= ${atual.inicio} AND cm."fechadaEm" < ${atual.fim})::int AS comandas_atual,
        COUNT(*) FILTER (
          WHERE cm."fechadaEm" >= ${anterior.inicio} AND cm."fechadaEm" < ${anterior.fim})::int AS comandas_anterior,
        COALESCE(SUM(cm.pessoas) FILTER (
          WHERE cm."fechadaEm" >= ${atual.inicio} AND cm."fechadaEm" < ${atual.fim}), 0)::int AS pessoas_atual,
        COALESCE(SUM(cm.pessoas) FILTER (
          WHERE cm."fechadaEm" >= ${anterior.inicio} AND cm."fechadaEm" < ${anterior.fim}), 0)::int AS pessoas_anterior
        FROM comandas cm
       WHERE cm."unidadeId" = ${unidadeId}
         AND cm.status = 'PAGA'
         AND cm."fechadaEm" >= ${tudo.inicio}
         AND cm."fechadaEm" < ${tudo.fim}
    )
    SELECT * FROM pagos, fechadas
  `;

  /**
   * O custo vem somado pelo banco, e não linha a linha em JavaScript.
   *
   * Um mês movimentado gera dezenas de milhares de movimentos de estoque —
   * trazê-los só para multiplicar e somar era o gargalo escondido daqui.
   *
   * `ABS()` porque saída tem quantidade negativa e o custo é sempre positivo.
   */
  const custos = await db.$queryRaw<LinhaDeCusto[]>`
    SELECT m.tipo,
           COALESCE(SUM(ABS(m.quantidade) * m."custoUnitario") FILTER (
             WHERE m."criadoEm" >= ${atual.inicio} AND m."criadoEm" < ${atual.fim}), 0) AS atual,
           COALESCE(SUM(ABS(m.quantidade) * m."custoUnitario") FILTER (
             WHERE m."criadoEm" >= ${anterior.inicio} AND m."criadoEm" < ${anterior.fim}), 0) AS anterior
      FROM movimentos_estoque m
     WHERE m."unidadeId" = ${unidadeId}
       AND m.tipo IN ('SAIDA_VENDA', 'PERDA', 'DEVOLUCAO')
       AND m."criadoEm" >= ${tudo.inicio}
       AND m."criadoEm" < ${tudo.fim}
     GROUP BY m.tipo
  `;

  const custoDe = (tipo: string, coluna: Coluna) =>
    num(custos.find((c) => c.tipo === tipo)?.[coluna]);

  const montar = (coluna: Coluna): ResumoDoPeriodo => {
    const faturamento = centavos(
      num(coluna === "atual" ? vendas?.fat_atual : vendas?.fat_anterior)
    );
    const comandas =
      (coluna === "atual" ? vendas?.comandas_atual : vendas?.comandas_anterior) ?? 0;
    const pessoas = (coluna === "atual" ? vendas?.pessoas_atual : vendas?.pessoas_anterior) ?? 0;

    // DEVOLUCAO abate: é o insumo que voltou de um item cancelado, e sem ela o
    // CMV cobraria o custo de um prato que ninguém vendeu — justo no dia em que
    // a cozinha errou bastante. O piso de zero existe porque uma devolução
    // lançada fora do período deixaria o CMV negativo, que não quer dizer nada.
    const cmv = centavos(
      Math.max(0, custoDe("SAIDA_VENDA", coluna) - custoDe("DEVOLUCAO", coluna))
    );
    const lucroBruto = centavos(faturamento - cmv);

    return {
      faturamento,
      cmv,
      perdas: centavos(custoDe("PERDA", coluna)),
      lucroBruto,
      margemBruta: cmv > 0 && faturamento > 0 ? (lucroBruto / faturamento) * 100 : null,
      comandas,
      pessoas,
      ticketMedio: comandas > 0 ? centavos(faturamento / comandas) : null,
    };
  };

  return { atual: montar("atual"), anterior: montar("anterior") };
}

/**
 * Quanto do faturamento vem de produto que tem custo cadastrado.
 *
 * Sem isto a margem engana: produto sem ficha entra com custo zero e faz o lucro
 * parecer enorme. Se a cobertura está baixa, o lucro acima é ficção — e este
 * número é o que denuncia.
 *
 * Produto marcado como controlado mas sem custo lançado contribui R$ 0 ao CMV;
 * contá-lo como coberto inflaria justamente a métrica que existe para apontar o
 * buraco.
 */
export async function coberturaDeCusto(unidadeId: string, intervalo: Intervalo) {
  const linhas = await db.$queryRaw<{ com_custo: boolean; valor: Soma }[]>`
    SELECT
      (
        EXISTS (SELECT 1 FROM composicoes c WHERE c."produtoId" = p.id)
        OR (
          p."controlaEstoque"
          AND EXISTS (
            SELECT 1 FROM estoque_saldos s
             WHERE s."produtoId" = p.id
               AND s."unidadeId" = ${unidadeId}
               AND s."custoMedio" > 0
          )
        )
      ) AS com_custo,
      SUM(ci."precoTotal") AS valor
      FROM comanda_itens ci
      JOIN produtos p ON p.id = ci."produtoId"
      JOIN comandas cm ON cm.id = ci."comandaId"
     WHERE cm."unidadeId" = ${unidadeId}
       AND ci.status NOT IN ('PENDENTE', 'CANCELADO')
       AND ci."lancadoEm" >= ${intervalo.inicio}
       AND ci."lancadoEm" < ${intervalo.fim}
     GROUP BY 1
  `;

  const valorDe = (comCusto: boolean) => num(linhas.find((l) => l.com_custo === comCusto)?.valor);

  const total = centavos(valorDe(true) + valorDe(false));
  const comCusto = centavos(valorDe(true));

  return {
    total,
    comCusto,
    /** `null` quando não houve venda: 0% leria como "nada tem custo". */
    porcentagem: total > 0 ? (comCusto / total) * 100 : null,
  };
}

/** O que está em consumo agora, nas mesas abertas. Não depende do período. */
export async function totalEmAberto(unidadeId: string) {
  const { _sum } = await db.comandaItem.aggregate({
    where: {
      comanda: { unidadeId, status: { in: ["ABERTA", "FECHANDO"] } },
      ...CONSUMO,
    },
    _sum: { precoTotal: true },
  });

  return centavos(Number(_sum.precoTotal ?? 0));
}

/**
 * Os mais vendidos do período, nas duas ordens.
 *
 * As duas listas saem da **mesma** consulta, e não de duas. Reordenar em
 * JavaScript uma lista curta não serviria: os oito que mais faturam e os oito
 * que mais saem são conjuntos diferentes — o refrigerante sai muito e fatura
 * pouco, a picanha faz o contrário —, então ordenar o top 8 de um critério
 * pelo outro esconderia exatamente quem o outro critério promove.
 *
 * As duas posições vêm de `ROW_NUMBER()` e o filtro devolve quem estiver no topo
 * de qualquer um dos dois: no máximo `2 × quantos` linhas, independente do
 * tamanho do cardápio.
 *
 * O título do produto entra por `JOIN`, e não numa segunda consulta com os ids
 * que a primeira devolveu — aquele era o N+1 escondido daqui.
 */
export type ProdutoNoRanking = {
  produtoId: string;
  titulo: string;
  quantidade: number;
  faturamento: number;
};

export type RankingDeProdutos = {
  porFaturamento: ProdutoNoRanking[];
  porQuantidade: ProdutoNoRanking[];
};

export async function rankingDeProdutos(
  unidadeId: string,
  intervalo: Intervalo,
  quantos = 8
): Promise<RankingDeProdutos> {
  const linhas = await db.$queryRaw<
    {
      produtoId: string;
      titulo: string;
      quantidade: Soma;
      faturamento: Soma;
      pos_qtd: number;
      pos_fat: number;
    }[]
  >`
    WITH totais AS (
      SELECT p.id AS "produtoId",
             p.titulo,
             SUM(ci.quantidade) AS quantidade,
             SUM(ci."precoTotal") AS faturamento
        FROM comanda_itens ci
        JOIN produtos p ON p.id = ci."produtoId"
        JOIN comandas cm ON cm.id = ci."comandaId"
       WHERE cm."unidadeId" = ${unidadeId}
         AND ci.status NOT IN ('PENDENTE', 'CANCELADO')
         AND ci."lancadoEm" >= ${intervalo.inicio}
         AND ci."lancadoEm" < ${intervalo.fim}
       GROUP BY p.id, p.titulo
    ),
    posicoes AS (
      SELECT *,
             ROW_NUMBER() OVER (ORDER BY quantidade DESC, titulo)::int AS pos_qtd,
             ROW_NUMBER() OVER (ORDER BY faturamento DESC, titulo)::int AS pos_fat
        FROM totais
    )
    SELECT * FROM posicoes
     WHERE pos_qtd <= ${quantos} OR pos_fat <= ${quantos}
  `;

  const comoProduto = (l: (typeof linhas)[number]): ProdutoNoRanking => ({
    produtoId: l.produtoId,
    titulo: l.titulo,
    quantidade: num(l.quantidade),
    faturamento: centavos(num(l.faturamento)),
  });

  const naPosicao = (campo: "pos_fat" | "pos_qtd") =>
    linhas
      .filter((l) => l[campo] <= quantos)
      .sort((a, b) => a[campo] - b[campo])
      .map(comoProduto);

  return { porFaturamento: naPosicao("pos_fat"), porQuantidade: naPosicao("pos_qtd") };
}

export type CategoriaNoPainel = {
  nome: string;
  faturamento: number;
  quantidade: number;
  /** Fatia do faturamento do período, de 0 a 100. */
  fatia: number;
};

/**
 * Vendas por categoria do cardápio.
 *
 * `LEFT JOIN` de propósito: produto sem categoria aparece como "Sem categoria"
 * em vez de sumir da conta. Uma categoria faltando é justamente o tipo de coisa
 * que o dono precisa ver para ir arrumar o cadastro — some-la faria as fatias
 * somarem menos de 100% sem explicar por quê.
 *
 * A base do percentual é o total **dos itens**, que não é o faturamento dos
 * pagamentos: desconto de comanda e taxa de serviço entram num e não no outro.
 * Usar o faturamento aqui faria as fatias não fecharem em 100%.
 */
export async function vendasPorCategoria(
  unidadeId: string,
  intervalo: Intervalo
): Promise<CategoriaNoPainel[]> {
  const linhas = await db.$queryRaw<
    { nome: string; faturamento: Soma; quantidade: Soma }[]
  >`
    SELECT COALESCE(cat.nome, 'Sem categoria') AS nome,
           SUM(ci."precoTotal") AS faturamento,
           SUM(ci.quantidade) AS quantidade
      FROM comanda_itens ci
      JOIN produtos p ON p.id = ci."produtoId"
      LEFT JOIN categorias_produto cat ON cat.id = p."categoriaId"
      JOIN comandas cm ON cm.id = ci."comandaId"
     WHERE cm."unidadeId" = ${unidadeId}
       AND ci.status NOT IN ('PENDENTE', 'CANCELADO')
       AND ci."lancadoEm" >= ${intervalo.inicio}
       AND ci."lancadoEm" < ${intervalo.fim}
     GROUP BY 1
     ORDER BY 2 DESC
  `;

  const total = linhas.reduce((soma, l) => soma + num(l.faturamento), 0);

  return linhas.map((l) => {
    const faturamento = centavos(num(l.faturamento));
    return {
      nome: l.nome,
      faturamento,
      quantidade: num(l.quantidade),
      fatia: total > 0 ? (num(l.faturamento) / total) * 100 : 0,
    };
  });
}

export type DiaDoGrafico = {
  /** "2026-09-20", dia local. */
  dia: string;
  faturamento: number;
  cmv: number;
  /** Faturamento menos CMV. Negativo quando o custo do dia passou a venda. */
  lucro: number;
};

export type ResumoDeCaixa = {
  fechamentos: number;
  /** Soma de `valorInformado - valorApurado`. Negativo é dinheiro faltando. */
  divergencia: number;
  /** Fechamentos em que a divergência não foi zero. */
  fechamentosComDivergencia: number;
  sangrias: number;
  suprimentos: number;
  /** `null` quando não há caixa aberto agora. */
  caixaAberto: { data: string; turno: string; fundo: number } | null;
};

/**
 * O caixa no período, mais o retrato de agora.
 *
 * `data` e `turno` voltam como texto: `data` é uma coluna `date`, e deixá-la
 * virar `Date` no Prisma repetiria o erro de fuso que já mordeu o gráfico —
 * uma data pura não tem hora para converter, e converter mesmo assim tira um
 * dia dela.
 */
export async function resumoDeCaixa(
  unidadeId: string,
  intervalo: Intervalo
): Promise<ResumoDeCaixa> {
  const [linha] = await db.$queryRaw<
    {
      fechamentos: number;
      divergencia: Soma;
      com_divergencia: number;
      sangrias: Soma;
      suprimentos: Soma;
      aberto_data: string | null;
      aberto_turno: string | null;
      aberto_fundo: Soma;
    }[]
  >`
    WITH fechados AS (
      SELECT COUNT(*)::int AS fechamentos,
             COALESCE(SUM(divergencia), 0) AS divergencia,
             -- Testa por nulo antes de comparar com zero: um fechamento sem
             -- divergência gravada é desconhecido, não divergente, e contá-lo
             -- aqui faria o cartão acusar diferença onde ninguém conferiu nada.
             COUNT(*) FILTER (WHERE divergencia IS NOT NULL AND divergencia <> 0)::int
               AS com_divergencia
        FROM caixas
       WHERE "unidadeId" = ${unidadeId}
         AND status IN ('FECHADO', 'CONFERIDO')
         AND "fechadoEm" >= ${intervalo.inicio}
         AND "fechadoEm" < ${intervalo.fim}
    ),
    movimentos AS (
      SELECT COALESCE(SUM(m.valor) FILTER (WHERE m.tipo = 'SANGRIA'), 0) AS sangrias,
             COALESCE(SUM(m.valor) FILTER (WHERE m.tipo = 'SUPRIMENTO'), 0) AS suprimentos
        FROM movimentos_caixa m
        JOIN caixas c ON c.id = m."caixaId"
       WHERE c."unidadeId" = ${unidadeId}
         AND m."criadoEm" >= ${intervalo.inicio}
         AND m."criadoEm" < ${intervalo.fim}
    ),
    -- O caixa aberto ignora o filtro de período, como o total em aberto no
    -- salão: é um retrato do agora, e um "caixa aberto do mês passado" não quer
    -- dizer nada. O mais antigo é o que interessa, porque é o esquecido.
    aberto AS (
      SELECT to_char(data, 'YYYY-MM-DD') AS aberto_data,
             turno::text AS aberto_turno,
             "fundoCaixa" AS aberto_fundo
        FROM caixas
       WHERE "unidadeId" = ${unidadeId} AND status = 'ABERTO'
       ORDER BY data, "abertoEm"
       LIMIT 1
    )
    SELECT f.*, m.*, a.aberto_data, a.aberto_turno, a.aberto_fundo
      FROM fechados f, movimentos m
      LEFT JOIN aberto a ON true
  `;

  return {
    fechamentos: linha?.fechamentos ?? 0,
    divergencia: centavos(num(linha?.divergencia)),
    fechamentosComDivergencia: linha?.com_divergencia ?? 0,
    sangrias: centavos(num(linha?.sangrias)),
    suprimentos: centavos(num(linha?.suprimentos)),
    caixaAberto: linha?.aberto_data
      ? {
          data: linha.aberto_data,
          turno: linha.aberto_turno ?? "",
          fundo: centavos(num(linha.aberto_fundo)),
        }
      : null,
  };
}

export type Alerta = {
  chave: string;
  /** `grave` é o que custa dinheiro agora; `atencao`, o que vai custar. */
  nivel: "grave" | "atencao";
  texto: string;
  link: { href: string; rotulo: string };
};

/** Quanto tempo uma mesa pode ficar aberta antes de virar alerta. */
const HORAS_DE_MESA_ABERTA = 6;

/**
 * Os alertas operacionais — o que pede ação agora.
 *
 * Só entram os que têm número atrás. Um painel que avisa sempre deixa de ser
 * lido, e é por isso que cada alerta aqui tem um limite explícito em vez de
 * aparecer "por precaução".
 *
 * Note que isto não repete os dois avisos do resultado do período (perdas e
 * cobertura de custo). Aqueles explicam os números logo acima deles e perdem o
 * sentido longe dali; estes são tarefas, e por isso ficam no topo.
 */
export async function alertasDoPainel(
  unidadeId: string,
  intervalo: Intervalo,
  agora = new Date()
): Promise<Alerta[]> {
  const hoje = comoTexto(agora);
  const limiteDaMesa = new Date(agora.getTime() - HORAS_DE_MESA_ABERTA * 60 * 60 * 1000);

  const [linha] = await db.$queryRaw<
    {
      caixas_atrasados: number;
      caixa_mais_antigo: string | null;
      divergencia: Soma;
      estoque_negativo: number;
      estoque_baixo: number;
      mesas_paradas: number;
    }[]
  >`
    WITH caixa_atrasado AS (
      -- Caixa aberto com data anterior a hoje: ou esqueceram de fechar, ou o
      -- dinheiro do dia anterior ainda não foi conferido.
      SELECT COUNT(*)::int AS caixas_atrasados,
             to_char(MIN(data), 'DD/MM') AS caixa_mais_antigo
        FROM caixas
       WHERE "unidadeId" = ${unidadeId}
         AND status = 'ABERTO'
         AND data < ${hoje}::date
    ),
    divergencia AS (
      SELECT COALESCE(SUM(divergencia), 0) AS divergencia
        FROM caixas
       WHERE "unidadeId" = ${unidadeId}
         AND status IN ('FECHADO', 'CONFERIDO')
         AND "fechadoEm" >= ${intervalo.inicio}
         AND "fechadoEm" < ${intervalo.fim}
    ),
    estoque AS (
      SELECT COUNT(*) FILTER (WHERE s.quantidade < 0)::int AS estoque_negativo,
             COUNT(*) FILTER (
               WHERE p."estoqueMinimo" IS NOT NULL
                 AND s.quantidade >= 0
                 AND s.quantidade < p."estoqueMinimo"
             )::int AS estoque_baixo
        FROM estoque_saldos s
        JOIN produtos p ON p.id = s."produtoId"
       WHERE s."unidadeId" = ${unidadeId}
    ),
    mesas AS (
      SELECT COUNT(*)::int AS mesas_paradas
        FROM comandas
       WHERE "unidadeId" = ${unidadeId}
         AND status IN ('ABERTA', 'FECHANDO')
         AND "abertaEm" < ${limiteDaMesa}
    )
    SELECT * FROM caixa_atrasado, divergencia, estoque, mesas
  `;

  const alertas: Alerta[] = [];
  if (!linha) return alertas;

  if (linha.caixas_atrasados > 0) {
    alertas.push({
      chave: "caixa-atrasado",
      nivel: "grave",
      texto:
        linha.caixas_atrasados === 1
          ? `O caixa de ${linha.caixa_mais_antigo} continua aberto.`
          : `${linha.caixas_atrasados} caixas de dias anteriores continuam abertos, o mais antigo de ${linha.caixa_mais_antigo}.`,
      link: { href: "/pdv/caixa", rotulo: "conferir o caixa" },
    });
  }

  const divergencia = centavos(num(linha.divergencia));
  // Um centavo de diferença é arredondamento, não problema. O limite existe
  // para o alerta não tocar todo dia e virar paisagem.
  if (Math.abs(divergencia) >= 1) {
    alertas.push({
      chave: "divergencia",
      nivel: divergencia < 0 ? "grave" : "atencao",
      texto:
        divergencia < 0
          ? `Faltaram ${dinheiro(-divergencia)} nos fechamentos de caixa do período.`
          : `Sobraram ${dinheiro(divergencia)} nos fechamentos de caixa do período.`,
      link: { href: "/gestao/auditoria", rotulo: "ver o diário" },
    });
  }

  if (linha.estoque_negativo > 0) {
    alertas.push({
      chave: "estoque-negativo",
      nivel: "grave",
      texto: `${linha.estoque_negativo} item(ns) com saldo negativo no estoque — o custo do que sai deles entra errado no CMV.`,
      link: { href: "/gestao/estoque", rotulo: "ajustar o estoque" },
    });
  }

  if (linha.estoque_baixo > 0) {
    alertas.push({
      chave: "estoque-baixo",
      nivel: "atencao",
      texto: `${linha.estoque_baixo} item(ns) abaixo do estoque mínimo.`,
      link: { href: "/gestao/estoque", rotulo: "ver o estoque" },
    });
  }

  if (linha.mesas_paradas > 0) {
    alertas.push({
      chave: "mesa-parada",
      nivel: "atencao",
      texto: `${linha.mesas_paradas} mesa(s) aberta(s) há mais de ${HORAS_DE_MESA_ABERTA} horas.`,
      link: { href: "/pdv", rotulo: "ver o salão" },
    });
  }

  return alertas;
}

/** Só para o texto dos alertas, onde não há componente para formatar. */
function dinheiro(valor: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(valor);
}

export type FormaNoPainel = {
  nome: string;
  tipo: string;
  /** Quantos pagamentos, não quantas comandas: uma conta dividida gera vários. */
  pagamentos: number;
  valor: number;
  /** Fatia do recebido no período, de 0 a 100. */
  fatia: number;
  /** A taxa cadastrada hoje na forma, em porcentagem. */
  taxaPct: number;
  /** `valor × taxaPct`. Estimativa, não o que a adquirente cobrou de fato. */
  custoDaTaxa: number;
};

/**
 * O que entrou por forma de pagamento.
 *
 * Soma `valor - troco` como o resto do painel: troco é dinheiro que voltou para
 * a mão do cliente, e contá-lo inflaria justamente a fatia do dinheiro.
 *
 * O custo da taxa é **estimativa**, e a tela precisa dizer isso. A taxa vem do
 * cadastro de hoje, não da que valia no dia do pagamento — se ele renegociar
 * com a adquirente, o custo do mês passado muda retroativamente nesta conta.
 * Guardar a taxa aplicada dentro de cada pagamento resolveria, e é uma mudança
 * de estrutura que não cabe neste passo.
 */
export async function formasDePagamento(
  unidadeId: string,
  intervalo: Intervalo
): Promise<FormaNoPainel[]> {
  const linhas = await db.$queryRaw<
    { nome: string; tipo: string; taxa: Soma; pagamentos: number; valor: Soma }[]
  >`
    SELECT fp.nome,
           fp.tipo::text AS tipo,
           fp."taxaPct" AS taxa,
           COUNT(*)::int AS pagamentos,
           SUM(p.valor - p.troco) AS valor
      FROM pagamentos p
      JOIN comandas cm ON cm.id = p."comandaId"
      JOIN formas_pagamento fp ON fp.id = p."formaPagamentoId"
     WHERE cm."unidadeId" = ${unidadeId}
       AND p."criadoEm" >= ${intervalo.inicio}
       AND p."criadoEm" < ${intervalo.fim}
     GROUP BY fp.nome, fp.tipo, fp."taxaPct"
     ORDER BY 5 DESC
  `;

  const total = linhas.reduce((soma, l) => soma + num(l.valor), 0);

  return linhas.map((l) => {
    const valor = centavos(num(l.valor));
    const taxaPct = num(l.taxa);
    return {
      nome: l.nome,
      tipo: l.tipo,
      pagamentos: l.pagamentos,
      valor,
      fatia: total > 0 ? (num(l.valor) / total) * 100 : 0,
      taxaPct,
      custoDaTaxa: centavos((valor * taxaPct) / 100),
    };
  });
}

/**
 * Faturamento e lucro por dia, agrupados pelo banco.
 *
 * O dia volta como **texto** já no fuso local. A alternativa — receber o
 * `date_trunc` como `Date` e ler `getDate()` — erra por um dia: o Prisma monta o
 * `Date` a partir do relógio UTC, e os getters locais então caem no dia
 * anterior. Agrupar em JavaScript exigiria trazer todos os pagamentos do período
 * só para contá-los.
 *
 * Receita e custo vêm de tabelas diferentes e são juntados por `FULL OUTER JOIN`
 * no próprio banco: um dia pode ter baixa de estoque sem pagamento (comanda que
 * virou o dia) ou pagamento sem baixa (produto sem ficha técnica), e um `JOIN`
 * comum perderia justamente esses.
 */
export async function faturamentoELucroPorDia(
  unidadeId: string,
  intervalo: Intervalo
): Promise<DiaDoGrafico[]> {
  const linhas = await db.$queryRaw<
    { dia: string; faturamento: Soma; saida: Soma; devolvido: Soma }[]
  >`
    WITH receita AS (
      SELECT to_char(
               date_trunc('day', p."criadoEm" AT TIME ZONE 'UTC' AT TIME ZONE ${FUSO_LOCAL}),
               'YYYY-MM-DD'
             ) AS dia,
             SUM(p.valor - p.troco) AS valor
        FROM pagamentos p
        JOIN comandas c ON c.id = p."comandaId"
       WHERE c."unidadeId" = ${unidadeId}
         AND p."criadoEm" >= ${intervalo.inicio}
         AND p."criadoEm" < ${intervalo.fim}
       GROUP BY 1
    ),
    custo AS (
      SELECT to_char(
               date_trunc('day', m."criadoEm" AT TIME ZONE 'UTC' AT TIME ZONE ${FUSO_LOCAL}),
               'YYYY-MM-DD'
             ) AS dia,
             COALESCE(SUM(ABS(m.quantidade) * m."custoUnitario")
               FILTER (WHERE m.tipo = 'SAIDA_VENDA'), 0) AS saida,
             COALESCE(SUM(ABS(m.quantidade) * m."custoUnitario")
               FILTER (WHERE m.tipo = 'DEVOLUCAO'), 0) AS devolvido
        FROM movimentos_estoque m
       WHERE m."unidadeId" = ${unidadeId}
         AND m.tipo IN ('SAIDA_VENDA', 'DEVOLUCAO')
         AND m."criadoEm" >= ${intervalo.inicio}
         AND m."criadoEm" < ${intervalo.fim}
       GROUP BY 1
    )
    SELECT COALESCE(r.dia, c.dia) AS dia,
           COALESCE(r.valor, 0) AS faturamento,
           COALESCE(c.saida, 0) AS saida,
           COALESCE(c.devolvido, 0) AS devolvido
      FROM receita r
      FULL OUTER JOIN custo c ON c.dia = r.dia
  `;

  const porDia = new Map<string, DiaDoGrafico>();
  for (const l of linhas) {
    const faturamento = centavos(num(l.faturamento));
    /**
     * O piso de zero é por dia, e não só no total do período.
     *
     * Uma devolução lançada no dia seguinte ao da venda deixaria o CMV daquele
     * dia negativo, e o gráfico desenharia um custo "para baixo". Por isso a
     * soma destas barras pode ficar alguns centavos acima do CMV do período,
     * que aplica o mesmo piso uma vez só — é o preço de cada barra ser legível
     * sozinha.
     */
    const cmv = centavos(Math.max(0, num(l.saida) - num(l.devolvido)));
    porDia.set(l.dia, { dia: l.dia, faturamento, cmv, lucro: centavos(faturamento - cmv) });
  }

  // Dia sem venda precisa aparecer como zero: um gráfico que pula o domingo sem
  // movimento esconde justamente o dia que o dono quer entender.
  const serie: DiaDoGrafico[] = [];
  for (let d = new Date(intervalo.inicio); d < intervalo.fim; d.setDate(d.getDate() + 1)) {
    const dia = chaveDoDia(d);
    serie.push(porDia.get(dia) ?? { dia, faturamento: 0, cmv: 0, lucro: 0 });
  }

  return serie;
}

function chaveDoDia(data: Date) {
  const doisDigitos = (n: number) => String(n).padStart(2, "0");
  return `${data.getFullYear()}-${doisDigitos(data.getMonth() + 1)}-${doisDigitos(data.getDate())}`;
}
