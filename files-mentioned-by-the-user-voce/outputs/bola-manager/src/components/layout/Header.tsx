import { Bell, CalendarClock, ChevronDown, Menu, Search, Sun } from 'lucide-react';
import { routeLabels } from '../../constants/navItems';
import type { ClubChoice, ManagerIdentity, RouteKey } from '../../types';
import { Badge } from '../shared/Badge';

interface HeaderProps {
  route: RouteKey;
  club: ClubChoice;
  manager: ManagerIdentity;
  onMenu: () => void;
  onNavigate: (route: RouteKey) => void;
  lightMode: boolean;
  onToggleTheme: () => void;
}

export function Header({ route, club, manager, onMenu, onNavigate, lightMode, onToggleTheme }: HeaderProps) {
  return (
    <header className="topbar">
      <div className="topbar__title">
        <button className="icon-button topbar__menu" onClick={onMenu} aria-label="Abrir menu"><Menu size={19} /></button>
        <div><p>{club.name.toUpperCase()} / TEMPORADA 2026</p><h1>{routeLabels[route]}</h1></div>
      </div>
      <button className="next-deadline" onClick={() => onNavigate('match')}>
        <CalendarClock size={16} />
        <span><small>PRÓXIMO COMPROMISSO</small><strong>{club.name} × Santos · hoje, 21:30</strong></span>
        <Badge tone="warning">em 48 min</Badge>
      </button>
      <div className="topbar__actions">
        <button className="icon-button search-button" aria-label="Buscar"><Search size={17} /></button>
        <button className="icon-button" onClick={onToggleTheme} aria-label={lightMode ? 'Ativar tema escuro' : 'Ativar tema claro'}><Sun size={17} /></button>
        <button className="icon-button notification-button" aria-label="Notificações"><Bell size={17} /><span>3</span></button>
        <button className="manager-menu">
          <span className="avatar">{manager.displayName.slice(0, 2).toUpperCase()}</span>
          <span><strong>{manager.displayName}</strong><small>Manager · Nível 12</small></span>
          <ChevronDown size={14} />
        </button>
      </div>
    </header>
  );
}
