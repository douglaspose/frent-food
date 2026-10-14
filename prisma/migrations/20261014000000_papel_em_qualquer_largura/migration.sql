-- Os dados que montaram o papel, para remontá-lo na largura de quem imprime.
--
-- O `conteudo` continua sendo a fonte da verdade do que foi impresso (segunda
-- via sai idêntica à primeira). Isto é o material para quando quem busca tem
-- outra largura — a térmica embutida numa maquininha faz 32 colunas, não 48.
ALTER TABLE "fila_impressao" ADD COLUMN "dados" JSONB;
