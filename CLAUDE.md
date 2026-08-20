# FRAMEWORK — Plataforma WhatsApp Interna MaisMoney
> Contexto completo para Claude Code. Leia inteiro antes de escrever qualquer linha de código.

---

## 1. CONTEXTO DA EMPRESA

**Empresa:** MAIS MONEY PROMOTORA DE VENDAS LTDA - ME  
**CNPJ:** 45.027.472/0001-76  
**Setor:** Correspondente bancário / crédito consignado  
**Localização:** Rio de Janeiro, RJ  
**Instagram/Facebook:** @maismoneyrj  

---

## 2. O QUE É ESSE PROJETO

Uma plataforma web interna para centralizar e gerenciar todos os atendimentos via WhatsApp da empresa. Fase 1 é uso interno. Fase futura pode evoluir para SaaS multi-tenant.

**Não é um chatbot.** É uma interface de atendimento humano centralizado, com controle de operadores, métricas e histórico.

---

## 3. STACK TÉCNICA

- **Frontend:** React + Vite + TypeScript + Tailwind CSS
- **Backend:** Node.js + Express + TypeScript
- **Banco de dados:** PostgreSQL (self-hosted no VPS)
- **WhatsApp API:** Evolution API (self-hosted, Docker) para atendimento receptivo + Meta Cloud API (oficial) para disparos
- **Armazenamento de mídia:** Local no VPS (temporário, com deleção automática)
- **Hospedagem:** VPS Hostinger KVM 2 (2 vCPU / 8GB RAM, confirmado em produção), Docker + Traefik (com n8n já rodando na mesma VPS, não gerenciado por este projeto)
- **Autenticação:** JWT com roles (admin / operador)

---

## 4. NÚMEROS WHATSAPP

| Número | Tipo de conexão | Função |
|--------|----------------|--------|
| Número 1 | Meta Cloud API (oficial) | Disparos |
| Número 2 | Meta Cloud API (oficial) | Disparos |
| Número 3 | Evolution API (self-hosted) | Atendimento receptivo |
| Número 4 | Evolution API (self-hosted) | Atendimento receptivo |

**Meta Cloud API:** integração testada e funcional de ponta a ponta em produção — webhook configurado (`https://inbox.maismoney.org/api/webhooks/meta`), assinatura verificada, handshake e teste de payload confirmados via log real do Nginx. Número `+55 21 99311-2632` (App ID `1007205988508804`, WABA `1033046152722350`) tem 4 templates HSM aprovados. **Pendência:** esse número estava ligado ao WhatsApp Business App normal; a conta foi excluída do celular pra liberar a migração, a verificação por SMS foi concluída, mas o registro no Cloud API ficou em status "Pendente" por mais de 1h sem progredir — chamado aberto no suporte da Meta pra destravar. Sem esse registro completo, mensagens reais não chegam no webhook (confirmado via teste real: mensagem entregue no celular, nada no backend).

**Evolution API:** self-hosted via Docker, cada número é uma instância separada.

---

## 5. USUÁRIOS E PERMISSÕES

| Role | Permissões |
|------|-----------|
| **Admin** | Acesso total: métricas, configurações, todos os atendimentos, gestão de usuários |
| **Operador** | Atender conversas, enviar/receber mensagens e mídia, ver próprio histórico |

- Equipe atual: 3 pessoas (todos operadores, 1 é admin)
- Qualquer operador pode atender qualquer conversa (sem fila exclusiva por operador)

---

## 6. FUNCIONALIDADES — ESTADO ATUAL (FASE 1)

### 6.1 — Atendimento
- [x] Visualizar todas as conversas ativas de todos os números em uma única tela
- [x] Abrir conversa e ver histórico de mensagens
- [x] Enviar mensagens de texto
- [x] Enviar áudios, fotos e outros arquivos de mídia
- [x] Registrar qual operador respondeu cada mensagem
- [x] Indicar status da conversa (aberta / em_atendimento / aguardando / encerrada)

### 6.2 — Métricas
- [x] Volume de mensagens por período (dia/semana/mês)
- [x] % de mensagens não respondidas
- [x] Volume de atendimentos por operador
- [x] Tempo médio de resposta

### 6.3 — Gestão de usuários
- [x] Criar/editar/desativar operadores
- [x] Definir role (admin / operador)
- [x] Login com e-mail e senha

### 6.4 — Etiquetas
- [x] Sistema livre de etiquetas — qualquer usuário cria etiqueta com nome próprio (até 40 caracteres), sem lista predefinida
- [x] Etiqueta anexável em quantas conversas quiser
- [x] Filtro dedicado por etiqueta na tela de Conversas

### 6.5 — Configurações
- [x] Card de perfil (todos os usuários): editar nome e senha, com confirmação da senha atual
- [x] Card de sistema (admin only, somente leitura): nome da empresa, dias de retenção de mídia, contadores

