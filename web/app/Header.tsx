import Link from "next/link";
import { logout } from "./actions";

export default function Header({ email, owner = false }: { email: string; owner?: boolean }) {
  return (
    <header className="header">
      <Link href="/" className="brand">JARVIS</Link>
      <nav className="nav">
        <Link href="/hoje">Hoje</Link>
        <Link href="/">Tarefas</Link>
        <Link href="/conhecimento">Conhecimento</Link>
        {owner && <Link href="/usuarios">Usuários</Link>}
      </nav>
      <span className="muted small">{email}</span>
      <form action={logout}><button className="link">Sair</button></form>
    </header>
  );
}
