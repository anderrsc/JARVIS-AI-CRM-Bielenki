import Link from "next/link";
import { logout } from "./actions";
import Navigation from "./Navigation";

export default function Header({ email, owner = false }: { email: string; owner?: boolean }) {
  return (
    <header className="header">
      <Link href="/" className="brand"><span className="brand-mark" aria-hidden="true">J</span><span>JARVIS<small>ASSISTENTE EXECUTIVO</small></span></Link>
      <Navigation owner={owner} />
      <span className="account" title={email} aria-label={`Conta: ${email}`}>{email.slice(0, 1).toUpperCase()}</span>
      <form action={logout}><button className="logout">Sair</button></form>
    </header>
  );
}
