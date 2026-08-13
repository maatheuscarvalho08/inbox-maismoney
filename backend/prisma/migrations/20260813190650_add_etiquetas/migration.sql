-- CreateTable
CREATE TABLE "etiquetas" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "etiquetas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversa_etiquetas" (
    "conversa_id" TEXT NOT NULL,
    "etiqueta_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversa_etiquetas_pkey" PRIMARY KEY ("conversa_id","etiqueta_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "etiquetas_nome_key" ON "etiquetas"("nome");

-- AddForeignKey
ALTER TABLE "conversa_etiquetas" ADD CONSTRAINT "conversa_etiquetas_conversa_id_fkey" FOREIGN KEY ("conversa_id") REFERENCES "conversas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversa_etiquetas" ADD CONSTRAINT "conversa_etiquetas_etiqueta_id_fkey" FOREIGN KEY ("etiqueta_id") REFERENCES "etiquetas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
