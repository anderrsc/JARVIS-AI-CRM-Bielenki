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
