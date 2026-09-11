-- Resposta citada (reply do WhatsApp) — referencia a mensagem original dentro
-- da mesma conversa. SET NULL se a original for removida, pra não travar delete.
ALTER TABLE "mensagens" ADD COLUMN "responde_a_id" TEXT;
ALTER TABLE "mensagens" ADD CONSTRAINT "mensagens_responde_a_id_fkey"
  FOREIGN KEY ("responde_a_id") REFERENCES "mensagens"("id") ON DELETE SET NULL ON UPDATE CASCADE;
