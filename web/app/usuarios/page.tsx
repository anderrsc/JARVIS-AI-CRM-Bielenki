import { Suspense } from "react";
import { getAccess } from "@/lib/auth";
import Link from "next/link";
import { JarvisError, getAuditoria, listUsuarios, type Evento, type Membro } from "@/lib/jarvis";
import Header from "../Header";
import Forbidden from "../Forbidden";
import MembroForm from "./MembroForm";
import { alternarAtivo } from "./actions";

const TIPO: Record<string, string> = {
  "acesso.negado": "Tentativa negada",
  "usuario.acessos": "Acessos alterados",
  "usuario.ativado": "Acesso reativado",
  "usuario.revogado": "Acesso revogado",
};
const tipoNome = (t: string) => TIPO[t] ?? t.replace(".", " · ");
const hora = (ts: number) => new Date(ts * 1000).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

async function Content({ searchParams }: { searchParams: Promise<{ filtro?: string }> }) {
  const sp = await searchParams;
  const filtro = sp.filtro === "negadas" || sp.filtro === "usuarios" ? sp.filtro : "";
  const access = await getAccess();
  if (access.status !== "owner") return <Forbidden email={access.email} />;
  let usuarios: Membro[] = [];
  let modulos: Record<string, string> = {};
  let empresas: Record<string, string> = {};
  let error = "";
  try {
    ({ usuarios, modulos, empresas } = await listUsuarios());
  } catch (e) {
    error = e instanceof JarvisError ? e.message : "Erro inesperado.";
  }
  let eventos: Evento[] = [];
  if (!error) {
    eventos = await getAuditoria({ tipo: filtro === "negadas" ? "acesso.negado" : filtro === "usuarios" ? "usuario." : undefined })
      .catch(() => []);
  }
  return (
    <main>
      <Header email={access.email} owner />
      <section className="card stack">
        <h1>Usuários e permissões</h1>
        <p className="muted small">
          Crie a conta em Supabase (Authentication → Users), copie o UUID e libere aqui o que a pessoa pode fazer em cada empresa.
          Sem a empresa marcada, ela não vê nada dela, nem pelo JARVIS. Revogar vale na hora.
        </p>
        {error && <p role="alert" className="error">{error}</p>}
      </section>
      {usuarios.map((u) => (
        <section key={u.id} className="card stack">
          <h2>{u.nome || u.email} {!u.ativo && <span className="status s-failed">Revogado</span>}</h2>
          <p className="muted small">
            {u.email}{u.cargo ? ` · ${u.cargo}` : ""} · último acesso:{" "}
            {u.ultimo_acesso ? new Date(u.ultimo_acesso * 1000).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "nunca"}
          </p>
          <details><summary className="small">Editar acessos</summary><MembroForm membro={u} empresas={empresas} modulos={modulos} /></details>
          <form action={alternarAtivo}>
            <input type="hidden" name="id" value={u.id} />
            <input type="hidden" name="ativo" value={u.ativo ? "false" : "true"} />
            <button className={u.ativo ? "link" : "secondary"}>{u.ativo ? "Revogar acesso" : "Reativar"}</button>
          </form>
        </section>
      ))}
      {!error && (
        <section className="card stack">
          <h2>Novo usuário</h2>
          <MembroForm empresas={empresas} modulos={modulos} />
        </section>
      )}
      {!error && (
        <section className="card stack" id="auditoria">
          <h2>Auditoria</h2>
          <p className="small">
            {[["", "Tudo"], ["negadas", "Tentativas negadas"], ["usuarios", "Mudanças de acesso"]].map(([k, n], i) => (
              <span key={k}>{i > 0 && " · "}{filtro === k ? <strong>{n}</strong> : <Link href={k ? `/usuarios?filtro=${k}#auditoria` : "/usuarios#auditoria"}>{n}</Link>}</span>
            ))}
          </p>
          {eventos.length === 0 ? <p className="muted small">Nenhum registro.</p> : (
            <ul className="small stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {eventos.map((e) => (
                <li key={e.id}>
                  <span className="muted">{hora(e.ts)}</span> · <strong>{e.ator_nome}</strong> ·{" "}
                  <span className={e.tipo === "acesso.negado" ? "error" : ""}>{tipoNome(e.tipo)}</span>
                  {e.empresa ? ` · ${empresas[e.empresa] ?? e.empresa}` : ""}
                  {e.recurso && e.tipo === "acesso.negado" ? ` · ${modulos[e.recurso.split(":")[0]] ?? e.recurso}` : ""}
                  {e.detalhe && e.tipo !== "acesso.negado" ? <span className="muted"> · {e.detalhe}</span> : ""}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}

export default function UsuariosPage({ searchParams }: PageProps<"/usuarios">) {
  return (
    <Suspense fallback={<main><p className="muted">Carregando…</p></main>}>
      <Content searchParams={searchParams as Promise<{ filtro?: string }>} />
    </Suspense>
  );
}
