-- Guarda o corpo aprovado do template (com {{1}}, {{2}}...) pra mostrar a mensagem
-- real enviada no histórico de disparos, em vez de só "template X".
ALTER TABLE "templates" ADD COLUMN "corpo" TEXT;
