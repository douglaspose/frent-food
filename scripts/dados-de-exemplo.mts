/**
 * Duas semanas de movimento de exemplo, para o painel ter o que desenhar.
 *
 * Diferente do `volume-de-teste.mts`, que enche o banco de teste com linhas
 * quaisquer para medir o custo do RLS: aqui os números precisam **fazer
 * sentido juntos**. Faturamento, CMV, categorias, formas de pagamento e caixa
 * saem da mesma venda, senão o painel mostra cartões que se contradizem e
 * ninguém sabe se o erro é do dado ou da conta.
 *
 * O que ele apaga (e só isso):
 *   - todos os caixas, e por cascata os movimentos de caixa;
 *   - as comandas já encerradas (PAGA e CANCELADA) com seus itens e pagamentos;
 *   - os movimentos de estoque ligados a venda (SAIDA_VENDA, DEVOLUCAO, PERDA).
 *
 * O que ele **não** toca: mesas abertas e fechando — as comandas vivas do
 * salão continuam de pé, e com elas o cartão "Em aberto no salão". Também não
 * mexe em cardápio, produtos que já tenham ficha técnica, usuários nem mesas.
 *
 * Uso: npx tsx --env-file=.env scripts/dados-de-exemplo.mts --confirmar
 */
import pg from "pg";

const DIAS = 14;

/**
 * Quanto do preço é custo, por categoria.
 *
 * Só entra em produto que ainda não tem ficha técnica. São proporções típicas
 * de bar e espetinho — bebida tem margem menor que porção —, e existem porque
 * sem custo nenhum o gráfico de lucro vira uma barra chapada e a margem bruta
 * mostra 93%, que é bonito e mentira.
 */
const CUSTO_POR_CATEGORIA: Record<string, number> = {
  Bebidas: 0.45,
  Espetos: 0.38,
  Carnes: 0.42,
  Porções: 0.3,
  Sobremesas: 0.28,
};
const CUSTO_PADRAO = 0.35;

/** Comandas por dia da semana. Domingo é 0. Sexta e sábado puxam a semana. */
const COMANDAS_POR_DIA = [22, 11, 12, 14, 17, 28, 34];

/**
 * Com que frequência cada categoria cai na comanda.
 *
 * Sortear produto por igual dava ticket médio de R$ 231 — a Picanha de R$ 129,90
 * saía tanto quanto um espeto de R$ 13,10, e a casa virava uma churrascaria. O
 * peso aqui é o que se vê na mesa de uma jantinha: espeto e bebida o tempo todo,
 * porção para dividir, carne de vez em quando.
 *
 * Categoria que não existir no cardápio é simplesmente ignorada.
 */
const PESO_DA_CATEGORIA: Record<string, number> = {
  Espetos: 45,
  Bebidas: 32,
  Porções: 13,
  Sobremesas: 6,
  Carnes: 4,
};

/** Quantos de cada, por categoria: espeto vai de quatro, picanha vai de uma. */
const QUANTIDADE_POR_CATEGORIA: Record<string, [number, number]> = {
  Espetos: [1, 4],
  Bebidas: [1, 2],
};
const QUANTIDADE_PADRAO: [number, number] = [1, 1];

/** A casa serve das 18h às 23h; a última comanda fecha depois da meia-noite. */
const ABERTURA = 18;
const FECHAMENTO = 23;

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Defina DATABASE_URL. Rode com: npx tsx --env-file=.env scripts/dados-de-exemplo.mts --confirmar");
  process.exit(1);
}

if (!process.argv.includes("--confirmar")) {
  console.error(
    "Este script apaga caixas, comandas encerradas e movimentos de venda.\n" +
      "Rode de novo com --confirmar se é isso mesmo que você quer."
  );
  process.exit(1);
}

/**
 * Sorteio com semente fixa.
 *
 * `Math.random()` daria um banco diferente a cada execução, e comparar "antes e
 * depois" de uma mudança no painel viraria adivinhação.
 */
