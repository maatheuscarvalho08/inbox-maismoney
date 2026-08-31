-- Marca conversas que nasceram de um disparo (etiqueta azul, permanente) e se já
-- receberam resposta do cliente (controla a aba "Disparos" x "Atendimento").
ALTER TABLE "conversas" ADD COLUMN "origem_disparo" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "conversas" ADD COLUMN "respondida" BOOLEAN NOT NULL DEFAULT true;
