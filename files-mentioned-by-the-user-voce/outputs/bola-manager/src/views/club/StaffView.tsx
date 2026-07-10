import { Award, Brain, CalendarClock, Dumbbell, HeartHandshake, Search, Shield, Sparkles, UsersRound } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Badge } from '../../components/shared/Badge';
import { Button } from '../../components/shared/Button';
import { ProgressBar } from '../../components/shared/ProgressBar';

interface StaffViewProps { onToast: (message: string) => void; }
interface Staff { name: string; role: string; initials: string; icon: LucideIcon; rating: number; specialty: string; contract: string; color: string; }
const staff: Staff[] = [
  { name: 'Marcelo Vilela', role: 'Auxiliar técnico', initials: 'MV', icon: Brain, rating: 8.7, specialty: 'Leitura de jogo', contract: 'Dez/2027', color: '#c8ff3d' },
  { name: 'Renata Campos', role: 'Preparadora física', initials: 'RC', icon: Dumbbell, rating: 9.1, specialty: 'Prevenção de lesões', contract: 'Dez/2028', color: '#66a3ff' },
  { name: 'Cláudio Reis', role: 'Psicólogo', initials: 'CR', icon: HeartHandshake, rating: 8.4, specialty: 'Gestão de crise', contract: 'Jun/2027', color: '#e6b85c' },
  { name: 'Olavo Martins', role: 'Chefe de scout', initials: 'OM', icon: Search, rating: 8.9, specialty: 'Mercado sul-americano', contract: 'Dez/2027', color: '#d777ed' },
];

export function StaffView({ onToast }: StaffViewProps) {
  return <main className="secondary-view view-enter"><div className="view-heading"><div><p className="eyebrow">BASTIDORES · 8 PROFISSIONAIS</p><h1>Comissão técnica</h1><p>A equipe multidisciplinar por trás do desempenho do Aurora.</p></div><Button variant="primary" icon={<UsersRound size={15} />} onClick={() => onToast('Busca de profissionais aberta.')}>Contratar profissional</Button></div><section className="staff-summary"><div><Shield size={18} /><div><small>QUALIDADE DA COMISSÃO</small><strong>8,8 <em>/ 10</em></strong></div><Badge tone="positive">3ª melhor da liga</Badge><div className="staff-cost"><small>CUSTO MENSAL</small><strong>R$ 1,84 mi</strong></div></div></section><div className="staff-grid">{staff.map((member) => <article key={member.name} style={{ '--staff-color': member.color } as React.CSSProperties}><header><span className="staff-avatar">{member.initials}</span><span><small>{member.role.toUpperCase()}</small><h2>{member.name}</h2></span><Badge tone="neutral">{member.rating}</Badge></header><div className="staff-specialty"><member.icon size={16} /><span><small>ESPECIALIDADE</small><strong>{member.specialty}</strong></span></div><dl><div><dt>Conhecimento</dt><dd>{Math.round(member.rating * 10)}%</dd></div><div><dt>Motivação</dt><dd>{Math.round(member.rating * 9.5)}%</dd></div></dl><ProgressBar value={member.rating * 10} /><footer><span><CalendarClock size={13} /> Contrato: {member.contract}</span><button onClick={() => onToast(`Reunião marcada com ${member.name}.`)}>Gerenciar</button></footer></article>)}</div><section className="staff-report"><div><Sparkles size={19} /><span><p className="eyebrow">RELATÓRIO SEMANAL</p><h2>“O grupo respondeu bem à redução de carga.”</h2><p>Renata recomenda manter a sessão de recuperação amanhã e treinar bola parada na sexta.</p></span></div><div><Award size={18} /><span><small>DESTAQUE DA SEMANA</small><strong>Renata Campos</strong><p>-18% risco de lesão</p></span></div><Button variant="secondary">Ler relatório completo</Button></section></main>;
}
