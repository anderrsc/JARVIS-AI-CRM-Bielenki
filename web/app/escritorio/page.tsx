import { Suspense } from "react";
import Link from "next/link";
import { getAccess } from "@/lib/auth";
import { getEquipe, getHoje, listJobs, JarvisError, type Briefing, type Equipe, type JobSummary } from "@/lib/jarvis";
import { AGENT_LABEL, AGENTS, type Agent } from "@/lib/validate";
import Header from "../Header";
import Forbidden from "../Forbidden";
import AutoRefresh from "../AutoRefresh";
import OfficeScene, { type OfficeAgent } from "./OfficeScene";

// Escritório: cada funcionário digital com o que está fazendo agora (fila real) e o que tem atribuído (pendências reais).
async function Content() {
  const access = await getAccess();
  if (access.status === "forbidden") return <Forbidden email={access.email} />;

  const [eq, jobs, hoje] = await Promise.allSettled([getEquipe(), listJobs(), getHoje()]);
  const erro = [eq, jobs, hoje].find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
  const agentes = (eq.status === "fulfilled" && (eq.value as Equipe).agentes) ||
    AGENTS.map((k) => ({ chave: k, nome: AGENT_LABEL[k], departamento: "Equipe" }));
  const lista: JobSummary[] = jobs.status === "fulfilled" ? jobs.value : [];
  const pend = new Map<Agent, number>();
  if (hoje.status === "fulfilled") {
    for (const e of (hoje.value as Briefing).empresas) for (const i of e.itens) pend.set(i.agente, (pend.get(i.agente) ?? 0) + 1);
  }

  const deps = new Map<string, typeof agentes>();
  for (const a of agentes) deps.set(a.departamento, [...(deps.get(a.departamento) ?? []), a]);
  const ativo = lista.some((j) => j.status === "queued" || j.status === "running");

  return (
    <main className="wide">
      <Header email={access.email} owner={access.status === "owner"} />
      <div className="office-heading"><div><span className="eyebrow">CENTRO DE OPERAÇÕES</span><h1>Seu escritório digital</h1><p className="muted small">A equipe, as prioridades e o trabalho acontecendo.</p></div><Link href="/tarefas" className="office-task-link">Acompanhar tarefas ↗</Link></div>
      {erro && <p role="alert" className="error">{erro.reason instanceof JarvisError ? erro.reason.message : "Parte dos dados não carregou."}</p>}
      <OfficeScene agents={agentes.map(a => {
        const mine = lista.filter(job => job.agent === a.chave);
        return {
          id: a.chave, name: a.nome, department: a.departamento,
          status: jobs.status === "rejected" ? "unknown" : mine.some(job => job.status === "running") ? "working" : mine.some(job => job.status === "queued") ? "queued" : "ready",
          pending: hoje.status === "fulfilled" ? pend.get(a.chave) ?? 0 : null,
          queue: jobs.status === "fulfilled" ? mine.filter(job => job.status === "queued").length : null,
          completed: jobs.status === "fulfilled" ? mine.filter(job => job.status === "completed").length : null,
          lastJob: mine[0]?.id,
        } satisfies OfficeAgent;
      })} />
      <details className="office-list"><summary>Ver equipe em lista</summary>
      <div className="office">
        {[...deps.entries()].map(([dep, membros]) => (
          <section key={dep} className="dept">
            <h2>{dep}</h2>
            {membros.map((a) => {
              const meus = lista.filter((j) => j.agent === a.chave);
              const rodando = meus.find((j) => j.status === "running");
              const fila = meus.filter((j) => j.status === "queued").length;
              const feitas = meus.filter((j) => j.status === "completed").length;
              const ultima = meus[0];
              const st = rodando ? "trabalhando" : fila ? "na fila" : "disponível";
              return (
                <article key={a.chave} className={`emp ${rodando ? "on" : fila ? "wait" : ""}`}>
                  <div className="agent-station" aria-hidden="true"><div className="agent-screen"><span /> <span /> <span /></div><span className="agent-avatar">{a.nome.slice(0, 1)}</span><div className="agent-desk" /></div>
                  <div className="emp-head"><span className="led" aria-hidden="true" /><strong>{a.nome}</strong></div>
                  <p className="small muted">{st}{fila ? ` · ${fila} na fila` : ""}</p>
                  <p className="small">{pend.get(a.chave) ?? 0} pendência(s) · {feitas} tarefa(s) concluída(s)</p>
                  {ultima && <Link className="small" href={`/jobs/${ultima.id}`}>Última tarefa</Link>}
                </article>
              );
            })}
          </section>
        ))}
      </div>
      </details>
      <AutoRefresh seconds={ativo ? 5 : 20} />
    </main>
  );
}

export default function Escritorio() {
  return (
    <Suspense fallback={<main><p className="muted">Carregando…</p></main>}>
      <Content />
    </Suspense>
  );
}
