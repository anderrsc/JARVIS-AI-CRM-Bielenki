"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { createRegra, editarRegra, JarvisError, regraAcao } from "@/lib/jarvis";
import { isUuid, parseNovaRegra } from "@/lib/validate";

export type RegraState = { error?: string; ok?: number; semelhantes?: string[] };

export async function novaRegra(prev: RegraState, form: FormData): Promise<RegraState> {
  await requireUser();
  const p = parseNovaRegra({
    empresa: form.get("empresa"), assunto: form.get("assunto"), texto: form.get("texto"),
    estado: form.get("estado"), fonte: form.get("fonte"),
  });
  if (!p.ok) return { error: p.error };
  try {
    const r = await createRegra(p.value);
    revalidatePath("/conhecimento");
    return { ok: (prev.ok ?? 0) + 1, semelhantes: r.semelhantes.map((s) => s.texto) };
  } catch (e) {
    return { error: e instanceof JarvisError ? e.message : "Erro inesperado." };
  }
}

function id(form: FormData) {
  const v = form.get("id");
  if (!isUuid(v)) throw new Error("Regra inválida");
  return v;
}

export async function confirmar(form: FormData) {
  await requireUser();
  await regraAcao(id(form), "confirmar");
  revalidatePath("/conhecimento");
}

export async function arquivar(form: FormData) {
  await requireUser();
  await regraAcao(id(form), "arquivar");
  revalidatePath("/conhecimento");
}

export async function editar(form: FormData) {
  await requireUser();
  const texto = String(form.get("texto") ?? "").trim();
  if (texto.length < 5 || texto.length > 1000) throw new Error("Texto inválido");
  await editarRegra(id(form), texto);
  revalidatePath("/conhecimento");
}
