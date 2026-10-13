-- A referência da linha lançada pela maquininha, para o reenvio não lançar
-- a rodada duas vezes.
ALTER TABLE "comanda_itens" ADD COLUMN "referenciaExterna" TEXT;

-- Único por restaurante, e não global: a referência nasce no aparelho, e dois
-- restaurantes diferentes podem gerar a mesma sem nenhuma relação entre elas.
CREATE UNIQUE INDEX "comanda_itens_tenantId_referenciaExterna_key"
  ON "comanda_itens" ("tenantId", "referenciaExterna");
