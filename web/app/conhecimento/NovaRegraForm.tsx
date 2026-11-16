"use client";
import { useActionState } from "react";
import { novaRegra } from "./actions";

export default function NovaRegraForm({ empresa, assuntos }: { empresa: string; assuntos: Record<string, string> }) {
  const [state, action, pending] = useActionState(novaRegra, {});
  return (
    <form action={action} className="card stack" key={state.ok ?? 0}>
      <h2>Ensinar uma regra</h2>
      <input type="hidden" name="empresa" value={empresa} />
      <div className="grid2">
        <label>Assunto
          <select name="assunto" required defaultValue="">
            <option value="" disabled>Escolha…</option>
            {Object.entries(assuntos).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label>Tipo
          <select name="estado" defaultValue="provisoria">
            <option value="provisoria">Informação provisória</option>
            <option value="hipotese">Hipótese</option>
            <option value="sugestao">Sugestão</option>
          </select>
        </label>
      </div>
      <label>Regra ou procedimento<textarea name="texto" rows={3} minLength={5} maxLength={1000} required /></label>
      <label>Fonte (opcional)<input name="fonte" maxLength={200} placeholder="ex.: instrução do proprietário, tabela 28/10" /></label>
      {state.error && <p role="alert" className="error">{state.error}</p>}
      {state.ok ? (
        <div className="small" aria-live="polite">
          <p className="ok">Regra registrada. Ela só vale para os agentes depois de confirmada.</p>
          {state.semelhantes?.length ? (
            <>
              <p className="warn">Atenção: já existem regras parecidas. Confira se é duplicata ou conflito:</p>
              <ul>{state.semelhantes.map((t, i) => <li key={i}>{t}</li>)}</ul>
            </>
          ) : null}
        </div>
      ) : null}
      <button disabled={pending}>{pending ? "Salvando…" : "Registrar"}</button>
    </form>
  );
}