### 6.6 — Módulo de Disparos (Meta Cloud API)
- [x] Selecionar número de origem (dos 2 números oficiais)
- [x] Selecionar template HSM aprovado (3 por número), com importação em massa via CSV
- [x] Preencher variáveis do template
- [x] Inserir número(s) destinatário(s)
- [x] Enviar disparo e registrar no histórico
- [x] Receber e exibir respostas aos disparos na tela de conversas
- Código pronto e testado ponta a ponta; ver seção 4 sobre o status do número de produção

### 6.7 — Conexão WhatsApp
- [x] Listar instâncias Evolution API e Meta Cloud API cadastradas
- [x] Status de cada número (conectado / desconectado)
- [x] QR Code para reconectar número Evolution API (admin only)

---

## 7. REGRAS DE ARMAZENAMENTO DE MÍDIA

> **Contexto importante:** a empresa recebe documentos pessoais e bancários de clientes via WhatsApp (CPF, RG, contracheque, etc.). Não há obrigatoriedade legal de retenção desses arquivos.

**Regra:**
- Arquivos de mídia (fotos, áudios, documentos) são deletados automaticamente após **4 dias de inatividade na conversa**
- "Inatividade" = nenhuma mensagem nova (de nenhum dos lados) por 4 dias
- Após deleção, o banco mantém apenas o **metadado** (tipo de arquivo, timestamp, nome do remetente) — o arquivo em si é removido do disco
- Textos das conversas: **mantidos permanentemente**
- Regra se aplica igualmente a mídia enviada pelo cliente e pelo operador

**Implementação sugerida:**
- Job cron diário verificando `last_message_at` de cada conversa
- Se `now() - last_message_at > 4 dias` → deletar arquivos físicos, atualizar registro no banco com `media_deleted: true`

---

## 8. DESIGN E IDENTIDADE VISUAL

### Referência visual
O frontend deve seguir o mesmo padrão do **CorbanCRM** já existente:
- Layout dark
- Sidebar à esquerda com navegação
- Tabelas com dados de atendimento
- Cards de métricas no topo

### Paleta de cores — "The Deep Blue"
Substituir as cores do CorbanCRM pelas cores abaixo. Apenas estes 7 tokens são permitidos em todo o sistema — nenhuma outra cor deve ser usada:

| Token | Hex | Uso |
|-------|-----|-----|
| `--color-primary` | `#ff8910` | Cor dominante: item ativo da sidebar, botões principais, CTAs, "Sair", alertas/atenção, borda de foco em inputs |
| `--color-accent` | `#1b36f5` | Acento: badges de status positivo, números de métricas no Dashboard, links e elementos clicáveis secundários |
| `--color-white` | `#ffffff` | Texto principal, ícones da sidebar (ativo e inativo), labels de cards |
| `--color-bg` | `#0d0f14` | Fundo geral da aplicação |
| `--color-surface` | `#13161f` | Cards, sidebar, painéis elevados |
| `--color-border` | `#1e2130` | Bordas sutis, skeletons/loading states |
| `--color-muted` | `#6b7280` | Textos secundários, labels, placeholders, subtítulos |

`--color-accent` (`#1b36f5`) tem apenas 2.49:1 de contraste sobre `--color-surface` — abaixo do mínimo de 4.5:1 para texto. Para texto/ícone pequeno sobre fundo escuro, usar `var(--color-accent-fg)` (tint derivado do mesmo azul, definido em `frontend/src/index.css`) em vez de `text-accent` diretamente. `--color-accent` continua valendo normalmente para fundos, badges translúcidos e bordas.

**Pendência conhecida:** `--color-muted` também fica abaixo de 4.5:1 sobre `surface`/`bg` (~3.7-4:1). Como é um dos 7 hex fixados pelo cliente, não foi ajustado — sinalizar antes de decidir se muda o valor ou se aceita o risco de acessibilidade.

### Tipografia e componentes
- Seguir o mesmo padrão de cards, tabelas e sidebar do CorbanCRM
- Fonte: Inter
- Apenas substituir a identidade de cor

---

## 9. ESTRUTURA DE TELAS SUGERIDA

```
/login                  → Tela de login (e-mail + senha)
/dashboard              → Visão geral: métricas, conversas recentes
/conversas              → Lista de todas as conversas (todos os números)
/conversas/:id          → Conversa individual com histórico e input
/disparos               → Módulo de disparos (Meta Cloud API, seção 6.4)
/numeros                → Status das instâncias WhatsApp (admin only)
/metricas               → Dashboard de métricas detalhadas (admin only)
/usuarios               → Gestão de operadores (admin only)
/configuracoes          → Configurações gerais (admin only)
```

---

## 10. ESTRUTURA DE BANCO DE DADOS (esboço)

```sql
-- Usuários do sistema
usuarios (id, nome, email, senha_hash, role, ativo, created_at)

-- Instâncias WhatsApp (números)
instancias (
  id, nome, numero, tipo_conexao (evolution|meta_cloud),
  evolution_instance_id, meta_phone_number_id, meta_waba_id,
  status, created_at
)

-- Templates HSM aprovados (apenas números Meta Cloud API)
templates (id, instancia_id, nome, meta_template_id, variaveis_schema, created_at)

-- Contatos (clientes que falam com a empresa)
contatos (id, nome, numero_whatsapp, created_at)

-- Conversas
conversas (id, instancia_id, contato_id, status, operador_id, last_message_at, created_at)

-- Mensagens
mensagens (
  id, conversa_id, remetente_tipo (cliente|operador),
  operador_id, conteudo_texto, tipo_midia,
  midia_path, midia_deleted, timestamp, created_at
)

-- Métricas (pode ser calculado via query ou tabela materializada)
```

