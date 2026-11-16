"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Navigation({ owner }: { owner: boolean }) {
  const path = usePathname();
  const links = [["/", "Conversa", "◉"], ["/hoje", "Hoje", "◷"], ["/escritorio", "Escritório", "▦"], ["/tarefas", "Tarefas", "☷"], ["/conhecimento", "Conhecimento", "◇"], ...(owner ? [["/usuarios", "Usuários", "♙"]] : [])];
  return <nav className="nav" aria-label="Navegação principal">{links.map(([href, label, icon]) => <Link key={href} href={href} aria-current={path === href || (href === "/tarefas" && path.startsWith("/jobs/")) ? "page" : undefined}><span aria-hidden="true">{icon}</span>{label}</Link>)}</nav>;
}
