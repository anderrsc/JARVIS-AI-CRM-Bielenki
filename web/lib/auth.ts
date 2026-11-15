import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isOwner } from "@/lib/validate";

export type Access = { status: "owner"; email: string } | { status: "forbidden"; email: string };

// getUser() valida o token no servidor de Auth do Supabase (não confia só no cookie).
export async function getAccess(): Promise<Access> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect("/login");
  const email = data.user.email ?? "";
  return isOwner(data.user.id, process.env.ALLOWED_USER_ID)
    ? { status: "owner", email }
    : { status: "forbidden", email };
}

// Para Server Actions: lança erro em vez de renderizar.
export async function requireOwner() {
  const access = await getAccess();
  if (access.status !== "owner") throw new Error("Acesso negado");
}
