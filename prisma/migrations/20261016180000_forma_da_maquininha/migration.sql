-- Qual forma de pagamento a maquininha usa, quando há mais de uma do tipo.
--
-- O aparelho manda o tipo — crédito, débito, Pix —, que é o que a
-- credenciadora precisa para passar o cartão. A forma é a escrituração: nome,
-- taxa e prazo. Com duas formas de crédito ("Cartão de Crédito" a 3,2% no
-- balcão, "Crédito Stone" a 1,9% na maquininha), todas as vendas do aparelho
-- caíam na primeira por ordem alfabética, e a taxa errada ficava congelada no
-- pagamento: o custo do mês sai torto e não há como corrigir depois.
ALTER TABLE "formas_pagamento" ADD COLUMN "naMaquininha" BOOLEAN NOT NULL DEFAULT false;