---

## 11. INTEGRAÇÕES WHATSAPP

### Evolution API (números de atendimento)
- Cada instância WhatsApp é uma instância no Evolution API
- Webhook recebe eventos: `messages.upsert`, `connection.update`, etc.
- Backend processa webhook → salva no banco → emite via WebSocket para o frontend
- Frontend usa WebSocket para atualizar conversas em tempo real

### Meta Cloud API (números de disparo)
- Webhook já configurado nos números — apenas apontar para o endpoint do backend
- Envio de mensagens usa templates HSM aprovados (3 por número)
- Respostas dos clientes chegam via webhook e entram no fluxo normal de conversas
- Backend precisa identificar o tipo de conexão por número para rotear corretamente envio/recebimento
- **Regra da janela de 24h:** fora de 24h desde a última mensagem do cliente, só é permitido reenviar via template HSM aprovado — texto livre é rejeitado pela Meta. A tela de conversa precisa checar essa janela por número oficial e adaptar o input (texto livre vs. seleção de template)

---

## 12. FASE 2 (PLANEJADO — NÃO CONSTRUIR AGORA): DISCADORA (Twilio Voice + IVR)

### Fluxo
1. Operador cria campanha: seleciona lista de números + áudio MP3 + template HSM de destino
2. Sistema enfileira as ligações com concorrência controlada (5 simultâneas)
3. Twilio disca o número → toca o áudio MP3 (TwiML `<Play>`)
4. Sistema aguarda DTMF (`<Gather>`) — cliente aperta 1
5. Webhook do Twilio recebe o DTMF → backend dispara o template HSM correspondente via Meta Cloud API
6. Resultado da campanha registrado (atendeu / não atendeu / converteu)

### Stack
- **Twilio Voice API** — chamadas e captura de DTMF
- **TwiML** — script da chamada (tocar áudio, aguardar input)
- **BullMQ + Redis** — fila de discagem, controle de concorrência (5 simultâneas), retry
- **Meta Cloud API** — já existente no projeto, dispara o HSM ao receber o DTMF

### Volume estimado
- ~50 ligações/dia, 5 simultâneas
- Custo Twilio estimado: US$30–60/mês dependendo da proporção fixo/celular

### Ressalva de compliance
- Ligação automática com áudio pregravado (robocall) é regulada pela ANATEL (Resolução 692) no Brasil
- Confirmado pelo responsável do negócio: base de clientes com consentimento via operação bancária
- Recomendação: validar com jurídico se esse consentimento cobre especificamente contato automatizado por voz, não só contato geral — decisão de negócio, não bloqueia o desenvolvimento

---

## 13. O QUE NÃO CONSTRUIR AGORA

- Multi-tenancy (SaaS) — fase futura
- Bot de atendimento automático — fora do escopo desta fase
- Integração com CorbanCRM — pode ser considerada depois
- Discadora / Twilio Voice + IVR — ver seção 12, planejado para Fase 2

---

## 14. PRIORIDADE DE BUILD

1. Autenticação (login, JWT, roles)
2. Conexão Evolution API + webhook receiver (atendimento receptivo)
3. Listagem de conversas em tempo real
4. Tela de conversa com envio de mensagens e mídia
5. Conexão Meta Cloud API + webhook receiver (disparos)
6. Módulo de disparos (seleção de template + envio)
7. Métricas básicas
8. Gestão de usuários
9. Job de deleção de mídia (cron) — regra dos 4 dias confirmada pelo dono do negócio, sem necessidade de aguardar validação BACEN antes de implementar

**Status:** itens 1–9 implementados no backend **e** conectados ao frontend (ver README.md → Status para detalhes), com deploy real em produção em `https://inbox.maismoney.org` (VPS Hostinger, Docker + Traefik, Postgres, Evolution API). Todas as telas usam dado real do Postgres, sem mock. Hardening aplicado: helmet, rate limit (login + geral), shutdown gracioso, path traversal corrigido no upload de mídia, verificação de usuário ativo a cada request, webhook Meta com assinatura obrigatória (fail-closed). Único item pendente: migração de registro do número de produção Meta Cloud API travada no lado da Meta (ver seção 4) — sem ela, disparos/recebimento reais não funcionam, mas o código e a infraestrutura estão prontos e testados.

---

## 15. OBSERVAÇÕES FINAIS

- Projeto começa como uso interno, código deve estar organizado para escalar para SaaS depois (separar lógica de tenant desde o início, mesmo que com tenant único por ora)
- Nenhuma mídia deve ser servida com URL pública permanente — sempre URL assinada ou rota autenticada
- Logs de acesso a mídia sensível são recomendados
- Não armazenar CPF, dados bancários ou documentos além do tempo mínimo necessário (regra dos 4 dias)
