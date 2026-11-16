"use client";
import { useActionState } from "react";
import { planoDoDia } from "./actions";

export default function PlanoButton() {
  const [state, action, pending] = useActionState(planoDoDia, {});
  return (
    <form action={action} className="stack">
      <button disabled={pending}>{pending ? "Enviando…" : "Pedir plano do dia ao Secretário"}</button>
      {state.error && <p role="alert" className="error">{state.error}</p>}
    </form>
  );
}
