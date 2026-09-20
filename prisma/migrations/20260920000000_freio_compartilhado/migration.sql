-- O freio de tentativas sai da memória do processo e passa a viver no banco.
--
-- Em memória, cada instância contava as suas: com duas atrás de um balanceador,
-- quem ataca ganha o dobro de tentativas, e um reinício zerava tudo.
CREATE TABLE "freios_de_tentativa" (
    "chave" TEXT NOT NULL,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "expiraEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "freios_de_tentativa_pkey" PRIMARY KEY ("chave")
);

CREATE INDEX "freios_de_tentativa_expiraEm_idx" ON "freios_de_tentativa"("expiraEm");
