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
  | { tipo: "ia" };

// Ações (mudam algo) sempre passam por confirmação antes de executar.
export const precisaConfirmar = (i: Intencao) => i.tipo === "delegar" || i.tipo === "anotar";

const ANOTAR = /^(?:jarvis[,\s]+)?(?:anote|anota|anotar|lembre-me de|lembre-me|me lembre de|me lembra de|lembrar de|crie uma (?:tarefa|pendencia)|criar (?:tarefa|pendencia)|nova (?:tarefa|pendencia))\s*(?:que|de|:|,)?\s*/i;

export function intencao(texto: string): Intencao {
  const t = sem(texto);
  // Só o chamado ("Jarvis", "oi", "tudo bem?"): responde na hora, sem acionar a IA.
  if (/^\s*(?:(?:oi|ola|e ai|ei|hey|alo|tudo bem|como vai|jarvis|ta ai|esta ai|voce esta ai|pode falar)[\s,.!?]*)+$/.test(t)) return { tipo: "saudacao" };
  if (/\b(plano do dia|plano de hoje|planej\w* (o |meu )?dia|organiz\w* (o |meu )?dia|monte (o|um) plano)/.test(t)) return { tipo: "plano" };
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
