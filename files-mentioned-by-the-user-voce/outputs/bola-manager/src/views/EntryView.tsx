import { useState, type FormEvent } from 'react';
import { ArrowRight, BadgeCheck, Eye, EyeOff, Goal, Mail, ShieldCheck, Sparkles, Users } from 'lucide-react';
import { Button } from '../components/shared/Button';
import { ClubMark } from '../components/shared/ClubMark';
import { useAuth } from '../hooks/useAuth';

interface EntryViewProps {
  onAuthenticated: () => void;
}

export function EntryView({ onAuthenticated }: EntryViewProps) {
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [creatingAccount, setCreatingAccount] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    try {
      if (creatingAccount) await auth.createEmailAccount(email, password);
      else await auth.signInEmail(email, password);
      onAuthenticated();
    } catch {
      // A mensagem em português é fornecida pelo contexto de autenticação.
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setLoading(true);
    try {
      await auth.signInGoogle();
      onAuthenticated();
    } catch {
      // A mensagem em português é fornecida pelo contexto de autenticação.
    } finally {
      setLoading(false);
    }
  }

  function handleDemo() {
    auth.startDemo();
    onAuthenticated();
  }

  return (
    <main className="entry-screen">
      <section className="entry-hero" aria-label="Apresentação do Bola Manager">
        <div className="entry-hero__grid" aria-hidden="true" />
        <header className="entry-brand">
          <span className="wordmark-glyph"><Goal size={19} /></span>
          <span>BOLA<span>MANAGER</span></span>
          <small>Temporada 2026</small>
        </header>

        <div className="entry-hero__content">
          <div className="live-kicker"><span /> PRÉ-JOGO · EM 48 MINUTOS</div>
          <h1>O jogo começa<br />antes do <em>apito.</em></h1>
          <p>Monte seu elenco, controle cada detalhe tático e viva a temporada rodada por rodada. Futebol brasileiro, sem atalhos.</p>
          <div className="entry-fixture">
            <div className="entry-fixture__team">
              <ClubMark code="AUR" size="lg" />
              <span>Aurora FC<small>2º · 27 pts</small></span>
            </div>
            <div className="entry-fixture__kickoff"><strong>21:30</strong><span>Brasileirão · R14</span></div>
            <div className="entry-fixture__team entry-fixture__team--away">
              <ClubMark code="SAN" color="#e7e7e7" size="lg" />
              <span>Santos<small>10º · 15 pts</small></span>
            </div>
          </div>
        </div>

        <footer className="entry-proof">
          <span><ShieldCheck size={15} /> Gestão profunda</span>
          <span><Sparkles size={15} /> Partidas em tempo real</span>
          <span><Users size={15} /> Salas privadas</span>
        </footer>
      </section>

      <section className="entry-auth">
        <div className="entry-auth__panel">
          <div className="entry-auth__heading">
            <span className="auth-index">01 / {creatingAccount ? 'NOVO MANAGER' : 'ACESSO'}</span>
            <h2>{creatingAccount ? 'Crie sua carreira.' : 'Assuma o comando.'}</h2>
            <p>{creatingAccount ? 'Cadastre seu e-mail para criar salas persistentes.' : 'Entre para continuar sua carreira ou experimente a temporada do Aurora FC.'}</p>
          </div>

          <form onSubmit={handleSubmit} className="auth-form">
            <label>
              <span>E-mail</span>
              <span className="input-wrap"><Mail size={16} /><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></span>
            </label>
            <label>
              <span>Senha <small>{creatingAccount ? 'mínimo de 6 caracteres' : 'conta Firebase'}</small></span>
              <span className="input-wrap">
                <BadgeCheck size={16} />
                <input type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} required />
                <button type="button" className="input-action" aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'} onClick={() => setShowPassword((value) => !value)}>
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </span>
            </label>
            <Button type="submit" variant="primary" loading={loading} icon={<ArrowRight size={16} />} className="auth-submit">
              {creatingAccount ? 'Criar conta e entrar' : 'Entrar no vestiário'}
            </Button>
          </form>

          {auth.error && <p className="auth-error" role="alert">{auth.error}</p>}
          {!auth.firebaseConfigured && <p className="auth-error" role="alert">Firebase não configurado. Use o modo demonstração.</p>}

          <button type="button" className="auth-mode-switch" onClick={() => { setCreatingAccount((value) => !value); auth.clearError(); }}>
            {creatingAccount ? 'Já tenho uma conta' : 'Primeiro acesso? Criar conta'}
          </button>

          <div className="auth-divider"><span>ou continue com</span></div>
          <Button variant="secondary" className="google-button" onClick={() => void handleGoogle()} disabled={loading || !auth.firebaseConfigured}>
            <span className="google-g">G</span> Entrar com Google
          </Button>

          <button className="demo-entry" onClick={handleDemo}>
            <span><strong>Explorar modo demonstração</strong><small>Sem cadastro · dados fictícios</small></span>
            <ArrowRight size={17} />
          </button>
          <p className="auth-terms">Ao continuar, você aceita os <a href="#termos">Termos de uso</a> e a <a href="#privacidade">Política de privacidade</a>.</p>
        </div>
      </section>
    </main>
  );
}
