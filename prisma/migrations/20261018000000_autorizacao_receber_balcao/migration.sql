-- Receber pela retaguarda uma venda de balcão que a maquininha não conseguiu
-- registrar: o dinheiro já saiu do cartão, a prova é o comprovante de papel, e
-- quem registra precisa da mesma autorização de um movimento de gaveta.
--
-- A liberação fica presa ao tipo, e é por ele que a auditoria responde "quem
-- liberou aquela venda de R$ 20 que ninguém achou no mapa".
ALTER TYPE "TipoAutorizacao" ADD VALUE 'RECEBER_BALCAO';
