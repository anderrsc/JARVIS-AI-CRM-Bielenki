import { test } from "node:test";
import assert from "node:assert/strict";
import { isOwner, isUuid, parseNewJob } from "../lib/validate.ts";

const OWNER = "11111111-2222-3333-4444-555555555555";

test("isOwner: só o UUID permitido", () => {
  assert.equal(isOwner(OWNER, OWNER), true);
  assert.equal(isOwner(OWNER.toUpperCase(), ` ${OWNER} `), true);
  assert.equal(isOwner("99999999-2222-3333-4444-555555555555", OWNER), false);
  assert.equal(isOwner(OWNER, undefined), false);
  assert.equal(isOwner(OWNER, ""), false);
  assert.equal(isOwner(OWNER, "nao-uuid"), false);
  assert.equal(isOwner(undefined, OWNER), false);
});

test("parseNewJob: valida perfil e tamanho", () => {
  assert.deepEqual(parseNewJob("sentinel", "  analisar CRM "), { ok: true, agent: "sentinel", prompt: "analisar CRM" });
  assert.equal(parseNewJob("root", "abc").ok, false);
  assert.equal(parseNewJob("jarvis", "a ").ok, false);
  assert.equal(parseNewJob("jarvis", "x".repeat(6001)).ok, false);
  assert.equal(parseNewJob("jarvis", null).ok, false);
});

test("isUuid", () => {
  assert.equal(isUuid(OWNER), true);
  assert.equal(isUuid("../worker/claim"), false);
});

test("parseNovaPendencia", async () => {
  const { parseNovaPendencia } = await import("../lib/validate.ts");
  const base = { empresa: "marquinhos", categoria: "urgente", titulo: " Medir obra ", cliente: " ", prazo: "2026-11-20", detalhe: null };
  const ok = parseNovaPendencia(base);
  assert.equal(ok.ok, true);
  if (ok.ok) assert.deepEqual(ok.value, { empresa: "marquinhos", categoria: "urgente", titulo: "Medir obra", cliente: null, prazo: "2026-11-20", detalhe: null });
  assert.equal(parseNovaPendencia({ ...base, categoria: "x" }).ok, false);
  assert.equal(parseNovaPendencia({ ...base, empresa: "../x" }).ok, false);
  assert.equal(parseNovaPendencia({ ...base, prazo: "20/11/2026" }).ok, false);
  assert.equal(parseNovaPendencia({ ...base, titulo: "a" }).ok, false);
  assert.equal(parseNovaPendencia({ ...base, prazo: "" }).ok, true);
});

test("isCrmItemId", async () => {
  const { isCrmItemId } = await import("../lib/validate.ts");
  assert.equal(isCrmItemId("crm:orcamento:11111111-2222-3333-4444-555555555555"), true);
  assert.equal(isCrmItemId("crm:orcamento:../../x"), false);
  assert.equal(isCrmItemId("11111111-2222-3333-4444-555555555555"), false);
});

test("parseNovaRegra", async () => {
  const { parseNovaRegra } = await import("../lib/validate.ts");
  const ok = parseNovaRegra({ empresa: "marquinhos", assunto: "medicao", texto: " Conferir medidas ", estado: "confirmada", fonte: "" });
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.value.estado, "provisoria"); // o painel nunca cria regra já confirmada
  assert.equal(parseNovaRegra({ empresa: "x/y", assunto: "medicao", texto: "abcdef", estado: "", fonte: null }).ok, false);
  assert.equal(parseNovaRegra({ empresa: "marquinhos", assunto: "medicao", texto: "abc", estado: "", fonte: null }).ok, false);
});

test("parseMembro", async () => {
  const { parseMembro } = await import("../lib/validate.ts");
  const fd = (o: Record<string, string | string[]>) => ({
    get: (k: string) => (Array.isArray(o[k]) ? o[k][0] : o[k]) ?? null,
    getAll: (k: string) => (Array.isArray(o[k]) ? o[k] : o[k] ? [o[k]] : []),
  });
  const ok = parseMembro(fd({ id: "AAAAAAAA-bbbb-cccc-dddd-eeeeeeeeeeee", email: "a@b.com", acesso: ["marquinhos:hoje", "marquinhos:delegar"] }));
  assert.equal(ok.ok, true);
  if (ok.ok) assert.deepEqual(ok.value.acessos, { marquinhos: ["hoje", "delegar"] });
  assert.equal(parseMembro(fd({ id: "x", email: "a@b.com" })).ok, false);
  assert.equal(parseMembro(fd({ id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", email: "a@b.com", acesso: "x;drop" })).ok, false);
});
