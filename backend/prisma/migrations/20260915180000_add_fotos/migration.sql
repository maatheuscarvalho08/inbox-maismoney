-- Avatar do operador (upload próprio) e foto de perfil do WhatsApp do contato
-- (só via Evolution — Meta Cloud API não expõe isso).
ALTER TABLE "usuarios" ADD COLUMN "foto_path" TEXT;
ALTER TABLE "contatos" ADD COLUMN "foto_url" TEXT;
ALTER TABLE "contatos" ADD COLUMN "foto_atualizada_em" TIMESTAMP(3);
