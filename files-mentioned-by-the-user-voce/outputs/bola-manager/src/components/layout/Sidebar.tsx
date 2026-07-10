import { CheckCircle2, ChevronsUpDown, Goal, LogOut, Sparkles } from 'lucide-react';
import { navItems } from '../../constants/navItems';
import type { ClubChoice, RouteKey } from '../../types';
import { cx } from '../../utils/formatters';
import { ClubMark } from '../shared/ClubMark';

interface SidebarProps {
  activeRoute: RouteKey;
  club: ClubChoice;
  onNavigate: (route: RouteKey) => void;
  open: boolean;
  onClose: () => void;
  onExit: () => void;
}

export function Sidebar({ activeRoute, club, onNavigate, open, onClose, onExit }: SidebarProps) {
  const groups = ['Gestão', 'Clube', 'Análise'] as const;

  return (
    <>
      <button className={cx('sidebar-backdrop', open && 'is-open')} onClick={onClose} aria-label="Fechar menu" />
      <aside className={cx('sidebar', open && 'is-open')}>
        <div className="sidebar__wordmark"><span className="wordmark-glyph"><Goal size={16} /></span><strong>BOLA<span>MANAGER</span></strong></div>
        <button className="club-switcher">
          <ClubMark code={club.code} color={club.color} size="sm" />
          <span><strong>{club.name}</strong><small>Brasileirão Série A</small></span>
          <ChevronsUpDown size={14} />
        </button>
        <nav className="sidebar__nav" aria-label="Navegação principal">
          {groups.map((group) => (
            <div className="nav-group" key={group}>
              <p>{group}</p>
              {navItems.filter((item) => item.group === group).map((item) => (
                <button
                  key={item.key}
                  className={cx(activeRoute === item.key && 'active', item.key === 'match' && 'match-nav')}
                  onClick={() => { onNavigate(item.key); onClose(); }}
                >
                  <item.icon size={16} strokeWidth={1.8} />
                  <span>{item.label}</span>
                  {item.key === 'match' && <span className="nav-live-dot" aria-label="Partida disponível" />}
                  {item.key === 'news' && <small>4</small>}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar__season">
          <div className="season-progress-head"><span>Temporada 2026</span><strong>32%</strong></div>
          <div className="progress"><span style={{ width: '32%' }} /></div>
          <div className="season-status"><CheckCircle2 size={14} /><span><strong>Rodada 14 de 38</strong><small>Objetivo: Libertadores</small></span></div>
        </div>
        <button className="sidebar__upgrade"><Sparkles size={14} /><span><strong>Centro de formação</strong><small>Upgrade concluído</small></span></button>
        <button className="sidebar__exit" onClick={onExit}><LogOut size={15} /> Sair da temporada</button>
      </aside>
    </>
  );
}
