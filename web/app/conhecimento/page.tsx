import { Suspense } from "react";
import Link from "next/link";
import { getAccess } from "@/lib/auth";
import { getEquipe, JarvisError, listRegras, type Regra } from "@/lib/jarvis";
import { ESTADO_REGRA_LABEL } from "@/lib/validate";
import Header from "../Header";
import Forbidden from "../Forbidden";
import NovaRegraForm from "./NovaRegraForm";
import { arquivar, confirmar, editar } from "./actions";

function Item({ r, assuntos }: { r: Regra; assuntos: Record<string, string> }) {
  const pendente = r.estado !== "confirmada";
  return (
    <li>
      <div>
        <span className="tag">{assuntos[r.assunto] ?? r.assunto}</span>
        <span className="small muted"> · {ESTADO_REGRA_LABEL[r.estado] ?? r.estado} · v{r.versao}{r.fonte ? ` · ${r.fonte}` : ""}</span>
      </div>
      <span>{r.texto}</span>
      <div className="actions">
        {pendente && (
          <form action={confirmar}><input type="hidden" name="id" value={r.id} /><button className="secondary">Confirmar</button></form>
        )}
        <details>
          <summary className="small">Editar</summary>
          <form action={editar} className="stack">
            <input type="hidden" name="id" value={r.id} />
            <textarea name="texto" rows={3} defaultValue={r.texto} minLength={5} maxLength={1000} required />
            <button className="secondary">Salvar nova versão</button>
          </form>
        </details>
        <form action={arquivar}><input type="hidden" name="id" value={r.id} /><button className="link">Arquivar</button></form>
      </div>
    </li>
  );
}

async function Content({ searchParams }: { searchParams: Promise<{ empresa?: string }> }) {
  const access = await getAccess();
  if (access.status !== "owner") return <Forbidden email={access.email} />;
  const sp = await searchParams;

  let error = "";
  let empresas: { chave: string; nome: string }[] = [];
  let regras: Regra[] = [];
  let assuntos: Record<string, string> = {};
  let empresa = "";
  try {
    empresas = (await getEquipe()).empresas;
    empresa = empresas.some((e) => e.chave === sp.empresa) ? sp.empresa! : empresas[0]?.chave ?? "";
    if (empresa) ({ regras, assuntos } = await listRegras(empresa));
  } catch (e) {
    error = e instanceof JarvisError ? e.message : "Erro inesperado.";
  }
  const pendentes = regras.filter((r) => r.estado !== "confirmada");
  const confirmadas = regras.filter((r) => r.estado === "confirmada");

  return (
    <main>
      <Header email={access.email} />
      <section className="card stack">
        <h1>Central de Conhecimento</h1>
        <p className="muted small">Só regras confirmadas por você chegam aos funcionários digitais, e só da empresa da tarefa. Editar cria uma nova versão; a anterior vale até você confirmar a nova.</p>
        <nav className="nav">
          {empresas.map((e) => (
            <Link key={e.chave} href={`/conhecimento?empresa=${e.chave}`} aria-current={e.chave === empresa ? "page" : undefined}
              className={e.chave === empresa ? "brand small" : "small"}>{e.nome}</Link>
          ))}
        </nav>
        {error && <p role="alert" className="error">{error}</p>}
      </section>
      {empresa && (
        <>
          <section className="card stack">
            <h2>Aguardando confirmação ({pendentes.length})</h2>
            {pendentes.length === 0 && <p className="muted">Nada pendente.</p>}
            <ul className="pend">{pendentes.map((r) => <Item key={r.id} r={r} assuntos={assuntos} />)}</ul>
          </section>
          <section className="card stack">
            <h2>Confirmadas ({confirmadas.length})</h2>
            {confirmadas.length === 0 && <p className="muted">Nenhuma regra confirmada ainda.</p>}
            <ul className="pend">{confirmadas.map((r) => <Item key={r.id} r={r} assuntos={assuntos} />)}</ul>
          </section>
          <NovaRegraForm empresa={empresa} assuntos={assuntos} />
        </>
      )}
    </main>
  );
}

export default function ConhecimentoPage({ searchParams }: PageProps<"/conhecimento">) {
  return (
    <Suspense fallback={<main><p className="muted">Carregando…</p></main>}>
      <Content searchParams={searchParams as Promise<{ empresa?: string }>} />
    </Suspense>
  );
}
