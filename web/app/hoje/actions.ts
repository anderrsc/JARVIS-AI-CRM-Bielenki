"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { createPendencia, delegarCrm, delegarPendencia, JarvisError, pedirPlano, setPendenciaStatus } from "@/lib/jarvis";
import { isCrmItemId, isUuid, parseNovaPendencia } from "@/lib/validate";

export type FormState = { error?: string; ok?: number };

const msg = (e: unknown) => (e instanceof JarvisError ? e.message : "Erro inesperado.");

export async function novaPendencia(prev: FormState, form: FormData): Promise<FormState> {
  await requireUser();
  const parsed = parseNovaPendencia({
    empresa: form.get("empresa"), categoria: form.get("categoria"), titulo: form.get("titulo"),
    cliente: form.get("cliente"), prazo: form.get("prazo"), detalhe: form.get("detalhe"),
  });
  if (!parsed.ok) return { error: parsed.error };
  try {
    await createPendencia(parsed.value);
  } catch (e) {
    return { error: msg(e) };
  }
  revalidatePath("/hoje");
  return { ok: (prev.ok ?? 0) + 1 };
}

function pendenciaId(form: FormData): string {
  const id = form.get("id");
  if (!isUuid(id)) throw new Error("Pendência inválida");
  return id;
}

export async function delegar(form: FormData) {
  await requireUser();
  const { job_id } = await delegarPendencia(pendenciaId(form));
  revalidatePath("/hoje");
  redirect(`/jobs/${job_id}`);
}

export async function delegarItemCrm(form: FormData) {
  await requireUser();
  const id = form.get("id");
  if (!isCrmItemId(id)) throw new Error("Item inválido");
  const { job_id } = await delegarCrm(id);
  revalidatePath("/hoje");
  redirect(`/jobs/${job_id}`);
}

export async function concluir(form: FormData) {
  await requireUser();
  await setPendenciaStatus(pendenciaId(form), "concluida");
  revalidatePath("/hoje");
}

export async function planoDoDia(): Promise<FormState> {
  await requireUser();
  let id: string;
  try {
    id = (await pedirPlano()).id;
  } catch (e) {
    return { error: msg(e) };
  }
  redirect(`/jobs/${id}`);
}
