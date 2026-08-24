import { CheckCircle2, Goal, LogOut } from 'lucide-react';
import { navItems } from '../../constants/navItems';
import type { ClubChoice, Room, RouteKey } from '../../types';
import { cx } from '../../utils/formatters';
import { findRoomLeagueForClub } from '../../utils/leagueStandings';
import { getSeasonProgress } from '../../utils/seasonProgress';
import { ClubMark } from '../shared/ClubMark';

interface SidebarProps {
  activeRoute: RouteKey;
  club: ClubChoice;
  room: Room | null;
  hasClub?: boolean;
  matchAvailable?: boolean;
  onNavigate: (route: RouteKey) => void;
  open: boolean;
  onClose: () => void;
  onExit: () => void;
}

function safeText(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

const clubRequiredRoutes = new Set<RouteKey>([
  'home', 'squad', 'tactics', 'calendar', 'competitions', 'match',
  'market', 'finance', 'stadium', 'staff', 'reports', 'press-conference',
]);

export function Sidebar({ activeRoute, club, room, hasClub = true, matchAvailable = false, onNavigate, open, onClose, onExit }: SidebarProps) {
  const season = getSeasonProgress(room);
  const roundLabel = season.hasSchedule
    ? `Rodada ${season.currentRound} de ${season.totalRounds}`
    : 'Calendário ainda não definido';
  const groups = ['Gestão', 'Clube', 'Análise'] as const;
  const roomLeague = findRoomLeagueForClub(room, club);
  const clubName = hasClub ? safeText(club?.name, 'Clube') : 'Sem clube';
  const clubCode = safeText(club?.code, 'CLB');
  const leagueName = safeText(roomLeague?.name) || safeText(club?.leagueName);
  const divisionName = safeText(roomLeague?.division) || safeText(club?.division);
  const leagueLabel = leagueName && divisionName && leagueName.toLocaleLowerCase('pt-BR') !== divisionName.toLocaleLowerCase('pt-BR')
    ? `${leagueName} · ${divisionName}`
    : leagueName || divisionName || 'Liga não informada';
  const seasonStatusLabel = room?.careerCompleted
    ? 'Carreira concluída'
    : room?.status === 'active'
      ? 'Temporada em andamento'
      : 'Aguardando início';

  return (
    <>
      <button className={cx('sidebar-backdrop', open && 'is-open')} onClick={onClose} aria-label="Fechar menu" />
      <aside className={cx('sidebar', open && 'is-open')}>
        <div className="sidebar__wordmark"><span className="wordmark-glyph"><Goal size={16} /></span><strong>BOLA<span>MANAGER</span></strong></div>
        <div className="club-switcher" aria-label={`Clube atual: ${clubName}`}>
          <ClubMark code={clubCode} color={safeText(club?.color, '#6b7280')} darkThemeColor={safeText(club?.darkThemeColor) || null} lightThemeColor={safeText(club?.lightThemeColor) || null} imageUrl={safeText(club?.crestImageUrl) || null} size="sm" />
          <span><strong>{clubName}</strong><small>{hasClub ? leagueLabel : 'Disponível no mercado'}</small></span>
        </div>
        <nav className="sidebar__nav" aria-label="Navegação principal">
          {groups.map((group) => (
            <div className="nav-group" key={group}>
              <p>{group}</p>
              {navItems.filter((item) => item.group === group).map((item) => (
                <button
                  key={item.key}
                  className={cx(activeRoute === item.key && 'active', item.key === 'match' && 'match-nav')}
                  onClick={() => { onNavigate(item.key); onClose(); }}
                  disabled={!hasClub && clubRequiredRoutes.has(item.key)}
                  title={!hasClub && clubRequiredRoutes.has(item.key) ? 'Assuma um clube para abrir esta área.' : undefined}
                >
                  <item.icon size={16} strokeWidth={1.8} />
                  <span>{item.label}</span>
                  {item.key === 'match' && matchAvailable && <span className="nav-live-dot" aria-label="Partida disponível" />}
                </button>
              ))}
            </div>
          ))}
        </nav>
        {hasClub && room && <div className="sidebar__season">
          <div className="season-progress-head"><span>{season.seasonYear ? `Temporada ${season.seasonYear}` : 'Temporada não iniciada'}</span><strong>{season.percent}%</strong></div>
          <div className="progress"><span style={{ width: `${season.percent}%` }} /></div>
          <div className="season-status"><CheckCircle2 size={14} /><span><strong>{roundLabel}</strong><small>{seasonStatusLabel}</small></span></div>
        </div>}
        <button className="sidebar__exit" onClick={onExit}><LogOut size={15} /> Sair da temporada</button>
      </aside>
    </>
  );
}
