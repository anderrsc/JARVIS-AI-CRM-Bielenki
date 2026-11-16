"use server";
import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { JarvisError, salvarUsuario, setUsuarioAtivo } from "@/lib/jarvis";
import { isUuid, parseMembro } from "@/lib/validate";

export type MembroState = { error?: string; ok?: number };

export async function salvar(prev: MembroState, form: FormData): Promise<MembroState> {
  await requireOwner();
  const p = parseMembro(form);
  if (!p.ok) return { error: p.error };
  try {
    await salvarUsuario(p.value);
  } catch (e) {
    return { error: e instanceof JarvisError ? e.message : "Erro inesperado." };
  }
  revalidatePath("/usuarios");
  return { ok: (prev.ok ?? 0) + 1 };
}

export async function alternarAtivo(form: FormData) {
  await requireOwner();
  const id = form.get("id");
  if (!isUuid(id)) throw new Error("Usuário inválido");
  await setUsuarioAtivo(id, form.get("ativo") === "true");
  revalidatePath("/usuarios");
}
