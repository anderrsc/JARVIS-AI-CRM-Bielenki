// Conversa com o JARVIS — lógica pura (sem dependências), testada em tests/conversa.test.ts.
// Perguntas sobre pendências são respondidas na hora com dados reais do /hoje (CRM + cadastro),
// sem IA. O resto vai para o agente JARVIS na fila. Nada aqui afirma ações que não aconteceram.
import type { Categoria } from "./validate";

export type Turno = { de: "eu" | "jarvis"; texto: string };
type Item = { titulo: string; categoria: string; cliente: string | null; motivo?: string; dias?: number | null; valor?: number | null };
type Empresa = { nome: string; resumo: string; atrasadas: number; total: number; itens: Item[] };
type Fonte = { nome: string; ok: boolean };
export type BriefingLike = { empresas: Empresa[]; fontes?: Fonte[] };

export const TEXTO_MAX = 1000;

const sem = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// Ordem importa: o primeiro tema que casar vence.
const TEMAS: [Categoria[], RegExp, string][] = [
  [["financeiro"], /\b(financeir|cobranc|cobrar|receber|a pagar|pagament|boleto|vencid|inadimpl|caixa)/, "cobranças e vencimentos"],
  [["instalacao"], /\binstala/, "instalações"],
  [["producao"], /\b(producao|fabrica|corte)/, "produção"],
  [["compra"], /\b(compra|material|materiais|fornecedor)/, "compras"],
  [["prazo"], /\b(medica|medir|medida)/, "medições e prazos"],
  [["cliente_retorno"], /\b(orcament|cliente.{0,20}(aguard|retorno|esperando)|lead)/, "orçamentos e clientes aguardando retorno"],
  [["urgente"], /\burgen/, "urgências"],
];
const GERAL = /\b(pendenc|hoje|agenda|atrasad|resumo|briefing|prioridad|o que (eu )?tenho|como (esta|estao|anda)|bom dia|boa tarde|boa noite|situacao)/;

export type Intencao =
  | { tipo: "pendencias"; categorias: Categoria[] | null; tema: string }
  | { tipo: "delegar"; categorias: Categoria[] | null; tema: string; atrasadas: boolean }
  | { tipo: "anotar"; titulo: string; categoria: Categoria; prazo: "hoje" | "amanha" | null }
  | { tipo: "plano" }
  | { tipo: "saudacao" }
  | { tipo: "lia" }
  | { tipo: "medicao"; cliente: string | null }
  | { tipo: "ia" };

// Ações (mudam algo) sempre passam por confirmação antes de executar.
export const precisaConfirmar = (i: Intencao) => i.tipo === "delegar" || i.tipo === "anotar" || i.tipo === "medicao";

const ANOTAR = /^(?:jarvis[,\s]+)?(?:anote|anota|anotar|lembre-me de|lembre-me|me lembre de|me lembra de|lembrar de|crie uma (?:tarefa|pendencia)|criar (?:tarefa|pendencia)|nova (?:tarefa|pendencia))\s*(?:que|de|:|,)?\s*/i;

// ---- Agendar medição no CRM ----
const MEDICAO = /\b(agend\w*|marc\w*|program\w*)\b.{0,25}\bmedi(cao|coes|r)\b/;
const DIAS = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];
// Onde termina o nome do cliente: data, hora ou pontuação.
const FIM_NOME = new RegExp(String.raw`\s*(?:,|\.|;|\s(?:(?:no|na|para|pra|em|de|do|da|as|a)\s+)?(?:hoje|amanha|depois de amanha|${DIAS.join("|")}|dia\s+\d{1,2}|\d{1,2}\/\d{1,2}|\d{1,2}(?::\d{2}|h|\s*horas?)|meio[- ]dia)\b)`);

/** Nome do cliente dito no pedido ("agendar medição para Maria Souza amanhã às 14h" → "Maria Souza"). */
export function clienteMedicao(texto: string): string | null {
  const orig = texto.normalize("NFC");
  const t = sem(orig);
  const m = t.match(/\bmedi(?:cao|coes|r)\b\s*(?:(?:para|pra|pro|com|do|da|de|no|na)\s+)?(?:(?:o|a)\s+)?(?:(?:cliente|senhor|senhora|sr\.?|sra\.?)\s+)?/);
  if (!m || m.index === undefined) return null;
  const ini = m.index + m[0].length;
  const resto = t.slice(ini);
  const fim = resto.match(FIM_NOME);
  const nome = orig.slice(ini, ini + (fim?.index ?? resto.length)).replace(/\s+(?:no|na|para|pra|em|de|do|da)$/i, "").trim();
  return nome.length >= 2 && !/^(hoje|amanh)/i.test(sem(nome)) ? nome.slice(0, 80) : null;
}

