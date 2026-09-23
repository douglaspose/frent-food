-- A referência da cobrança na maquininha, para o reenvio não pagar duas vezes.
ALTER TABLE "pagamentos" ADD COLUMN "referenciaExterna" TEXT;

-- Único por restaurante, e não global: a referência nasce no aparelho, e dois
-- restaurantes diferentes podem gerar a mesma sem nenhuma relação entre elas.
CREATE UNIQUE INDEX "pagamentos_tenantId_referenciaExterna_key"
  ON "pagamentos" ("tenantId", "referenciaExterna");
