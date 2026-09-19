-- DropForeignKey
ALTER TABLE "composicoes" DROP CONSTRAINT "composicoes_insumoId_fkey";

-- AddForeignKey
ALTER TABLE "composicoes" ADD CONSTRAINT "composicoes_insumoId_fkey" FOREIGN KEY ("insumoId") REFERENCES "produtos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
