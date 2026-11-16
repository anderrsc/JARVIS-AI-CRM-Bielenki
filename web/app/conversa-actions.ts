"use server";
import { requireUser } from "@/lib/auth";
import { createJob, getHoje, getJob, JarvisError } from "@/lib/jarvis";
import { intencao, montarPrompt, responderPendencias, TEXTO_MAX, type Turno } from "@/lib/conversa";
import { isUuid } from "@/lib/validate";

export type RespostaConversa =
  | { tipo: "texto"; texto: string; fonte: "dados" }
  | { tipo: "tarefa"; id: string }
  | { tipo: "erro"; texto: string };

const erro = (e: unknown): RespostaConversa => ({ tipo: "erro", texto: e instanceof JarvisError ? e.message : "Erro inesperado." });

function limparHistorico(h: unknown): Turno[] {
  if (!Array.isArray(h)) return [];
  return h.slice(-6).flatMap((t) =>
    t && (t.de === "eu" || t.de === "jarvis") && typeof t.texto === "string" ? [{ de: t.de, texto: t.texto.slice(0, 600) }] : []);
}

export async function conversar(texto: unknown, historico: unknown): Promise<RespostaConversa> {
  await requireUser();
  const t = typeof texto === "string" ? texto.trim() : "";
  if (t.length < 2) return { tipo: "erro", texto: "Não entendi. Pode repetir?" };
  if (t.length > TEXTO_MAX) return { tipo: "erro", texto: "Mensagem longa demais." };
  const it = intencao(t);
  try {
    if (it.tipo === "pendencias") return { tipo: "texto", texto: responderPendencias(await getHoje(), it), fonte: "dados" };
    let resumo: string[] = [];
    try {
      resumo = (await getHoje()).empresas.filter((e) => e.total > 0).map((e) => e.resumo);
    } catch { /* sem o resumo o agente ainda responde */ }
    const job = await createJob("jarvis", montarPrompt(t, limparHistorico(historico), resumo));
    return { tipo: "tarefa", id: job.id };
  } catch (e) {
    return erro(e);
  }
}

export async function verResposta(id: unknown): Promise<{ status: string; texto: string | null } | { status: "erro"; texto: string }> {
  await requireUser();
  if (!isUuid(id)) return { status: "erro", texto: "Tarefa inválida." };
  try {
    const j = await getJob(id);
    return { status: j.status, texto: j.result };
  } catch (e) {
    return { status: "erro", texto: e instanceof JarvisError ? e.message : "Erro inesperado." };
  }
}
