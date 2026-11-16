# Plano unificado — JARVIS AI OFFICE

Junta a "Diretriz principal (funcionários digitais)" com o "Prompt Master". A diretriz define a ordem; o Prompt Master detalha os requisitos.

## Auditoria (16/11/2026)
| Existe e funciona | Falta |
|---|---|
| Fila de tarefas FastAPI + SQLite, worker + Ollama na VPS, HTTPS (Caddy) | Dados das empresas (clientes, orçamentos, OS, financeiro) |
| Painel Next.js com login Supabase, só o proprietário | Usuários/permissões por empresa e módulo |
| Agentes JARVIS e SENTINEL (texto) | Demais agentes, memória, Central de Conhecimento, rotinas, eventos, 3D |

## Fases (cada uma em PRs pequenos)
1. **Utilidade diária** — equipe de agentes; pendências por empresa; "o que temos para hoje" priorizado na ordem da diretriz; delegar pendência ao agente; plano do dia pelo Secretário. *(PR backend + PR painel)*
2. **Cérebro e memória** — Central de Conhecimento por empresa com estado `confirmada / provisória / hipótese / sugestão`; regra só vira confirmada com aprovação do proprietário; versões; o agente recebe só regras confirmadas da empresa da tarefa. Memória tipada (pessoal, empresarial, operacional, projetos, decisões).
3. **Multiempresa e permissões** — usuários com empresas e módulos autorizados (ler/criar/editar/excluir/executar/aprovar), checagem no backend em toda rota, identidade do solicitante acompanhando cada tarefa, auditoria (tabela `eventos` já criada na fase 1).
4. **Integrações e rotinas** — CRM Bielenki, agenda, e-mail, WhatsApp (só rascunho sem autorização), rotina matinal agendada, monitoramentos.
5. **Escritório 3D** — avatares com estado real das tarefas (nada simulado), reuniões virtuais como tarefas colaborativas.
6. **Equipe de programação** — Programador/Auditor/Pesquisador com contexto de projetos.

## Regras que valem em todas as fases
- Não inventar dados nem regras das empresas; onde faltar, perguntar.
- Nunca misturar dados de empresas sem identificar a origem; tarefa delegada leva só o contexto da empresa dela.
- Ações sensíveis (enviar mensagens, alterar financeiro, publicar, excluir) só com aprovação.
