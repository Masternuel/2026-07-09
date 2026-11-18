import { Pencil, ShieldCheck } from 'lucide-react';
import type { ManagerIdentity } from '../../types';
import { Badge } from '../shared/Badge';
import { Button } from '../shared/Button';
import { ResilientImage } from '../shared/ResilientImage';
import { getMenuCapabilities } from './mainMenuModel';

export function ProfilePage({ identity, saveCount, onSettings }: { identity: ManagerIdentity; saveCount: number; onSettings: () => void }) {
  const capabilities = getMenuCapabilities(identity.mode);
  return (
    <section className="menu-profile" aria-labelledby="menu-profile-title">
      <header className="menu-page-heading"><div><p className="eyebrow">SUA IDENTIDADE</p><h1 id="menu-profile-title">Perfil do manager</h1><p>O mesmo perfil acompanha suas preferências e carreiras disponíveis.</p></div></header>
      <div className="menu-profile__identity"><span className="avatar avatar--large"><ResilientImage src={identity.photoURL} alt="" fallback={identity.displayName.slice(0, 2).toLocaleUpperCase('pt-BR')} /></span><div><h2>{identity.displayName}</h2><p>{identity.email ?? (capabilities.desktop ? 'Perfil deste computador · sem e-mail' : 'E-mail não informado')}</p><Badge tone={capabilities.canEdit ? 'positive' : 'info'}><ShieldCheck size={13} aria-hidden="true" />{capabilities.modeLabel}</Badge></div><Button variant="secondary" icon={<Pencil size={15} aria-hidden="true" />} onClick={onSettings}>Editar nome em Configurações</Button></div>
      <dl className="menu-profile__details"><div><dt>Identificador do manager</dt><dd>{identity.uid}</dd></div><div><dt>Carreiras disponíveis</dt><dd>{saveCount}</dd></div><div><dt>Armazenamento</dt><dd>{capabilities.storageLabel}</dd></div><div><dt>Edição da base</dt><dd>{capabilities.canEdit ? 'Disponível com esta conta Firebase' : 'Indisponível para esta identidade'}</dd></div></dl>
      <p className="menu-notice">O perfil não possui níveis, XP ou conquistas globais. Seu histórico de jogo é apresentado somente a partir dos metadados dos saves disponíveis.</p>
    </section>
  );
}
