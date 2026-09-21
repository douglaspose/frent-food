-- Row Level Security: isolamento entre restaurantes no próprio banco.
--
-- ATENÇÃO — este script NÃO está ativo e não roda junto com as migrations.
-- Ativá-lo antes de fazer a aplicação declarar o tenant em cada conexão
-- deixaria TODAS as consultas vazias. Leia docs/seguranca.md antes.
--
-- Três condições, todas obrigatórias:
--   1. A aplicação conecta com a role `app_gestao` (abaixo), nunca com um
--      superusuário — superusuário ignora RLS e o script vira decoração.
--   2. Toda consulta roda dentro de uma transação que executa antes:
--         SET LOCAL app.tenant_id = '<id do tenant da sessão>';
--   3. Os jobs que varrem vários restaurantes (agente de impressão, rotinas de
--      manutenção) usam uma role própria com BYPASSRLS.
--
-- Depois de aplicar, rode `npm run rls:verificar` apontando para o banco de
-- verdade. Ele prova que a proteção está valendo — "aplicou sem erro" não
-- prova nada aqui: num banco onde a conexão é superusuário, tudo isto é
-- aceito e nada é aplicado.

-- 1) Role da aplicação, sem privilégio de ignorar RLS.
CREATE ROLE app_gestao LOGIN PASSWORD 'defina-uma-senha-forte' NOBYPASSRLS;
GRANT CONNECT ON DATABASE gestao_restaurante TO app_gestao;
GRANT USAGE ON SCHEMA public TO app_gestao;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_gestao;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_gestao;

-- 2) Tabelas que carregam `tenantId`: a política compara direto.
--
--    `current_setting(..., true)` devolve NULL em vez de erro quando a
--    variável não foi definida — e NULL não casa com nada, então a consulta
--    sem tenant declarado volta vazia em vez de vazar.
--
--    A lista é conferida contra o schema pelo teste `rls.test.ts`: tabela nova
--    com `tenantId` que não aparecer aqui quebra a suíte. Sem isso, a próxima
--    tabela criada nasceria sem política e ninguém perceberia.
DO $$
DECLARE
  tabela text;
BEGIN
  FOREACH tabela IN ARRAY ARRAY[
    'unidades', 'parametros_unidade', 'usuarios', 'cargos', 'areas', 'mesas',
    'clientes', 'categorias_produto', 'produtos', 'grupos_opcionais',
    'cardapios', 'impressoras', 'estacoes', 'comandas', 'comanda_itens',
    'pedidos', 'caixas', 'movimentos_caixa', 'formas_pagamento', 'pagamentos',
    'autorizacoes', 'audit_logs', 'fila_impressao', 'estoque_saldos',
    'movimentos_estoque', 'notas_fiscais', 'perfis_fiscais', 'logomarcas'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tabela);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tabela);
    EXECUTE format('DROP POLICY IF EXISTS isolamento_tenant ON %I', tabela);
    EXECUTE format(
      'CREATE POLICY isolamento_tenant ON %I USING ("tenantId" = current_setting(''app.tenant_id'', true))
       WITH CHECK ("tenantId" = current_setting(''app.tenant_id'', true))',
      tabela
    );
  END LOOP;
END $$;

-- 3) Tabelas-filhas, que não têm `tenantId`.
--
--    Deixá-las de fora seria o pior dos mundos: a política das tabelas-pai daria
--    a sensação de banco protegido enquanto `cardapio_itens` entregaria o
--    cardápio e o preço de todos os restaurantes, e `composicoes`, a ficha
--    técnica — que é receita, o que o dono menos quer dividir com o concorrente.
--
--    A política sobe pelo pai. Custa uma subconsulta por acesso; é o preço de
--    não denormalizar `tenantId` em mais dez tabelas, e isto é a última rede,
--    não o caminho quente.
DO $$
DECLARE
  par record;
BEGIN
  FOR par IN
    SELECT * FROM (VALUES
      ('permissoes',               'cargoId',       'cargos'),
      ('usuarios_unidades',        'usuarioId',     'usuarios'),
      ('composicoes',              'produtoId',     'produtos'),
      ('opcionais_item',           'grupoId',       'grupos_opcionais'),
      ('produtos_grupos_opcionais','produtoId',     'produtos'),
      ('cardapio_itens',           'cardapioId',    'cardapios'),
      ('produtos_estacoes',        'produtoId',     'produtos'),
      ('comanda_item_opcionais',   'comandaItemId', 'comanda_itens'),
      ('pedido_itens',             'pedidoId',      'pedidos')
    ) AS t(filha, chave, pai)
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', par.filha);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', par.filha);
    EXECUTE format('DROP POLICY IF EXISTS isolamento_tenant ON %I', par.filha);
    EXECUTE format(
      'CREATE POLICY isolamento_tenant ON %I
         USING (EXISTS (SELECT 1 FROM %I p WHERE p.id = %I.%I
                        AND p."tenantId" = current_setting(''app.tenant_id'', true)))
         WITH CHECK (EXISTS (SELECT 1 FROM %I p WHERE p.id = %I.%I
                        AND p."tenantId" = current_setting(''app.tenant_id'', true)))',
      par.filha, par.pai, par.filha, par.chave,
      par.pai, par.filha, par.chave
    );
  END LOOP;
END $$;

-- 4) A própria tabela de restaurantes.
--    Sem política aqui, uma consulta escapada devolve a lista de clientes do
--    SaaS — nomes, planos e slugs de todo mundo.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS isolamento_tenant ON tenants;
CREATE POLICY isolamento_tenant ON tenants
  USING (id = current_setting('app.tenant_id', true))
  WITH CHECK (id = current_setting('app.tenant_id', true));

-- 5) Role para rotinas que atravessam restaurantes (relatórios internos,
--    manutenção, criação de um cliente novo). Use só onde for necessário.
-- CREATE ROLE app_manutencao LOGIN PASSWORD '...' BYPASSRLS;

-- Para desligar tudo:
--   ALTER TABLE <tabela> DISABLE ROW LEVEL SECURITY;
