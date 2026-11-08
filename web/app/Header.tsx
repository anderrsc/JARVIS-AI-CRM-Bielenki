import Link from "next/link";
import { logout } from "./actions";

export default function Header({ email }: { email: string }) {
  return (
    <header className="header">
      <Link href="/" className="brand">JARVIS</Link>
      <span className="muted small">{email}</span>
      <form action={logout}><button className="link">Sair</button></form>
    </header>
  );
}
