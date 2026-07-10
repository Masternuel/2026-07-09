import { useState, type CSSProperties, type ReactNode } from 'react';
import type { ClubChoice, ManagerIdentity, RouteKey } from '../../types';
import { BottomBar } from './BottomBar';
import { Header } from './Header';
import { Sidebar } from './Sidebar';

interface AppShellProps {
  route: RouteKey;
  club: ClubChoice;
  manager: ManagerIdentity;
  onNavigate: (route: RouteKey) => void;
  onExit: () => void;
  children: ReactNode;
}

export function AppShell({ route, club, manager, onNavigate, onExit, children }: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [lightMode, setLightMode] = useState(false);

  return (
    <div
      className={lightMode ? 'app-shell theme-light' : 'app-shell'}
      style={{
        '--accent': club.color,
        '--accent-deep': `color-mix(in srgb, ${club.color} 58%, #000)`,
        '--accent-dim': `color-mix(in srgb, ${club.color} 12%, transparent)`,
      } as CSSProperties}
    >
      <Sidebar activeRoute={route} club={club} onNavigate={onNavigate} open={sidebarOpen} onClose={() => setSidebarOpen(false)} onExit={onExit} />
      <div className="app-main">
        <Header route={route} club={club} manager={manager} onMenu={() => setSidebarOpen(true)} onNavigate={onNavigate} lightMode={lightMode} onToggleTheme={() => setLightMode((value) => !value)} />
        <div className="view-wrap" key={route}>{children}</div>
      </div>
      <BottomBar active={route} onNavigate={onNavigate} onMore={() => setSidebarOpen(true)} />
    </div>
  );
}
