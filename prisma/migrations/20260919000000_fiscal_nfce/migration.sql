-- CreateEnum
CREATE TYPE "RegimeTributario" AS ENUM ('SIMPLES_NACIONAL', 'NORMAL');

-- CreateEnum
CREATE TYPE "AmbienteFiscal" AS ENUM ('HOMOLOGACAO', 'PRODUCAO');

-- CreateEnum
CREATE TYPE "EmissorFiscal" AS ENUM ('SIMULADO', 'FOCUS_NFE', 'PLUGNOTAS');

-- CreateEnum
CREATE TYPE "StatusNotaFiscal" AS ENUM ('PENDENTE', 'PROCESSANDO', 'AUTORIZADA', 'REJEITADA', 'CANCELADA', 'CONTINGENCIA', 'DENEGADA');

-- AlterEnum
ALTER TYPE "TipoImpressao" ADD VALUE 'DANFE_NFCE';

-- AlterTable
ALTER TABLE "formas_pagamento" ADD COLUMN     "codigoFiscal" TEXT NOT NULL DEFAULT '99';

-- AlterTable
ALTER TABLE "produtos" ADD COLUMN     "perfilFiscalId" TEXT;

-- AlterTable
ALTER TABLE "unidades" ADD COLUMN     "ambienteFiscal" "AmbienteFiscal" NOT NULL DEFAULT 'HOMOLOGACAO',
ADD COLUMN     "codigoMunicipioIbge" TEXT,
ADD COLUMN     "codigoUf" TEXT,
ADD COLUMN     "csc" TEXT,
ADD COLUMN     "cscId" TEXT,
ADD COLUMN     "emissorFiscal" "EmissorFiscal" NOT NULL DEFAULT 'SIMULADO',
ADD COLUMN     "emiteNfce" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "inscricaoEstadual" TEXT,
ADD COLUMN     "inscricaoMunicipal" TEXT,
ADD COLUMN     "regimeTributario" "RegimeTributario" NOT NULL DEFAULT 'SIMPLES_NACIONAL',
ADD COLUMN     "serieNfce" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "tokenEmissor" TEXT;

-- CreateTable
CREATE TABLE "perfis_fiscais" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "padrao" BOOLEAN NOT NULL DEFAULT false,
    "origemMercadoria" INTEGER NOT NULL DEFAULT 0,
    "cfop" TEXT NOT NULL DEFAULT '5102',
    "csosn" TEXT NOT NULL DEFAULT '102',
    "cstIcms" TEXT NOT NULL DEFAULT '00',
    "aliquotaIcms" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "cstPis" TEXT NOT NULL DEFAULT '49',
    "aliquotaPis" DECIMAL(5,4) NOT NULL DEFAULT 0,
    "cstCofins" TEXT NOT NULL DEFAULT '49',
    "aliquotaCofins" DECIMAL(5,4) NOT NULL DEFAULT 0,

    CONSTRAINT "perfis_fiscais_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notas_fiscais" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "comandaId" TEXT,
    "modelo" TEXT NOT NULL DEFAULT '65',
    "serie" INTEGER NOT NULL,
    "numero" INTEGER NOT NULL,
    "ambiente" "AmbienteFiscal" NOT NULL,
    "status" "StatusNotaFiscal" NOT NULL DEFAULT 'PENDENTE',
    "valorTotal" DECIMAL(10,2) NOT NULL,
    "chaveAcesso" TEXT,
    "protocolo" TEXT,
    "autorizadaEm" TIMESTAMP(3),
    "qrCodeDados" TEXT,
    "urlConsulta" TEXT,
    "xml" TEXT,
    "motivoRejeicao" TEXT,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "canceladaEm" TIMESTAMP(3),
    "protocoloCancelamento" TEXT,
    "motivoCancelamento" TEXT,
    "emitidaPorId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notas_fiscais_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "perfis_fiscais_tenantId_idx" ON "perfis_fiscais"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "notas_fiscais_chaveAcesso_key" ON "notas_fiscais"("chaveAcesso");

-- CreateIndex
CREATE INDEX "notas_fiscais_tenantId_idx" ON "notas_fiscais"("tenantId");

-- CreateIndex
CREATE INDEX "notas_fiscais_unidadeId_status_idx" ON "notas_fiscais"("unidadeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "notas_fiscais_unidadeId_serie_numero_key" ON "notas_fiscais"("unidadeId", "serie", "numero");

-- AddForeignKey
ALTER TABLE "produtos" ADD CONSTRAINT "produtos_perfilFiscalId_fkey" FOREIGN KEY ("perfilFiscalId") REFERENCES "perfis_fiscais"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "perfis_fiscais" ADD CONSTRAINT "perfis_fiscais_unidadeId_fkey" FOREIGN KEY ("unidadeId") REFERENCES "unidades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notas_fiscais" ADD CONSTRAINT "notas_fiscais_unidadeId_fkey" FOREIGN KEY ("unidadeId") REFERENCES "unidades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notas_fiscais" ADD CONSTRAINT "notas_fiscais_comandaId_fkey" FOREIGN KEY ("comandaId") REFERENCES "comandas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
