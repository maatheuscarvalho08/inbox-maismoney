# Deploy — VPS Hostinger

Guia para colocar o MaisMoney Inbox no ar numa VPS (testado mentalmente contra uma
Hostinger KVM 2 / Ubuntu — ajuste comandos se usar outra distro). Este arquivo não
foi executado numa VPS de verdade; revise cada passo antes de rodar em produção.

## Visão geral

- **Postgres + Backend + Evolution API** rodam em Docker (`docker-compose.prod.yml`).
- **Frontend** é buildado como arquivos estáticos e servido direto pelo **Nginx do host**
  (mais simples de combinar com HTTPS via certbot do que dockerizar mais uma camada).
- **Nginx** faz proxy de `/api` e `/socket.io` para o backend e serve o frontend.

## 1. Preparar a VPS

```bash
ssh root@SEU_IP

apt update && apt upgrade -y

# Docker
curl -fsSL https://get.docker.com | sh

# Node (para buildar o frontend na própria VPS)
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs

# Nginx + Certbot
apt install -y nginx certbot python3-certbot-nginx
```

## 2. Apontar o domínio

No painel da Hostinger (ou onde o domínio estiver registrado), crie um registro **A**
apontando `seu-dominio.com` para o IP da VPS. Espere propagar (minutos a poucas horas)
antes de rodar o certbot no passo 6.

## 3. Levar o código para a VPS

Se ainda não subiu este projeto para um repositório remoto (GitHub/GitLab), faça isso
primeiro. Depois, na VPS:

```bash
mkdir -p /var/www/maismoney-inbox
cd /var/www/maismoney-inbox
git clone SEU_REPOSITORIO .
```

## 4. Configurar variáveis de ambiente

```bash
cp .env.example .env
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

Edite os três arquivos:

- **`.env`** (raiz): `POSTGRES_PASSWORD` forte, `EVOLUTION_API_KEY` forte,
  `EVOLUTION_SERVER_URL=https://seu-dominio.com/evolution`.
- **`backend/.env`**:
  - `DATABASE_URL` → troque `localhost` por `db` e use a mesma senha do `.env` raiz:
    `postgresql://maismoney:SENHA@db:5432/maismoney_inbox?schema=public`
  - `JWT_SECRET` → gere um novo, nunca reaproveite o de dev:
    `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
  - `CORS_ORIGIN=https://seu-dominio.com`
  - `PUBLIC_API_URL=https://seu-dominio.com/api`
  - `EVOLUTION_API_URL=http://evolution-api:8080` (nome do serviço, não localhost)
  - `EVOLUTION_API_KEY` → mesma chave do `.env` raiz
  - `ADMIN_EMAIL` / `ADMIN_SENHA` → credenciais reais do primeiro admin (troque a senha
    de exemplo)
  - Campos `META_*` ficam vazios até vocês terem o app da Meta configurado (item 9)
- **`frontend/.env`**: `VITE_API_URL=https://seu-dominio.com/api`

## 5. Subir Postgres + Backend + Evolution API

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml logs -f backend   # confirme que subiu sem erro, Ctrl+C pra sair
```

O backend roda `prisma migrate deploy` sozinho ao iniciar. Depois, crie o admin:

```bash
docker compose -f docker-compose.prod.yml exec backend npm run seed
```

## 6. Buildar e publicar o frontend

```bash
cd frontend
npm install
npm run build
cd ..
```

O Nginx (próximo passo) serve direto de `frontend/dist`.

## 7. Configurar o Nginx

```bash
cp deploy/nginx.conf /etc/nginx/sites-available/maismoney-inbox
nano /etc/nginx/sites-available/maismoney-inbox   # troque SEU_DOMINIO pelo domínio real
                                                     # e confira o caminho de "root"

ln -s /etc/nginx/sites-available/maismoney-inbox /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx
```

## 8. HTTPS

```bash
certbot --nginx -d seu-dominio.com
```

O certbot edita o `server block` sozinho para adicionar TLS e redirecionar HTTP→HTTPS.
Teste em `https://seu-dominio.com` — deve carregar a tela de login.

## 9. Conectar os números de WhatsApp

