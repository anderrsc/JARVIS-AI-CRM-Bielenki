import { test } from "node:test";
import assert from "node:assert/strict";
import { clienteMedicao, escolherCliente, intencao, quandoMedicao } from "../lib/conversa.ts";

// 18/11/2026 (quarta) 10:00 em Brasília
const agora = new Date("2026-11-18T13:00:00Z");

test("intenção de medição e nome do cliente", () => {
  assert.deepEqual(intencao("Jarvis, agendar medição para a Maria Souza amanhã às 14h"), { tipo: "medicao", cliente: "Maria Souza" });
  assert.equal(clienteMedicao("marca uma medição com o João da Silva na sexta às 9h"), "João da Silva");
  assert.equal(clienteMedicao("agende a medição do cliente Pedro Ávila dia 25 às 8:30"), "Pedro Ávila");
  assert.equal(clienteMedicao("agendar medição amanhã às 10"), null);
  assert.equal(intencao("quais medições estão atrasadas?").tipo, "pendencias");
});

test("data e hora em Brasília", () => {
  assert.deepEqual(quandoMedicao("amanhã às 14h", agora), { iso: "2026-11-19T14:00:00-03:00", rotulo: "qui, 19/11 às 14:00" });
  assert.deepEqual(quandoMedicao("na sexta às 9h30", agora), { iso: "2026-11-20T09:30:00-03:00", rotulo: "sex, 20/11 às 09:30" });
  assert.equal((quandoMedicao("quarta às 8", agora) as { iso: string }).iso, "2026-11-25T08:00:00-03:00");
  assert.equal((quandoMedicao("dia 5 às 3 da tarde", agora) as { iso: string }).iso, "2026-12-05T15:00:00-03:00");
  assert.equal((quandoMedicao("20/11 meio-dia", agora) as { iso: string }).iso, "2026-11-20T12:00:00-03:00");
  assert.equal((quandoMedicao("10/01 às 7:15", agora) as { iso: string }).iso, "2027-01-10T07:15:00-03:00");
  assert.deepEqual(quandoMedicao("amanhã", agora), { falta: "hora" });
  assert.deepEqual(quandoMedicao("às 14h", agora), { falta: "data" });
  assert.deepEqual(quandoMedicao("hoje às 8h", agora), { falta: "passado" });
  assert.deepEqual(quandoMedicao("31/02 às 8h", agora), { falta: "data" });
});

test("escolha do cliente", () => {
  const a = { id: "1", nome: "Maria Souza", endereco: null }, b2 = { id: "2", nome: "Maria Souza Lima", endereco: null };
  assert.deepEqual(escolherCliente("maria souza", [a, b2]), { cliente: a });
  assert.deepEqual(escolherCliente("maria", [a, b2]), { opcoes: [a, b2] });
  assert.deepEqual(escolherCliente("souza", [b2]), { cliente: b2 });
  assert.deepEqual(escolherCliente("x", []), { opcoes: [] });
});
