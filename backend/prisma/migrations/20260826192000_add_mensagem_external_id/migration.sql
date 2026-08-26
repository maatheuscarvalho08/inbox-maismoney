-- Guarda o ID da mensagem no provedor (wamid da Meta / key.id do Evolution) pra
-- deduplicar reentregas de webhook (Meta garante "pelo menos uma vez", não "exatamente
-- uma vez" — sem isso, o mesmo evento reentregue cria mensagem duplicada).
ALTER TABLE "mensagens" ADD COLUMN "external_id" TEXT;
CREATE UNIQUE INDEX "mensagens_external_id_key" ON "mensagens"("external_id");
