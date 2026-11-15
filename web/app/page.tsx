import { Suspense } from "react";
import Link from "next/link";
import { getAccess } from "@/lib/auth";
import { listJobs, JarvisError, type JobSummary } from "@/lib/jarvis";
import { STATUS_LABEL } from "@/lib/validate";
import Header from "./Header";
import Forbidden from "./Forbidden";
import NewJobForm from "./NewJobForm";
import AutoRefresh from "./AutoRefresh";

async function Content() {
  const access = await getAccess();
  if (access.status !== "owner") return <Forbidden email={access.email} />;

  let jobs: JobSummary[] = [];
  let error = "";
  try {
    jobs = await listJobs();
  } catch (e) {
    error = e instanceof JarvisError ? e.message : "Erro inesperado.";
  }
  const pending = jobs.some((j) => j.status === "queued" || j.status === "running");

  return (
    <main>
      <Header email={access.email} />
      <NewJobForm />
      <section className="card">
        <h2>Tarefas recentes</h2>
        {error && <p role="alert" className="error">{error}</p>}
        {!error && jobs.length === 0 && <p className="muted">Nenhuma tarefa ainda.</p>}
        <ul className="jobs">
          {jobs.map((j) => (
            <li key={j.id}>
              <Link href={`/jobs/${j.id}`}>
                <span className="agent">{j.agent.toUpperCase()}</span>
                <span className={`status s-${j.status}`}>{STATUS_LABEL[j.status] ?? j.status}</span>
                <time className="muted small">{new Date(j.created_at * 1000).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</time>
              </Link>
            </li>
          ))}
        </ul>
      </section>
      {pending && <AutoRefresh />}
    </main>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<main><p className="muted">Carregando…</p></main>}>
      <Content />
    </Suspense>
  );
}
