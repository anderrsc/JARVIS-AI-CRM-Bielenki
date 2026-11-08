import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAccess } from "@/lib/auth";
import { getJob, JarvisError, type Job } from "@/lib/jarvis";
import { isUuid, STATUS_LABEL } from "@/lib/validate";
import Header from "../../Header";
import Forbidden from "../../Forbidden";
import AutoRefresh from "../../AutoRefresh";

async function Content({ params }: { params: Promise<{ id: string }> }) {
  const access = await getAccess();
  if (access.status !== "owner") return <Forbidden email={access.email} />;
  const { id } = await params;
  if (!isUuid(id)) notFound();

  let job: Job | null = null;
  let error = "";
  try {
    job = await getJob(id);
  } catch (e) {
    error = e instanceof JarvisError ? e.message : "Erro inesperado.";
  }
  const pending = job && (job.status === "queued" || job.status === "running");

  return (
    <main>
      <Header email={access.email} />
      <p><Link href="/">← Voltar</Link></p>
      <section className="card stack">
        {error && <p role="alert" className="error">{error}</p>}
        {job && (
          <>
            <h2>{job.agent.toUpperCase()} <span className={`status s-${job.status}`}>{STATUS_LABEL[job.status] ?? job.status}</span></h2>
            <p className="muted small">
              Criada em {new Date(job.created_at * 1000).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} · tentativas: {job.attempts}
            </p>
            {job.result ? <pre className="result">{job.result}</pre> : <p className="muted">Sem resposta ainda.</p>}
            {pending && <AutoRefresh />}
          </>
        )}
      </section>
    </main>
  );
}

export default function JobPage({ params }: PageProps<"/jobs/[id]">) {
  return (
    <Suspense fallback={<main><p className="muted">Carregando…</p></main>}>
      <Content params={params} />
    </Suspense>
  );
}