export type Quando = { iso: string; rotulo: string } | { falta: "data" | "hora" | "passado" };

/** Data e hora da medição no fuso de Brasília (-03:00). Só aceita o que foi dito; não inventa horário. */
export function quandoMedicao(texto: string, agora = new Date()): Quando {
  const t = sem(texto);
  const hojeBrt = new Date(agora.getTime() - 3 * 3600_000);
  const base = Date.UTC(hojeBrt.getUTCFullYear(), hojeBrt.getUTCMonth(), hojeBrt.getUTCDate());
  let dia: number | null = null;
  const dm = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  const dd = t.match(/\bdia\s+(\d{1,2})\b/);
  const ds = DIAS.findIndex((d) => new RegExp(`\\b${d}\\b`).test(t));
  if (/\bdepois de amanha\b/.test(t)) dia = base + 2 * 86400_000;
  else if (/\bamanha\b/.test(t)) dia = base + 86400_000;
  else if (/\bhoje\b/.test(t)) dia = base;
  else if (dm) {
    const ano = dm[3] ? (dm[3].length === 2 ? 2000 + Number(dm[3]) : Number(dm[3])) : hojeBrt.getUTCFullYear();
    dia = Date.UTC(ano, Number(dm[2]) - 1, Number(dm[1]));
    if (!dm[3] && dia < base) dia = Date.UTC(ano + 1, Number(dm[2]) - 1, Number(dm[1]));
    if (new Date(dia).getUTCDate() !== Number(dm[1])) dia = null;
  } else if (dd) {
    const n = Number(dd[1]);
    dia = Date.UTC(hojeBrt.getUTCFullYear(), hojeBrt.getUTCMonth(), n);
    if (dia < base) dia = Date.UTC(hojeBrt.getUTCFullYear(), hojeBrt.getUTCMonth() + 1, n);
    if (new Date(dia).getUTCDate() !== n) dia = null;
  } else if (ds >= 0) {
    const diff = ((ds - hojeBrt.getUTCDay() + 7) % 7) || 7;
    dia = base + diff * 86400_000;
  }
  if (dia === null) return { falta: "data" };
  let h: number | null = null, min = 0;
  const hm = t.match(/\b(\d{1,2})(?::(\d{2})|h(\d{2})?|\s*(?:horas?|hs)\b)/) ?? t.match(/\bas\s+(\d{1,2})\b/);
  if (/\bmeio[- ]dia\b/.test(t)) h = 12;
  else if (hm) { h = Number(hm[1]); min = Number(hm[2] ?? hm[3] ?? 0); }
  if (h === null) return { falta: "hora" };
  if (h < 12 && /\b(da tarde|da noite)\b/.test(t)) h += 12;
  if (h > 23 || min > 59) return { falta: "hora" };
  const ms = dia + (h * 60 + min) * 60_000;
  if (ms + 3 * 3600_000 < agora.getTime()) return { falta: "passado" };
  const d = new Date(ms);
  const p2 = (n: number) => String(n).padStart(2, "0");
  const iso = `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}T${p2(h)}:${p2(min)}:00-03:00`;
  const sem3 = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"][d.getUTCDay()];
  return { iso, rotulo: `${sem3}, ${p2(d.getUTCDate())}/${p2(d.getUTCMonth() + 1)} às ${p2(h)}:${p2(min)}` };
}

type ClienteLike = { id: string; nome: string; endereco: string | null };
/** Escolhe o cliente: nome igual (sem acento) ou resultado único. Senão, devolve as opções para a pessoa escolher. */
export function escolherCliente<T extends ClienteLike>(nome: string, lista: T[]): { cliente: T } | { opcoes: T[] } {
  const igual = lista.filter((c) => sem(c.nome).trim() === sem(nome).trim());
  if (igual.length === 1) return { cliente: igual[0] };
  if (lista.length === 1) return { cliente: lista[0] };
  return { opcoes: lista };
}

export const FALTA_MEDICAO: Record<"cliente" | "data" | "hora" | "passado", string> = {
  cliente: "Para quem é a medição? Diga, por exemplo: agendar medição para Maria Souza amanhã às 14h.",
  data: "Para qual dia? Pode ser hoje, amanhã, um dia da semana ou uma data como 20/11.",
  hora: "Em qual horário? Por exemplo: às 14h.",
  passado: "Esse horário já passou. Diga um dia e horário futuros.",
};

