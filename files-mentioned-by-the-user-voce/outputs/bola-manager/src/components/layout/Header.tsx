import { Bell, CalendarClock, ChevronDown, Menu, Moon, Sun } from 'lucide-react';
import { routeLabels } from '../../constants/navItems';
import type { ThemePreference } from '../../preferences/userPreferences';
import type { ClubChoice, ManagerIdentity, RoomFixture, RouteKey } from '../../types';
import { Badge } from '../shared/Badge';

interface HeaderProps {
  route: RouteKey;
  club: ClubChoice;
  manager: ManagerIdentity;
  nextFixture: RoomFixture | null;
  seasonYear?: number | null;
  hasClub?: boolean;
  commitmentLabel?: string;
  onMenu: () => void;
  onNavigate: (route: RouteKey) => void;
  lightMode: boolean;
  themePreference?: ThemePreference;
  themeBusy?: boolean;
  onToggleTheme: () => void;
}

function safeText(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function fixtureDateLabel(fixture: RoomFixture | null) {
  const date = new Date(fixture?.scheduledAt ?? '');
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    timeZone: 'UTC',
  }).format(date);
}

export function Header({ route, club, manager, nextFixture, seasonYear, hasClub = true, commitmentLabel, onMenu, onNavigate, lightMode, themePreference = lightMode ? 'light' : 'dark', themeBusy = false, onToggleTheme }: HeaderProps) {
  const safeCommitmentLabel = safeText(commitmentLabel, '');
  const clubName = hasClub ? safeText(club?.name, 'Clube') : 'Carreira do treinador';
  const managerName = safeText(manager?.displayName, 'Manager');
  const accountLabel = manager.mode === 'firebase' ? 'Conta conectada'
    : manager.mode === 'local' ? 'Perfil local'
      : manager.mode === 'peer' ? 'Convidado P2P' : 'Demonstração';
  const accountDetail = manager.mode === 'firebase' ? 'Conta Firebase'
    : manager.mode === 'local' ? 'Perfil local · seu computador'
      : manager.mode === 'peer' ? 'Convidado P2P · save no anfitrião' : 'Modo demonstração';
  const fixtureRound = Number.isFinite(Number(nextFixture?.round)) && Number(nextFixture?.round) > 0
    ? Math.trunc(Number(nextFixture?.round))
    : null;
  const nextFixtureLabel = safeCommitmentLabel || (nextFixture
    ? `${safeText(nextFixture.homeTeam, 'Mandante')} × ${safeText(nextFixture.awayTeam, 'Visitante')}${fixtureRound ? ` · Rodada ${fixtureRound}` : ''}`
    : 'Próximo compromisso ainda não definido');
  const hasCommitmentAction = hasClub && Boolean(safeCommitmentLabel || nextFixture);
  const scheduledLabel = fixtureDateLabel(nextFixture);
  const fixtureYear = nextFixture?.scheduledAt
    ? new Date(nextFixture.scheduledAt).getFullYear()
    : null;
  const seasonLabel = Number.isFinite(Number(seasonYear)) && Number(seasonYear) > 0
    ? String(Math.trunc(Number(seasonYear)))
    : Number.isFinite(fixtureYear) && Number(fixtureYear) > 0
      ? String(fixtureYear)
      : null;

  return (
    <header className="topbar">
      <div className="topbar__title">
        <button className="icon-button topbar__menu" onClick={onMenu} aria-label="Abrir menu"><Menu size={19} /></button>
        <div><p>{clubName.toLocaleUpperCase('pt-BR')} / {seasonLabel ? `TEMPORADA ${seasonLabel}` : 'TEMPORADA NÃO INICIADA'}</p><h1>{safeText(routeLabels[route], 'Central')}</h1></div>
      </div>
      <button className="next-deadline" onClick={() => onNavigate('match')} disabled={!hasCommitmentAction}>
        <CalendarClock size={16} />
        <span><small>{hasClub ? 'PRÓXIMO COMPROMISSO' : 'SITUAÇÃO PROFISSIONAL'}</small><strong>{hasClub ? nextFixtureLabel : 'Buscando uma nova oportunidade'}</strong></span>
        <Badge tone={hasCommitmentAction ? 'warning' : 'info'}>{safeCommitmentLabel ? 'continuar' : scheduledLabel ?? (nextFixture ? 'data pendente' : 'aguardando')}</Badge>
      </button>
      <div className="topbar__actions">
        <button className="icon-button" onClick={onToggleTheme} disabled={themeBusy} aria-label={lightMode ? 'Ativar tema escuro' : 'Ativar tema claro'} title={`Tema atual: ${themePreference === 'system' ? `sistema (${lightMode ? 'claro' : 'escuro'})` : lightMode ? 'claro' : 'escuro'}`}>{lightMode ? <Moon size={17} /> : <Sun size={17} />}</button>
        <button className="icon-button notification-button" aria-label="Abrir configurações de notificações" onClick={() => onNavigate('settings')}><Bell size={17} /></button>
        <button className="manager-menu" onClick={() => onNavigate('settings')} aria-label={`Abrir configurações da conta · ${accountDetail}`} title={accountDetail}>
          <span className="avatar">{managerName.slice(0, 2).toLocaleUpperCase('pt-BR')}</span>
          <span><strong>{managerName}</strong><small>{accountLabel}</small></span>
          <ChevronDown size={14} />
        </button>
      </div>
    </header>
  );
}
