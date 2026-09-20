/**
 * Enche o banco de teste com duas semanas de movimento.
 *
 * Existe por causa da medição do RLS. Medir em tabelas vazias mede a coisa
 * errada: sem linhas, a consulta custa quase nada e a ida a mais ao banco vira
 * 100% do tempo — um número assustador que não acontece na vida real. Com
 * volume, o custo da consulta aparece e a sobrecarga volta ao tamanho dela.
 *
 * O volume é o de um bar pequeno cheio: ~140 comandas por dia, 6 itens cada.
 *
 * Uso: npx tsx scripts/volume-de-teste.mts   (usa TEST_DATABASE_URL)
 */
import "dotenv/config";
import pg from "pg";

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.error("Defina TEST_DATABASE_URL apontando para o Postgres local.");
  process.exit(1);
}

const COMANDAS = 2000;
const ITENS_POR_COMANDA = 6;
const DIAS = 14;

const db = new pg.Client({ connectionString: url });
await db.connect();

const ctx = (
  await db.query<{ tenant: string; unidade: string; usuario: string; forma: string }>(
    `select u."tenantId" tenant,
            u.id          unidade,
            (select id from usuarios      where "tenantId" = u."tenantId" limit 1) usuario,
            (select id from formas_pagamento where "tenantId" = u."tenantId" limit 1) forma
       from unidades u limit 1`
  )
).rows[0];

if (!ctx?.usuario || !ctx.forma) {
  console.error("Banco sem seed: rode `npm run db:seed` apontando para o banco de teste.");
  process.exit(1);
}

console.log("Limpando volume anterior...");
await db.query(`delete from movimentos_estoque where id like 'vol-%'`);
await db.query(`delete from pagamentos         where id like 'vol-%'`);
await db.query(`delete from comanda_itens      where id like 'vol-%'`);
await db.query(`delete from comandas           where id like 'vol-%'`);

const p = [ctx.tenant, ctx.unidade, ctx.usuario];

console.log(`Criando ${COMANDAS} comandas...`);
await db.query(
  `insert into comandas
     (id, "tenantId", "unidadeId", numero, origem, status, pessoas,
      "taxaServicoPct", "descontoValor", "abertaPorId", "abertaEm", "fechadaEm")
   select 'vol-c-' || g, $1, $2, 900000 + g, 'MESA', 'PAGA', 1 + (g % 6),
          10, 0, $3,
          now() - (random() * ${DIAS}) * interval '1 day',
          now() - (random() * ${DIAS}) * interval '1 day'
     from generate_series(1, ${COMANDAS}) g`,
  p.slice(0, 3)
);

console.log(`Criando ${COMANDAS * ITENS_POR_COMANDA} itens...`);
await db.query(
  `insert into comanda_itens
     (id, "tenantId", "comandaId", "produtoId", quantidade,
      "precoUnitario", "precoTotal", status, "lancadoPorId", "lancadoEm")
   select 'vol-i-' || g || '-' || i,
          $1,
          'vol-c-' || g,
          (array(select id from produtos where "tenantId" = $1 order by id))[
            1 + ((g * 7 + i) % (select count(*) from produtos where "tenantId" = $1))
          ],
          1 + (i % 3),
          19.90,
          19.90 * (1 + (i % 3)),
          'ENTREGUE',
          $2,
          now() - (random() * ${DIAS}) * interval '1 day'
     from generate_series(1, ${COMANDAS}) g,
          generate_series(1, ${ITENS_POR_COMANDA}) i`,
  [ctx.tenant, ctx.usuario]
);

console.log(`Criando ${COMANDAS} pagamentos...`);
await db.query(
  `insert into pagamentos
     (id, "tenantId", "comandaId", "formaPagamentoId", valor, troco, "usuarioId", "criadoEm")
   select 'vol-p-' || g, $1, 'vol-c-' || g, $3,
          (select coalesce(sum("precoTotal"), 0) from comanda_itens where "comandaId" = 'vol-c-' || g),
          0, $2,
          now() - (random() * ${DIAS}) * interval '1 day'
     from generate_series(1, ${COMANDAS}) g`,
  [ctx.tenant, ctx.usuario, ctx.forma]
);

console.log("Criando movimentos de estoque...");
await db.query(
  `insert into movimentos_estoque
     (id, "tenantId", "unidadeId", "produtoId", tipo, quantidade,
      "custoUnitario", "saldoDepois", "criadoEm")
   select 'vol-m-' || g,
          $1, $2,
          (array(select id from produtos where "tenantId" = $1 order by id))[
            1 + (g % (select count(*) from produtos where "tenantId" = $1))
          ],
          'SAIDA_VENDA', -1, 8.50, 100 - (g % 100),
          now() - (random() * ${DIAS}) * interval '1 day'
     from generate_series(1, ${COMANDAS * 2}) g`,
  [ctx.tenant, ctx.unidade]
);

await db.query("analyze");

const { rows } = await db.query<{ tabela: string; linhas: number }>(
  `select 'comandas' tabela, count(*)::int linhas from comandas
   union all select 'comanda_itens', count(*)::int from comanda_itens
   union all select 'pagamentos', count(*)::int from pagamentos
   union all select 'movimentos_estoque', count(*)::int from movimentos_estoque
   order by 1`
);

console.log("");
for (const r of rows) console.log(`  ${r.tabela.padEnd(20)} ${String(r.linhas).padStart(6)} linhas`);
console.log("");

await db.end();
