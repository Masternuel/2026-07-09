import { ClipboardList, Home, MoreHorizontal, Swords, Users } from 'lucide-react';
import type { RouteKey } from '../../types';
import { cx } from '../../utils/formatters';

interface BottomBarProps {
  active: RouteKey;
  onNavigate: (route: RouteKey) => void;
  onMore: () => void;
}

const items: Array<{ key: RouteKey; label: string; icon: typeof Home }> = [
  { key: 'home', label: 'Central', icon: Home },
  { key: 'squad', label: 'Elenco', icon: Users },
  { key: 'tactics', label: 'Táticas', icon: ClipboardList },
  { key: 'match', label: 'Partida', icon: Swords },
];

export function BottomBar({ active, onNavigate, onMore }: BottomBarProps) {
  return (
    <nav className="bottom-bar" aria-label="Navegação móvel">
      {items.map((item) => (
        <button key={item.key} className={cx(active === item.key && 'active')} onClick={() => onNavigate(item.key)}>
          <item.icon size={18} />
          <span>{item.label}</span>
          {item.key === 'match' && <i />}
        </button>
      ))}
      <button onClick={onMore}><MoreHorizontal size={18} /><span>Mais</span></button>
    </nav>
  );
}
