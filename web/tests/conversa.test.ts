import { test } from "node:test";
import assert from "node:assert/strict";
import { intencao, responderPendencias, montarPrompt, paraFala } from "../lib/conversa.ts";

const b = {
  fontes: [{ nome: "CRM Bielenki", ok: true }],
  empresas: [
    { nome: "Marquinhos Calhas e Esquadrias", resumo: "Na Marquinhos: cobrança ou vencimento: 2.", atrasadas: 1, total: 3, itens: [
      { titulo: "Receber parcela", categoria: "financeiro", cliente: "Ana", motivo: "atrasada 2 dia(s)", dias: -2, valor: 1500 },
      { titulo: "Instalar calha", categoria: "instalacao", cliente: null, motivo: "vence hoje", dias: 0 },
      { titulo: "Pagar fornecedor", categoria: "financeiro", cliente: null, dias: 5 },
    ] },
    { nome: "Bielenki Metal", resumo: "Na Bielenki Metal: nenhuma pendência cadastrada.", atrasadas: 0, total: 0, itens: [] },
  ],
};

test("intenção: temas e geral, sem acento", () => {
  assert.deepEqual(intencao("Quais cobranças estão vencidas?"), { tipo: "pendencias", categorias: ["financeiro"], tema: "cobranças e vencimentos" });
  assert.equal((intencao("tem instalação amanhã?") as { categorias: string[] }).categorias[0], "instalacao");
  assert.equal((intencao("Bom dia JARVIS, o que eu tenho hoje?") as { categorias: null }).categorias, null);
  assert.deepEqual(intencao("escreva um texto sobre calhas"), { tipo: "ia" });
});

test("resposta filtrada usa só dados reais e conta atrasadas", () => {
  const r = responderPendencias(b, { tipo: "pendencias", categorias: ["financeiro"], tema: "cobranças" });
  assert.match(r, /2 item\(ns\) de cobranças, 1 atrasado/);
  assert.match(r, /Receber parcela \(Ana, atrasada 2 dia\(s\), R\$\s?1\.500,00\)/);
  assert.doesNotMatch(r, /Instalar calha|Bielenki Metal/);
});

test("resposta geral, vazia e fonte com falha", () => {
  const geral = responderPendencias(b, { tipo: "pendencias", categorias: null, tema: "pendências" });
  assert.match(geral, /Prioridades:/);
  const vazio = responderPendencias({ empresas: [], fontes: [{ nome: "CRM Bielenki", ok: false }] }, { tipo: "pendencias", categorias: ["compra"], tema: "compras" });
  assert.match(vazio, /Não encontrei compras/);
  assert.match(vazio, /não consegui ler CRM Bielenki/);
});

test("prompt curto com histórico limitado e fala limpa", () => {
  const hist = Array.from({ length: 10 }, (_, i) => ({ de: i % 2 ? "jarvis" : "eu", texto: "msg" + i }) as const);
  const p = montarPrompt("e agora?", [...hist], ["Na Marquinhos: x."]);
  assert.doesNotMatch(p, /msg5/);
  assert.match(p, /msg9/);
  assert.match(p, /Não diga que executou/);
  assert.equal(paraFala("• A\n• B"), "A. B");
  assert.match(paraFala("palavra ".repeat(200), 50), /O restante está na tela\.$/);
});
