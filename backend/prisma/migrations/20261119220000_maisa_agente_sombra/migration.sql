-- Fase 4: o agente em modo sombra guarda a resposta do roteiro e o motivo da decisao.
ALTER TABLE "maisa_interpretacoes" ADD COLUMN "texto_real" TEXT;
ALTER TABLE "maisa_interpretacoes" ADD COLUMN "motivo" TEXT;
