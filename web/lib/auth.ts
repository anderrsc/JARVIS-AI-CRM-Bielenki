import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isOwner, isUuid } from "@/lib/validate";

export type Access =
  | { status: "owner"; email: string; userId: string }
  | { status: "member"; email: string; userId: string; acessos: Record<string, string[]> }
  | { status: "forbidden"; email: string };

// Membro: o backend JARVIS decide o que ele pode (por empresa e módulo). O painel só repassa quem é.
async function memberAccess(userId: string): Promise<Record<string, string[]> | null> {
  const base = process.env.JARVIS_API_URL?.replace(/\/+$/, "");
  const key = process.env.JARVIS_USER_KEY;
  if (!base || !key || !isUuid(userId)) return null;
  try {
    const res = await fetch(base + "/me", {
      headers: { "X-API-Key": key, "X-Jarvis-User": userId },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const me = (await res.json()) as { proprietario: boolean; acessos: Record<string, string[]> };
    return me.proprietario ? null : me.acessos;
  } catch {
    return null;
  }
}

// getUser() valida o token no servidor de Auth do Supabase (não confia só no cookie). cache(): uma vez por requisição.
export const getAccess = cache(async (): Promise<Access> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect("/login");
  const email = data.user.email ?? "";
  if (isOwner(data.user.id, process.env.ALLOWED_USER_ID)) return { status: "owner", email, userId: data.user.id };
  const acessos = await memberAccess(data.user.id);
  return acessos ? { status: "member", email, userId: data.user.id, acessos } : { status: "forbidden", email };
});

// Para Server Actions: lança erro em vez de renderizar. A permissão fina é checada no backend.
export async function requireUser() {
  const access = await getAccess();
  if (access.status === "forbidden") throw new Error("Acesso negado");
  return access;
}

export async function requireOwner() {
  const access = await getAccess();
  if (access.status !== "owner") throw new Error("Acesso negado");
}

// Cabeçalho de identidade para o backend: vazio para o proprietário.
export async function actorHeaders(): Promise<Record<string, string>> {
  const access = await getAccess();
  if (access.status === "member") return { "X-Jarvis-User": access.userId };
  if (access.status === "owner") return {};
  throw new Error("Acesso negado");
}
