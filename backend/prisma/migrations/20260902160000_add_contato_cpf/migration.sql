-- Campo separado pro CPF do cliente — evita que operador tenha que espremer
-- nome e CPF juntos no mesmo campo de texto.
ALTER TABLE "contatos" ADD COLUMN "cpf" TEXT;
