# JARVIS-AI-CRM-Bielenki

Fila de tarefas JARVIS/SENTINEL com Ollama na VPS e painel web privado.

| Pasta | O que é |
|---|---|
| `web/` | Painel Next.js (Vercel) com login Supabase, acesso só do proprietário |
| `cloud/` | API FastAPI + SQLite (fila) |
| `worker/` | Worker que consome a fila e chama o Ollama |
| `compose.*.yaml`, `compose.sh`, `caddy/` | Implantação ativa na VPS (projeto Docker `jarvis-vps`) |
| `docs/` | Plano de continuidade e documentação original do backend |

`cloud/compose.yaml` e `cloud/Caddyfile` são exemplos antigos: não iniciar em paralelo à implantação ativa.

## Testes
```bash
pip install -r requirements-dev.txt && pytest -q      # backend
cd web && npm ci && npm test && npm run lint && npm run build
```

## Publicar o painel (Vercel + Supabase)

**Supabase** (projeto `ytstuvhggtlaaccdlekt`)
1. Authentication → Sign In / Providers: desative "Allow new users to sign up".
2. Authentication → Users → Add user: crie seu usuário (e-mail + senha). Copie o UUID.
3. Project Settings → API Keys: copie a *Publishable key*.
4. Authentication → URL Configuration: Site URL = domínio da Vercel (ex.: `https://jarvis-xxx.vercel.app`).

**Vercel**
1. Importe o repositório; em *Root Directory* escolha `web`.
2. Environment Variables (Production), conforme `web/.env.example`:
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `JARVIS_API_URL=https://jarvis-bielenki.duckdns.org`
   - `JARVIS_USER_KEY` = mesmo valor de `JARVIS_USER_KEY` do `.env.vps` (copie direto do servidor, nunca pelo chat)
   - `ALLOWED_USER_ID` = UUID do passo 2
3. Deploy.

## Segurança
- `JARVIS_USER_KEY` só existe no servidor da Vercel; o navegador fala apenas com o Next.js. `JARVIS_WORKER_KEY` fica só na VPS.
- Toda página e ação valida a sessão com `supabase.auth.getUser()` e compara com `ALLOWED_USER_ID`. Outra conta logada vê "sem permissão".
- Mutations são Server Actions (checagem Origin/Host do Next.js).
- Pendente: rate limiting distribuído, dono por tarefa no backend (necessário antes de multiusuário), backup do SQLite.

## Conector CRM Bielenki (Marquinhos)
A tela **Hoje** lê as pendências reais da Central de Pendências do CRM (`pending_center`), somente leitura, e permite delegar cada item a um funcionário digital.
1. No CRM, crie um usuário só para o JARVIS (cargo com menor acesso, empresa Marquinhos, status ativo).
2. No `.env.vps` da VPS, preencha `CRM_SUPABASE_URL`, `CRM_SUPABASE_ANON_KEY` (chave pública do Supabase do CRM), `CRM_JARVIS_EMAIL`, `CRM_JARVIS_PASSWORD` e `CRM_SITE_URL` (ver `.env.vps.example`).
3. `./compose.sh up -d --build jarvis worker`.
Nunca use a `service_role` do CRM: o JARVIS deve ver só o que o próprio usuário vê (RLS). O worker não recebe essas variáveis.
