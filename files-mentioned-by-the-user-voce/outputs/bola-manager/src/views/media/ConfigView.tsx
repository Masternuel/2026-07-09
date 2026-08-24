import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  Check,
  Cloud,
  KeyRound,
  Mail,
  Monitor,
  Moon,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Sun,
  UserRound,
} from 'lucide-react';
import { Badge } from '../../components/shared/Badge';
import { Button } from '../../components/shared/Button';
import { useAuth } from '../../hooks/useAuth';
import { useNotifications } from '../../hooks/useNotifications';
import { useUserPreferences } from '../../preferences/UserPreferencesContext';
import type { ThemePreference, UserPreferencesPatch } from '../../preferences/userPreferences';

interface ConfigViewProps {
  onToast: (message: string) => void;
}

type SettingsSection = 'account' | 'notifications' | 'interface' | 'access';

function Toggle({ checked, disabled, onChange, label }: {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      className="toggle"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <i />
    </button>
  );
}

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('')
    .toLocaleUpperCase('pt-BR') || 'BM';
}

const themeOptions: Array<{ key: ThemePreference; label: string; icon: typeof Moon }> = [
  { key: 'dark', label: 'Escuro', icon: Moon },
  { key: 'light', label: 'Claro', icon: Sun },
  { key: 'system', label: 'Sistema', icon: Monitor },
];

const notificationOptions = [
  ['offers', 'Ofertas e leilões', 'Lances superados e propostas recebidas'],
  ['matches', 'Partidas', 'Início, intervalo e resultado final'],
  ['news', 'Notícias do clube', 'Rumores, entrevistas e comunicados'],
] as const;

