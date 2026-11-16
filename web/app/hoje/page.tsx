import { Suspense } from "react";
import Link from "next/link";
import { getAccess } from "@/lib/auth";
import { getEquipe, getHoje, JarvisError, type Briefing, type Equipe } from "@/lib/jarvis";
import { AGENT_LABEL, CATEGORIA_LABEL, STATUS_LABEL } from "@/lib/validate";
import Header from "../Header";
import Forbidden from "../Forbidden";
import NovaPendenciaForm from "./NovaPendenciaForm";
import PlanoButton from "./PlanoButton";
import { concluir, delegar } from "./actions";

async function Content() {
  const access = await getAccess();
  if (access.status !== "owner") return <Forbidden email={access.email} />;

  let hoje: Briefing | null = null;
  let equipe: Equipe | null = null;
  let error = "";
  try {
    [hoje, equipe] = await Promise.all([getHoje(), getEquipe()]);
  } catch (e) {
    error = e instanceof JarvisError ? e.message : "Erro inesperado.";
  }

  return (
    <main>
      <Header email={access.email} />
      <section className="card stack">
        <h1>O que temos para hoje</h1>
        {error && <p role="alert" className="error">{error}</p>}
        {hoje && (
          <>
            <p className="muted small">
              {new Date(hoje.data + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}
              {" · "}priorizado: urgentes, clientes aguardando, prazos, produção, instalações, cobranças, compras, compromissos, decisões, melhorias.
            </p>
            {hoje.empresas.map((e) => <p key={e.empresa}>{e.resumo}</p>)}
            <PlanoButton />
          </>
        )}
      </section>

      {hoje?.empresas.map((e) => (
        <section key={e.empresa} className="card stack">
          <h2>{e.nome} <span className="muted small">({e.total})</span></h2>
          {e.itens.length === 0 && <p className="muted">Nenhuma pendência aberta.</p>}
          <ul className="pend">
            {e.itens.map((p) => (
              <li key={p.id} className={p.dias != null && p.dias < 0 ? "late" : ""}>
                <div>
                  <span className="tag">{CATEGORIA_LABEL[p.categoria] ?? p.categoria}</span>
                  {p.motivo && <span className={`small ${p.dias != null && p.dias <= 0 ? "error" : "warn"}`}> · {p.motivo}</span>}
                </div>
                <strong>{p.titulo}</strong>
                <span className="muted small">
                  {p.cliente && <>Cliente: {p.cliente} · </>}
                  Responsável: {AGENT_LABEL[p.agente] ?? p.agente} · {STATUS_LABEL[p.status] ?? p.status}
                </span>
                {p.detalhe && <span className="small">{p.detalhe}</span>}
                <div className="actions">
                  {p.status === "delegada" && p.job_id ? (
                    <Link href={`/jobs/${p.job_id}`}>Ver resposta do agente</Link>
                  ) : (
                    <form action={delegar}><input type="hidden" name="id" value={p.id} /><button className="secondary">Delegar</button></form>
                  )}
                  <form action={concluir}><input type="hidden" name="id" value={p.id} /><button className="link">Concluir</button></form>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {equipe && <NovaPendenciaForm empresas={equipe.empresas} />}
    </main>
  );
}

export default function HojePage() {
  return (
    <Suspense fallback={<main><p className="muted">Carregando…</p></main>}>
      <Content />
    </Suspense>
  );
}
