import "server-only";
import type { Agent } from "@/lib/validate";

// Somente servidor: JARVIS_USER_KEY nunca vai ao navegador. Endpoints /worker não são usados aqui.
export type JobSummary = { id: string; agent: Agent; status: string; created_at: number; attempts: number };
export type Job = JobSummary & { result: string | null };

export class JarvisError extends Error {}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const base = process.env.JARVIS_API_URL?.replace(/\/+$/, "");
  const key = process.env.JARVIS_USER_KEY;
  if (!base || !key) throw new JarvisError("Servidor JARVIS não configurado.");
  let res: Response;
  try {
    res = await fetch(base + path, {
      ...init,
      headers: { "X-API-Key": key, "Content-Type": "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new JarvisError("Servidor JARVIS indisponível. Tente novamente em instantes.");
  }
  if (res.status === 404) throw new JarvisError("Tarefa não encontrada.");
  if (res.status === 401) throw new JarvisError("Falha de autenticação com o servidor JARVIS.");
  if (!res.ok) throw new JarvisError(`Erro do servidor JARVIS (${res.status}).`);
  return (await res.json()) as T;
}

export const listJobs = () => call<{ jobs: JobSummary[] }>("/jobs").then((r) => r.jobs);
export const getJob = (id: string) => call<Job>(`/jobs/${encodeURIComponent(id)}`);
export const createJob = (agent: Agent, prompt: string) =>
  call<{ id: string; status: string }>("/jobs", { method: "POST", body: JSON.stringify({ agent, prompt }) });