function sorteador(semente: number) {
  let s = semente >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const aleatorio = sorteador(20260920);

const entre = (min: number, max: number) => min + Math.floor(aleatorio() * (max - min + 1));
const umDe = <T,>(lista: T[]) => lista[Math.floor(aleatorio() * lista.length)]!;
const centavos = (n: number) => Math.round(n * 100) / 100;

let contador = 0;
/** Id curto e único. As colunas são texto; não precisa ser cuid de verdade. */
const novoId = (prefixo: string) => `ex${prefixo}${(contador++).toString(36)}${Date.now().toString(36)}`;

/**
 * Data para o banco, no relógio **UTC**.
 *
 * As colunas são `timestamp without time zone` e guardam UTC — é o que o Prisma
 * grava e o que ele relê. Escrever o relógio local aqui deslocaria tudo em três
 * horas, e o gráfico por dia jogaria a noite inteira para o dia seguinte.
 */
function paraBanco(d: Date) {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

/** "2026-09-20", o dia local — para a coluna `date` do caixa. */
function diaLocal(d: Date) {
  const doisDigitos = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${doisDigitos(d.getMonth() + 1)}-${doisDigitos(d.getDate())}`;
}

const db = new pg.Client({ connectionString: url });
await db.connect();

type Linha = Record<string, unknown>;

/** Insere em lote, em blocos, para não estourar o limite de parâmetros. */
async function inserir(tabela: string, colunas: string[], linhas: Linha[]) {
  const POR_BLOCO = Math.max(1, Math.floor(60000 / colunas.length));
  for (let i = 0; i < linhas.length; i += POR_BLOCO) {
    const bloco = linhas.slice(i, i + POR_BLOCO);
    const valores: unknown[] = [];
    const grupos = bloco.map((linha) => {
      const marcas = colunas.map((col) => {
        valores.push(linha[col]);
        return `$${valores.length}`;
      });
      return `(${marcas.join(", ")})`;
    });
    await db.query(
      `INSERT INTO ${tabela} (${colunas.map((c) => `"${c}"`).join(", ")}) VALUES ${grupos.join(", ")}`,
      valores
    );
  }
}

// ---------------------------------------------------------------- referências

const { rows: contexto } = await db.query<{ tenant: string; unidade: string }>(
  `SELECT t.id AS tenant, u.id AS unidade
     FROM unidades u JOIN tenants t ON t.id = u."tenantId"
    ORDER BY u."criadoEm" LIMIT 1`
);
const ctx = contexto[0];
if (!ctx) {
  console.error("Não há unidade no banco. Rode o seed antes.");
  process.exit(1);
}

const { rows: usuarios } = await db.query<{ id: string }>(
  `SELECT id FROM usuarios WHERE "tenantId" = $1 AND ativo`,
  [ctx.tenant]
);
const { rows: mesas } = await db.query<{ id: string }>(
  `SELECT id FROM mesas WHERE "unidadeId" = $1`,
  [ctx.unidade]
);
const { rows: formas } = await db.query<{ id: string; tipo: string }>(
  `SELECT id, tipo::text FROM formas_pagamento WHERE "tenantId" = $1 AND ativo`,
  [ctx.tenant]
);

/**
 * O catálogo vendável, com preço do cardápio.
 *
 * `temFicha` separa quem já tem custo de verdade: nesses o script não encosta,
 * porque a ficha técnica é cadastro do dono e a baixa deles consome insumo, não
 * o próprio produto.
 */
const { rows: catalogo } = await db.query<{
  id: string;
  titulo: string;
  categoria: string | null;
  preco: string;
  item: string;
  tem_ficha: boolean;
  controla: boolean;
}>(
  `SELECT p.id, p.titulo, cat.nome AS categoria, ci.preco, ci.id AS item,
          EXISTS (SELECT 1 FROM composicoes co WHERE co."produtoId" = p.id) AS tem_ficha,
          p."controlaEstoque" AS controla
     FROM produtos p
     JOIN cardapio_itens ci ON ci."produtoId" = p.id
     LEFT JOIN categorias_produto cat ON cat.id = p."categoriaId"
    WHERE p."tenantId" = $1 AND p.tipo = 'VENDA' AND p.ativo AND ci.visivel
    ORDER BY p.titulo`,
  [ctx.tenant]
);

if (mesas.length === 0 || formas.length === 0 || catalogo.length === 0) {
  console.error("Faltam mesas, formas de pagamento ou cardápio. Rode o seed antes.");
  process.exit(1);
}

console.log(
  `Base: ${catalogo.length} itens de cardápio, ${mesas.length} mesas, ${formas.length} formas de pagamento.`
);

// -------------------------------------------------------------------- limpeza

await db.query("BEGIN");

const apagados = {
  caixas: (await db.query(`DELETE FROM caixas WHERE "unidadeId" = $1`, [ctx.unidade])).rowCount ?? 0,
  comandas:
    (
      await db.query(
        `DELETE FROM comandas WHERE "unidadeId" = $1 AND status IN ('PAGA', 'CANCELADA')`,
        [ctx.unidade]
      )
    ).rowCount ?? 0,
  movimentos:
    (
      await db.query(
        `DELETE FROM movimentos_estoque
          WHERE "unidadeId" = $1
            AND (tipo IN ('SAIDA_VENDA', 'DEVOLUCAO', 'PERDA')
                 OR motivo = 'Compra de exemplo')`,
        [ctx.unidade]
      )
    ).rowCount ?? 0,
};

console.log(
  `Apagados: ${apagados.caixas} caixas, ${apagados.comandas} comandas encerradas, ${apagados.movimentos} movimentos de venda.`
);

// -------------------------------------------------- base de custo por produto

/**
 * Sem custo não há lucro para desenhar.
 *
 * Em vez de inventar um custo solto dentro do movimento de venda — que faria o
 * CMV subir enquanto o alerta de cobertura continuasse dizendo que quase nada
 * tem custo —, o script monta a base do jeito que o sistema espera: liga o
 * controle de estoque, lança uma ENTRADA com custo e deixa o saldo de pé. Aí
 * CMV, margem e cobertura contam a mesma história.
 */
const custoDe = new Map<string, number>();
const entradas: Linha[] = [];
const saldos: Linha[] = [];
const inicio = new Date();
inicio.setHours(0, 0, 0, 0);
inicio.setDate(inicio.getDate() - (DIAS - 1));

const compradoEm = new Date(inicio);
compradoEm.setHours(8, 0, 0, 0);

for (const produto of catalogo) {
  if (produto.tem_ficha) continue;

  const preco = Number(produto.preco);
  const proporcao = CUSTO_POR_CATEGORIA[produto.categoria ?? ""] ?? CUSTO_PADRAO;
  // Um empurrãozinho aleatório para as margens não saírem todas idênticas.
  const custo = centavos(preco * proporcao * (0.9 + aleatorio() * 0.2));
  custoDe.set(produto.id, custo);

  // Estoque para as duas semanas com folga, para o saldo não fechar negativo e
  // disparar o alerta de estoque por culpa dos dados de exemplo.
  const quantidade = 400;

  entradas.push({
    id: novoId("mv"),
    tenantId: ctx.tenant,
    unidadeId: ctx.unidade,
    produtoId: produto.id,
    tipo: "ENTRADA",
    quantidade,
    custoUnitario: custo,
    saldoDepois: quantidade,
    motivo: "Compra de exemplo",
    criadoEm: paraBanco(compradoEm),
  });

  saldos.push({
    id: novoId("sl"),
    tenantId: ctx.tenant,
    unidadeId: ctx.unidade,
    produtoId: produto.id,
    quantidade,
    custoMedio: custo,
    atualizadoEm: paraBanco(compradoEm),
  });
}

await db.query(
  `UPDATE produtos SET "controlaEstoque" = true, "estoqueMinimo" = 30
    WHERE "tenantId" = $1 AND tipo = 'VENDA' AND ativo
      AND NOT EXISTS (SELECT 1 FROM composicoes co WHERE co."produtoId" = produtos.id)`,
  [ctx.tenant]
);

await inserir(
  "movimentos_estoque",
  ["id", "tenantId", "unidadeId", "produtoId", "tipo", "quantidade", "custoUnitario", "saldoDepois", "motivo", "criadoEm"],
  entradas
);

/**
 * `ON CONFLICT` porque `(unidadeId, produtoId)` é único e alguns produtos já
 * têm saldo de antes. Quem já tinha custo cadastrado fica como está — é dado do
 * dono, não do exemplo.
 */
for (const saldo of saldos) {
  await db.query(
    `INSERT INTO estoque_saldos ("id", "tenantId", "unidadeId", "produtoId", "quantidade", "custoMedio", "atualizadoEm")
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT ("unidadeId", "produtoId") DO UPDATE
        SET quantidade = EXCLUDED.quantidade,
            "custoMedio" = CASE WHEN estoque_saldos."custoMedio" > 0
                                THEN estoque_saldos."custoMedio"
                                ELSE EXCLUDED."custoMedio" END,
            "atualizadoEm" = EXCLUDED."atualizadoEm"`,
    [saldo.id, saldo.tenantId, saldo.unidadeId, saldo.produtoId, saldo.quantidade, saldo.custoMedio, saldo.atualizadoEm]
  );
}

console.log(`Base de custo: ${custoDe.size} produtos com ENTRADA e saldo de exemplo.`);

// ------------------------------------------------------------------- movimento

const { rows: ultimo } = await db.query<{ n: number }>(
  `SELECT COALESCE(MAX(numero), 0)::int AS n FROM comandas WHERE "unidadeId" = $1`,
  [ctx.unidade]
);
let numero = (ultimo[0]?.n ?? 0) + 1;

const caixas: Linha[] = [];
const comandas: Linha[] = [];
const itens: Linha[] = [];
const pagamentos: Linha[] = [];
const saidas: Linha[] = [];
const movimentosDeCaixa: Linha[] = [];

const agora = new Date();

/**
 * A ficha técnica de quem tem uma, com o custo do insumo.
 *
 * Produto com ficha não dá baixa de si mesmo: consome os insumos, e é deles que
 * vem o custo. Excluí-lo do cardápio de exemplo seria mais simples e estaria
 * errado — ele some das vendas e o dono estranha a falta.
 */
const { rows: fichas } = await db.query<{
  produtoId: string;
  insumoId: string;
  quantidade: string;
  custo: string | null;
}>(
  `SELECT co."produtoId", co."insumoId", co.quantidade, s."custoMedio" AS custo
     FROM composicoes co
     LEFT JOIN estoque_saldos s ON s."produtoId" = co."insumoId" AND s."unidadeId" = $1`,
  [ctx.unidade]
);

const fichaDe = new Map<string, { insumoId: string; quantidade: number; custo: number }[]>();
for (const f of fichas) {
  const lista = fichaDe.get(f.produtoId) ?? [];
  lista.push({
    insumoId: f.insumoId,
    quantidade: Number(f.quantidade),
    custo: Number(f.custo ?? 0),
  });
  fichaDe.set(f.produtoId, lista);
}

const vendaveis = catalogo;

/**
 * Sorteio de produto com peso por categoria.
 *
 * Monta a roleta uma vez, e não a cada item: são mil e poucos itens gerados, e
 * refazer a soma dos pesos em cada um seria trabalho à toa.
 */
const porCategoria = new Map<string, typeof catalogo>();
for (const p of vendaveis) {
  const chave = p.categoria ?? "Sem categoria";
  porCategoria.set(chave, [...(porCategoria.get(chave) ?? []), p]);
}

const roleta = [...porCategoria.entries()].map(([categoria, produtos]) => ({
  categoria,
  produtos,
  // Categoria fora da tabela entra com peso pequeno, em vez de sumir.
  peso: PESO_DA_CATEGORIA[categoria] ?? 5,
}));
const pesoTotal = roleta.reduce((soma, r) => soma + r.peso, 0);

function sortearProduto() {
  let ponto = aleatorio() * pesoTotal;
  for (const faixa of roleta) {
    ponto -= faixa.peso;
    if (ponto <= 0) return faixa;
  }
  return roleta[roleta.length - 1]!;
}

for (let d = 0; d < DIAS; d++) {
  const dia = new Date(inicio);
  dia.setDate(dia.getDate() + d);

  const ehHoje = diaLocal(dia) === diaLocal(agora);
  const caixaId = novoId("cx");
  const abertoEm = new Date(dia);
  abertoEm.setHours(ABERTURA - 1, 30, 0, 0);

  let dinheiroNoCaixa = 0;
  let recebidoNoDia = 0;
  // Contadas as que entraram, não as sorteadas: hoje descarta as que fechariam
  // depois de agora, e o log mentiria sobre o que foi gravado.
  let comandasDoDia = 0;

  const quantasComandas = Math.max(
    1,
    Math.round(COMANDAS_POR_DIA[dia.getDay()]! * (0.85 + aleatorio() * 0.3))
  );

  for (let i = 0; i < quantasComandas; i++) {
    const abertura = new Date(dia);
    abertura.setHours(entre(ABERTURA, FECHAMENTO), entre(0, 59), entre(0, 59), 0);

    const duracao = entre(35, 95);
    const fechamento = new Date(abertura.getTime() + duracao * 60 * 1000);

    // O dia de hoje só teve o movimento que já aconteceu: uma comanda fechando
    // às 23h de hoje seria uma venda do futuro no relatório de amanhã.
    if (ehHoje && fechamento > agora) continue;

    comandasDoDia++;
    const comandaId = novoId("cm");
    const garcom = umDe(usuarios).id;
    const quantosItens = entre(2, 5);

    let total = 0;
    for (let j = 0; j < quantosItens; j++) {
      const faixa = sortearProduto();
      const produto = umDe(faixa.produtos);
      const [min, max] = QUANTIDADE_POR_CATEGORIA[faixa.categoria] ?? QUANTIDADE_PADRAO;
      const quantidade = entre(min, max);
      const preco = Number(produto.preco);
      const precoTotal = centavos(preco * quantidade);
      total += precoTotal;

      const lancadoEm = new Date(abertura.getTime() + entre(1, duracao - 5) * 60 * 1000);

      itens.push({
        id: novoId("it"),
        tenantId: ctx.tenant,
        comandaId,
        produtoId: produto.id,
        cardapioItemId: produto.item,
        quantidade,
        precoUnitario: preco,
        precoTotal,
        status: "ENTREGUE",
        lancadoPorId: garcom,
        lancadoEm: paraBanco(lancadoEm),
      });

      /**
       * A baixa segue a regra do sistema: quem tem ficha consome o insumo,
       * quem não tem consome a si mesmo. Saída é negativa, como o resto do
       * sistema grava.
       */
      const baixa = (produtoId: string, qtd: number, custo: number) =>
        saidas.push({
          id: novoId("mv"),
          tenantId: ctx.tenant,
          unidadeId: ctx.unidade,
          produtoId,
          tipo: "SAIDA_VENDA",
          quantidade: -qtd,
          custoUnitario: custo,
          saldoDepois: 0,
          motivo: "Venda",
          referenciaId: comandaId,
          usuarioId: garcom,
          criadoEm: paraBanco(lancadoEm),
        });

      const ficha = fichaDe.get(produto.id);
      if (ficha) {
        for (const parte of ficha) baixa(parte.insumoId, parte.quantidade * quantidade, parte.custo);
      } else {
        const custo = custoDe.get(produto.id);
        if (custo !== undefined) baixa(produto.id, quantidade, custo);
      }
    }

    total = centavos(total);

    comandas.push({
      id: comandaId,
      tenantId: ctx.tenant,
      unidadeId: ctx.unidade,
      numero: numero++,
      origem: "MESA",
      status: "PAGA",
      mesaId: umDe(mesas).id,
      pessoas: entre(1, 5),
      abertaPorId: garcom,
      abertaEm: paraBanco(abertura),
      fechadaEm: paraBanco(fechamento),
      caixaId,
    });

    /**
     * Uma conta em cada dez sai dividida em duas formas. Sem isso o cartão de
     * formas de pagamento fica certinho demais, e o número de pagamentos bate
     * exatamente com o de comandas — o que não acontece em bar nenhum.
     */
    const partes = aleatorio() < 0.1 ? 2 : 1;
    let restante = total;

    for (let parte = 0; parte < partes; parte++) {
      const forma = umDe(formas);
      const valorBase = parte === partes - 1 ? restante : centavos(total / partes);
      restante = centavos(restante - valorBase);

      // Em dinheiro o cliente paga redondo e leva troco. Troco não é
      // faturamento, e é justamente o que o painel desconta.
      const redondo = forma.tipo === "DINHEIRO" && aleatorio() < 0.7;
      const valor = redondo ? Math.ceil(valorBase / 10) * 10 : valorBase;
      const troco = centavos(valor - valorBase);

      if (forma.tipo === "DINHEIRO") dinheiroNoCaixa += valorBase;
      recebidoNoDia += valorBase;

      pagamentos.push({
        id: novoId("pg"),
        tenantId: ctx.tenant,
        comandaId,
        caixaId,
        formaPagamentoId: forma.id,
        valor,
        troco,
        usuarioId: umDe(usuarios).id,
        criadoEm: paraBanco(fechamento),
      });
    }
  }

  const fundo = 200;

  // Sangria nas noites cheias: o caixa não fica com mil reais em espécie.
  let sangrado = 0;
  if (dinheiroNoCaixa > 400) {
    sangrado = Math.floor(dinheiroNoCaixa / 2 / 50) * 50;
    const sangradoEm = new Date(dia);
    sangradoEm.setHours(FECHAMENTO, 10, 0, 0);
    movimentosDeCaixa.push({
      id: novoId("mc"),
      tenantId: ctx.tenant,
      caixaId,
      tipo: "SANGRIA",
      valor: sangrado,
      descricao: "Sangria de exemplo",
      usuarioId: umDe(usuarios).id,
      criadoEm: paraBanco(sangradoEm),
    });
  }

  const apurado = centavos(fundo + dinheiroNoCaixa - sangrado);

  /**
   * O caixa de hoje fica aberto, como estaria de verdade a esta hora; os
   * anteriores fecham. Uma diferença pequena aparece em parte das noites — é o
   * que dá o que conferir no cartão de caixa e no alerta de divergência.
   */
  const fechado = !ehHoje;
  const diferenca = fechado && aleatorio() < 0.35 ? centavos((aleatorio() * 12 - 7) * 1) : 0;
  const fechadoEm = new Date(dia);
  fechadoEm.setHours(FECHAMENTO + 1, entre(0, 45), 0, 0);

  caixas.push({
    id: caixaId,
    tenantId: ctx.tenant,
    unidadeId: ctx.unidade,
    tipo: "GERAL",
    data: diaLocal(dia),
    turno: "NOITE",
    status: fechado ? "FECHADO" : "ABERTO",
    fundoCaixa: fundo,
    valorInformado: fechado ? centavos(apurado + diferenca) : null,
    valorApurado: fechado ? apurado : null,
    divergencia: fechado ? diferenca : null,
    abertoPorId: umDe(usuarios).id,
    abertoEm: paraBanco(abertoEm),
    fechadoPorId: fechado ? umDe(usuarios).id : null,
    fechadoEm: fechado ? paraBanco(fechadoEm) : null,
  });

  console.log(
    `  ${diaLocal(dia)} · ${comandasDoDia} comandas · R$ ${recebidoNoDia.toFixed(2)}${fechado ? "" : " · caixa aberto"}`
  );
}

/**
 * Entrada para os insumos que as fichas técnicas consomem.
 *
 * Só dá para calcular aqui, depois de saber quanto foi vendido. Sem isto o
 * insumo fecha negativo — foi o que aconteceu na primeira rodada, e o painel
 * passou a acusar "1 item com saldo negativo" por culpa dos dados de exemplo, e
 * não de um problema de verdade.
 */
const consumoDeInsumo = new Map<string, number>();
for (const saida of saidas) {
  const produtoId = saida.produtoId as string;
  if (custoDe.has(produtoId)) continue;
  consumoDeInsumo.set(produtoId, (consumoDeInsumo.get(produtoId) ?? 0) + Math.abs(Number(saida.quantidade)));
}

const custoDoInsumo = new Map<string, number>();
for (const partes of fichaDe.values()) {
  for (const parte of partes) custoDoInsumo.set(parte.insumoId, parte.custo);
}

const entradasDeInsumo: Linha[] = [];
for (const [insumoId, consumido] of consumoDeInsumo) {
  // Compra com 40% de folga sobre o que saiu: sobra estoque no fim das duas
  // semanas, como sobraria numa casa que se planeja.
  const quantidade = Math.ceil(consumido * 1.4);
  const custo = custoDoInsumo.get(insumoId) ?? 0;

  entradasDeInsumo.push({
    id: novoId("mv"),
    tenantId: ctx.tenant,
    unidadeId: ctx.unidade,
    produtoId: insumoId,
    tipo: "ENTRADA",
    quantidade,
    custoUnitario: custo,
    saldoDepois: quantidade,
    motivo: "Compra de exemplo",
    criadoEm: paraBanco(compradoEm),
  });

  await db.query(
    `INSERT INTO estoque_saldos ("id", "tenantId", "unidadeId", "produtoId", "quantidade", "custoMedio", "atualizadoEm")
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT ("unidadeId", "produtoId") DO UPDATE
        SET quantidade = EXCLUDED.quantidade,
            "custoMedio" = CASE WHEN estoque_saldos."custoMedio" > 0
                                THEN estoque_saldos."custoMedio"
                                ELSE EXCLUDED."custoMedio" END,
            "atualizadoEm" = EXCLUDED."atualizadoEm"`,
    [novoId("sl"), ctx.tenant, ctx.unidade, insumoId, quantidade, custo, paraBanco(compradoEm)]
  );
}

await inserir(
  "movimentos_estoque",
  ["id", "tenantId", "unidadeId", "produtoId", "tipo", "quantidade", "custoUnitario", "saldoDepois", "motivo", "criadoEm"],
  entradasDeInsumo
);

// A ordem importa: o caixa precisa existir antes da comanda que aponta para ele.
await inserir(
  "caixas",
  ["id", "tenantId", "unidadeId", "tipo", "data", "turno", "status", "fundoCaixa", "valorInformado", "valorApurado", "divergencia", "abertoPorId", "abertoEm", "fechadoPorId", "fechadoEm"],
  caixas
);
await inserir(
  "comandas",
  ["id", "tenantId", "unidadeId", "numero", "origem", "status", "mesaId", "pessoas", "abertaPorId", "abertaEm", "fechadaEm", "caixaId"],
  comandas
);
await inserir(
  "comanda_itens",
  ["id", "tenantId", "comandaId", "produtoId", "cardapioItemId", "quantidade", "precoUnitario", "precoTotal", "status", "lancadoPorId", "lancadoEm"],
  itens
);
await inserir(
  "pagamentos",
  ["id", "tenantId", "comandaId", "caixaId", "formaPagamentoId", "valor", "troco", "usuarioId", "criadoEm"],
  pagamentos
);
await inserir(
  "movimentos_estoque",
  ["id", "tenantId", "unidadeId", "produtoId", "tipo", "quantidade", "custoUnitario", "saldoDepois", "motivo", "referenciaId", "usuarioId", "criadoEm"],
  saidas
);
await inserir(
  "movimentos_caixa",
  ["id", "tenantId", "caixaId", "tipo", "valor", "descricao", "usuarioId", "criadoEm"],
  movimentosDeCaixa
);

// O saldo desce pelo que saiu, senão a tela de estoque mostraria 400 de tudo
// depois de duas semanas de venda.
await db.query(
  `UPDATE estoque_saldos s
      SET quantidade = s.quantidade - vendido.total
     FROM (
       SELECT "produtoId", SUM(ABS(quantidade)) AS total
         FROM movimentos_estoque
        WHERE "unidadeId" = $1 AND tipo = 'SAIDA_VENDA'
        GROUP BY "produtoId"
     ) AS vendido
    WHERE s."produtoId" = vendido."produtoId" AND s."unidadeId" = $1`,
  [ctx.unidade]
);

await db.query("COMMIT");

console.log(
  `\nCriados: ${caixas.length} caixas, ${comandas.length} comandas, ${itens.length} itens, ` +
    `${pagamentos.length} pagamentos, ${saidas.length} saídas de estoque.`
);

await db.end();
