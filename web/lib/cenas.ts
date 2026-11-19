// Cenas: cada frase falada pelo JARVIS vem com um cartão HUD na tela (estilo "fala e mostra").
// Lógica pura, só com dados reais do /hoje, /crm/lia e da medição. Testada em tests/cenas.test.ts.

export type Tom = "alerta" | "ok" | "info";
export type LinhaCena = { texto: string; detalhe?: string; valor?: string; tom?: Tom };
export type Cena = { fala: string; titulo: string; destaque?: string; legenda?: string; tom?: Tom; linhas?: LinhaCena[] };

type Item = { titulo: string; categoria: string; cliente: string | null; motivo?: string; dias?: number | null; valor?: number | null };
type Empresa = { empresa?: string; nome: string; resumo: string; atrasadas: number; total: number; itens: Item[] };
export type BriefingCenas = { empresas: Empresa[] };

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

// Ordem de importância para o dono: dinheiro, medições/prazos, obra, clientes.
const GRUPOS: { cats: string[]; titulo: string; um: string; varios: string }[] = [
  { cats: ["financeiro"], titulo: "Cobranças", um: "cobrança", varios: "cobranças" },
  { cats: ["prazo"], titulo: "Medições e prazos", um: "medição ou prazo", varios: "medições e prazos" },
  { cats: ["instalacao"], titulo: "Instalações", um: "instalação", varios: "instalações" },
  { cats: ["urgente"], titulo: "Urgências", um: "urgência", varios: "urgências" },
  { cats: ["cliente_retorno"], titulo: "Clientes aguardando", um: "cliente aguardando retorno", varios: "clientes aguardando retorno" },
  { cats: ["producao", "compra"], titulo: "Produção e compras", um: "item de produção ou compra", varios: "itens de produção e compras" },
  { cats: ["compromisso", "decisao", "melhoria"], titulo: "Outros", um: "outro item", varios: "outros itens" },
];

const atrasado = (i: Item) => typeof i.dias === "number" && i.dias < 0;

function linhaItem(i: Item): LinhaCena {
  return {
    texto: i.cliente || i.titulo,
    detalhe: [i.cliente ? i.titulo : "", i.motivo].filter(Boolean).join(" · ") || undefined,
    valor: typeof i.valor === "number" && i.valor > 0 ? brl(i.valor) : undefined,
    tom: atrasado(i) ? "alerta" : undefined,
  };
}

/** Só a Marquinhos, por enquanto (se o briefing não disser a empresa, usa o que veio). */
function marquinhos(b: BriefingCenas): Empresa[] {
  const m = b.empresas.filter((e) => e.empresa === "marquinhos" || /marquinhos/i.test(e.nome));
  return m.length ? m : b.empresas;
}

function cenaGrupo(e: Empresa, g: (typeof GRUPOS)[number], lista: Item[], max: number): Cena {
  const atr = lista.filter(atrasado).length;
  const soma = lista.reduce((s, i) => s + (typeof i.valor === "number" && i.valor > 0 ? i.valor : 0), 0);
  const primeiro = lista[0];
  const fala = `${g.titulo}: ${plural(lista.length, "item", "itens")}${atr ? `, ${atr} atrasado${atr > 1 ? "s" : ""}` : ""}${soma ? `, somando ${brl(soma)}` : ""}.`
    + (primeiro ? ` O primeiro é ${primeiro.cliente ? `de ${primeiro.cliente}` : primeiro.titulo}${primeiro.motivo ? `, ${primeiro.motivo}` : ""}.` : "");
  return {
    fala, titulo: g.titulo, destaque: String(lista.length), legenda: soma ? brl(soma) : atr ? `${atr} atrasado${atr > 1 ? "s" : ""}` : e.nome,
    tom: atr ? "alerta" : "info",
    linhas: lista.slice(0, max).map(linhaItem).concat(lista.length > max ? [{ texto: `+ ${lista.length - max} na tela Hoje` }] : []),
  };
}

