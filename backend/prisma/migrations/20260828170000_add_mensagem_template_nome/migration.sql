-- conteudo_texto de um disparo passa a ser a mensagem de verdade enviada (corpo do
-- template com variáveis substituídas), então o nome do template precisa de campo
-- próprio — antes era descoberto fazendo parsing do texto "[Disparo · template X]".
ALTER TABLE "mensagens" ADD COLUMN "template_nome" TEXT;

-- Backfill: disparos já existentes guardam o nome só dentro do texto antigo
-- ("[Disparo · template "X"]") — extrai daqui antes que o texto vire outra coisa.
UPDATE "mensagens"
SET "template_nome" = substring("conteudo_texto" FROM 'template "([^"]+)"')
WHERE "conteudo_texto" LIKE '[Disparo%' AND "template_nome" IS NULL;

