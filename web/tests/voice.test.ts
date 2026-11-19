import { test } from "node:test";
import assert from "node:assert/strict";
import { validVoiceText, speechParts } from "../lib/voice.ts";

test("voice rejects invalid or unbounded requests", () => {
  for (const value of [null, {}, 8, "", "   ", "a".repeat(1201)]) assert.equal(validVoiceText(value), false);
  assert.equal(validVoiceText("Pois não, senhor."), true);
});

test("short opening plays first and longer speech keeps every word", () => {
  const text = "Pois não, senhor. " + "Uma resposta com informações importantes para hoje. ".repeat(6);
  const parts = speechParts(text);
  assert.equal(parts[0], "Pois não, senhor.");
  assert.equal(parts.join(" "), text.trim());
  assert.ok(parts.every(part => part.length <= 140));
});

test("speech boundaries preserve currency values and decimal numbers", () => {
  assert.deepEqual(speechParts("O valor é R$ 1.500,00. Confira hoje."), ["O valor é R$ 1.500,00.", "Confira hoje."]);
});
