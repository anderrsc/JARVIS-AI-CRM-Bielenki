import LoginForm from "./LoginForm";

export default function LoginPage() {
  return (
    <main className="login-page">
      <section className="login-intro">
        <span className="eyebrow">SEU ASSISTENTE EXECUTIVO</span>
        <div className="login-reactor" aria-hidden="true"><span>J</span></div>
        <h1>Clareza para decidir.<br /><em>Tempo para criar.</em></h1>
        <p>Suas empresas, sua equipe e suas prioridades.<br />Tudo começa com uma conversa.</p>
        <span className="login-signature">JARVIS <span> / </span> BIELENKI</span>
      </section>
      <section className="login-panel">
        <span className="brand"><span className="brand-mark" aria-hidden="true">J</span>JARVIS</span>
        <div><span className="eyebrow">BEM-VINDO DE VOLTA</span><h2>Seu próximo passo<br />começa aqui.</h2><p className="muted">Entre para acessar seu espaço de trabalho.</p></div>
        <LoginForm />
        <p className="login-security"><span aria-hidden="true">◇</span> Ambiente privado · Acesso autorizado</p>
      </section>
    </main>
  );
}
