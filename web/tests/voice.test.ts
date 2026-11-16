import { test } from "node:test";
import assert from "node:assert/strict";
import { freeVoiceAvailable, validVoiceText, FREE_VOICE_MODEL, VOICE_ID } from "../lib/voice.ts";

test("free voice fails closed at the announced deadline", () => {
  assert.equal(freeVoiceAvailable(Date.parse("2026-11-30T23:59:59Z")), true);
  assert.equal(freeVoiceAvailable(Date.parse("2026-12-01T00:00:00Z")), false);
  assert.equal(FREE_VOICE_MODEL, "s2.1-pro-free");
  assert.equal(VOICE_ID, "a5b93aeddcc948c19ea04f0afe9d178c");
});

test("voice rejects invalid or unbounded requests", () => {
  for (const value of [null, {}, 8, "", "   ", "a".repeat(1201)]) assert.equal(validVoiceText(value), false);
  assert.equal(validVoiceText("Pois não, senhor."), true);
});