/** Briefing do dia ou de um tema, frase por frase. */
export function cenasPendencias(b: BriefingCenas, categorias: string[] | null, max = 4, maxGrupos = 4): Cena[] {
  const cenas: Cena[] = [];
  for (const e of marquinhos(b)) {
    const itens = categorias ? e.itens.filter((i) => categorias.includes(i.categoria)) : e.itens;
    if (!itens.length) continue;
    const grupos = GRUPOS.map((g) => ({ g, lista: itens.filter((i) => g.cats.includes(i.categoria)) })).filter((x) => x.lista.length);
    if (!categorias) {
      const atr = itens.filter(atrasado).length;
      cenas.push({
        fala: `Na ${e.nome.split(" ")[0]}, temos ${plural(itens.length, "pendência", "pendências")} hoje${atr ? `, ${atr} atrasada${atr > 1 ? "s" : ""}` : ""}.`,
        titulo: `Hoje · ${e.nome}`, destaque: String(itens.length), legenda: atr ? `${atr} atrasada${atr > 1 ? "s" : ""}` : "em dia",
        tom: atr ? "alerta" : "ok",
        linhas: grupos.map(({ g, lista }) => ({ texto: g.titulo, valor: String(lista.length), tom: lista.some(atrasado) ? "alerta" as const : undefined })),
      });
    }
    for (const { g, lista } of grupos.slice(0, maxGrupos)) cenas.push(cenaGrupo(e, g, lista, max));
  }
  return cenas;
}

type LiaCenas = { ativa: boolean; hoje: Record<string, number>; sugestoes: { contato: string; texto: string }[]; aguardando_equipe: number; falhas_24h: string[] };

export function cenasLia(l: LiaCenas): Cena[] {
  if (!l.ativa) return [{ fala: "A Lia está pausada. O WhatsApp está só com a equipe.", titulo: "Lia · WhatsApp", destaque: "Pausada", tom: "alerta" }];
  const n = (k: string) => l.hoje[k] ?? 0;
  const respondeu = n("respondeu") + n("aprovada");
  const cenas: Cena[] = [{ fala: `A Lia respondeu ${plural(respondeu, "mensagem", "mensagens")} hoje.`, titulo: "Lia · WhatsApp", destaque: String(respondeu), legenda: "respostas hoje", tom: "ok",
    linhas: [{ texto: "Sugestões para aprovar", valor: String(l.sugestoes.length) }, { texto: "Conversas esperando a equipe", valor: String(l.aguardando_equipe), tom: l.aguardando_equipe ? "alerta" : undefined }] }];
  if (l.sugestoes.length) cenas.push({ fala: `${plural(l.sugestoes.length, "sugestão espera", "sugestões esperam")} sua aprovação no Atendimento.`, titulo: "Aprovar no Atendimento", destaque: String(l.sugestoes.length), tom: "alerta",
    linhas: l.sugestoes.slice(0, 3).map((s) => ({ texto: s.contato, detalhe: s.texto.slice(0, 80) })) });
  if (l.falhas_24h.length) cenas.push({ fala: `Atenção: ${plural(l.falhas_24h.length, "falha", "falhas")} da IA nas últimas 24 horas.`, titulo: "Falhas da Lia", destaque: String(l.falhas_24h.length), tom: "alerta",
    linhas: [{ texto: l.falhas_24h[0].slice(0, 90) }] });
  return cenas;
}

type ClienteFicha = { nome: string; telefone?: string | null; endereco?: string | null };

/** Ficha do cliente no pedido de medição (antes de confirmar). */
export function cenaMedicao(c: ClienteFicha, rotulo: string, fala: string): Cena {
  return {
    fala, titulo: "Medição · confirmar", destaque: c.nome, legenda: rotulo, tom: "info",
    linhas: [
      c.endereco ? { texto: "Endereço", detalhe: c.endereco } : null,
      c.telefone ? { texto: "Telefone", detalhe: c.telefone } : null,
      { texto: "Quando", detalhe: rotulo },
      { texto: "Cliente", detalhe: "Nada é enviado ao cliente" },
    ].filter((l): l is { texto: string; detalhe: string } => !!l),
  };
}
