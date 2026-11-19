import { getAccess } from "@/lib/auth";
import { paraFala } from "@/lib/conversa";
import { validVoiceText } from "@/lib/voice";

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
  // Only the self-hosted voice service (free Kokoro voice on the VPS).
  const ownUrl = process.env.JARVIS_VOICE_URL || (process.env.JARVIS_API_URL ? `${process.env.JARVIS_API_URL.replace(/\/+$/, "")}/voice` : undefined);
  const ownKey = process.env.JARVIS_VOICE_KEY || process.env.JARVIS_USER_KEY;
  if (!ownUrl) return error("O serviço de voz ainda não está conectado. Continue por texto.", 503);
  if (!ownKey) return error("A chave do serviço de voz não foi configurada.", 503);
  try {
    const response = await fetch(`${ownUrl.replace(/\/+$/, "")}/v1/tts`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ownKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text: paraFala(text, 180) }),
      cache: "no-store",
      signal: AbortSignal.timeout(90_000),
    });
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      return error(response.status === 429 ? "O JARVIS está preparando outra fala. Tente novamente em instantes." : "O serviço de voz não respondeu. Continue por texto ou tente ouvir novamente.", 502);
    }
    return new Response(response.body, { headers: { "Content-Type": "audio/wav", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return error("A geração da voz demorou ou perdeu a conexão. Tente ouvir novamente.", 504);
  }
}
