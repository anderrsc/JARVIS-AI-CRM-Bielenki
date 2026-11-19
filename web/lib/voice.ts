// Voz própria na VPS: Kokoro-82M, voz livre pm_alex (pt-BR). Sem voz clonada e sem API paga.
export const VOICE_TEXT_MAX = 1200;

export function validVoiceText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= VOICE_TEXT_MAX;
}

// A short first phrase can play while the server prepares the rest.
export function speechParts(text: string): string[] {
  const sentences = text.match(/.+?(?:[.!?]+(?=\s|$)|$)/g) ?? [];
  return sentences.flatMap(sentence => {
    const words = sentence.trim().split(/\s+/);
    const parts: string[] = [];
    let part = "";
    for (const word of words) {
      if (part && part.length + word.length + 1 > 140) { parts.push(part); part = ""; }
      part += (part ? " " : "") + word;
    }
    if (part) parts.push(part);
    return parts;
  });
}
