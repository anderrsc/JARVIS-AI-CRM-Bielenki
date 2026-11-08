# Plano e critérios de aceite

## Objetivo
Interface em português na Vercel para um único proprietário autenticado pelo Supabase, capaz de criar tarefas para jarvis/sentinel, listar tarefas e consultar status e resultado. Ollama e worker continuam na VPS; computador pessoal pode ficar desligado. Não implementar CRM completo nem integração Claude/API paga nesta etapa.

## Arquitetura recomendada para implementar
Next.js com rotas no servidor na Vercel; Supabase Auth para login; chamadas do servidor Vercel para a API HTTPS da VPS. Escolher versões estáveis atuais com documentação oficial e lockfile. Nenhuma chave compartilhada de backend deve chegar ao navegador.
Variáveis propostas, ainda não usadas por nenhum frontend:
- NEXT_PUBLIC_SUPABASE_URL: URL já informada.
- NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: obter do projeto; nunca inventar.
- JARVIS_API_URL: https://jarvis-bielenki.duckdns.org.
- JARVIS_USER_KEY: somente servidor Vercel, mesma chave de usuário do backend.
- ALLOWED_USER_ID: UUID do proprietário no Supabase, verificado no servidor em cada operação.
JARVIS_WORKER_KEY permanece somente na VPS. Nunca usar NEXT_PUBLIC_ para chaves JARVIS, secret ou service_role.

## Autorização obrigatória
A API atual tem chave de usuário global, lista todos os jobs e não armazena dono. Portanto, para esta etapa, autorizar somente o UUID do proprietário em toda rota do servidor que chama a VPS. Não liberar a API a qualquer conta Supabase. Desabilitar cadastro público conforme configuração disponível e confirmar identidade autorizada. Não usar user_metadata editável como autorização.
Se houver pedido de múltiplos usuários, implementar propriedade real por tarefa e testes de isolamento no backend antes de disponibilizar. Chave global no servidor não cria isolamento por usuário.
Validar sessão no servidor com método atual recomendado pelo Supabase; não confiar apenas em estado de interface ou getSession sem validação apropriada. Verificar Origin/CSRF em operações mutáveis com cookies. Limitar taxa de criação de tarefas e acesso, usando mecanismo que funcione com múltiplas instâncias; não confiar em contador em memória de função serverless.
Se criar tabelas expostas no Supabase, usar RLS e políticas restritas; não é necessário migrar a fila SQLite para construir o painel inicial.

## Sequência
1. Inspecionar repositório e instruções existentes; preservar README e registrar base antes de alterações.
2. Inspecionar Supabase somente com acesso autorizado; consultar changelog/docs atuais antes de implementação. Obter configurações faltantes sem pedir segredos no chat.
3. Criar interface responsiva e acessível: login, nova tarefa, lista, detalhe/resultado, loading, vazio, falhas e logout. Identificar JARVIS/SENTINEL como perfis de texto, sem simular ações externas.
4. Implementar rotas de servidor com validação de sessão, allowlist, timeout, validação de corpo e tratamento de erros. Não encaminhar /worker ao navegador e não expor chave compartilhada.
5. Testar fluxo local e build; criar documentação de variáveis, instruções Vercel e callback/site URL Supabase para domínio real do deploy.
6. Preparar alterações Git revisáveis. Não sobrescrever remotamente arquivos que mudaram. Publicar conforme autorização do usuário; este handoff por si só não autoriza alterações de banco destrutivas.
7. Depois do deploy, verificar HTTPS, login/logout, autorização, tarefa ponta a ponta e reinício/persistência. Planejar backup consistente SQLite (API de backup SQLite ou parada controlada), criptografado fora da VPS, e restauração testada.

## Validação necessária
- Sem sessão: operações protegidas retornam 401.
- Usuário autenticado fora da allowlist: 403, sem lista ou criação de tarefas.
- Proprietário: criar tarefa, acompanhar queued/running/completed e ver resultado.
- Não vazar chaves em JS, HTML, logs, respostas de erro ou arquivos versionados.
- Falhas da VPS/Ollama tratadas de modo compreensível; sem espera longa bloqueante em uma chamada Vercel, usar polling para jobs.
- Testes de validação, autorização e falhas; build e lint apropriados.
- Confirmar portas públicas: somente SSH e Caddy conforme política do host; sem 8000 ou 11434 publicados.
- Verificar token DuckDNS rotacionado, backups e atualização/reinicialização pendente antes de declarar produção pronta.

## Limitações conhecidas do backend
Sem dono por tarefa, rate limiting, auditoria de usuário, cancelamento, heartbeat de lease nem token único por tentativa. Reutilizar worker_id após expiração pode aceitar resultado antigo de tentativa anterior; corrigir antes de múltiplos workers/retries confiáveis. Prompts/resultados armazenados em texto no SQLite. /health testa processo HTTP, não integridade de toda a cadeia. /openapi.json ainda disponível no original apesar de docs/redoc desativados. Não afirmar que o sistema já é uma solução empresarial pronta.
