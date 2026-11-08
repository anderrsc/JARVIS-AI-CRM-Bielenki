"use client";
import { useActionState } from "react";
import { login } from "./actions";

export default function LoginForm() {
  const [state, action, pending] = useActionState(login, {});
  return (
    <form action={action} className="card stack">
      <label>E-mail<input name="email" type="email" autoComplete="email" required /></label>
      <label>Senha<input name="password" type="password" autoComplete="current-password" required /></label>
      {state.error && <p role="alert" className="error">{state.error}</p>}
      <button disabled={pending}>{pending ? "Entrando…" : "Entrar"}</button>
    </form>
  );
}
