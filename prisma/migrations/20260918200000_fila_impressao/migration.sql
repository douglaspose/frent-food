-- CreateEnum
CREATE TYPE "TipoImpressao" AS ENUM ('COMANDA_PRODUCAO', 'CONFERENCIA', 'CUPOM', 'CANCELAMENTO');

-- CreateEnum
CREATE TYPE "StatusImpressao" AS ENUM ('PENDENTE', 'IMPRESSO', 'ERRO');

-- AlterTable
ALTER TABLE "unidades" ADD COLUMN     "tokenImpressao" TEXT;

-- CreateTable
CREATE TABLE "fila_impressao" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "impressoraId" TEXT,
    "tipo" "TipoImpressao" NOT NULL,
    "status" "StatusImpressao" NOT NULL DEFAULT 'PENDENTE',
    "conteudo" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "referenciaId" TEXT,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "erro" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "impressoEm" TIMESTAMP(3),

    CONSTRAINT "fila_impressao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fila_impressao_tenantId_idx" ON "fila_impressao"("tenantId");

-- CreateIndex
CREATE INDEX "fila_impressao_unidadeId_status_idx" ON "fila_impressao"("unidadeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "unidades_tokenImpressao_key" ON "unidades"("tokenImpressao");

-- AddForeignKey
ALTER TABLE "fila_impressao" ADD CONSTRAINT "fila_impressao_unidadeId_fkey" FOREIGN KEY ("unidadeId") REFERENCES "unidades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fila_impressao" ADD CONSTRAINT "fila_impressao_impressoraId_fkey" FOREIGN KEY ("impressoraId") REFERENCES "impressoras"("id") ON DELETE SET NULL ON UPDATE CASCADE;
