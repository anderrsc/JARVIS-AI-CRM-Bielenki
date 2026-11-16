// Validação pura (sem dependências) — testada em tests/validate.test.ts
// Mesmas chaves de cloud/office.py (AGENTES). O backend também valida.
export const AGENT_LABEL = {
  jarvis: "JARVIS (coordenação)",
  secretario: "Secretário Executivo",
  comercial: "Assistente Comercial",
  orcamentos: "Assistente de Orçamentos",
  producao: "Coordenador de Produção",
  instalacoes: "Coordenador de Instalações",
  financeiro: "Assistente Financeiro",
  compras: "Assistente de Compras",
  atendimento: "Assistente de Atendimento",
  administrativo: "Assistente Administrativo",
  gestao: "Analista de Gestão",
  programador: "Programador",
  pesquisador: "Pesquisador",
  sentinel: "SENTINEL (auditoria)",
} as const;
export type Agent = keyof typeof AGENT_LABEL;
export const AGENTS = Object.keys(AGENT_LABEL) as Agent[];

// Ordem de prioridade do modo ASSISTENTE DE TRABALHO (cloud/office.py, CATEGORIAS).
export const CATEGORIA_LABEL = {
  urgente: "Pendência urgente",
  cliente_retorno: "Cliente aguardando retorno",
  prazo: "Serviço com prazo próximo",
  producao: "Problema de produção",
  instalacao: "Instalação pendente",
  financeiro: "Cobrança ou vencimento",
  compra: "Compra necessária",
  compromisso: "Compromisso",
  decisao: "Decisão aguardando aprovação",
  melhoria: "Oportunidade de melhoria",
} as const;
export type Categoria = keyof typeof CATEGORIA_LABEL;

export type NovaPendencia = {
  empresa: string; categoria: Categoria; titulo: string;
  cliente: string | null; prazo: string | null; detalhe: string | null;
};

const opt = (v: unknown, max: number) => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};

export function parseNovaPendencia(form: {
  empresa: unknown; categoria: unknown; titulo: unknown; cliente: unknown; prazo: unknown; detalhe: unknown;
}): { ok: true; value: NovaPendencia } | { ok: false; error: string } {
  const { empresa, categoria, titulo } = form;
  if (typeof empresa !== "string" || !/^[a-z0-9_-]{1,40}$/.test(empresa)) return { ok: false, error: "Escolha a empresa." };
  if (typeof categoria !== "string" || !(categoria in CATEGORIA_LABEL)) return { ok: false, error: "Escolha o tipo." };
  const t = typeof titulo === "string" ? titulo.trim() : "";
  if (t.length < 3 || t.length > 200) return { ok: false, error: "O título precisa ter de 3 a 200 caracteres." };
  const prazo = opt(form.prazo, 10);
  if (prazo && !/^\d{4}-\d{2}-\d{2}$/.test(prazo)) return { ok: false, error: "Prazo inválido." };
  return {
    ok: true,
    value: { empresa, categoria: categoria as Categoria, titulo: t, cliente: opt(form.cliente, 200), prazo, detalhe: opt(form.detalhe, 4000) },
  };
}
export const PROMPT_MIN = 3;
export const PROMPT_MAX = 6000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

export function parseNewJob(
  agent: unknown,
  prompt: unknown,
): { ok: true; agent: Agent; prompt: string } | { ok: false; error: string } {
  if (typeof agent !== "string" || !(AGENTS as string[]).includes(agent))
    return { ok: false, error: "Perfil inválido." };
  if (typeof prompt !== "string") return { ok: false, error: "Tarefa inválida." };
  const p = prompt.trim();
  if (p.length < PROMPT_MIN) return { ok: false, error: `A tarefa precisa de ao menos ${PROMPT_MIN} caracteres.` };
  if (p.length > PROMPT_MAX) return { ok: false, error: `A tarefa pode ter no máximo ${PROMPT_MAX} caracteres.` };
  return { ok: true, agent: agent as Agent, prompt: p };
}

// Proprietário único: compara o id validado pelo Supabase com ALLOWED_USER_ID.
export function isOwner(userId: string | undefined | null, allowed: string | undefined): boolean {
  const a = allowed?.trim();
  if (!userId || !a || !isUuid(a)) return false;
  return userId.toLowerCase() === a.toLowerCase();
}

export const STATUS_LABEL: Record<string, string> = {
  queued: "Na fila",
  running: "Executando",
  completed: "Concluída",
  failed: "Falhou",
  aberta: "Aberta",
  delegada: "Delegada",
  concluida: "Concluída",
  cancelada: "Cancelada",
  crm: "No CRM",
};

// Id de item do CRM: crm:<categoria>:<uuid> (o backend busca o conteúdo no próprio CRM).
export function isCrmItemId(v: unknown): v is string {
  return typeof v === "string" && /^crm:[a-z_]+:[0-9a-f-]{36}$/i.test(v) && isUuid(v.slice(v.lastIndexOf(":") + 1));
}

export const ESTADO_REGRA_LABEL: Record<string, string> = {
  provisoria: "Provisória", hipotese: "Hipótese", sugestao: "Sugestão", confirmada: "Confirmada",
};
export function parseNovaRegra(f: { empresa: unknown; assunto: unknown; texto: unknown; estado: unknown; fonte: unknown }):
  { ok: true; value: { empresa: string; assunto: string; texto: string; estado: string; fonte: string | null } } | { ok: false; error: string } {
  if (typeof f.empresa !== "string" || !/^[a-z0-9_-]{1,40}$/.test(f.empresa)) return { ok: false, error: "Empresa inválida." };
  if (typeof f.assunto !== "string" || !/^[a-z_]{1,30}$/.test(f.assunto)) return { ok: false, error: "Escolha o assunto." };
  const texto = typeof f.texto === "string" ? f.texto.trim() : "";
  if (texto.length < 5 || texto.length > 1000) return { ok: false, error: "A regra precisa ter de 5 a 1000 caracteres." };
  const estado = typeof f.estado === "string" && ["provisoria", "hipotese", "sugestao"].includes(f.estado) ? f.estado : "provisoria";
  return { ok: true, value: { empresa: f.empresa, assunto: f.assunto, texto, estado, fonte: opt(f.fonte, 200) } };
}
