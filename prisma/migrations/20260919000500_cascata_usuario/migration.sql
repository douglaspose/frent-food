-- DropForeignKey
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_usuarioId_fkey";

-- DropForeignKey
ALTER TABLE "autorizacoes" DROP CONSTRAINT "autorizacoes_aprovadoPorId_fkey";

-- DropForeignKey
ALTER TABLE "autorizacoes" DROP CONSTRAINT "autorizacoes_solicitadoPorId_fkey";

-- DropForeignKey
ALTER TABLE "caixas" DROP CONSTRAINT "caixas_abertoPorId_fkey";

-- DropForeignKey
ALTER TABLE "caixas" DROP CONSTRAINT "caixas_fechadoPorId_fkey";

-- DropForeignKey
ALTER TABLE "comanda_itens" DROP CONSTRAINT "comanda_itens_canceladoPorId_fkey";

-- DropForeignKey
ALTER TABLE "comanda_itens" DROP CONSTRAINT "comanda_itens_lancadoPorId_fkey";

-- DropForeignKey
ALTER TABLE "comandas" DROP CONSTRAINT "comandas_abertaPorId_fkey";

-- DropForeignKey
ALTER TABLE "movimentos_caixa" DROP CONSTRAINT "movimentos_caixa_usuarioId_fkey";

-- DropForeignKey
ALTER TABLE "pagamentos" DROP CONSTRAINT "pagamentos_usuarioId_fkey";

-- AddForeignKey
ALTER TABLE "comandas" ADD CONSTRAINT "comandas_abertaPorId_fkey" FOREIGN KEY ("abertaPorId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comanda_itens" ADD CONSTRAINT "comanda_itens_lancadoPorId_fkey" FOREIGN KEY ("lancadoPorId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comanda_itens" ADD CONSTRAINT "comanda_itens_canceladoPorId_fkey" FOREIGN KEY ("canceladoPorId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caixas" ADD CONSTRAINT "caixas_abertoPorId_fkey" FOREIGN KEY ("abertoPorId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caixas" ADD CONSTRAINT "caixas_fechadoPorId_fkey" FOREIGN KEY ("fechadoPorId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentos_caixa" ADD CONSTRAINT "movimentos_caixa_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagamentos" ADD CONSTRAINT "pagamentos_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autorizacoes" ADD CONSTRAINT "autorizacoes_solicitadoPorId_fkey" FOREIGN KEY ("solicitadoPorId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autorizacoes" ADD CONSTRAINT "autorizacoes_aprovadoPorId_fkey" FOREIGN KEY ("aprovadoPorId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
