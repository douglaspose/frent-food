-- Cada aparelho da casa com a sua própria credencial.
--
-- A credencial era uma só, a da unidade, e todos os aparelhos usavam a mesma:
-- a maquininha do garçom, a do caixa e o agente de impressão do balcão. Uma
-- maquininha perdida só se cortava regerando esse token — o que derrubava
-- todos os outros junto, no meio do turno.
--
-- O token da unidade continua valendo: o agente de impressão instalado nos
-- restaurantes não muda de uma vez, e um cadastro novo não pode parar quem já
-- está imprimindo.
CREATE TYPE "TipoAparelho" AS ENUM ('MAQUININHA', 'AGENTE_IMPRESSAO');

CREATE TABLE "aparelhos" (
  "id"              TEXT NOT NULL,
  "tenantId"        TEXT NOT NULL,
  "unidadeId"       TEXT NOT NULL,
  "nome"            TEXT NOT NULL,
  "tipo"            "TipoAparelho" NOT NULL DEFAULT 'MAQUININHA',
  "token"           TEXT NOT NULL,
  "ativo"           BOOLEAN NOT NULL DEFAULT true,
  -- Gravado no máximo uma vez por minuto: a maquininha busca a fila a cada
  -- poucos segundos, e um UPDATE por busca é escrita sem resposta nova.
  "ultimoContatoEm" TIMESTAMP(3),
  "ultimoApelido"   TEXT,
  "criadoEm"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revogadoEm"      TIMESTAMP(3),

  CONSTRAINT "aparelhos_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "aparelhos_token_key" ON "aparelhos" ("token");
CREATE INDEX "aparelhos_tenantId_idx" ON "aparelhos" ("tenantId");
CREATE INDEX "aparelhos_unidadeId_ativo_idx" ON "aparelhos" ("unidadeId", "ativo");

ALTER TABLE "aparelhos"
  ADD CONSTRAINT "aparelhos_unidadeId_fkey"
  FOREIGN KEY ("unidadeId") REFERENCES "unidades"("id") ON DELETE CASCADE ON UPDATE CASCADE;
