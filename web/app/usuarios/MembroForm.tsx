"use client";
import { useActionState } from "react";
import { salvar } from "./actions";
import type { Membro } from "@/lib/jarvis";

type Props = { membro?: Membro; empresas: Record<string, string>; modulos: Record<string, string> };

export default function MembroForm({ membro, empresas, modulos }: Props) {
  const [state, action, pending] = useActionState(salvar, {});
  return (
    <form action={action} className="stack" key={membro ? undefined : state.ok ?? 0}>
      {membro ? <input type="hidden" name="id" value={membro.id} /> : (
        <label>UUID do usuário (Supabase do painel → Authentication → Users)
          <input name="id" required pattern="[0-9a-fA-F-]{36}" placeholder="00000000-0000-0000-0000-000000000000" />
        </label>
      )}
      <div className="grid2">
        <label>E-mail<input name="email" type="email" required defaultValue={membro?.email} maxLength={200} /></label>
        <label>Nome<input name="nome" defaultValue={membro?.nome ?? ""} maxLength={120} /></label>
        <label>Cargo<input name="cargo" defaultValue={membro?.cargo ?? ""} maxLength={80} /></label>
      </div>
      {Object.entries(empresas).map(([ek, en]) => (
        <fieldset key={ek} className="row">
          <legend>{en}</legend>
          {Object.entries(modulos).map(([mk, mn]) => (
            <label key={mk} className="small">
              <input type="checkbox" name="acesso" value={`${ek}:${mk}`} defaultChecked={membro?.acessos[ek]?.includes(mk)} /> {mn}
            </label>
          ))}
        </fieldset>
      ))}
      {state.error && <p role="alert" className="error">{state.error}</p>}
      {state.ok ? <p className="ok small" aria-live="polite">Salvo.</p> : null}
      <button disabled={pending}>{pending ? "Salvando…" : membro ? "Salvar acessos" : "Cadastrar"}</button>
    </form>
  );
}
