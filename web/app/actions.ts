"use server";
// Server Actions: o Next.js compara Origin e Host (proteção CSRF) antes de executar.
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { createJob, JarvisError } from "@/lib/jarvis";
import { createClient } from "@/lib/supabase/server";
import { parseNewJob } from "@/lib/validate";

export type FormState = { error?: string };

export async function submitJob(_: FormState, form: FormData): Promise<FormState> {
  await requireUser();
  const parsed = parseNewJob(form.get("agent"), form.get("prompt"));
  if (!parsed.ok) return { error: parsed.error };
  let id: string;
  try {
    const empresa = form.get("empresa");
    id = (await createJob(parsed.agent, parsed.prompt, typeof empresa === "string" && /^[a-z0-9_-]{1,40}$/.test(empresa) ? empresa : null)).id;
  } catch (e) {
    return { error: e instanceof JarvisError ? e.message : "Erro inesperado." };
  }
  revalidatePath("/");
  redirect(`/jobs/${id}`);
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
