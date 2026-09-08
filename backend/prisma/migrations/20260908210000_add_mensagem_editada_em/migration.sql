-- Marca quando o operador editou o texto de uma mensagem já enviada (só
-- possível via Evolution API) — mostra a tag "editada" igual o WhatsApp real.
ALTER TABLE "mensagens" ADD COLUMN "editada_em" TIMESTAMP(3);
