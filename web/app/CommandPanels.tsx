import Link from "next/link";
import { getHoje, listJobs } from "@/lib/jarvis";
import { STATUS_LABEL } from "@/lib/validate";

export async function DayPanel() {
  const day = await getHoje().catch(() => null);
  const total = day?.empresas.reduce((sum, company) => sum + company.total, 0);
  return <aside className="hud-column" aria-label="Visão do dia">
    <section className="hud-panel"><h2>Visão do dia</h2><span className="hud-label">PENDÊNCIAS EM ABERTO</span><strong className="hud-metric">{total ?? "—"}</strong><p>{day ? `${day.empresas.reduce((sum, company) => sum + company.atrasadas, 0)} com prazo atrasado` : "Não foi possível consultar as pendências agora."}</p><Link className="hud-link" href="/hoje">Abrir prioridades <span>↗</span></Link></section>
    <section className="hud-panel"><h2>Seus espaços</h2><Link className="hud-link" href="/escritorio">▦ Escritório <span>↗</span></Link><Link className="hud-link" href="/tarefas">☷ Tarefas <span>↗</span></Link><Link className="hud-link" href="/conhecimento">◇ Conhecimento <span>↗</span></Link></section>
    {day && <section className="hud-panel"><h2>Empresas</h2>{day.empresas.map(company => <div key={company.empresa}><h3>{company.nome}</h3><p>{company.total} pendências · {company.atrasadas} atrasadas</p></div>)}</section>}
  </aside>;
}

export async function ActivityPanel() {
  const jobs = await listJobs().catch(() => null);
  const active = jobs?.filter(job => job.status === "running" || job.status === "queued").length;
  return <aside className="hud-column" aria-label="Atividade da equipe">
    <section className="hud-panel"><h2>Operação</h2><div className="hud-ring"><span>{active ?? "—"}</span></div><p style={{ textAlign: "center" }}>{jobs ? "tarefas na fila ou em execução" : "Atividade indisponível no momento"}</p></section>
    <section className="hud-panel"><h2>Últimas tarefas</h2>{jobs?.length ? <ul className="hud-activity">{jobs.slice(0, 4).map(job => <li key={job.id}><Link href={`/jobs/${job.id}`}>{job.agent.toUpperCase()} ↗</Link><br /><span className={`status s-${job.status}`}>{STATUS_LABEL[job.status] ?? job.status}</span></li>)}</ul> : <p>{jobs ? "A atividade da sua equipe aparecerá aqui." : "Não foi possível consultar a equipe."}</p>}<Link className="hud-link" href="/tarefas">Todas as tarefas <span>↗</span></Link></section>
  </aside>;
}
