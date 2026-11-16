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

export type Intencao = { tipo: "pendencias"; categorias: Categoria[] | null; tema: string } | { tipo: "ia" };

export function intencao(texto: string): Intencao {
  const t = sem(texto);
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
