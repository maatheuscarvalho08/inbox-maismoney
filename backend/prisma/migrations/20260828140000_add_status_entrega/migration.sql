-- Confirmação de entrega estilo WhatsApp (enviado/entregue/lido/falhou), populada pelo
-- webhook "statuses" da Meta a partir do wamid (já reaproveitamos external_id, que hoje
-- só guardava o ID de mensagens recebidas, pra guardar também o wamid da que a gente envia).
CREATE TYPE "StatusEntrega" AS ENUM ('enviado', 'entregue', 'lido', 'falhou');
ALTER TABLE "mensagens" ADD COLUMN "status_entrega" "StatusEntrega";
