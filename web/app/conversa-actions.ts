"use server";
import { requireUser } from "@/lib/auth";
import { agendarMedicao, buscarClientes, createJob, createPendencia, delegarCrm, delegarPendencia, getHoje, getLia, getJob, pedirPlano, JarvisError, type ClienteCrm } from "@/lib/jarvis";
import { alvosDelegar, escolherCliente, FALTA_MEDICAO, intencao, montarPrompt, prazoIso, quandoMedicao, responderLia, responderPendencias, TEXTO_MAX, type Intencao, type Turno } from "@/lib/conversa";
import { AGENT_LABEL, CATEGORIA_LABEL } from "@/lib/validate";
import { cenaMedicao, cenasLia, cenasPendencias, type Cena } from "@/lib/cenas";
import { isUuid } from "@/lib/validate";

export type RespostaConversa =
  | { tipo: "texto"; texto: string; fonte: "dados"; links?: { href: string; rotulo: string }[]; cenas?: Cena[] }
  | { tipo: "tarefa"; id: string; agente?: string }
  | { tipo: "confirmar"; texto: string; cenas?: Cena[] }
  | { tipo: "erro"; texto: string };

const erro = (e: unknown): RespostaConversa => ({ tipo: "erro", texto: e instanceof JarvisError ? e.message : "Erro inesperado." });

function limparHistorico(h: unknown): Turno[] {
  if (!Array.isArray(h)) return [];
  return h.slice(-6).flatMap((t) =>
    t && (t.de === "eu" || t.de === "jarvis") && typeof t.texto === "string" ? [{ de: t.de, texto: t.texto.slice(0, 600) }] : []);
}

type PlanoMedicao = { ok: true; cliente: ClienteCrm; iso: string; rotulo: string } | { ok: false; texto: string };

/** Resolve cliente (no CRM) e data/hora do pedido. Mesmo texto = mesmo resultado, na pergunta e na confirmação. */
async function planoMedicao(texto: string, it: Extract<Intencao, { tipo: "medicao" }>): Promise<PlanoMedicao> {
  if (!it.cliente) return { ok: false, texto: FALTA_MEDICAO.cliente };
  const q = quandoMedicao(texto);
  if ("falta" in q) return { ok: false, texto: FALTA_MEDICAO[q.falta] };
  const lista = await buscarClientes(it.cliente);
  const e = escolherCliente(it.cliente, lista);
  if ("cliente" in e) return { ok: true, cliente: e.cliente, iso: q.iso, rotulo: q.rotulo };
  if (!e.opcoes.length) return { ok: false, texto: `Não encontrei "${it.cliente}" nos clientes da Marquinhos no CRM. Confira o nome ou cadastre o cliente primeiro.` };
  return { ok: false, texto: `Encontrei mais de um cliente para "${it.cliente}":\n${e.opcoes.map((c) => `• ${c.nome}${c.endereco ? ` (${c.endereco})` : ""}`).join("\n")}\nRepita o pedido com o nome completo.` };
}

export async function conversar(texto: unknown, historico: unknown): Promise<RespostaConversa> {
  await requireUser();
  const t = typeof texto === "string" ? texto.trim() : "";
  if (t.length < 2) return { tipo: "erro", texto: "Não entendi. Pode repetir?" };
  if (t.length > TEXTO_MAX) return { tipo: "erro", texto: "Mensagem longa demais." };
  const it = intencao(t);
  try {
    if (it.tipo === "pendencias") {
      const hoje = await getHoje();
      const cenas = cenasPendencias(hoje, it.categorias);
      return { tipo: "texto", texto: responderPendencias(hoje, it), fonte: "dados", ...(cenas.length ? { cenas } : {}) };
    }
    if (it.tipo === "saudacao") return { tipo: "texto", fonte: "dados", texto: "Pois não, senhor. Posso dizer o que temos para hoje, as cobranças ou as instalações, anotar uma tarefa, agendar uma medição ou delegar pendências." };
    if (it.tipo === "lia") {
      const lia = await getLia();
      return { tipo: "texto", texto: responderLia(lia), fonte: "dados", cenas: cenasLia(lia) };
    }
    if (it.tipo === "plano") return { tipo: "tarefa", id: (await pedirPlano()).id, agente: AGENT_LABEL.secretario };
    if (it.tipo === "medicao") {
      const p = await planoMedicao(t, it);
      if (!p.ok) return { tipo: "texto", texto: p.texto, fonte: "dados" };
      const texto = `Vou agendar uma medição na agenda do CRM para ${p.cliente.nome}${p.cliente.endereco ? `, em ${p.cliente.endereco}` : ""}, ${p.rotulo}. Depois deixo a ficha A4 para imprimir. Nada é enviado ao cliente. Confirma?`;
      return { tipo: "confirmar", texto, cenas: [cenaMedicao(p.cliente, p.rotulo, texto)] };
    }
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
    if (it.tipo === "medicao") {
      const p = await planoMedicao(t, it);
      if (!p.ok) return { tipo: "erro", texto: `${p.texto} Nada foi agendado.` };
      const r = await agendarMedicao(p.cliente.id, p.iso);
      const links = [r.ficha && { href: r.ficha, rotulo: "Imprimir ficha A4" }, r.agenda && { href: r.agenda, rotulo: "Abrir agenda" }]
        .filter((l): l is { href: string; rotulo: string } => !!l);
      return { tipo: "texto", fonte: "dados", links, texto: r.ja_existia
        ? `Essa medição de ${r.cliente} ${p.rotulo} já estava agendada. Não criei outra.`
        : `Agendado. Medição de ${r.cliente}, ${p.rotulo}, já está na agenda do CRM. A ficha A4 está no link abaixo.` };
    }
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
