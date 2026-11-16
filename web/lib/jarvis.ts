import "server-only";
import { actorHeaders } from "@/lib/auth";
import type { Agent, Categoria, NovaPendencia } from "@/lib/validate";

// Somente servidor: JARVIS_USER_KEY nunca vai ao navegador. Endpoints /worker não são usados aqui.
export type JobSummary = { id: string; agent: Agent; status: string; created_at: number; attempts: number };
export type Job = JobSummary & { result: string | null; empresa?: string | null; contexto?: string | null };

export class JarvisError extends Error {}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const base = process.env.JARVIS_API_URL?.replace(/\/+$/, "");
  const key = process.env.JARVIS_USER_KEY;
  if (!base || !key) throw new JarvisError("Servidor JARVIS não configurado.");
  let res: Response;
  try {
    res = await fetch(base + path, {
      ...init,
      headers: { "X-API-Key": key, "Content-Type": "application/json", ...(await actorHeaders()) },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new JarvisError("Servidor JARVIS indisponível. Tente novamente em instantes.");
  }
  if (res.status === 404) throw new JarvisError("Registro não encontrado.");
  if (res.status === 409 || res.status === 422) {
    const detail = await res.json().then((b) => b?.detail, () => null);
    throw new JarvisError(typeof detail === "string" ? detail : "Dados inválidos.");
  }
  if (res.status === 401) throw new JarvisError("Falha de autenticação com o servidor JARVIS.");
  if (res.status === 403) throw new JarvisError("Sem permissão para esta empresa ou função.");
  if (res.status === 429) throw new JarvisError("Muitas solicitações. Aguarde alguns minutos.");
  if (!res.ok) throw new JarvisError(`Erro do servidor JARVIS (${res.status}).`);
  return (await res.json()) as T;
}

export const listJobs = () => call<{ jobs: JobSummary[] }>("/jobs").then((r) => r.jobs);
export const getJob = (id: string) => call<Job>(`/jobs/${encodeURIComponent(id)}`);
export const createJob = (agent: Agent, prompt: string, empresa?: string | null) =>
  call<{ id: string; status: string }>("/jobs", { method: "POST", body: JSON.stringify({ agent, prompt, empresa: empresa || null }) });

// ---- Escritório: pendências e briefing do dia ----
export type Pendencia = {
  id: string; empresa: string; categoria: Categoria; titulo: string; detalhe: string | null;
  cliente: string | null; prazo: string | null; status: string; agente: Agent; job_id: string | null;
  created_at: number; motivo?: string; dias?: number | null;
  origem?: "jarvis" | "crm"; link?: string | null; valor?: number | null; prioridade?: string | null;
};
export type Fonte = { nome: string; empresa: string; ok: boolean; erro: string | null };
export type BriefingEmpresa = { empresa: string; nome: string; resumo: string; atrasadas: number; total: number; itens: Pendencia[] };
export type Briefing = { data: string; empresas: BriefingEmpresa[]; fontes?: Fonte[] };
export type Equipe = { empresas: { chave: string; nome: string }[] };

export const getHoje = () => call<Briefing>("/hoje");
export const getEquipe = () => call<Equipe>("/equipe");
export const createPendencia = (p: NovaPendencia) =>
  call<Pendencia>("/pendencias", { method: "POST", body: JSON.stringify(p) });
export const setPendenciaStatus = (id: string, status: "concluida" | "cancelada") =>
  call<Pendencia>(`/pendencias/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ status }) });
export const delegarPendencia = (id: string) =>
  call<{ job_id: string; agente: Agent }>(`/pendencias/${encodeURIComponent(id)}/delegar`, { method: "POST" });
export const pedirPlano = () => call<{ id: string }>("/hoje/plano", { method: "POST" });
export const delegarCrm = (id: string) =>
  call<{ job_id: string; agente: Agent }>("/crm/delegar", { method: "POST", body: JSON.stringify({ id }) });

// ---- Central de Conhecimento ----
export type Regra = {
  id: string; empresa: string; assunto: string; texto: string; estado: string; fonte: string | null;
  versao: number; anterior_id: string | null; created_at: number; updated_at: number; confirmado_em: number | null;
};
export const listRegras = (empresa: string) =>
  call<{ regras: Regra[]; assuntos: Record<string, string> }>(`/conhecimento?empresa=${encodeURIComponent(empresa)}`);
export const createRegra = (r: { empresa: string; assunto: string; texto: string; estado: string; fonte: string | null }) =>
  call<{ regra: Regra; semelhantes: Regra[] }>("/conhecimento", { method: "POST", body: JSON.stringify(r) });
export const regraAcao = (id: string, acao: "confirmar" | "arquivar") =>
  call<Regra>(`/conhecimento/${encodeURIComponent(id)}/${acao}`, { method: "POST" });
export const editarRegra = (id: string, texto: string) =>
  call<Regra>(`/conhecimento/${encodeURIComponent(id)}/editar`, { method: "POST", body: JSON.stringify({ texto }) });

// ---- Usuários (só proprietário) ----
export type Membro = { id: string; email: string; nome: string | null; cargo: string | null; ativo: boolean; ultimo_acesso: number | null; acessos: Record<string, string[]> };
export const listUsuarios = () =>
  call<{ usuarios: Membro[]; modulos: Record<string, string>; empresas: Record<string, string> }>("/usuarios");
export const salvarUsuario = (m: { id: string; email: string; nome: string | null; cargo: string | null; acessos: Record<string, string[]> }) =>
  call<Membro>(`/usuarios/${encodeURIComponent(m.id)}`, { method: "PUT", body: JSON.stringify(m) });
export const setUsuarioAtivo = (id: string, ativo: boolean) =>
  call<Membro>(`/usuarios/${encodeURIComponent(id)}/ativo?ativo=${ativo}`, { method: "POST" });
