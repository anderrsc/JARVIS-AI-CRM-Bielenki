// Validação pura (sem dependências) — testada em tests/validate.test.ts
export const AGENTS = ["jarvis", "sentinel"] as const;
export type Agent = (typeof AGENTS)[number];
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
  if (typeof agent !== "string" || !(AGENTS as readonly string[]).includes(agent))
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
};
