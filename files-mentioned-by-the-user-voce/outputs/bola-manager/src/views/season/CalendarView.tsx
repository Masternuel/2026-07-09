import { useMemo, useState } from 'react';
import { CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, Dumbbell, Plane, Swords, Trophy } from 'lucide-react';
import { Badge } from '../../components/shared/Badge';
import { Button } from '../../components/shared/Button';
import { ClubMark } from '../../components/shared/ClubMark';
import { upcomingFixtures } from '../../data/demoData';
import type { Room, RoomFixture, RouteKey } from '../../types';

interface CalendarViewProps {
  room: Room | null;
  onNavigate?: (route: RouteKey) => void;
}

interface DisplayFixture {
  key: string;
  home: string;
  away: string;
  homeCode: string;
  awayCode: string;
  competition: string;
  detail: string;
  date: string;
  time: string;
}

const monthDays = Array.from({ length: 35 }, (_, index) => {
  const day = index - 1;
  return day > 0 && day <= 31 ? day : null;
});

function normalizeFixtureId(fixtureId: string | null | undefined) {
  return String(fixtureId ?? '').trim().toLocaleLowerCase('pt-BR');
}

function roomFixtureToDisplay(fixture: RoomFixture): DisplayFixture {
  const compactCode = (teamName: string) => teamName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 3)
    .toUpperCase();
  return {
    key: fixture.fixtureId,
    home: fixture.homeTeam,
    away: fixture.awayTeam,
    homeCode: compactCode(fixture.homeTeam),
    awayCode: compactCode(fixture.awayTeam),
    competition: fixture.competition,
    detail: `${fixture.competition} · Rodada ${fixture.round} · Mandante: ${fixture.homeTeam}`,
    date: `R${fixture.round}`,
    time: 'A definir',
  };
}

function demoFixtureToDisplay(fixture: (typeof upcomingFixtures)[number]): DisplayFixture {
  return {
    key: `${fixture.date}-${fixture.home}-${fixture.away}`,
    home: fixture.home,
    away: fixture.away,
    homeCode: fixture.home.slice(0, 3).toUpperCase(),
    awayCode: fixture.away.slice(0, 3).toUpperCase(),
    competition: fixture.competition,
    detail: `${fixture.competition} · ${fixture.venue}`,
    date: fixture.date,
    time: fixture.time,
  };
}

