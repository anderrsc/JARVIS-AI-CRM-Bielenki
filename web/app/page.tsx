import { Suspense } from "react";
import { getAccess } from "@/lib/auth";
import Header from "./Header";
import Forbidden from "./Forbidden";
import Jarvis from "./Jarvis";

async function Content() {
  const access = await getAccess();
  if (access.status === "forbidden") return <Forbidden email={access.email} />;
  return (
    <main className="jv-page">
      <Header email={access.email} owner={access.status === "owner"} />
      <Jarvis nome="senhor" />
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
