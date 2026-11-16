import { Suspense } from "react";
import { getAccess } from "@/lib/auth";
import Header from "./Header";
import Forbidden from "./Forbidden";
import Jarvis from "./Jarvis";
import { DayPanel, ActivityPanel } from "./CommandPanels";

async function Content() {
  const access = await getAccess();
  if (access.status === "forbidden") return <Forbidden email={access.email} />;
  return (
    <main className="jv-page">
      <Header email={access.email} owner={access.status === "owner"} />
      <div className="jv-workspace">
        <Suspense fallback={<aside className="hud-column"><p className="muted small">Consultando prioridades…</p></aside>}><DayPanel /></Suspense>
        <Jarvis nome="senhor" />
        <Suspense fallback={<aside className="hud-column"><p className="muted small">Consultando equipe…</p></aside>}><ActivityPanel /></Suspense>
      </div>
    </main>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<main className="jv-page"><p className="muted">Iniciando JARVIS…</p></main>}>
      <Content />
    </Suspense>
  );
}
