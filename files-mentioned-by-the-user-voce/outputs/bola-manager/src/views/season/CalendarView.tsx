import { useState } from 'react';
import { CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, Dumbbell, Plane, Swords, Trophy } from 'lucide-react';
import { Badge } from '../../components/shared/Badge';
import { Button } from '../../components/shared/Button';
import { ClubMark } from '../../components/shared/ClubMark';
import { upcomingFixtures } from '../../data/demoData';

const monthDays = Array.from({ length: 35 }, (_, index) => {
  const day = index - 1;
  return day > 0 && day <= 31 ? day : null;
});

export function CalendarView() {
  const [view, setView] = useState<'agenda' | 'month'>('agenda');
  return (
    <main className="secondary-view view-enter">
      <div className="view-heading"><div><p className="eyebrow">TEMPORADA 2026</p><h1>Calendário</h1><p>Partidas, treinos, viagens e compromissos da equipe.</p></div><div className="view-heading__actions"><div className="compact-tabs"><button aria-selected={view === 'agenda'} onClick={() => setView('agenda')}>Agenda</button><button aria-selected={view === 'month'} onClick={() => setView('month')}>Mês</button></div><Button variant="secondary" icon={<CalendarDays size={15} />}>Sincronizar</Button></div></div>
      <section className="calendar-shell">
        <header className="month-nav"><button className="icon-button"><ChevronLeft size={16} /></button><div><p className="eyebrow">MÊS ATUAL</p><h2>Julho de 2026</h2></div><button className="icon-button"><ChevronRight size={16} /></button><span>Hoje · 16 jul</span></header>
        {view === 'agenda' ? (
          <div className="agenda-layout">
            <div className="agenda-list">
              <div className="agenda-date"><span>HOJE</span><strong>16</strong><small>QUA</small></div>
              <article className="agenda-featured"><div className="agenda-line"><i /><span>21:30</span></div><div><Badge tone="warning" dot>Próximo jogo</Badge><h3>Aurora FC <span>×</span> Santos</h3><p>Brasileirão · Rodada 14 · Estádio Boreal</p><div className="agenda-clubs"><ClubMark code="AUR" size="sm" /><span>Preparação concluída</span><ClubMark code="SAN" color="#ddd" size="sm" /></div></div><Button variant="primary" icon={<Swords size={15} />}>Central da partida</Button></article>
              <div className="agenda-date"><span>AMANHÃ</span><strong>17</strong><small>QUI</small></div>
              <article className="agenda-item"><span className="agenda-icon"><Dumbbell size={17} /></span><div><strong>Recuperação pós-jogo</strong><p>CT da Alvorada · Grupo principal</p></div><time>10:00</time></article>
              {upcomingFixtures.slice(1).map((fixture, index) => <article className="agenda-item fixture" key={fixture.date}><span className="agenda-icon"><Trophy size={17} /></span><div><strong>{fixture.home} × {fixture.away}</strong><p>{fixture.competition} · {fixture.venue}</p></div><time>{fixture.date}<small>{fixture.time}</small></time>{index === 0 && <Badge tone="info"><Plane size={12} /> Viagem</Badge>}</article>)}
            </div>
            <aside className="calendar-summary"><div><p className="eyebrow">CARGA DOS PRÓXIMOS 14 DIAS</p><h3>4 jogos em 13 dias</h3><span className="load-meter"><i style={{ width: '72%' }} /></span><p>Atenção à recuperação entre Fluminense e Fortaleza.</p></div><dl><div><dt><Swords size={14} /> Jogos</dt><dd>4</dd></div><div><dt><Dumbbell size={14} /> Treinos</dt><dd>8</dd></div><div><dt><Plane size={14} /> Viagens</dt><dd>1.144 km</dd></div><div><dt><Clock3 size={14} /> Descanso</dt><dd>3 dias</dd></div></dl><div className="calendar-alert"><Check size={15} /><span><strong>Sem conflitos</strong><small>Datas FIFA e Copa do Brasil conciliadas.</small></span></div></aside>
          </div>
        ) : (
          <div className="month-grid"><div className="weekday-row">{['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB', 'DOM'].map((day) => <span key={day}>{day}</span>)}</div><div className="month-days">{monthDays.map((day, index) => <button key={index} className={day === 16 ? 'today' : ''} disabled={!day}><span>{day}</span>{[5, 12, 16, 20, 24, 28].includes(day ?? 0) && <i className={day === 16 ? 'match' : day === 24 ? 'cup' : ''} />}{[3, 4, 9, 10, 17, 22, 26].includes(day ?? 0) && <small>Treino</small>}</button>)}</div></div>
        )}
      </section>
    </main>
  );
}
