import { BarChart3, BookOpen, ChevronRight, Database, Gamepad2, LogOut, Play, Plus, Radio, Settings2, UserRound, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import type { SocketState } from '../../hooks/useSocket';
import type { ManagerIdentity } from '../../types';
import { getMenuCapabilities, mainMenuPages, type MainMenuPageId } from './mainMenuModel';
import { BrandLogo } from '../shared/BrandLogo';

const pageIcons = { career: Gamepad2, 'new-game': Plus, continue: Play, multiplayer: Users, editor: Database, settings: Settings2, profile: UserRound, history: BarChart3, credits: BookOpen };

interface MainMenuLayoutProps {
  identity: ManagerIdentity;
  page: MainMenuPageId;
  connectionState: SocketState;
  canContinue: boolean;
  continueReason: string;
  pending: boolean;
  sessionSelected: boolean;
  onNavigate: (page: MainMenuPageId) => void;
  onExit: () => void;
  children: ReactNode;
}

export function MainMenuLayout(props: MainMenuLayoutProps) {
  const capabilities = getMenuCapabilities(props.identity.mode);
  const connected = props.connectionState === 'connected';
  const connectionLabel = props.identity.mode === 'demo' ? 'Modo demonstração'
    : connected ? props.identity.mode === 'local' ? 'Local' : props.identity.mode === 'peer' ? 'Anfitrião conectado' : 'Conectado'
      : props.connectionState === 'connecting' ? 'Conectando…' : props.identity.mode === 'peer' ? 'Anfitrião desconectado' : 'Conexão indisponível';

  return (
    <div className="main-menu">
      <a className="main-menu__skip" href="#main-menu-content">Pular para o conteúdo</a>
      <aside className="main-menu__rail">
        <div className="main-menu__brand"><BrandLogo variant="menu" /></div>
        <nav className="main-menu__navigation" aria-label="Menu principal">
          {mainMenuPages.map((item) => {
            const Icon = pageIcons[item.id];
            const reason = props.sessionSelected ? 'Volte ao menu para navegar.'
              : item.id === 'continue' && !props.canContinue ? props.continueReason
                : item.id === 'new-game' && !capabilities.canCreate ? 'Somente o anfitrião cria carreiras.' : null;
            const disabled = Boolean(reason) || (item.id === 'continue' && props.pending);
            return (
              <div key={item.id} className={`main-menu__nav-item main-menu__nav-item--${item.group}`}>
                <button type="button" aria-current={!props.sessionSelected && props.page === item.id ? 'page' : undefined} disabled={disabled} title={reason ?? undefined} onClick={() => props.onNavigate(item.id)} aria-describedby={item.id === 'continue' && reason ? 'main-menu-continue-reason' : undefined}>
                  <Icon size={17} aria-hidden="true" /><span>{item.label}</span>{props.page === item.id && !props.sessionSelected && <ChevronRight size={13} aria-hidden="true" />}
                </button>
                {item.id === 'continue' && reason && !props.sessionSelected && <small id="main-menu-continue-reason" className="main-menu__nav-note">{reason}</small>}
              </div>
            );
          })}
        </nav>
        <div className="main-menu__rail-footer">
          <button type="button" className="main-menu__identity" onClick={() => props.onNavigate('profile')} disabled={props.sessionSelected}>
            <span className="avatar">{props.identity.displayName.slice(0, 2).toLocaleUpperCase('pt-BR')}</span>
            <span><strong>{props.identity.displayName}</strong><small>{capabilities.modeLabel}</small></span>
          </button>
          <button type="button" className="main-menu__exit" onClick={props.onExit} disabled={props.pending}><LogOut size={16} aria-hidden="true" /> Sair</button>
        </div>
      </aside>
      <div className="main-menu__workspace">
        <header className="main-menu__topbar"><span><strong>{props.sessionSelected ? 'Temporada selecionada' : 'Menu principal'}</strong></span><span className={`main-menu__connection${connected ? ' is-connected' : ''}`}><Radio size={14} aria-hidden="true" />{connectionLabel}</span></header>
        <main id="main-menu-content" className="main-menu__content" tabIndex={-1}>{props.children}</main>
        <footer className="main-menu__footer"><span>{capabilities.storageLabel}</span></footer>
      </div>
    </div>
  );
}
