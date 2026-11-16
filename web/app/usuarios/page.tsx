import { Suspense } from "react";
import { getAccess } from "@/lib/auth";
import { JarvisError, listUsuarios, type Membro } from "@/lib/jarvis";
import Header from "../Header";
import Forbidden from "../Forbidden";
import MembroForm from "./MembroForm";
import { alternarAtivo } from "./actions";

async function Content() {
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
    </main>
  );
}

export default function UsuariosPage() {
  return (
    <Suspense fallback={<main><p className="muted">Carregando…</p></main>}>
      <Content />
    </Suspense>
  );
}
