-- Fase 2: módulo de discadora (Twilio Voice + IVR). Aditivo, não altera nenhuma
-- tabela existente.

CREATE TYPE "StatusCampanha" AS ENUM ('rascunho', 'em_andamento', 'pausada', 'concluida');
CREATE TYPE "StatusLigacao" AS ENUM ('pendente', 'discando', 'atendeu', 'nao_atendeu', 'ocupado', 'erro');

CREATE TABLE "campanhas_discadora" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "audio_path" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "instancia_id" TEXT NOT NULL,
    "status" "StatusCampanha" NOT NULL DEFAULT 'rascunho',
    "total_numeros" INTEGER NOT NULL DEFAULT 0,
    "criado_por" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campanhas_discadora_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "campanha_numeros" (
    "id" TEXT NOT NULL,
    "campanha_id" TEXT NOT NULL,
    "numero_whatsapp" TEXT NOT NULL,
    "nome_contato" TEXT,
    "status_ligacao" "StatusLigacao" NOT NULL DEFAULT 'pendente',
    "apertou_1" BOOLEAN NOT NULL DEFAULT false,
    "hsm_disparado" BOOLEAN NOT NULL DEFAULT false,
    "twilio_call_sid" TEXT,
    "iniciado_em" TIMESTAMP(3),
    "finalizado_em" TIMESTAMP(3),

    CONSTRAINT "campanha_numeros_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "campanhas_discadora" ADD CONSTRAINT "campanhas_discadora_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "campanhas_discadora" ADD CONSTRAINT "campanhas_discadora_instancia_id_fkey" FOREIGN KEY ("instancia_id") REFERENCES "instancias"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "campanhas_discadora" ADD CONSTRAINT "campanhas_discadora_criado_por_fkey" FOREIGN KEY ("criado_por") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "campanha_numeros" ADD CONSTRAINT "campanha_numeros_campanha_id_fkey" FOREIGN KEY ("campanha_id") REFERENCES "campanhas_discadora"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "campanha_numeros_campanha_id_idx" ON "campanha_numeros"("campanha_id");
CREATE INDEX "campanha_numeros_twilio_call_sid_idx" ON "campanha_numeros"("twilio_call_sid");
