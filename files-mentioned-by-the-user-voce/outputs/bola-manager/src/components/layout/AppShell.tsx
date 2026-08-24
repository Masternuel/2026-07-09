import { useState, type CSSProperties, type ReactNode } from 'react';
import type { ClubChoice, ManagerIdentity, Room, RoomFixture, RouteKey } from '../../types';
import { ClubBackdrop } from '../shared/ClubBackdrop';
import { BottomBar } from './BottomBar';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { useUserPreferences } from '../../preferences/UserPreferencesContext';
import { foregroundForAccent, hoverForAccent, resolveClubThemeColors } from '../../utils/clubThemeColors';

interface AppShellProps {
  route: RouteKey;
  club: ClubChoice;
  manager: ManagerIdentity;
  room: Room | null;
  nextFixture: RoomFixture | null;
  hasClub?: boolean;
  commitmentLabel?: string;
  onNavigate: (route: RouteKey) => void;
  onExit: () => void;
  children: ReactNode;
}

export function appShellThemeStyle(club: ClubChoice, lightMode: boolean): CSSProperties {
  const themeColors = resolveClubThemeColors(club);
  const accent = lightMode ? themeColors.lightThemeColor : themeColors.darkThemeColor;
  const onAccent = foregroundForAccent(accent);
  const lineOpacity = lightMode ? 30 : 34;
  const softLineOpacity = lightMode ? 17 : 20;
  const strongLineOpacity = lightMode ? 44 : 48;
  return {
    '--accent': accent,
    '--on-accent': onAccent,
    '--accent-hover': hoverForAccent(accent, onAccent),
    '--accent-deep': `color-mix(in srgb, ${accent} 58%, #000)`,
    '--accent-dim': `color-mix(in srgb, ${accent} 12%, transparent)`,
    '--team-line': `color-mix(in srgb, ${accent} ${lineOpacity}%, transparent)`,
    '--team-line-soft': `color-mix(in srgb, ${accent} ${softLineOpacity}%, transparent)`,
    '--team-line-strong': `color-mix(in srgb, ${accent} ${strongLineOpacity}%, transparent)`,
    '--team-surface': `color-mix(in srgb, ${accent} 6%, transparent)`,
    '--team-surface-strong': `color-mix(in srgb, ${accent} 10%, transparent)`,
    '--line': 'var(--team-line)',
    '--line-soft': 'var(--team-line-soft)',
  } as CSSProperties;
}

export function AppShell({ route, club, manager, room, nextFixture, hasClub = true, commitmentLabel, onNavigate, onExit, children }: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { preferences, resolvedTheme, status: preferencesStatus, updatePreferences } = useUserPreferences();
  const lightMode = resolvedTheme === 'light';

  function toggleTheme() {
    void updatePreferences({ theme: lightMode ? 'dark' : 'light' });
  }

  return (
    <div
      className={lightMode ? 'app-shell theme-light' : 'app-shell'}
      style={appShellThemeStyle(club, lightMode)}
    >
      <Sidebar activeRoute={route} club={club} room={room} hasClub={hasClub} matchAvailable={Boolean(nextFixture || commitmentLabel)} onNavigate={onNavigate} open={sidebarOpen} onClose={() => setSidebarOpen(false)} onExit={onExit} />
      <div className="app-main">
        <Header route={route} club={club} manager={manager} nextFixture={nextFixture} seasonYear={room?.seasonYear} hasClub={hasClub} commitmentLabel={commitmentLabel} onMenu={() => setSidebarOpen(true)} onNavigate={onNavigate} lightMode={lightMode} themePreference={preferences.theme} themeBusy={preferencesStatus === 'loading' || preferencesStatus === 'saving'} onToggleTheme={toggleTheme} />
        <div className="view-wrap">
          {hasClub && <ClubBackdrop club={club} />}
          <div className="view-content" key={route}>{children}</div>
        </div>
      </div>
      <BottomBar active={route} onNavigate={onNavigate} onMore={() => setSidebarOpen(true)} />
    </div>
  );
}
