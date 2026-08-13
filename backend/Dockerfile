FROM node:22-alpine

WORKDIR /app

# Prisma precisa da libc real (não musl) para o motor de query no Alpine.
RUN apk add --no-cache openssl libc6-compat

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
