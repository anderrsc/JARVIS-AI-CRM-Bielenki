# JARVIS Econômico v0.2 — Nuvem + worker local

## O que realmente está implementado
API de fila de tarefas na nuvem, autenticação por duas chaves separadas, SQLite persistente, worker Windows que busca tarefas por HTTPS e usa Ollama local, agentes JARVIS e SENTINEL textuais, testes. **Não inclui ainda PWA, login multiusuário, integração CRM, Claude Code, notificações nem deploy automatizado.** Não execute tarefas sensíveis nem armazene dados reais de clientes neste MVP.

## Custos e limites
Servidor VPS de entrada (1 vCPU, 1–2 GB RAM, 20 GB SSD): reservar R$ 35–75/mês **como orçamento-alvo, não cotação**. Domínio opcional e backups podem elevar custo; usar domínio existente ou subdomínio para economizar. Não incluir assinatura Claude, energia, impostos, câmbio e excedentes de tráfego. Não usar API Anthropic por padrão; gastos adicionais de API devem permanecer em R$0 até configurar limites. Worker depende de computador ligado; nuvem continua recebendo tarefas, mas não as executa sozinha.

## Testar localmente (Windows)
Instale Python 3.12, Git, Ollama e execute `ollama pull qwen2.5:3b`.

```powershell
cd jarvis-economico
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m pytest -q
```

Para testar a API local, configure variáveis temporárias em PowerShell:

```powershell
$env:JARVIS_DB="$PWD\jarvis-test.sqlite3"
$env:JARVIS_USER_KEY=([Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))).ToLower()
$env:JARVIS_WORKER_KEY=([Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))).ToLower()
.\.venv\Scripts\python.exe -m uvicorn app:app --app-dir cloud --host 127.0.0.1 --port 8000
```

A API local pode ser testada em outro terminal via `Invoke-RestMethod` usando `X-API-Key`. Para o worker real, é obrigatório configurar uma URL HTTPS válida.

## VPS Linux (Ubuntu) — somente depois de contratar
1. Instale Docker Engine + Compose plugin e Caddy seguindo documentação oficial. Configure firewall: SSH restrito, 80 e 443 abertos, porta 8000 não pública.
2. Copie somente `cloud/` para VPS. Gere duas chaves **diferentes** de 32 bytes com `openssl rand -hex 32` e preencha `cloud/.env`. Nunca comite o `.env`.
3. Execute `cd cloud && docker compose up -d --build`.
4. Aponte DNS de `jarvis.seu-dominio.com` para VPS, ajuste `Caddyfile` e configure Caddy como serviço para HTTPS automático.
5. Teste `https://jarvis.seu-dominio.com/health`; configure backups criptografados do volume `jarvis_data` e atualizações de segurança.

## Worker Windows
No computador com Ollama, instale dependências de `worker/requirements.txt`. Configure as variáveis do `worker/.env.example` **no ambiente do PowerShell** (o script não carrega automaticamente o arquivo `.env`). Use `JARVIS_CLOUD_URL=https://seu-host` e a mesma chave worker do VPS. Execute `python worker/worker.py`. O worker só faz conexões de saída HTTPS e chama Ollama em `127.0.0.1:11434`. **Nunca exponha Ollama na internet**.

## Exemplo de criação de tarefa
```powershell
$h=@{'X-API-Key'=$env:JARVIS_USER_KEY}
$body=@{agent='sentinel';prompt='Liste riscos de regressão na impressão A4 de orçamentos'} | ConvertTo-Json
Invoke-RestMethod -Uri 'https://jarvis.seu-dominio.com/jobs' -Method Post -Headers $h -ContentType 'application/json' -Body $body
```
Use `GET /jobs` e `GET /jobs/{id}` com a mesma chave para acompanhar.

## Segurança e limitações de produção
- O MVP usa **uma chave de usuário compartilhada**, não login por pessoa: não é adequado para uso empresarial multiusuário até implementar autenticação OIDC, RBAC, rate limiting, logs de auditoria e proteção contra abuso.
- `GET /health` é público; os demais endpoints exigem chaves. HTTPS é obrigatório para acesso remoto.
- SQLite suporta um único servidor/instância; não escale réplicas nem use filesystem efêmero sem volume persistente.
- O lease dura 300s; o worker Ollama tem timeout de 180s. Falhas são registradas, não reexecutadas automaticamente; expiração por perda de conexão é reprocessada até 3 tentativas.
- O worker **não executa shell, não acessa GitHub, não modifica arquivos e não usa Claude**. Isso é intencional. Integração Claude Code será adicionada com aprovação e controle de uso.
- Um VPS de entrada não executa o modelo local; ele apenas armazena e distribui tarefas.
