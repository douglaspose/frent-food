-- Cada trabalho sai para um agente só.
--
-- A fila entregava a quem perguntasse: dois agentes buscando ao mesmo tempo
-- recebiam os mesmos trabalhos e a cozinha ganhava duas vias de cada comanda.
-- Isso deixou de ser hipótese quando a maquininha virou agente de impressão —
-- ela e o agente do balcão buscam na mesma fila.
--
-- `entregueEm` é a marca da entrega: enquanto ela for recente, o trabalho não
-- sai de novo. Vencida, volta a sair — o agente que o levou pode ter morrido
-- no meio, e papel que não saiu precisa de outra chance.
ALTER TABLE "fila_impressao" ADD COLUMN "entregueEm" TIMESTAMP(3);

-- Quem levou. Não participa da exclusão (quem exclui é a marca de tempo); é
-- para a tela de impressão poder dizer qual aparelho está puxando a fila.
ALTER TABLE "fila_impressao" ADD COLUMN "entregueA" TEXT;

-- A busca da fila filtra por unidade, status e pela marca de entrega.
CREATE INDEX "fila_impressao_unidadeId_status_entregueEm_idx"
  ON "fila_impressao" ("unidadeId", "status", "entregueEm");