export function ConfigView({ onToast }: ConfigViewProps) {
  const auth = useAuth();
  const settings = useUserPreferences();
  const browserNotifications = useNotifications();
  const identity = auth.identity;
  const managerName = identity?.displayName || 'Manager';
  const [displayName, setDisplayName] = useState(managerName);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [permissionPending, setPermissionPending] = useState(false);
  const [activeSection, setActiveSection] = useState<SettingsSection>('account');
  const preferencesBusy = settings.status === 'loading' || settings.status === 'saving';

  useEffect(() => {
    setDisplayName(managerName);
    setProfileError(null);
  }, [identity?.uid, managerName]);

  function openSection(section: SettingsSection) {
    setActiveSection(section);
    if (typeof document === 'undefined') return;
    document.getElementById(`settings-${section}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function updatePreferences(patch: UserPreferencesPatch) {
    void settings.updatePreferences(patch);
  }

  async function saveProfile() {
    const previousName = identity?.displayName || 'Manager';
    setProfileSaving(true);
    setProfileError(null);
    try {
      await auth.updateDisplayName(displayName);
      onToast(identity?.mode === 'demo'
        ? 'Nome atualizado nesta demonstração.'
        : 'Nome atualizado no Firebase Auth.');
    } catch (nextError) {
      setDisplayName(previousName);
      setProfileError(nextError instanceof Error ? nextError.message : 'Não foi possível atualizar o perfil.');
    } finally {
      setProfileSaving(false);
    }
  }

  async function requestBrowserNotifications() {
    setPermissionPending(true);
    const permission = await browserNotifications.requestPermission();
    setPermissionPending(false);
    if (permission === 'granted') onToast('Notificações do navegador permitidas.');
  }

  const syncLabel = settings.status === 'loading'
    ? 'Carregando preferências do usuário…'
    : settings.status === 'saving'
      ? 'Salvando preferências…'
      : settings.status === 'error'
        ? settings.error || 'Não foi possível sincronizar as preferências.'
        : settings.savedAt
          ? `Preferências salvas às ${settings.savedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.`
          : identity?.mode === 'demo'
            ? 'Preferências ativas somente nesta demonstração.'
            : 'Preferências sincronizadas com sua conta.';

  const permissionCopy = browserNotifications.permission === 'granted'
    ? ['Notificações permitidas', 'Alertas aparecem com o jogo aberto e esta aba em segundo plano.']
    : browserNotifications.permission === 'denied'
      ? ['Notificações bloqueadas', 'Altere a permissão nas configurações do navegador.']
      : browserNotifications.permission === 'unsupported'
        ? ['Notificações indisponíveis', 'Este navegador não oferece a API de notificações.']
        : ['Permissão ainda não concedida', 'O navegador só perguntará após uma ação sua.'];

  return (
    <main className="secondary-view settings-view view-enter">
      <div className="view-heading">
        <div>
          <p className="eyebrow">CONTA E PREFERÊNCIAS</p>
          <h1>Configurações</h1>
          <p>Preferências globais ligadas à sua identidade, em qualquer save.</p>
        </div>
        <Badge tone={identity?.mode === 'firebase' ? 'positive' : 'info'}>
          <ShieldCheck size={12} /> {identity?.mode === 'firebase' ? 'Conta Firebase' : 'Modo demonstração'}
        </Badge>
      </div>

      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Seções de configurações">
          {([
            ['account', 'Conta', UserRound],
            ['notifications', 'Notificações', Bell],
            ['interface', 'Interface', Monitor],
            ['access', 'Acesso', KeyRound],
          ] as const).map(([section, label, Icon]) => (
            <button
              type="button"
              key={section}
              className={activeSection === section ? 'active' : undefined}
              aria-current={activeSection === section ? 'page' : undefined}
              onClick={() => openSection(section)}
            >
              <Icon size={15} /> {label}
            </button>
          ))}
        </nav>

        <div className="settings-main">
          <div className={`settings-sync settings-sync--${settings.status}`} role={settings.status === 'error' ? 'alert' : 'status'} aria-live="polite">
            {settings.status === 'error' ? <AlertTriangle size={16} /> : settings.status === 'saved' ? <Check size={16} /> : <Cloud size={16} />}
            <span>{syncLabel}</span>
            {settings.status === 'error' && (
              <Button size="sm" variant="ghost" icon={<RefreshCw size={13} />} onClick={() => void settings.reloadPreferences()}>
                Tentar novamente
              </Button>
            )}
          </div>

          <section className="settings-section" id="settings-account">
            <header>
              <div><p className="eyebrow">PERFIL DO MANAGER</p><h2>Sua conta</h2></div>
              <span className="avatar avatar--large">
                {identity?.photoURL ? <img src={identity.photoURL} alt="" referrerPolicy="no-referrer" /> : initials(managerName)}
              </span>
            </header>
            <div className="settings-form">
              <label>
                <span>Nome de exibição</span>
                <input value={displayName} maxLength={80} disabled={profileSaving} onChange={(event) => setDisplayName(event.target.value)} />
              </label>
              <label>
                <span>E-mail da conta</span>
                <span className="input-wrap"><Mail size={15} /><input type="email" value={identity?.email ?? 'Não informado nesta conta'} readOnly aria-readonly="true" /></span>
              </label>
              <label>
                <span>Região</span>
                <select
                  value={settings.preferences.profile.region}
                  disabled={preferencesBusy}
                  onChange={(event) => updatePreferences({ profile: { region: event.target.value as 'br-sp' | 'south-america' } })}
                >
                  <option value="br-sp">Brasil · São Paulo</option>
                  <option value="south-america">América do Sul</option>
                </select>
              </label>
              <label>
                <span>Idioma</span>
                <select value={settings.preferences.profile.locale} disabled aria-label="Idioma, somente Português do Brasil disponível">
                  <option value="pt-BR">Português (Brasil)</option>
                </select>
              </label>
            </div>
            {profileError && <p className="settings-form-error" role="alert">{profileError}</p>}
            <footer>
              <span>O e-mail continua sob controle do provedor de autenticação.</span>
              <Button
                variant="primary"
                loading={profileSaving}
                disabled={!identity || displayName.trim() === managerName}
                onClick={() => void saveProfile()}
              >
                Salvar nome
              </Button>
            </footer>
          </section>

          <section className="settings-section" id="settings-notifications">
            <header><div><p className="eyebrow">ALERTAS</p><h2>Notificações</h2></div><Smartphone size={18} /></header>
            {notificationOptions.map(([key, title, subtitle]) => (
              <div className="setting-row" key={key}>
                <span><strong>{title}</strong><small>{subtitle}</small></span>
                <Toggle
                  checked={settings.preferences.notifications[key]}
                  disabled={preferencesBusy}
                  onChange={(value) => updatePreferences({ notifications: { [key]: value } })}
                  label={title}
                />
              </div>
            ))}
            <div className={`notification-permission notification-permission--${browserNotifications.permission}`}>
              <Bell size={16} />
              <span><strong>{permissionCopy[0]}</strong><small>{permissionCopy[1]}</small></span>
              {browserNotifications.permission === 'granted' && <Check size={16} />}
              {browserNotifications.permission === 'default' && (
                <Button size="sm" variant="secondary" loading={permissionPending} onClick={() => void requestBrowserNotifications()}>
                  Permitir
                </Button>
              )}
              {(browserNotifications.permission === 'denied' || browserNotifications.permission === 'unsupported') && (
                <Badge tone="warning">Indisponível</Badge>
              )}
            </div>
            {browserNotifications.error && <p className="settings-form-error" role="alert">{browserNotifications.error}</p>}
          </section>

          <section className="settings-section" id="settings-interface">
            <header><div><p className="eyebrow">EXPERIÊNCIA</p><h2>Interface</h2></div><Monitor size={18} /></header>
            <div className="theme-options">
              {themeOptions.map(({ key, label, icon: Icon }) => (
                <button
                  type="button"
                  key={key}
                  aria-pressed={settings.preferences.theme === key}
                  disabled={preferencesBusy}
                  onClick={() => updatePreferences({ theme: key })}
                >
                  <span><Icon size={18} /></span>
                  <strong>{label}</strong>
                  {settings.preferences.theme === key && <Check size={14} />}
                </button>
              ))}
            </div>
            <div className="setting-row settings-readonly-row">
              <span><strong>Densidade da interface</strong><small>A interface usa a densidade padrão responsiva.</small></span>
              <Badge tone="neutral">Automática</Badge>
            </div>
          </section>

          <section className="settings-section" id="settings-access">
            <header><div><p className="eyebrow">SEGURANÇA</p><h2>Acesso à conta</h2></div><KeyRound size={18} /></header>
            <div className="setting-row settings-readonly-row">
              <span><strong>Gerenciamento de sessões</strong><small>O aplicativo ainda não mantém um inventário confiável de dispositivos conectados.</small></span>
              <Button variant="ghost" size="sm" disabled title="Recurso ainda não disponível">Indisponível</Button>
            </div>
          </section>
        </div>

        <aside className="settings-aside">
          <div className="manager-card">
            <span className="avatar avatar--large">
              {identity?.photoURL ? <img src={identity.photoURL} alt="" referrerPolicy="no-referrer" /> : initials(managerName)}
            </span>
            <h3>{managerName}</h3>
            <p>{identity?.email ?? 'Conta sem e-mail'}</p>
            <Badge tone={identity?.mode === 'firebase' ? 'positive' : 'info'}>
              {identity?.mode === 'firebase' ? 'Firebase Auth' : 'Demonstração'}
            </Badge>
            <dl>
              <div><dt>Região</dt><dd>{settings.preferences.profile.region === 'br-sp' ? 'São Paulo' : 'América do Sul'}</dd></div>
              <div><dt>Idioma</dt><dd>pt-BR</dd></div>
              <div><dt>Tema</dt><dd>{settings.preferences.theme === 'system' ? 'Sistema' : settings.preferences.theme === 'light' ? 'Claro' : 'Escuro'}</dd></div>
            </dl>
          </div>
          <div className="settings-storage-card">
            <Cloud size={16} />
            <span>
              <strong>{identity?.mode === 'firebase' ? 'Preferências no Firestore' : 'Preferências temporárias'}</strong>
              <small>{identity?.mode === 'firebase' ? 'Documento privado users/{uid}.' : 'O modo demonstração não grava um perfil remoto.'}</small>
            </span>
          </div>
        </aside>
      </div>
    </main>
  );
}
