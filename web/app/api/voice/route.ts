import { getAccess } from "@/lib/auth";
import { paraFala } from "@/lib/conversa";
import { FREE_VOICE_MODEL, freeVoiceAvailable, validVoiceText, VOICE_ID } from "@/lib/voice";

export const maxDuration = 180;

function error(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  // Cookie-authenticated endpoint: only same-origin requests may synthesize audio.
  if (request.headers.get("origin") !== new URL(request.url).origin) return error("Origem inválida.", 403);
  const access = await getAccess();
  if (access.status === "forbidden") return error("Acesso negado.", 403);
  if (!request.headers.get("content-type")?.includes("application/json")) return error("Formato inválido.", 415);
  // Bound the body before parsing, including chunked requests.
  const reader = request.body?.getReader();
  if (!reader) return error("Texto inválido.", 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 8192) { await reader.cancel(); return error("Texto muito longo.", 413); }
    chunks.push(value);
  }
  let body: unknown;
  try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return error("Texto inválido.", 400); }
  const text = body && typeof body === "object" && "text" in body ? body.text : null;
  if (!validVoiceText(text)) return error("Texto inválido ou muito longo.", 400);
  // Self-hosting is the default. Fish is an explicitly configured, free-only bridge.
  const ownUrl = process.env.JARVIS_VOICE_URL || (!process.env.FISH_AUDIO_API_KEY && process.env.JARVIS_API_URL ? `${process.env.JARVIS_API_URL.replace(/\/+$/, "")}/voice` : undefined);
  const ownKey = process.env.JARVIS_VOICE_KEY || process.env.JARVIS_USER_KEY;
  const key = process.env.FISH_AUDIO_API_KEY;
  if (ownUrl && !ownKey) return error("A chave do serviço próprio de voz não foi configurada.", 503);
  if (!ownUrl && !key) return error("O serviço próprio de voz ainda não está conectado. Ouça a amostra em Voz e continue por texto.", 503);
  if (!ownUrl && !freeVoiceAvailable()) return error("O período gratuito anunciado pelo Fish Audio terminou. Conecte o serviço próprio de voz para continuar sem API paga.", 503);
  try {
    const response = await fetch(ownUrl ? `${ownUrl.replace(/\/+$/, "")}/v1/tts` : "https://api.fish.audio/v1/tts", {
      method: "POST",
      headers: { Authorization: `Bearer ${ownUrl ? ownKey : key}`, "Content-Type": "application/json", ...(!ownUrl ? { model: FREE_VOICE_MODEL } : {}) },
      body: JSON.stringify(ownUrl ? { text: paraFala(text, 180) } : { text: paraFala(text), reference_id: VOICE_ID, format: "mp3" }),
      cache: "no-store",
      signal: AbortSignal.timeout(ownUrl ? 150_000 : 50_000),
    });
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      if (ownUrl) return error(response.status === 429 ? "O JARVIS está preparando outra fala. Tente novamente em instantes." : "O serviço próprio de voz não respondeu. Continue por texto ou tente ouvir novamente.", 502);
      return error(response.status === 401 ? "A chave do Fish Audio não foi aceita." : response.status === 402 ? "O Fish Audio não liberou esta voz no plano gratuito. Nenhum modelo pago foi acionado." : response.status === 429 ? "Limite gratuito atingido. Tente ouvir novamente em instantes." : "Não foi possível gerar essa voz no Fish Audio. Você pode continuar por texto.", 502);
    }
    return new Response(response.body, { headers: { "Content-Type": ownUrl ? "audio/wav" : "audio/mpeg", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return error("A geração da voz demorou ou perdeu a conexão. Tente ouvir novamente.", 504);
  }
}
