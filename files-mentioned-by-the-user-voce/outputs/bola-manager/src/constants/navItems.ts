import {
  BarChart3,
  CalendarDays,
  CircleDollarSign,
  ClipboardList,
  Landmark,
  LayoutDashboard,
  Newspaper,
  Settings,
  Shield,
  ShoppingBag,
  Swords,
  Trophy,
  Users,
  UsersRound,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { RouteKey } from '../types';

export interface NavItem {
  key: RouteKey;
  label: string;
  icon: LucideIcon;
  group: 'Gestão' | 'Clube' | 'Análise';
}

export const navItems: NavItem[] = [
  { key: 'home', label: 'Central', icon: LayoutDashboard, group: 'Gestão' },
  { key: 'squad', label: 'Elenco', icon: Users, group: 'Gestão' },
  { key: 'tactics', label: 'Táticas', icon: ClipboardList, group: 'Gestão' },
  { key: 'calendar', label: 'Calendário', icon: CalendarDays, group: 'Gestão' },
  { key: 'competitions', label: 'Competições', icon: Trophy, group: 'Gestão' },
  { key: 'match', label: 'Central da partida', icon: Swords, group: 'Gestão' },
  { key: 'market', label: 'Mercado', icon: ShoppingBag, group: 'Clube' },
  { key: 'finance', label: 'Finanças', icon: CircleDollarSign, group: 'Clube' },
  { key: 'stadium', label: 'Infraestrutura', icon: Landmark, group: 'Clube' },
  { key: 'staff', label: 'Comissão técnica', icon: UsersRound, group: 'Clube' },
  { key: 'news', label: 'Notícias', icon: Newspaper, group: 'Análise' },
  { key: 'rankings', label: 'Rankings', icon: Shield, group: 'Análise' },
  { key: 'reports', label: 'Relatórios', icon: BarChart3, group: 'Análise' },
  { key: 'settings', label: 'Configurações', icon: Settings, group: 'Análise' },
];

export const routeLabels: Record<RouteKey, string> = {
  ...Object.fromEntries(navItems.map((item) => [item.key, item.label])),
  'press-conference': 'Coletiva pós-jogo',
} as Record<RouteKey, string>;
