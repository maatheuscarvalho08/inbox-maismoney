-- CreateEnum
CREATE TYPE "Role" AS ENUM ('admin', 'operador');

-- CreateEnum
CREATE TYPE "TipoConexao" AS ENUM ('evolution', 'meta_cloud');

-- CreateEnum
CREATE TYPE "StatusInstancia" AS ENUM ('conectado', 'desconectado');

-- CreateEnum
CREATE TYPE "StatusConversa" AS ENUM ('aberta', 'em_atendimento', 'encerrada');

-- CreateEnum
CREATE TYPE "RemetenteTipo" AS ENUM ('cliente', 'operador');

-- CreateTable
CREATE TABLE "usuarios" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "senha_hash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instancias" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "tipo_conexao" "TipoConexao" NOT NULL,
    "evolution_instance_id" TEXT,
    "meta_phone_number_id" TEXT,
    "meta_waba_id" TEXT,
    "status" "StatusInstancia" NOT NULL DEFAULT 'desconectado',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "instancias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "templates" (
    "id" TEXT NOT NULL,
    "instancia_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "meta_template_id" TEXT NOT NULL,
    "variaveis_schema" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contatos" (
    "id" TEXT NOT NULL,
    "nome" TEXT,
    "numero_whatsapp" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contatos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversas" (
    "id" TEXT NOT NULL,
    "instancia_id" TEXT NOT NULL,
    "contato_id" TEXT NOT NULL,
    "status" "StatusConversa" NOT NULL DEFAULT 'aberta',
    "operador_id" TEXT,
    "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mensagens" (
    "id" TEXT NOT NULL,
    "conversa_id" TEXT NOT NULL,
    "remetente_tipo" "RemetenteTipo" NOT NULL,
    "operador_id" TEXT,
    "conteudo_texto" TEXT,
    "tipo_midia" TEXT,
    "midia_path" TEXT,
    "midia_deleted" BOOLEAN NOT NULL DEFAULT false,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mensagens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_email_key" ON "usuarios"("email");

-- CreateIndex
CREATE UNIQUE INDEX "instancias_numero_key" ON "instancias"("numero");

-- CreateIndex
CREATE UNIQUE INDEX "contatos_numero_whatsapp_key" ON "contatos"("numero_whatsapp");

-- AddForeignKey
ALTER TABLE "templates" ADD CONSTRAINT "templates_instancia_id_fkey" FOREIGN KEY ("instancia_id") REFERENCES "instancias"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversas" ADD CONSTRAINT "conversas_instancia_id_fkey" FOREIGN KEY ("instancia_id") REFERENCES "instancias"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversas" ADD CONSTRAINT "conversas_contato_id_fkey" FOREIGN KEY ("contato_id") REFERENCES "contatos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversas" ADD CONSTRAINT "conversas_operador_id_fkey" FOREIGN KEY ("operador_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensagens" ADD CONSTRAINT "mensagens_conversa_id_fkey" FOREIGN KEY ("conversa_id") REFERENCES "conversas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensagens" ADD CONSTRAINT "mensagens_operador_id_fkey" FOREIGN KEY ("operador_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
