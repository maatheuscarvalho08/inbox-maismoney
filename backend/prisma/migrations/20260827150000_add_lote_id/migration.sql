-- Agrupa disparos de um mesmo envio em massa (CSV) no histórico da tela de Disparos.
ALTER TABLE "mensagens" ADD COLUMN "lote_id" TEXT;
CREATE INDEX "mensagens_lote_id_idx" ON "mensagens"("lote_id");
