-- CreateEnum
CREATE TYPE "StatusMesa" AS ENUM ('LIVRE', 'OCUPADA', 'FECHANDO', 'RESERVADA', 'SUJA');

-- CreateEnum
CREATE TYPE "TipoProduto" AS ENUM ('VENDA', 'INSUMO', 'REVENDA', 'EMBALAGEM', 'USO_INTERNO');

-- CreateEnum
CREATE TYPE "UnidadeMedida" AS ENUM ('UN', 'KG', 'G', 'L', 'ML');

-- CreateEnum
CREATE TYPE "CanalVenda" AS ENUM ('SALAO', 'BALCAO', 'DELIVERY', 'APP', 'TOTEM');

-- CreateEnum
CREATE TYPE "TipoEstacao" AS ENUM ('KDS', 'IMPRESSORA', 'AMBOS');

-- CreateEnum
CREATE TYPE "OrigemComanda" AS ENUM ('MESA', 'BALCAO', 'CARTAO', 'DELIVERY');

-- CreateEnum
CREATE TYPE "StatusComanda" AS ENUM ('ABERTA', 'FECHANDO', 'PAGA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "StatusItem" AS ENUM ('PENDENTE', 'ENVIADO', 'EM_PREPARO', 'PRONTO', 'ENTREGUE', 'CANCELADO');

-- CreateEnum
CREATE TYPE "StatusPedido" AS ENUM ('AGUARDANDO', 'EM_PREPARO', 'PRONTO', 'ENTREGUE', 'CANCELADO');

-- CreateEnum
CREATE TYPE "TipoCaixa" AS ENUM ('GERAL', 'DELIVERY');

-- CreateEnum
CREATE TYPE "Turno" AS ENUM ('DIA', 'INTERMEDIARIO', 'NOITE', 'MADRUGADA');

-- CreateEnum
CREATE TYPE "StatusCaixa" AS ENUM ('ABERTO', 'FECHADO', 'CONFERIDO');

-- CreateEnum
CREATE TYPE "TipoMovimento" AS ENUM ('SANGRIA', 'SUPRIMENTO', 'PAGAMENTO', 'RECEBIMENTO');

-- CreateEnum
CREATE TYPE "TipoPagamento" AS ENUM ('DINHEIRO', 'CREDITO', 'DEBITO', 'PIX', 'VOUCHER', 'CONVENIO', 'OUTRO');

-- CreateEnum
CREATE TYPE "TipoAutorizacao" AS ENUM ('CANCELAMENTO_ITEM', 'CANCELAMENTO_COMANDA', 'DESCONTO', 'REABERTURA_COMANDA', 'SANGRIA');

-- CreateEnum
CREATE TYPE "StatusAutorizacao" AS ENUM ('PENDENTE', 'APROVADA', 'NEGADA');

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "plano" TEXT NOT NULL DEFAULT 'basico',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unidades" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "apelido" TEXT,
    "cnpj" TEXT,
    "razaoSocial" TEXT,
    "telefone" TEXT,
    "whatsapp" TEXT,
    "email" TEXT,
    "cep" TEXT,
    "logradouro" TEXT,
    "numero" TEXT,
    "complemento" TEXT,
    "bairro" TEXT,
    "cidade" TEXT,
    "uf" TEXT,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "taxaServicoPct" DECIMAL(5,2) NOT NULL DEFAULT 10,
    "retencaoGorjetaPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "atuaLoja" BOOLEAN NOT NULL DEFAULT true,
    "atuaDelivery" BOOLEAN NOT NULL DEFAULT false,
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unidades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parametros_unidade" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "grupo" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "valor" JSONB NOT NULL,

    CONSTRAINT "parametros_unidade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuarios" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "senhaHash" TEXT,
    "pinHash" TEXT,
    "cpf" TEXT,
    "avatarUrl" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cargos" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "nivel" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "cargos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissoes" (
    "id" TEXT NOT NULL,
    "cargoId" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "permitido" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "permissoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuarios_unidades" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "cargoId" TEXT NOT NULL,

    CONSTRAINT "usuarios_unidades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "areas" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mesas" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "areaId" TEXT,
    "numero" TEXT NOT NULL,
    "capacidade" INTEGER NOT NULL DEFAULT 4,
    "status" "StatusMesa" NOT NULL DEFAULT 'LIVRE',
    "qrToken" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "mesas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categorias_produto" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "corHex" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "categorias_produto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "produtos" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "codigo" TEXT,
    "titulo" TEXT NOT NULL,
    "tipo" "TipoProduto" NOT NULL DEFAULT 'VENDA',
    "unidadeMedida" "UnidadeMedida" NOT NULL DEFAULT 'UN',
    "categoriaId" TEXT,
    "descricao" TEXT,
    "fichaNutricional" TEXT,
    "alergicos" TEXT,
    "harmonizacao" TEXT,
    "fotoUrl" TEXT,
    "ncm" TEXT,
    "cest" TEXT,
    "categoriaImposto" TEXT,
    "centroCusto" TEXT,
    "valorIdealVenda" DECIMAL(10,2),
    "margemLucroMin" DECIMAL(5,2),
    "tempoMontagemMin" INTEGER,
    "exigePontoCarne" BOOLEAN NOT NULL DEFAULT false,
    "ehAdicional" BOOLEAN NOT NULL DEFAULT false,
    "maiorDeIdade" BOOLEAN NOT NULL DEFAULT false,
    "isentoTaxaServico" BOOLEAN NOT NULL DEFAULT false,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "produtos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "composicoes" (
    "id" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "insumoId" TEXT NOT NULL,
    "quantidade" DECIMAL(12,4) NOT NULL,

    CONSTRAINT "composicoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grupos_opcionais" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "minEscolhas" INTEGER NOT NULL DEFAULT 0,
    "maxEscolhas" INTEGER NOT NULL DEFAULT 1,
    "obrigatorio" BOOLEAN NOT NULL DEFAULT false,
    "ordem" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "grupos_opcionais_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opcionais_item" (
    "id" TEXT NOT NULL,
    "grupoId" TEXT NOT NULL,
    "produtoId" TEXT,
    "titulo" TEXT NOT NULL,
    "preco" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "opcionais_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "produtos_grupos_opcionais" (
    "produtoId" TEXT NOT NULL,
    "grupoId" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "produtos_grupos_opcionais_pkey" PRIMARY KEY ("produtoId","grupoId")
);

-- CreateTable
CREATE TABLE "cardapios" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "canal" "CanalVenda" NOT NULL DEFAULT 'SALAO',
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "cardapios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cardapio_itens" (
    "id" TEXT NOT NULL,
    "cardapioId" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "categoriaId" TEXT,
    "preco" DECIMAL(10,2) NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "esgotado" BOOLEAN NOT NULL DEFAULT false,
    "visivel" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "cardapio_itens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "impressoras" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "conexao" TEXT NOT NULL,
    "endereco" TEXT,
    "modelo" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "impressoras_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "estacoes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" "TipoEstacao" NOT NULL DEFAULT 'AMBOS',
    "corHex" TEXT,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "impressoraId" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "estacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "produtos_estacoes" (
    "produtoId" TEXT NOT NULL,
    "estacaoId" TEXT NOT NULL,

    CONSTRAINT "produtos_estacoes_pkey" PRIMARY KEY ("produtoId","estacaoId")
);

-- CreateTable
CREATE TABLE "clientes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cpf" TEXT,
    "celular" TEXT,
    "email" TEXT,
    "dataNascimento" TIMESTAMP(3),
    "sexo" TEXT,
    "observacoes" TEXT,
    "fotoUrl" TEXT,
    "visitas" INTEGER NOT NULL DEFAULT 0,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clientes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comandas" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "origem" "OrigemComanda" NOT NULL DEFAULT 'MESA',
    "status" "StatusComanda" NOT NULL DEFAULT 'ABERTA',
    "mesaId" TEXT,
    "cartaoNumero" TEXT,
    "clienteId" TEXT,
    "nomeCliente" TEXT,
    "pessoas" INTEGER NOT NULL DEFAULT 1,
    "taxaServicoPct" DECIMAL(5,2) NOT NULL DEFAULT 10,
    "descontoValor" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "descontoMotivo" TEXT,
    "observacao" TEXT,
    "abertaPorId" TEXT NOT NULL,
    "abertaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fechadaEm" TIMESTAMP(3),
    "caixaId" TEXT,

    CONSTRAINT "comandas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comanda_itens" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "comandaId" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "cardapioItemId" TEXT,
    "quantidade" DECIMAL(10,3) NOT NULL,
    "precoUnitario" DECIMAL(10,2) NOT NULL,
    "precoTotal" DECIMAL(10,2) NOT NULL,
    "observacao" TEXT,
    "pontoCarne" TEXT,
    "status" "StatusItem" NOT NULL DEFAULT 'PENDENTE',
    "lancadoPorId" TEXT NOT NULL,
    "lancadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "canceladoPorId" TEXT,
    "motivoCancelamento" TEXT,

    CONSTRAINT "comanda_itens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comanda_item_opcionais" (
    "id" TEXT NOT NULL,
    "comandaItemId" TEXT NOT NULL,
    "opcionalId" TEXT,
    "titulo" TEXT NOT NULL,
    "preco" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "quantidade" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "comanda_item_opcionais_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pedidos" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "comandaId" TEXT NOT NULL,
    "estacaoId" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "status" "StatusPedido" NOT NULL DEFAULT 'AGUARDANDO',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "iniciadoEm" TIMESTAMP(3),
    "prontoEm" TIMESTAMP(3),
    "entregueEm" TIMESTAMP(3),

    CONSTRAINT "pedidos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pedido_itens" (
    "id" TEXT NOT NULL,
    "pedidoId" TEXT NOT NULL,
    "comandaItemId" TEXT NOT NULL,

    CONSTRAINT "pedido_itens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "caixas" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "tipo" "TipoCaixa" NOT NULL DEFAULT 'GERAL',
    "data" DATE NOT NULL,
    "turno" "Turno" NOT NULL DEFAULT 'NOITE',
    "status" "StatusCaixa" NOT NULL DEFAULT 'ABERTO',
    "fundoCaixa" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "valorInformado" DECIMAL(10,2),
    "valorApurado" DECIMAL(10,2),
    "divergencia" DECIMAL(10,2),
    "abertoPorId" TEXT NOT NULL,
    "abertoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fechadoPorId" TEXT,
    "fechadoEm" TIMESTAMP(3),

    CONSTRAINT "caixas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimentos_caixa" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "caixaId" TEXT NOT NULL,
    "tipo" "TipoMovimento" NOT NULL,
    "valor" DECIMAL(10,2) NOT NULL,
    "descricao" TEXT,
    "usuarioId" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimentos_caixa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "formas_pagamento" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" "TipoPagamento" NOT NULL,
    "taxaPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "prazoDias" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "formas_pagamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pagamentos" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "comandaId" TEXT NOT NULL,
    "caixaId" TEXT,
    "formaPagamentoId" TEXT NOT NULL,
    "valor" DECIMAL(10,2) NOT NULL,
    "troco" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "nsu" TEXT,
    "bandeira" TEXT,
    "usuarioId" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pagamentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "autorizacoes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "tipo" "TipoAutorizacao" NOT NULL,
    "referenciaId" TEXT NOT NULL,
    "motivo" TEXT,
    "status" "StatusAutorizacao" NOT NULL DEFAULT 'PENDENTE',
    "solicitadoPorId" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aprovadoPorId" TEXT,
    "resolvidoEm" TIMESTAMP(3),

    CONSTRAINT "autorizacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "unidadeId" TEXT,
    "usuarioId" TEXT,
    "entidade" TEXT NOT NULL,
    "entidadeId" TEXT NOT NULL,
    "acao" TEXT NOT NULL,
    "antes" JSONB,
    "depois" JSONB,
    "ip" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE INDEX "unidades_tenantId_idx" ON "unidades"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "unidades_tenantId_codigo_key" ON "unidades"("tenantId", "codigo");

-- CreateIndex
CREATE INDEX "parametros_unidade_tenantId_idx" ON "parametros_unidade"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "parametros_unidade_unidadeId_chave_key" ON "parametros_unidade"("unidadeId", "chave");

-- CreateIndex
CREATE INDEX "usuarios_tenantId_idx" ON "usuarios"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_tenantId_email_key" ON "usuarios"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "cargos_tenantId_nome_key" ON "cargos"("tenantId", "nome");

-- CreateIndex
CREATE UNIQUE INDEX "permissoes_cargoId_chave_key" ON "permissoes"("cargoId", "chave");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_unidades_usuarioId_unidadeId_key" ON "usuarios_unidades"("usuarioId", "unidadeId");

-- CreateIndex
CREATE INDEX "areas_tenantId_idx" ON "areas"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "mesas_qrToken_key" ON "mesas"("qrToken");

-- CreateIndex
CREATE INDEX "mesas_tenantId_idx" ON "mesas"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "mesas_unidadeId_numero_key" ON "mesas"("unidadeId", "numero");

-- CreateIndex
CREATE INDEX "categorias_produto_tenantId_idx" ON "categorias_produto"("tenantId");

-- CreateIndex
CREATE INDEX "produtos_tenantId_idx" ON "produtos"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "composicoes_produtoId_insumoId_key" ON "composicoes"("produtoId", "insumoId");

-- CreateIndex
CREATE INDEX "grupos_opcionais_tenantId_idx" ON "grupos_opcionais"("tenantId");

-- CreateIndex
CREATE INDEX "cardapios_tenantId_idx" ON "cardapios"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "cardapios_unidadeId_canal_key" ON "cardapios"("unidadeId", "canal");

-- CreateIndex
CREATE UNIQUE INDEX "cardapio_itens_cardapioId_produtoId_key" ON "cardapio_itens"("cardapioId", "produtoId");

-- CreateIndex
CREATE INDEX "impressoras_tenantId_idx" ON "impressoras"("tenantId");

-- CreateIndex
CREATE INDEX "estacoes_tenantId_idx" ON "estacoes"("tenantId");

-- CreateIndex
CREATE INDEX "clientes_tenantId_idx" ON "clientes"("tenantId");

-- CreateIndex
CREATE INDEX "clientes_tenantId_cpf_idx" ON "clientes"("tenantId", "cpf");

-- CreateIndex
CREATE INDEX "comandas_tenantId_idx" ON "comandas"("tenantId");

-- CreateIndex
CREATE INDEX "comandas_unidadeId_status_idx" ON "comandas"("unidadeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "comandas_unidadeId_numero_key" ON "comandas"("unidadeId", "numero");

-- CreateIndex
CREATE INDEX "comanda_itens_tenantId_idx" ON "comanda_itens"("tenantId");

-- CreateIndex
CREATE INDEX "comanda_itens_comandaId_idx" ON "comanda_itens"("comandaId");

-- CreateIndex
CREATE INDEX "pedidos_tenantId_idx" ON "pedidos"("tenantId");

-- CreateIndex
CREATE INDEX "pedidos_unidadeId_status_idx" ON "pedidos"("unidadeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "pedido_itens_pedidoId_comandaItemId_key" ON "pedido_itens"("pedidoId", "comandaItemId");

-- CreateIndex
CREATE INDEX "caixas_tenantId_idx" ON "caixas"("tenantId");

-- CreateIndex
CREATE INDEX "caixas_unidadeId_status_idx" ON "caixas"("unidadeId", "status");

-- CreateIndex
CREATE INDEX "movimentos_caixa_tenantId_idx" ON "movimentos_caixa"("tenantId");

-- CreateIndex
CREATE INDEX "formas_pagamento_tenantId_idx" ON "formas_pagamento"("tenantId");

-- CreateIndex
CREATE INDEX "pagamentos_tenantId_idx" ON "pagamentos"("tenantId");

-- CreateIndex
CREATE INDEX "pagamentos_comandaId_idx" ON "pagamentos"("comandaId");

-- CreateIndex
CREATE INDEX "autorizacoes_tenantId_idx" ON "autorizacoes"("tenantId");

-- CreateIndex
CREATE INDEX "autorizacoes_unidadeId_status_idx" ON "autorizacoes"("unidadeId", "status");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_entidade_entidadeId_idx" ON "audit_logs"("tenantId", "entidade", "entidadeId");

-- AddForeignKey
ALTER TABLE "unidades" ADD CONSTRAINT "unidades_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parametros_unidade" ADD CONSTRAINT "parametros_unidade_unidadeId_fkey" FOREIGN KEY ("unidadeId") REFERENCES "unidades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cargos" ADD CONSTRAINT "cargos_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permissoes" ADD CONSTRAINT "permissoes_cargoId_fkey" FOREIGN KEY ("cargoId") REFERENCES "cargos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuarios_unidades" ADD CONSTRAINT "usuarios_unidades_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuarios_unidades" ADD CONSTRAINT "usuarios_unidades_unidadeId_fkey" FOREIGN KEY ("unidadeId") REFERENCES "unidades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuarios_unidades" ADD CONSTRAINT "usuarios_unidades_cargoId_fkey" FOREIGN KEY ("cargoId") REFERENCES "cargos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "areas" ADD CONSTRAINT "areas_unidadeId_fkey" FOREIGN KEY ("unidadeId") REFERENCES "unidades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mesas" ADD CONSTRAINT "mesas_unidadeId_fkey" FOREIGN KEY ("unidadeId") REFERENCES "unidades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mesas" ADD CONSTRAINT "mesas_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "areas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categorias_produto" ADD CONSTRAINT "categorias_produto_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "produtos" ADD CONSTRAINT "produtos_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "produtos" ADD CONSTRAINT "produtos_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "categorias_produto"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "composicoes" ADD CONSTRAINT "composicoes_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "produtos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "composicoes" ADD CONSTRAINT "composicoes_insumoId_fkey" FOREIGN KEY ("insumoId") REFERENCES "produtos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grupos_opcionais" ADD CONSTRAINT "grupos_opcionais_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opcionais_item" ADD CONSTRAINT "opcionais_item_grupoId_fkey" FOREIGN KEY ("grupoId") REFERENCES "grupos_opcionais"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opcionais_item" ADD CONSTRAINT "opcionais_item_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "produtos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "produtos_grupos_opcionais" ADD CONSTRAINT "produtos_grupos_opcionais_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "produtos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "produtos_grupos_opcionais" ADD CONSTRAINT "produtos_grupos_opcionais_grupoId_fkey" FOREIGN KEY ("grupoId") REFERENCES "grupos_opcionais"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cardapios" ADD CONSTRAINT "cardapios_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cardapios" ADD CONSTRAINT "cardapios_unidadeId_fkey" FOREIGN KEY ("unidadeId") REFERENCES "unidades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cardapio_itens" ADD CONSTRAINT "cardapio_itens_cardapioId_fkey" FOREIGN KEY ("cardapioId") REFERENCES "cardapios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cardapio_itens" ADD CONSTRAINT "cardapio_itens_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "produtos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cardapio_itens" ADD CONSTRAINT "cardapio_itens_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "categorias_produto"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "impressoras" ADD CONSTRAINT "impressoras_unidadeId_fkey" FOREIGN KEY ("unidadeId") REFERENCES "unidades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estacoes" ADD CONSTRAINT "estacoes_unidadeId_fkey" FOREIGN KEY ("unidadeId") REFERENCES "unidades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estacoes" ADD CONSTRAINT "estacoes_impressoraId_fkey" FOREIGN KEY ("impressoraId") REFERENCES "impressoras"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "produtos_estacoes" ADD CONSTRAINT "produtos_estacoes_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "produtos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "produtos_estacoes" ADD CONSTRAINT "produtos_estacoes_estacaoId_fkey" FOREIGN KEY ("estacaoId") REFERENCES "estacoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clientes" ADD CONSTRAINT "clientes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comandas" ADD CONSTRAINT "comandas_unidadeId_fkey" FOREIGN KEY ("unidadeId") REFERENCES "unidades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comandas" ADD CONSTRAINT "comandas_mesaId_fkey" FOREIGN KEY ("mesaId") REFERENCES "mesas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comandas" ADD CONSTRAINT "comandas_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comandas" ADD CONSTRAINT "comandas_abertaPorId_fkey" FOREIGN KEY ("abertaPorId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comandas" ADD CONSTRAINT "comandas_caixaId_fkey" FOREIGN KEY ("caixaId") REFERENCES "caixas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comanda_itens" ADD CONSTRAINT "comanda_itens_comandaId_fkey" FOREIGN KEY ("comandaId") REFERENCES "comandas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comanda_itens" ADD CONSTRAINT "comanda_itens_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "produtos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comanda_itens" ADD CONSTRAINT "comanda_itens_cardapioItemId_fkey" FOREIGN KEY ("cardapioItemId") REFERENCES "cardapio_itens"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comanda_itens" ADD CONSTRAINT "comanda_itens_lancadoPorId_fkey" FOREIGN KEY ("lancadoPorId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comanda_itens" ADD CONSTRAINT "comanda_itens_canceladoPorId_fkey" FOREIGN KEY ("canceladoPorId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comanda_item_opcionais" ADD CONSTRAINT "comanda_item_opcionais_comandaItemId_fkey" FOREIGN KEY ("comandaItemId") REFERENCES "comanda_itens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comanda_item_opcionais" ADD CONSTRAINT "comanda_item_opcionais_opcionalId_fkey" FOREIGN KEY ("opcionalId") REFERENCES "opcionais_item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_unidadeId_fkey" FOREIGN KEY ("unidadeId") REFERENCES "unidades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_comandaId_fkey" FOREIGN KEY ("comandaId") REFERENCES "comandas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedidos" ADD CONSTRAINT "pedidos_estacaoId_fkey" FOREIGN KEY ("estacaoId") REFERENCES "estacoes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido_itens" ADD CONSTRAINT "pedido_itens_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "pedidos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido_itens" ADD CONSTRAINT "pedido_itens_comandaItemId_fkey" FOREIGN KEY ("comandaItemId") REFERENCES "comanda_itens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caixas" ADD CONSTRAINT "caixas_unidadeId_fkey" FOREIGN KEY ("unidadeId") REFERENCES "unidades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caixas" ADD CONSTRAINT "caixas_abertoPorId_fkey" FOREIGN KEY ("abertoPorId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caixas" ADD CONSTRAINT "caixas_fechadoPorId_fkey" FOREIGN KEY ("fechadoPorId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentos_caixa" ADD CONSTRAINT "movimentos_caixa_caixaId_fkey" FOREIGN KEY ("caixaId") REFERENCES "caixas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentos_caixa" ADD CONSTRAINT "movimentos_caixa_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formas_pagamento" ADD CONSTRAINT "formas_pagamento_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagamentos" ADD CONSTRAINT "pagamentos_comandaId_fkey" FOREIGN KEY ("comandaId") REFERENCES "comandas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagamentos" ADD CONSTRAINT "pagamentos_caixaId_fkey" FOREIGN KEY ("caixaId") REFERENCES "caixas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagamentos" ADD CONSTRAINT "pagamentos_formaPagamentoId_fkey" FOREIGN KEY ("formaPagamentoId") REFERENCES "formas_pagamento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagamentos" ADD CONSTRAINT "pagamentos_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autorizacoes" ADD CONSTRAINT "autorizacoes_unidadeId_fkey" FOREIGN KEY ("unidadeId") REFERENCES "unidades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autorizacoes" ADD CONSTRAINT "autorizacoes_solicitadoPorId_fkey" FOREIGN KEY ("solicitadoPorId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autorizacoes" ADD CONSTRAINT "autorizacoes_aprovadoPorId_fkey" FOREIGN KEY ("aprovadoPorId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