**Evolution API (atendimento receptivo):**

1. Configure o webhook da instância para `https://seu-dominio.com/api/webhooks/evolution`
   (evento `messages.upsert` e `connection.update`) — normalmente feito via chamada à
   própria API da Evolution ao criar a instância. Confira o formato atual na
   [documentação oficial](https://doc.evolution-api.com), que muda com frequência.
2. Na tela **Números** do sistema (admin), clique **Novo número**, escolha
   *Evolution API* e informe o nome da instância que você criou na Evolution.
3. Clique **Reconectar (QR Code)** e escaneie com o WhatsApp do número.

**Meta Cloud API (disparos):**

1. No [Meta for Developers](https://developers.facebook.com), configure o app do
   WhatsApp Business, pegue `Phone Number ID`, `WABA ID` e o `Access Token`.
2. Configure o webhook do app para `https://seu-dominio.com/api/webhooks/meta`, usando
   o mesmo valor de `META_WEBHOOK_VERIFY_TOKEN` que está no `backend/.env`.
3. Preencha `META_ACCESS_TOKEN` e `META_APP_SECRET` no `backend/.env` e reinicie o
   backend: `docker compose -f docker-compose.prod.yml restart backend`.
4. Na tela **Números**, cadastre o número como *Meta Cloud API* com o Phone Number ID
   e WABA ID reais.
5. Nos cards de números Meta Cloud API, cadastre os 3 templates HSM já aprovados pela
   Meta (nome interno + ID aprovado).

## 10. Verificação final

- [ ] Login funciona em `https://seu-dominio.com`
- [ ] `docker compose -f docker-compose.prod.yml ps` mostra os 3 serviços `healthy`/`running`
- [ ] Enviar uma mensagem de teste pelo WhatsApp real chega em **Conversas**
- [ ] Responder pela tela entrega de volta no WhatsApp do cliente
- [ ] Painel **Configurações → Sistema** mostra os números conectados

## Atualizações futuras

```bash
cd /var/www/maismoney-inbox
git pull
docker compose -f docker-compose.prod.yml up -d --build backend
cd frontend && npm install && npm run build && cd ..
systemctl reload nginx
```

## Segurança — revisão feita antes do deploy (2026-08-14)

Revisei o código em busca de vulnerabilidades antes de liberar o deploy. Corrigidos direto no código: path traversal no upload de mídia (usuário conseguia escrever arquivo fora de `uploads/` via `conversaId` malicioso), sessão de usuário desativado/rebaixado que continuava válida até o token expirar (até 8h), verificação de assinatura do webhook Meta que "falhava aberta" quando `META_APP_SECRET` não estava configurado, reuso do `JWT_SECRET` como chave de assinatura de mídia, e falta de rate limit geral na API.

Dois pontos ficaram **documentados, não corrigidos** — avaliei que mexer agora tinha mais risco de travar o deploy do que benefício imediato:

- **Container do backend roda como root** (`backend/Dockerfile` não define `USER`). Rodar como usuário não-root é mais seguro, mas exige garantir que o volume `backend_uploads` tenha permissão de escrita pro novo usuário — não dá pra validar isso sem um Docker de verdade rodando (este ambiente de dev não tem Docker). Recomendo revisitar depois que o deploy inicial estiver estável.
- **`npm audit` no backend acusa uma vulnerabilidade alta em `deepmerge-ts`**, puxada por `@prisma/config`/`prisma`. É a *CLI* do Prisma (usada só em `prisma migrate deploy` no start do container), não código exposto a request HTTP — risco prático baixo. Ainda não existe versão corrigida publicada. Rode `npm audit` de novo mais perto do deploy pra ver se já saiu fix.

## O que eu não consegui validar daqui

Este ambiente de desenvolvimento não tem Docker instalado (sem acesso admin), então
**não rodei `docker compose build` de verdade** — só revisei os Dockerfiles e o compose
manualmente. Antes de considerar o deploy pronto, rode `docker compose -f
docker-compose.prod.yml up -d --build` na VPS e confira os logs do backend com atenção
a erros de build do Prisma ou de conexão com o Postgres.
