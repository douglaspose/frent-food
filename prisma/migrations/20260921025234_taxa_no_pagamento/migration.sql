-- AlterTable
ALTER TABLE "pagamentos" ADD COLUMN     "taxaPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "taxaValor" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- Preenche o histórico com a taxa que está cadastrada hoje em cada forma.
--
-- Não melhora o passado: ninguém guardou a taxa que valia em cada dia, e esta
-- é exatamente a estimativa que o painel já fazia. O que muda é que ela para
-- de se mover. A partir daqui, renegociar com a adquirente não reescreve o
-- custo de um mês já fechado.
--
-- Sem este UPDATE o custo de cartão de todo o histórico cairia para zero no
-- instante da migração, que é pior que uma estimativa congelada.
UPDATE "pagamentos" p
   SET "taxaPct" = f."taxaPct",
       "taxaValor" = ROUND((p."valor" - p."troco") * f."taxaPct" / 100, 2)
  FROM "formas_pagamento" f
 WHERE f."id" = p."formaPagamentoId"
   AND f."taxaPct" > 0;
