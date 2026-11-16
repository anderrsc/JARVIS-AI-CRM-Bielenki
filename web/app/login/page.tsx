import LoginForm from "./LoginForm";

export default function LoginPage() {
  return (
    <main className="narrow">
      <h1>JARVIS</h1>
      <p className="muted">Acesso restrito a usuários autorizados.</p>
      <LoginForm />
    </main>
  );
}
