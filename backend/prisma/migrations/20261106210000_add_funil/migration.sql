-- CreateEnum
CREATE TYPE "Convenio" AS ENUM ('inss', 'clt', 'siape', 'servidor_prefeitura', 'marinha', 'militar', 'conta_de_luz', 'loas', 'credito_pessoal', 'fgts');

-- CreateEnum
CREATE TYPE "EtapaFunil" AS ENUM ('lead', 'dados_coletados', 'simulacao', 'simulacao_com_saldo', 'proposta_digitada', 'proposta_paga');

-- AlterTable
ALTER TABLE "conversas" ADD COLUMN     "convenio" "Convenio",
ADD COLUMN     "convenio_origem" TEXT,
ADD COLUMN     "etapa_funil" "EtapaFunil";

-- CreateTable
CREATE TABLE "funil_eventos" (
    "id" TEXT NOT NULL,
    "conversa_id" TEXT NOT NULL,
    "etapa" "EtapaFunil" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "funil_eventos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "funil_eventos_etapa_created_at_idx" ON "funil_eventos"("etapa", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "funil_eventos_conversa_id_etapa_key" ON "funil_eventos"("conversa_id", "etapa");

-- AddForeignKey
ALTER TABLE "funil_eventos" ADD CONSTRAINT "funil_eventos_conversa_id_fkey" FOREIGN KEY ("conversa_id") REFERENCES "conversas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Histórico: toda conversa em que o cliente já escreveu conta como lead, na data da
-- primeira mensagem dele.
INSERT INTO "funil_eventos" ("id", "conversa_id", "etapa", "created_at")
SELECT gen_random_uuid()::text, m."conversa_id", 'lead', MIN(m."timestamp")
FROM "mensagens" m
WHERE m."remetente_tipo" = 'cliente'
GROUP BY m."conversa_id";

-- Histórico: lead com CPF já cadastrado conta como dados coletados. A data real não
-- existe, então usa a mesma do lead.
INSERT INTO "funil_eventos" ("id", "conversa_id", "etapa", "created_at")
SELECT gen_random_uuid()::text, e."conversa_id", 'dados_coletados', e."created_at"
FROM "funil_eventos" e
JOIN "conversas" c ON c."id" = e."conversa_id"
JOIN "contatos" ct ON ct."id" = c."contato_id"
WHERE e."etapa" = 'lead' AND ct."cpf" IS NOT NULL;

UPDATE "conversas" c
SET "etapa_funil" = CASE
  WHEN EXISTS (SELECT 1 FROM "funil_eventos" e WHERE e."conversa_id" = c."id" AND e."etapa" = 'dados_coletados') THEN 'dados_coletados'::"EtapaFunil"
  ELSE 'lead'::"EtapaFunil"
END
WHERE EXISTS (SELECT 1 FROM "funil_eventos" e WHERE e."conversa_id" = c."id");
