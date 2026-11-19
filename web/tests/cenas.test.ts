import { test } from "node:test";
import assert from "node:assert/strict";
import { cenaMedicao, cenasLia, cenasPendencias } from "../lib/cenas.ts";

const b = {
  empresas: [
    { empresa: "marquinhos", nome: "Marquinhos Calhas e Esquadrias", resumo: "", atrasadas: 1, total: 3, itens: [
      { titulo: "Receber parcela", categoria: "financeiro", cliente: "Ana", motivo: "atrasada 2 dia(s)", dias: -2, valor: 1500 },
      { titulo: "Medir janelas", categoria: "prazo", cliente: "Maria Souza", motivo: "hoje 14h", dias: 0 },
      { titulo: "Pagar fornecedor", categoria: "financeiro", cliente: null, dias: 5, valor: 500 },
    ] },
    { empresa: "bielenki", nome: "Bielenki Metal", resumo: "", atrasadas: 0, total: 1, itens: [
      { titulo: "Item da metalúrgica", categoria: "financeiro", cliente: null, dias: 1 },
    ] },
  ],
};

test("briefing do dia: resumo + um cartão por tema, só Marquinhos, dinheiro primeiro", () => {
  const c = cenasPendencias(b, null);
  assert.equal(c.length, 3);
  assert.match(c[0].fala, /^Na Marquinhos, temos 3 pendências hoje, 1 atrasada\.$/);
  assert.equal(c[0].tom, "alerta");
  assert.equal(c[1].titulo, "Cobranças");
  assert.match(c[1].fala, /2 itens, 1 atrasado, somando R\$\s?2\.000,00\. O primeiro é de Ana, atrasada 2 dia\(s\)\./);
  assert.equal(c[1].linhas![0].tom, "alerta");
  assert.equal(c[2].titulo, "Medições e prazos");
  assert.ok(!JSON.stringify(c).includes("metalúrgica"));
});

test("tema filtrado não repete o resumo e limita a lista", () => {
  const c = cenasPendencias(b, ["financeiro"], 1);
  assert.equal(c.length, 1);
  assert.equal(c[0].linhas!.at(-1)!.texto, "+ 1 na tela Hoje");
  assert.deepEqual(cenasPendencias(b, ["instalacao"]), []);
});

test("Lia e ficha da medição", () => {
  const l = cenasLia({ ativa: true, hoje: { respondeu: 4, aprovada: 1 }, sugestoes: [{ contato: "João", texto: "Olá" }], aguardando_equipe: 0, falhas_24h: [] });
  assert.equal(l[0].destaque, "5");
  assert.equal(l[1].titulo, "Aprovar no Atendimento");
  assert.equal(cenasLia({ ativa: false, hoje: {}, sugestoes: [], aguardando_equipe: 0, falhas_24h: [] })[0].destaque, "Pausada");
  const m = cenaMedicao({ nome: "Maria Souza", telefone: null, endereco: "Rua A, 1" }, "qui, 20/11 às 14:00", "Confirma?");
  assert.equal(m.destaque, "Maria Souza");
  assert.deepEqual(m.linhas!.map((x) => x.texto), ["Endereço", "Quando", "Cliente"]);
});
