-- CreateEnum
CREATE TYPE "TipoMovimentoEstoque" AS ENUM ('ENTRADA', 'SAIDA_VENDA', 'PERDA', 'AJUSTE', 'DEVOLUCAO');

-- AlterTable
ALTER TABLE "produtos" ADD COLUMN     "controlaEstoque" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "estoqueMinimo" DECIMAL(14,4);

-- CreateTable
CREATE TABLE "estoque_saldos" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "quantidade" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "custoMedio" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "estoque_saldos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimentos_estoque" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "tipo" "TipoMovimentoEstoque" NOT NULL,
    "quantidade" DECIMAL(14,4) NOT NULL,
    "custoUnitario" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "saldoDepois" DECIMAL(14,4) NOT NULL,
    "motivo" TEXT,
    "referenciaId" TEXT,
    "usuarioId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimentos_estoque_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "estoque_saldos_tenantId_idx" ON "estoque_saldos"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "estoque_saldos_unidadeId_produtoId_key" ON "estoque_saldos"("unidadeId", "produtoId");

-- CreateIndex
CREATE INDEX "movimentos_estoque_tenantId_idx" ON "movimentos_estoque"("tenantId");

-- CreateIndex
CREATE INDEX "movimentos_estoque_unidadeId_produtoId_criadoEm_idx" ON "movimentos_estoque"("unidadeId", "produtoId", "criadoEm");

-- AddForeignKey
ALTER TABLE "estoque_saldos" ADD CONSTRAINT "estoque_saldos_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "produtos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentos_estoque" ADD CONSTRAINT "movimentos_estoque_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "produtos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
