"use client";
import { useActionState } from "react";
import { submitJob } from "./actions";
import { PROMPT_MAX } from "@/lib/validate";

export default function NewJobForm() {
  const [state, action, pending] = useActionState(submitJob, {});
  return (
    <form action={action} className="card stack">
      <h2>Nova tarefa</h2>
      <fieldset className="row">
        <legend>Perfil</legend>
        <label><input type="radio" name="agent" value="jarvis" defaultChecked /> JARVIS (coordenação)</label>
        <label><input type="radio" name="agent" value="sentinel" /> SENTINEL (auditoria)</label>
      </fieldset>
      <label>Descrição<textarea name="prompt" rows={5} minLength={3} maxLength={PROMPT_MAX} required /></label>
      {state.error && <p role="alert" className="error">{state.error}</p>}
      <button disabled={pending}>{pending ? "Enviando…" : "Enviar"}</button>
    </form>
  );
}
