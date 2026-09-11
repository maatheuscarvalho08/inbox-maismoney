-- Motivo real da falha de entrega, persistido no banco — antes só ia pro log
-- do container, que some a cada deploy/restart.
ALTER TABLE "mensagens" ADD COLUMN "erro_entrega" TEXT;
