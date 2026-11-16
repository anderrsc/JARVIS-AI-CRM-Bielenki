"use client";
import { useActionState } from "react";
import { novaPendencia } from "./actions";
import { CATEGORIA_LABEL } from "@/lib/validate";

export default function NovaPendenciaForm({ empresas }: { empresas: { chave: string; nome: string }[] }) {
  const [state, action, pending] = useActionState(novaPendencia, {});
  return (
    <details className="card">
      <summary><h2 className="inline">Registrar pendência</h2></summary>
      {/* key: limpa o formulário depois de salvar */}
      <form action={action} className="stack" key={state.ok ?? 0}>
        <div className="grid2">
          <label>Empresa
            <select name="empresa" required defaultValue="">
              <option value="" disabled>Escolha…</option>
              {empresas.map((e) => <option key={e.chave} value={e.chave}>{e.nome}</option>)}
            </select>
          </label>
          <label>Tipo
            <select name="categoria" required defaultValue="">
              <option value="" disabled>Escolha…</option>
              {Object.entries(CATEGORIA_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
        </div>
        <label>O que precisa ser feito<input name="titulo" minLength={3} maxLength={200} required /></label>
        <div className="grid2">
          <label>Cliente (opcional)<input name="cliente" maxLength={200} /></label>
          <label>Prazo (opcional)<input name="prazo" type="date" /></label>
        </div>
        <label>Detalhes (opcional)<textarea name="detalhe" rows={3} maxLength={4000} /></label>
        {state.error && <p role="alert" className="error">{state.error}</p>}
        {state.ok ? <p className="ok small" aria-live="polite">Pendência registrada.</p> : null}
        <button disabled={pending}>{pending ? "Salvando…" : "Salvar"}</button>
      </form>
    </details>
  );
}
