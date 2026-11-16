// The free provider must never fall back to a paid model.
export const VOICE_ID = "a5b93aeddcc948c19ea04f0afe9d178c";
export const FREE_VOICE_MODEL = "s2.1-pro-free";
export const FREE_VOICE_END = Date.parse("2026-12-01T00:00:00Z");
export const VOICE_TEXT_MAX = 1200;

export function freeVoiceAvailable(now = Date.now()) {
  return now < FREE_VOICE_END;
}

export function validVoiceText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= VOICE_TEXT_MAX;
}
