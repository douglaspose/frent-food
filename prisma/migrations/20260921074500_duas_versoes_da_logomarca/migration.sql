-- CreateEnum
CREATE TYPE "FundoDaLogo" AS ENUM ('CLARO', 'ESCURO');

-- CreateTable
CREATE TABLE "logomarcas" (
    "tenantId" TEXT NOT NULL,
    "fundo" "FundoDaLogo" NOT NULL,
    "bytes" BYTEA NOT NULL,
    "tipo" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "logomarcas_pkey" PRIMARY KEY ("tenantId","fundo")
);

-- A logo que já existia ia para o topo escuro do login e do cardápio do QR:
-- é a versão ESCURO. Copiada antes de as colunas sumirem — sem esta linha, a
-- migração apagaria a logomarca de quem já tinha cadastrado a dele.
INSERT INTO "logomarcas" ("tenantId", "fundo", "bytes", "tipo", "criadoEm")
SELECT "id", 'ESCURO', "logo", "logoTipo", COALESCE("logoEm", CURRENT_TIMESTAMP)
FROM "tenants"
WHERE "logo" IS NOT NULL AND "logoTipo" IS NOT NULL;

-- AlterTable
ALTER TABLE "tenants" DROP COLUMN "logo",
DROP COLUMN "logoEm",
DROP COLUMN "logoTipo";

-- AddForeignKey
ALTER TABLE "logomarcas" ADD CONSTRAINT "logomarcas_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
