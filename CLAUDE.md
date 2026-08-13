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
- **Hospedagem:** VPS Hostinger KVM 2 (~2 vCPU / 4GB RAM)
- **Autenticação:** JWT com roles (admin / operador)

---

## 4. NÚMEROS WHATSAPP

| Número | Tipo de conexão | Função |
|--------|----------------|--------|
| Número 1 | Meta Cloud API (oficial) | Disparos |
| Número 2 | Meta Cloud API (oficial) | Disparos |
| Número 3 | Evolution API (self-hosted) | Atendimento receptivo |
| Número 4 | Evolution API (self-hosted) | Atendimento receptivo |

**Meta Cloud API:** webhook já configurado — apenas apontar endpoint do backend da plataforma. Cada número tem 3 templates HSM aprovados pela Meta.

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

## 6. FUNCIONALIDADES OBRIGATÓRIAS — FASE 1

### 6.1 — Atendimento
- [ ] Visualizar todas as conversas ativas de todos os números em uma única tela
- [ ] Abrir conversa e ver histórico de mensagens
- [ ] Enviar mensagens de texto
- [ ] Enviar áudios, fotos e outros arquivos de mídia
- [ ] Registrar qual operador respondeu cada mensagem
- [ ] Indicar status da conversa (aberta / em atendimento / aguardando / encerrada)

### 6.2 — Métricas
- [ ] Volume de mensagens por período (dia/semana/mês)
- [ ] % de mensagens não respondidas
- [ ] Volume de atendimentos por operador
- [ ] Tempo médio de resposta (desejável)

### 6.3 — Gestão de usuários
- [ ] Criar/editar/desativar operadores
- [ ] Definir role (admin / operador)
- [ ] Login com e-mail e senha

### 6.4 — Módulo de Disparos (Meta Cloud API)
- [ ] Selecionar número de origem (dos 2 números oficiais)
- [ ] Selecionar template HSM aprovado (3 por número)
- [ ] Preencher variáveis do template
- [ ] Inserir número(s) destinatário(s)
- [ ] Enviar disparo e registrar no histórico
- [ ] Receber e exibir respostas aos disparos na tela de conversas

### 6.5 — Conexão WhatsApp
- [ ] Listar instâncias Evolution API conectadas
- [ ] Status de cada número (conectado / desconectado)
- [ ] QR Code para reconectar número (admin only)

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

## 12. O QUE NÃO CONSTRUIR AGORA

- Multi-tenancy (SaaS) — fase futura
- Bot de atendimento automático — fora do escopo desta fase
- Integração com CorbanCRM — pode ser considerada depois

---

## 13. PRIORIDADE DE BUILD

1. Autenticação (login, JWT, roles)
2. Conexão Evolution API + webhook receiver (atendimento receptivo)
3. Listagem de conversas em tempo real
4. Tela de conversa com envio de mensagens e mídia
5. Conexão Meta Cloud API + webhook receiver (disparos)
6. Módulo de disparos (seleção de template + envio)
7. Métricas básicas
8. Gestão de usuários
9. Job de deleção de mídia (cron) — regra dos 4 dias confirmada pelo dono do negócio, sem necessidade de aguardar validação BACEN antes de implementar

**Status:** itens 1–9 implementados no backend **e** conectados ao frontend (ver README.md → Status para detalhes). Todas as telas usam dado real do Postgres, sem mock. Sistema pronto para deploy (ver [DEPLOY.md](./DEPLOY.md)): Dockerfile do backend, `docker-compose.prod.yml`, config de Nginx, hardening básico (helmet, rate limit no login, shutdown gracioso). Falta apenas configurar credenciais reais da Evolution API / Meta Cloud API para validar entrega de mensagens de verdade — sem elas, o envio salva localmente mas retorna "não entregue".

---

## 14. OBSERVAÇÕES FINAIS

- Projeto começa como uso interno, código deve estar organizado para escalar para SaaS depois (separar lógica de tenant desde o início, mesmo que com tenant único por ora)
- Nenhuma mídia deve ser servida com URL pública permanente — sempre URL assinada ou rota autenticada
- Logs de acesso a mídia sensível são recomendados
- Não armazenar CPF, dados bancários ou documentos além do tempo mínimo necessário (regra dos 4 dias)