export function CalendarView({ room, onNavigate }: CalendarViewProps) {
  const [view, setView] = useState<'agenda' | 'month'>('agenda');
  const schedule = useMemo(() => {
    const fixtures = room?.fixtureSchedule ?? [];
    const completed = new Set((room?.completedFixtureIds ?? []).map(normalizeFixtureId));
    const pendingFixtures = fixtures.filter((fixture) => !completed.has(normalizeFixtureId(fixture.fixtureId)));
    const current = pendingFixtures.find((fixture) => normalizeFixtureId(fixture.fixtureId) === normalizeFixtureId(room?.currentFixtureId))
      ?? pendingFixtures[0]
      ?? null;
    const upcoming = pendingFixtures.filter((fixture) => normalizeFixtureId(fixture.fixtureId) !== normalizeFixtureId(current?.fixtureId));
    return { hasRealSchedule: fixtures.length > 0, current, upcoming };
  }, [room]);

  const featuredFixture = schedule.current
    ? roomFixtureToDisplay(schedule.current)
    : room || schedule.hasRealSchedule ? null : demoFixtureToDisplay(upcomingFixtures[0]);
  const followingFixtures = schedule.hasRealSchedule
    ? schedule.upcoming.slice(0, 3).map(roomFixtureToDisplay)
    : room ? [] : upcomingFixtures.slice(1).map(demoFixtureToDisplay);
  const gameCount = schedule.hasRealSchedule
    ? (schedule.current ? 1 : 0) + schedule.upcoming.length
    : (featuredFixture ? 1 : 0) + followingFixtures.length;

  return (
    <main className="secondary-view view-enter">
      <div className="view-heading">
        <div><p className="eyebrow">TEMPORADA 2026</p><h1>Calendário</h1><p>Partidas, treinos, viagens e compromissos da equipe.</p></div>
        <div className="view-heading__actions">
          <div className="compact-tabs">
            <button aria-selected={view === 'agenda'} onClick={() => setView('agenda')}>Agenda</button>
            <button aria-selected={view === 'month'} onClick={() => setView('month')}>Mês</button>
          </div>
          <Button variant="secondary" icon={<CalendarDays size={15} />}>Sincronizar</Button>
        </div>
      </div>

      <section className="calendar-shell">
        <header className="month-nav">
          <button className="icon-button"><ChevronLeft size={16} /></button>
          <div><p className="eyebrow">MÊS ATUAL</p><h2>Julho de 2026</h2></div>
          <button className="icon-button"><ChevronRight size={16} /></button>
          <span>Hoje · 16 jul</span>
        </header>

        {view === 'agenda' ? (
          <div className="agenda-layout">
            <div className="agenda-list">
              <div className="agenda-date"><span>ATUAL</span><strong>{featuredFixture?.date.replace(/\D/g, '') || '—'}</strong><small>ROD</small></div>
              {featuredFixture ? (
                <article className="agenda-featured">
                  <div className="agenda-line"><i /><span>{featuredFixture.time}</span></div>
                  <div>
                    <Badge tone="warning" dot>Próximo jogo</Badge>
                    <h3>{featuredFixture.home} <span>×</span> {featuredFixture.away}</h3>
                    <p>{featuredFixture.detail}</p>
                    <div className="agenda-clubs">
                      <ClubMark code={featuredFixture.homeCode} size="sm" />
                      <span>Preparação em andamento</span>
                      <ClubMark code={featuredFixture.awayCode} color="#ddd" size="sm" />
                    </div>
                  </div>
                  <Button
                    variant="primary"
                    icon={<Swords size={15} />}
                    onClick={() => onNavigate?.('match')}
                    disabled={!onNavigate}
                  >
                    Central da partida
                  </Button>
                </article>
              ) : (
                <article className="agenda-item">
                  <span className="agenda-icon"><Check size={17} /></span>
                  <div>
                    <strong>{room && !schedule.hasRealSchedule ? 'Calendário sendo atualizado' : 'Temporada concluída'}</strong>
                    <p>{room && !schedule.hasRealSchedule ? 'Confirme a próxima partida para migrar este save antigo.' : 'Não existem partidas pendentes nesta sala.'}</p>
                  </div>
                </article>
              )}

              <div className="agenda-date"><span>DEPOIS</span><strong>+</strong><small>AGENDA</small></div>
              <article className="agenda-item"><span className="agenda-icon"><Dumbbell size={17} /></span><div><strong>Recuperação pós-jogo</strong><p>CT do clube · Grupo principal</p></div><time>10:00</time></article>
              {followingFixtures.map((fixture, index) => (
                <article className="agenda-item fixture" key={fixture.key}>
                  <span className="agenda-icon"><Trophy size={17} /></span>
                  <div><strong>{fixture.home} × {fixture.away}</strong><p>{fixture.detail}</p></div>
                  <time>{fixture.date}<small>{fixture.time}</small></time>
                  {index === 0 && <Badge tone="info"><Plane size={12} /> Próxima</Badge>}
                </article>
              ))}
            </div>

            <aside className="calendar-summary">
              <div><p className="eyebrow">SEQUÊNCIA DE PARTIDAS</p><h3>{gameCount} {gameCount === 1 ? 'jogo pendente' : 'jogos pendentes'}</h3><span className="load-meter"><i style={{ width: `${Math.min(100, gameCount * 18)}%` }} /></span><p>Sequência definida pelo calendário oficial da sala.</p></div>
              <dl><div><dt><Swords size={14} /> Jogos</dt><dd>{gameCount}</dd></div><div><dt><Dumbbell size={14} /> Treinos</dt><dd>8</dd></div><div><dt><Plane size={14} /> Viagens</dt><dd>Variável</dd></div><div><dt><Clock3 size={14} /> Descanso</dt><dd>3 dias</dd></div></dl>
              <div className="calendar-alert"><Check size={15} /><span><strong>Calendário sincronizado</strong><small>Fixtures atualizadas com o save da sala.</small></span></div>
            </aside>
          </div>
        ) : (
          <div className="month-grid">
            <div className="weekday-row">{['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB', 'DOM'].map((day) => <span key={day}>{day}</span>)}</div>
            <div className="month-days">{monthDays.map((day, index) => <button key={index} className={day === 16 ? 'today' : ''} disabled={!day}><span>{day}</span>{[5, 12, 16, 20, 24, 28].includes(day ?? 0) && <i className={day === 16 ? 'match' : day === 24 ? 'cup' : ''} />}{[3, 4, 9, 10, 17, 22, 26].includes(day ?? 0) && <small>Treino</small>}</button>)}</div>
          </div>
        )}
      </section>
    </main>
  );
}
