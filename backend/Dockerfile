FROM node:22-alpine

WORKDIR /app

# Prisma precisa da libc real (não musl) para o motor de query no Alpine.
# ffmpeg converte áudio gravado no navegador (webm/opus) pra ogg/opus, formato que a
# Meta Cloud API aceita de verdade pra mensagem de voz (webm não está na lista dela).
RUN apk add --no-cache openssl libc6-compat ffmpeg

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npx prisma generate
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3333

# Aplica migrations pendentes e sobe o servidor. Seguro rodar em todo restart:
# "migrate deploy" só aplica o que ainda não foi aplicado.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
