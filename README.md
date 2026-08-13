# MaisMoney Inbox

Plataforma interna de atendimento WhatsApp da MaisMoney. Contexto completo do projeto está em [CLAUDE.md](./CLAUDE.md) — leia antes de mexer em qualquer parte do sistema.

## Estrutura

```
backend/    Express + TypeScript + Prisma (PostgreSQL)
frontend/   React + Vite + TypeScript + Tailwind
```

## Rodando localmente

### 1. Banco de dados

```
docker compose up -d
```

Sobe um PostgreSQL local em `localhost:5432` (usuário/senha/banco: `maismoney`).

### 2. Backend

```
cd backend
cp .env.example .env
npm install
npm run prisma:migrate    # cria as tabelas
npm run seed               # cria o usuário admin (usa ADMIN_EMAIL/ADMIN_SENHA do .env)
npm run dev                 # http://localhost:3333
```

### 3. Frontend

```
cd frontend
cp .env.example .env
npm install
npm run dev                 # http://localhost:5173
```

Login com o e-mail/senha definidos em `backend/.env` (`ADMIN_EMAIL` / `ADMIN_SENHA`).

## Deploy em produção

Ver [DEPLOY.md](./DEPLOY.md) — guia completo para VPS (Docker + Nginx + HTTPS via certbot).

## Status

**Backend implementado** (itens 1–9 da prioridade de build, seção 13 do CLAUDE.md):

- Autenticação (login JWT, roles admin/operador)
- WebSocket (Socket.io, autenticado por JWT) para atualização de conversas em tempo real
- Conversas e mensagens (listar, detalhar, atualizar status/operador, enviar texto e mídia)
- Upload de mídia com rota de acesso autenticada (header JWT ou URL assinada de curta duração para o provedor de WhatsApp buscar o arquivo)
- Integração Evolution API: cliente de envio + webhook receptor (`POST /api/webhooks/evolution`)
- Integração Meta Cloud API: cliente de envio (texto e template) + webhook receptor com verificação de assinatura (`GET`/`POST /api/webhooks/meta`)
- Módulo de disparos (envio via template Meta Cloud API)
- Métricas reais via agregação no Postgres (`/api/metricas/*`)
- Gestão de usuários (CRUD admin, com proteção contra auto-desativação)
- Job diário de deleção de mídia após 4 dias de inatividade (`node-cron`, 03:00)

**Frontend conectado ao backend real** — nenhuma tela usa mais dado mockado:

- **Dashboard** — métricas resumidas e conversas recentes reais, com sparklines/comparativos calculados a partir de histórico diário real (não inventado)
- **Métricas** (admin) — gráficos de volume, atendimentos por operador, distribuição por status e tempo de resposta, todos via agregação real no Postgres. "Metas do time" usa alvos configurados localmente (não existe tabela de metas no schema) combinados com valores atuais reais
- **Conversas** — lista com filtro por status, atualização ao vivo via WebSocket
- **Conversa individual** — histórico de mensagens, envio de texto e mídia, indicador de status/operador, aviso e bloqueio de texto livre fora da janela de 24h para números Meta Cloud API
- **Números** — cadastrar/editar instâncias (Evolution API e Meta Cloud API), cadastrar/remover templates HSM, status, botão de reconexão (QR Code)
- **Usuários** (admin) — criar operadores/admins, ativar/desativar
- **Disparos** — seleção de número Meta Cloud API, template, variáveis, destinatário único ou importação de lista via CSV
- **Configurações** — qualquer usuário edita o próprio nome/senha; admin vê informações do sistema (empresa, retenção de mídia, contadores)
- **Etiquetas** — sistema de tags livres nas conversas (criadas pelos próprios usuários), com filtro dedicado, além de filtros por número e por vendedor

Testado de ponta a ponta com os dois servidores rodando: simulei exatamente as chamadas que cada tela faz (login → dashboard → métricas → conversas → conversa individual → envio de mensagem → assumir conversa → instâncias → usuários → templates) e todas retornaram os dados esperados.

**O que ainda não dá para testar de verdade:** a entrega de fato pelas APIs do WhatsApp (Evolution API self-hosted e Meta Cloud API) — o código chama as APIs corretamente, mas precisa das credenciais reais do negócio (ver `backend/.env.example`) para confirmar a entrega. Sem isso, mensagens enviadas pela tela de conversa ficam salvas localmente mas aparecem como "não entregue".

**Pendente:** fluxo de recuperação de senha por e-mail (hoje é só uma tela informativa direcionando a falar com um admin).

**Hardening de produção:** helmet (cabeçalhos de segurança), rate limit no login (10 tentativas / 15 min), shutdown gracioso (SIGTERM), `trust proxy` para funcionar atrás do Nginx.
