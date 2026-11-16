# Checklist de segurança — JARVIS (16/11/2026)

✅ feito · ⚠️ parcial / depende de ação · ➖ não se aplica hoje

| # | Item | Situação |
|---|---|---|
| 1 | API keys fora do código | ✅ Tudo em variáveis de ambiente (`.env.vps` na VPS, Vercel no painel). |
| 2 | Nenhum secret no histórico do git | ✅ Varredura do histórico: só placeholders de exemplo. |
| 3 | service_role nunca no client | ✅ Não é usada em lugar nenhum. O conector do CRM entra como usuário comum (RLS vale). |
| 4 | Chave pública do banco limitada pelo RLS | ✅ Painel usa a publishable só no servidor; o JARVIS não tem tabelas no Supabase dele. |
| 5 | RLS em toda tabela com dados | ➖ JARVIS: dados ficam no SQLite do backend, sem acesso direto; o isolamento é feito no backend (abaixo). CRM: ver auditoria do CRM. |
| 6 | Policies escopadas, sem `true` genérico | ➖ Mesma razão do item 5. |
| 7 | Permissão mínima por papel | ✅ Usuários com acessos por empresa e módulo (`cloud/access.py`); equipe técnica só do proprietário. |
| 8 | Bloquear mass assignment | ✅ Todos os modelos da API recusam campos extras (422). |
| 9 | Queries parametrizadas | ✅ Todo SQL usa `?`; teste de injeção incluído. |
| 10 | Validação de entrada em toda rota | ✅ Pydantic na API + validação no painel antes de chamar. |
| 11 | Auth no servidor | ✅ `supabase.auth.getUser()` no servidor + backend confere chave e usuário em toda rota. |
| 12 | Nenhuma tela sensível sem login | ✅ Toda página chama `getAccess()`; sem sessão vai para /login. |
| 13 | Cookies httpOnly/secure/sameSite | ✅ Forçados no painel (o navegador nunca usa o Supabase direto). |
| 14 | Hash de senhas | ✅ Senhas só no Supabase Auth (bcrypt). O JARVIS não guarda senha de usuário. |
| 15 | HTTPS em tudo | ✅ Caddy (API) e Vercel (painel) redirecionam HTTP→HTTPS; HSTS ativo. |
| 16 | Security headers | ✅ CSP, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy, HSTS (painel e API). |
| 17 | Rate limit em rotas de IA | ✅ 40 tarefas de IA por usuário a cada 10 min (`JARVIS_RATE_MAX`). |
| 18 | Bot protection em login/cadastro | ⚠️ Cadastro público desativado; login conta com o limite do Supabase Auth. Sem CAPTCHA. |
| 19 | Restringir uploads | ➖ Não há upload. Corpo das requisições limitado a 128 KB no Caddy. |
| 20 | Respostas enxutas | ✅ Tarefas não expõem o dono; membro só vê as próprias; itens de outra empresa retornam 404. |
| 21 | Erros/logs sem vazamento | ✅ API devolve "Erro interno" sem stack; worker registra só o tipo do erro; `/openapi.json` desligado. |
| 22 | Pacotes verificados | ✅ Só pacotes oficiais (fastapi, uvicorn, httpx, next, react, @supabase/*). `npm audit`: 0 vulnerabilidades. |
| 23 | Secrets de terceiros criptografados | ⚠️ `.env.vps` em texto no servidor, só root (`chmod 600`). Prompts/resultados no SQLite sem criptografia. |
| 24 | Auditoria de RLS antes de entregar | ⚠️ JARVIS sem tabelas no Supabase. CRM auditado à parte (só leitura). |

Também: toda alteração (pendências, regras, tarefas, usuários) fica em `eventos` com o autor; `/auditoria` só para o proprietário.

Pendências reais: trocar a senha temporária do usuário JARVIS no CRM; rotacionar token DuckDNS; reboot do kernel; backup do SQLite.
