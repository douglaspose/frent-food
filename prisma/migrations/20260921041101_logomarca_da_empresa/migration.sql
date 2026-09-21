-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "logo" BYTEA,
ADD COLUMN     "logoCorFundo" TEXT,
ADD COLUMN     "logoEm" TIMESTAMP(3),
ADD COLUMN     "logoTipo" TEXT;
