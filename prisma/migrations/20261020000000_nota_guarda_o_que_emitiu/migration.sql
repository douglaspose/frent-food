-- O que a nota tinha dentro quando foi emitida.
--
-- A nota que a SEFAZ não recebeu precisa ser transmitida depois, e **igual**:
-- mesma chave, mesma data de emissão, mesmo código numérico, mesmos itens e
-- tributos. Nada disso ficava guardado — a linha tinha série, número e total,
-- e o resto era remontado da comanda, o que daria outra chave (a data e o
-- código entram no cálculo dela).
--
-- Guardar o documento como ele nasceu é também o que permite conferir, meses
-- depois, o que foi declarado: o XML só existe depois da autorização.
ALTER TABLE "notas_fiscais" ADD COLUMN "emitida" JSONB;

-- A fila de quem espera transmissão é varrida por unidade e por idade: a mais
-- velha primeiro, porque é a que está mais perto de estourar o prazo legal.
CREATE INDEX "notas_fiscais_unidadeId_status_criadoEm_idx"
  ON "notas_fiscais" ("unidadeId", "status", "criadoEm");
