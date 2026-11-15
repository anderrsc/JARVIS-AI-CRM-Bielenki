import Header from "./Header";

export default function Forbidden({ email }: { email: string }) {
  return (
    <main>
      <Header email={email} />
      <p role="alert" className="error card">Esta conta não tem permissão de acesso.</p>
    </main>
  );
}