export function intencao(texto: string): Intencao {
  const t = sem(texto);
  // Só o chamado ("Jarvis", "oi", "tudo bem?"): responde na hora, sem acionar a IA.
  if (/^\s*(?:(?:oi|ola|e ai|ei|hey|alo|tudo bem|como vai|jarvis|ta ai|esta ai|voce esta ai|pode falar)[\s,.!?]*)+$/.test(t)) return { tipo: "saudacao" };
  if (/\b(plano do dia|plano de hoje|planej\w* (o |meu )?dia|organiz\w* (o |meu )?dia|monte (o|um) plano)/.test(t)) return { tipo: "plano" };
  if (MEDICAO.test(t)) return { tipo: "medicao", cliente: clienteMedicao(texto) };
  const an = t.replace(/^\s+/, "").match(ANOTAR);
  if (an) {
    const titulo = texto.trim().slice(an[0].length).replace(/[.!]+$/, "").trim();
    if (titulo.length >= 3) {
      const tt = sem(titulo);
      return { tipo: "anotar", titulo: titulo.charAt(0).toUpperCase() + titulo.slice(1, 200),
        categoria: /\burgen/.test(tt) ? "urgente" : "compromisso",
        prazo: /\bamanha\b/.test(tt) ? "amanha" : /\bhoje\b/.test(tt) ? "hoje" : null };
    }
  }
  if (/\blia\b|\b(atendimento|whatsapp|zap)\b.{0,30}\b(como|esta|anda|hoje|resumo|situacao)|\b(como|resumo|situacao)\b.{0,30}\b(atendimento|whatsapp)\b/.test(t)) return { tipo: "lia" };
  if (/\b(deleg\w*|encaminh\w*|distribu\w*)\b/.test(t)) {
    const tema = TEMAS.find(([, re]) => re.test(t));
    return { tipo: "delegar", categorias: tema ? tema[0] : null, tema: tema ? tema[2] : "pendências", atrasadas: /atrasad|vencid/.test(t) };
  }
  for (const [cats, re, tema] of TEMAS) if (re.test(t)) return { tipo: "pendencias", categorias: cats, tema };
  if (GERAL.test(t)) return { tipo: "pendencias", categorias: null, tema: "pendências" };
  return { tipo: "ia" };
}

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function linha(i: Item): string {
  const extra = [i.cliente, i.motivo, typeof i.valor === "number" && i.valor > 0 ? brl(i.valor) : ""].filter(Boolean).join(", ");
  return `• ${i.titulo}${extra ? ` (${extra})` : ""}`;
}

/** Resposta falada/escrita a partir do briefing real. Limita a lista para caber numa fala. */
export function responderPendencias(b: BriefingLike, it: Extract<Intencao, { tipo: "pendencias" }>, max = 5): string {
  const partes: string[] = [];
  const falhas = (b.fontes ?? []).filter((f) => !f.ok).map((f) => f.nome);
  for (const e of b.empresas) {
    if (!it.categorias) {
      if (e.total === 0) continue;
      partes.push(e.resumo);
      const top = e.itens.slice(0, max);
      if (top.length) partes.push("Prioridades:\n" + top.map(linha).join("\n"));
      continue;
    }
    const lista = e.itens.filter((i) => it.categorias!.includes(i.categoria as Categoria));
    if (!lista.length) continue;
    const atrasadas = lista.filter((i) => typeof i.dias === "number" && i.dias < 0).length;
    partes.push(`Na ${e.nome}, ${lista.length} item(ns) de ${it.tema}` + (atrasadas ? `, ${atrasadas} atrasado(s).` : "."));
    partes.push(lista.slice(0, max).map(linha).join("\n") + (lista.length > max ? `\n…e mais ${lista.length - max} na tela Hoje.` : ""));
  }
  if (!partes.length) partes.push(it.categorias ? `Não encontrei ${it.tema} em aberto nos dados cadastrados.` : "Nenhuma pendência em aberto nos dados cadastrados.");
  if (falhas.length) partes.push(`Atenção: não consegui ler ${falhas.join(", ")} agora; a lista pode estar incompleta.`);
  return partes.join("\n\n");
}

