"use server";
import { requireUser } from "@/lib/auth";
import { createJob, createPendencia, delegarCrm, delegarPendencia, getHoje, getJob, pedirPlano, JarvisError } from "@/lib/jarvis";
import { alvosDelegar, intencao, montarPrompt, prazoIso, responderPendencias, TEXTO_MAX, type Turno } from "@/lib/conversa";
import { AGENT_LABEL, CATEGORIA_LABEL } from "@/lib/validate";
import { isUuid } from "@/lib/validate";

export type RespostaConversa =
  | { tipo: "texto"; texto: string; fonte: "dados" }
  | { tipo: "tarefa"; id: string; agente?: string }
  | { tipo: "confirmar"; texto: string }
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
    if (it.tipo === "plano") return { tipo: "tarefa", id: (await pedirPlano()).id, agente: AGENT_LABEL.secretario };
    if (it.tipo === "anotar") {
      const quando = it.prazo ? ` com prazo ${it.prazo === "hoje" ? "hoje" : "amanhã"}` : "";
      return { tipo: "confirmar", texto: `Vou anotar na lista de Hoje da Marquinhos, como ${CATEGORIA_LABEL[it.categoria].toLowerCase()}${quando}: "${it.titulo}". Confirma?` };
    }
    if (it.tipo === "delegar") {
      const alvo = alvosDelegar(await getHoje(), it);
      if (!alvo.length) return { tipo: "texto", texto: `Não há ${it.tema}${it.atrasadas ? " atrasadas" : ""} em aberto para delegar.`, fonte: "dados" };
      const lista = alvo.map((i) => `• ${i.titulo} → ${AGENT_LABEL[i.agente as keyof typeof AGENT_LABEL] ?? i.agente}`).join("\n");
      return { tipo: "confirmar", texto: `Vou delegar ${alvo.length} item(ns) de ${it.tema}${it.atrasadas ? " atrasados" : ""} para preparar as próximas ações (nada é enviado a clientes):\n${lista}\nConfirma?` };
    }
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

/** Executa a ação confirmada. Recalcula tudo no servidor e só relata o que o JARVIS confirmou. */
export async function executarAcao(texto: unknown): Promise<RespostaConversa> {
  await requireUser();
  const t = typeof texto === "string" ? texto.trim().slice(0, TEXTO_MAX) : "";
  const it = intencao(t);
  try {
    if (it.tipo === "anotar") {
      const p = await createPendencia({ empresa: "marquinhos", categoria: it.categoria, titulo: it.titulo, cliente: null, prazo: prazoIso(it.prazo), detalhe: "Criada por voz na conversa com o JARVIS." });
      return { tipo: "texto", fonte: "dados", texto: `Anotado. "${p.titulo}" está na lista de Hoje, com o ${AGENT_LABEL[p.agente] ?? p.agente}.` };
    }
    if (it.tipo === "delegar") {
      const alvo = alvosDelegar(await getHoje(), it);
      if (!alvo.length) return { tipo: "texto", fonte: "dados", texto: "Nada a delegar: esses itens já foram delegados ou encerrados." };
      const ok: string[] = [], falhas: string[] = [];
      for (const i of alvo) {
        try {
          const r = i.id.startsWith("crm:") ? await delegarCrm(i.id) : await delegarPendencia(i.id);
          ok.push(`• ${i.titulo} → ${AGENT_LABEL[r.agente] ?? r.agente}`);
        } catch (e) {
          falhas.push(`• ${i.titulo}: ${e instanceof JarvisError ? e.message : "erro"}`);
        }
      }
      return { tipo: "texto", fonte: "dados", texto: [
        ok.length ? `Delegado (${ok.length}). As tarefas estão na fila e aparecem no Escritório:\n${ok.join("\n")}` : "",
        falhas.length ? `Não consegui delegar (${falhas.length}):\n${falhas.join("\n")}` : "",
      ].filter(Boolean).join("\n\n") };
    }
    return { tipo: "erro", texto: "Não há ação para confirmar." };
  } catch (e) {
    return erro(e);
  }
}
