"use client";
import { useActionState } from "react";
import { submitJob } from "./actions";
import { AGENT_LABEL, PROMPT_MAX } from "@/lib/validate";

export default function NewJobForm() {
  const [state, action, pending] = useActionState(submitJob, {});
  return (
    <form action={action} className="card stack">
      <h2>Nova tarefa</h2>
      <label>Funcionário digital
        <select name="agent" defaultValue="jarvis">
          {Object.entries(AGENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <label>Empresa (as regras confirmadas dela vão para o agente)
        <select name="empresa" defaultValue="">
          <option value="">Nenhuma / geral</option>
          <option value="marquinhos">Marquinhos Calhas e Esquadrias</option>
          <option value="bielenki">Bielenki Metal</option>
        </select>
      </label>
      <label>Descrição<textarea name="prompt" rows={5} minLength={3} maxLength={PROMPT_MAX} required /></label>
      {state.error && <p role="alert" className="error">{state.error}</p>}
      <button disabled={pending}>{pending ? "Enviando…" : "Enviar"}</button>
    </form>
  );
}