/** Prompt curto para o agente (o modelo local tem contexto pequeno). */
export function montarPrompt(texto: string, historico: Turno[], resumoDia: string[]): string {
  const hist = historico.slice(-4).map((h) => `${h.de === "eu" ? "Proprietário" : "JARVIS"}: ${h.texto.slice(0, 300)}`).join("\n");
  return [
    "Você está conversando por voz com o proprietário. Responda em até 4 frases curtas, em português do Brasil, "
      + "sem markdown. Não diga que executou nada: se ele pedir uma ação, diga o que precisa para fazê-la ou que vai preparar para aprovação.",
    resumoDia.length ? "Situação de hoje (dados reais):\n" + resumoDia.join("\n") : "",
    hist ? "Conversa recente:\n" + hist : "",
    `Proprietário: ${texto}`,
  ].filter(Boolean).join("\n\n");
}

/** Texto para síntese de voz: sem marcadores e limitado. */
export function paraFala(texto: string, max = 600): string {
  const t = texto.replace(/[•*#_`>]/g, " ").replace(/\s*\n+\s*/g, ". ").replace(/\.\s*\./g, ".").replace(/\s{2,}/g, " ").trim();
  return t.length > max ? t.slice(0, max).replace(/\s\S*$/, "") + ". O restante está na tela." : t;
}

type ItemAcao = Item & { id: string; status?: string; agente: string; prazo?: string | null };
export const DELEGAR_MAX = 5;

/** Itens que a ação de delegar vai tocar: abertos (não delegados), na ordem de prioridade. */
export function alvosDelegar(b: { empresas: { itens: ItemAcao[] }[] }, it: Extract<Intencao, { tipo: "delegar" }>): ItemAcao[] {
  return b.empresas.flatMap((e) => e.itens)
    .filter((i) => i.status !== "delegada" && i.status !== "concluida" && i.status !== "cancelada")
    .filter((i) => !it.categorias || it.categorias.includes(i.categoria as Categoria))
    .filter((i) => !it.atrasadas || (typeof i.dias === "number" && i.dias < 0))
    .slice(0, DELEGAR_MAX);
}

/** Data ISO (fuso de Brasília) para "hoje"/"amanhã". */
export function prazoIso(p: "hoje" | "amanha" | null, agora = new Date()): string | null {
  if (!p) return null;
  const brt = new Date(agora.getTime() - 3 * 3600_000 + (p === "amanha" ? 86400_000 : 0));
  return brt.toISOString().slice(0, 10);
}

export const SIM = /^(sim|confirm\w*|pode( fazer| seguir| ir)?|ok|okay|isso|manda ver|faca|faça|executa\w*)\b/i;
export const NAO = /^(nao|não|cancel\w*|para|pare|deixa|esquece)\b/i;

export type LiaLike = { ativa: boolean; modo: string; hoje: Record<string, number>; sugestoes: { contato: string; texto: string }[]; aguardando_equipe: number; falhas_24h: string[] };
const MODO: Record<string, string> = { assistente: "assistente, só sugere", semiautomatica: "semiautomática", automatica: "automática supervisionada" };

/** Resumo do atendimento da Lia (WhatsApp) com dados reais do CRM. */
export function responderLia(l: LiaLike, max = 3): string {
  if (!l.ativa) return "A Lia está pausada no CRM. O atendimento do WhatsApp está só com a equipe.";
  const n = (k: string) => l.hoje[k] ?? 0;
  const partes = [`A Lia está ativa, no modo ${MODO[l.modo] ?? l.modo}. Hoje respondeu ${n("respondeu") + n("aprovada")} mensagem(ns)`
    + (n("sugeriu") ? ` e deixou ${n("sugeriu")} sugestão(ões)` : "") + "."];
  if (l.sugestoes.length) {
    partes.push(`${l.sugestoes.length} sugestão(ões) esperando aprovação no Atendimento:`);
    for (const s of l.sugestoes.slice(0, max)) partes.push(`• ${s.contato}: "${s.texto.slice(0, 80)}"`);
    if (l.sugestoes.length > max) partes.push(`• e mais ${l.sugestoes.length - max}.`);
  }
  if (l.aguardando_equipe) partes.push(`${l.aguardando_equipe} conversa(s) com mensagem nova esperando a equipe.`);
  if (l.falhas_24h.length) partes.push(`Atenção: ${l.falhas_24h.length} falha(s) da IA nas últimas 24 horas. Última: ${l.falhas_24h[0]}.`);
  if (!l.sugestoes.length && !l.aguardando_equipe && !l.falhas_24h.length) partes.push("Nada pendente no atendimento.");
  return partes.join("\n");
}
