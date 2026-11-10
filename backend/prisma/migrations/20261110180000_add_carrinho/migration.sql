-- Conversa ofertada pela Maisa e sem resposta por 24h.
ALTER TABLE "conversas" ADD COLUMN "carrinho_em" TIMESTAMP(3);
CREATE INDEX "conversas_carrinho_em_idx" ON "conversas"("carrinho_em");
