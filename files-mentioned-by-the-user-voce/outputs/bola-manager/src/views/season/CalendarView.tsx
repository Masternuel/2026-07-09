import { useMemo, useState } from 'react';
import {
  BriefcaseBusiness,
  Building2,
  Check,
  ChevronLeft,
  ChevronRight,
  Swords,
  Trophy,
  UserRoundCheck,
} from 'lucide-react';
import { Badge } from '../../components/shared/Badge';
import { Button } from '../../components/shared/Button';
import { ClubMark } from '../../components/shared/ClubMark';
import type { Room, RoomFixture, RouteKey } from '../../types';
import {
  buildCalendarSchedule,
  type CalendarItem,
  type CalendarItemKind,
  validCalendarDate,
} from './calendarItems';

interface CalendarViewProps {
  room: Room | null;
  managerClubId: string | null;
  onNavigate?: (route: RouteKey) => void;
}

interface DisplayFixture {
  home: string;
  away: string;
  homeCode: string;
  awayCode: string;
  homeColor?: string;
  awayColor?: string;
  homeDarkThemeColor?: string | null;
  homeLightThemeColor?: string | null;
  awayDarkThemeColor?: string | null;
  awayLightThemeColor?: string | null;
  homeCrestImageUrl?: string | null;
  awayCrestImageUrl?: string | null;
  detail: string;
  date: string;
  datePrimary: string;
  dateSecondary: string;
  time: string;
  scheduledAt: string | null;
}

const utcDateOptions = { timeZone: 'UTC' } as const;
const dateFormatter = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', ...utcDateOptions });
const dayFormatter = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', ...utcDateOptions });
const shortMonthFormatter = new Intl.DateTimeFormat('pt-BR', { month: 'short', ...utcDateOptions });
const timeFormatter = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  ...utcDateOptions,
});
const monthFormatter = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', ...utcDateOptions });

function formattedDate(date: Date) {
  return dateFormatter.format(date).replace('.', '').toLocaleUpperCase('pt-BR');
}

function monthCells(date: Date) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const first = new Date(Date.UTC(year, month, 1));
  const leading = (first.getUTCDay() + 6) % 7;
  const total = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const count = Math.ceil((leading + total) / 7) * 7;
  return Array.from({ length: count }, (_, index) => {
    const day = index - leading + 1;
    return day > 0 && day <= total ? day : null;
  });
}

function roomFixtureToDisplay(fixture: RoomFixture): DisplayFixture {
  const compactCode = (teamName: string) => teamName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 3)
    .toUpperCase();
  const stadiumName = fixture.homeStadium?.trim() || 'Estádio a definir';
  const numericCapacity = Number(fixture.homeStadiumCapacity);
  const venue = Number.isFinite(numericCapacity) && numericCapacity > 0
    ? `${stadiumName} · ${new Intl.NumberFormat('pt-BR').format(Math.trunc(numericCapacity))}`
    : stadiumName;
  const kickoff = validCalendarDate(fixture.scheduledAt);
  return {
    home: fixture.homeTeam,
    away: fixture.awayTeam,
    homeCode: fixture.homeCode || compactCode(fixture.homeTeam),
    awayCode: fixture.awayCode || compactCode(fixture.awayTeam),
    homeColor: fixture.homeColor,
    awayColor: fixture.awayColor,
    homeDarkThemeColor: fixture.homeDarkThemeColor,
    homeLightThemeColor: fixture.homeLightThemeColor,
    awayDarkThemeColor: fixture.awayDarkThemeColor,
    awayLightThemeColor: fixture.awayLightThemeColor,
    homeCrestImageUrl: fixture.homeCrestImageUrl,
    awayCrestImageUrl: fixture.awayCrestImageUrl,
    detail: `${fixture.competition} · Rodada ${fixture.round} · ${venue}`,
    date: kickoff ? formattedDate(kickoff) : `Rodada ${fixture.round}`,
    datePrimary: kickoff ? dayFormatter.format(kickoff) : `R${fixture.round}`,
    dateSecondary: kickoff
      ? shortMonthFormatter.format(kickoff).replace('.', '').toLocaleUpperCase('pt-BR')
      : 'A DEFINIR',
    time: kickoff ? timeFormatter.format(kickoff) : 'A definir',
    scheduledAt: kickoff?.toISOString() ?? null,
  };
}

function commitmentLabel(kind: CalendarItemKind) {
  switch (kind) {
    case 'fixture': return 'Jogo';
    case 'facility-project': return 'Obra';
    case 'staff-contract': return 'Contrato';
    case 'lifecycle': return 'Carreira';
  }
}

function commitmentTiming(kind: CalendarItemKind) {
  switch (kind) {
    case 'fixture': return '';
    case 'facility-project': return 'Conclusão prevista';
    case 'staff-contract': return 'Vencimento';
    case 'lifecycle': return 'Data efetiva';
  }
}

function commitmentIcon(kind: CalendarItemKind) {
  switch (kind) {
    case 'fixture': return <Trophy size={17} />;
    case 'facility-project': return <Building2 size={17} />;
    case 'staff-contract': return <BriefcaseBusiness size={17} />;
    case 'lifecycle': return <UserRoundCheck size={17} />;
  }
}

function emptyCopy(room: Room | null, hasCommitments: boolean) {
  if (!room) {
    return { title: 'Carregando calendário', detail: 'Aguardando o estado atual da sala.' };
  }
  if (room.scheduleIssue?.message) {
    return { title: 'Calendário indisponível', detail: room.scheduleIssue.message };
  }
  if (room.status === 'waiting') {
    return { title: 'Temporada ainda não iniciada', detail: 'As partidas serão publicadas quando a sala começar.' };
  }
  if (hasCommitments) {
    return { title: 'Nenhuma partida pendente', detail: 'Os demais compromissos confirmados seguem na agenda.' };
  }
  return { title: 'Nenhum compromisso pendente', detail: 'Não há eventos confirmados no estado atual do save.' };
}

export function CalendarView({ room, managerClubId, onNavigate }: CalendarViewProps) {
  const [view, setView] = useState<'agenda' | 'month'>('agenda');
  const [monthOffset, setMonthOffset] = useState(0);
  const schedule = useMemo(() => buildCalendarSchedule(room, managerClubId), [managerClubId, room]);
  const featuredItem = schedule.currentFixture;
  const featuredFixture = featuredItem ? roomFixtureToDisplay(featuredItem.fixture) : null;
  const saveDate = validCalendarDate(room?.clubCareerState?.currentDate);
  const today = saveDate ?? validCalendarDate(room?.seasonStartedAt) ?? new Date();
  const firstDatedItem = schedule.items.find((item) => validCalendarDate(item.scheduledAt));
  const baseMonth = saveDate
    ?? validCalendarDate(firstDatedItem?.scheduledAt)
    ?? validCalendarDate(room?.seasonStartedAt)
    ?? new Date();
  const displayedMonth = new Date(Date.UTC(
    baseMonth.getUTCFullYear(),
    baseMonth.getUTCMonth() + monthOffset,
    1,
  ));
  const days = monthCells(displayedMonth);
  const itemsByDay = new Map<number, CalendarItem[]>();
  for (const item of schedule.items) {
    const date = validCalendarDate(item.scheduledAt);
    if (!date || date.getUTCFullYear() !== displayedMonth.getUTCFullYear() || date.getUTCMonth() !== displayedMonth.getUTCMonth()) {
      continue;
    }
    const day = date.getUTCDate();
    itemsByDay.set(day, [...(itemsByDay.get(day) ?? []), item]);
  }
  const emptyState = emptyCopy(room, schedule.items.length > 0);
  const counts = schedule.items.reduce<Record<CalendarItemKind, number>>((result, item) => {
    result[item.kind] += 1;
    return result;
  }, { fixture: 0, 'facility-project': 0, 'staff-contract': 0, lifecycle: 0 });
  const unscheduledGames = schedule.fixtures.filter((item) => !item.scheduledAt).length;

  return (
    <main className="secondary-view view-enter">
      <div className="view-heading">
        <div>
          <p className="eyebrow">TEMPORADA {room?.seasonYear ?? '—'}</p>
          <h1>Calendário</h1>
          <p>Partidas e compromissos confirmados do clube.</p>
        </div>
        <div className="view-heading__actions">
          <div className="compact-tabs">
            <button aria-selected={view === 'agenda'} onClick={() => setView('agenda')}>Agenda</button>
            <button aria-selected={view === 'month'} onClick={() => setView('month')}>Mês</button>
          </div>
        </div>
      </div>

      <section className="calendar-shell">
        <header className="month-nav">
          <button className="icon-button" aria-label="Mês anterior" onClick={() => setMonthOffset((offset) => offset - 1)}><ChevronLeft size={16} /></button>
          <div><p className="eyebrow">MÊS DA AGENDA</p><h2>{monthFormatter.format(displayedMonth)}</h2></div>
          <button className="icon-button" aria-label="Próximo mês" onClick={() => setMonthOffset((offset) => offset + 1)}><ChevronRight size={16} /></button>
          <span>Hoje · {formattedDate(today)}</span>
        </header>

        {view === 'agenda' ? (
          <div className="agenda-layout">
            <div className="agenda-list">
              <div className="agenda-date">
                <span>{featuredFixture ? 'PRÓXIMO' : 'AGENDA'}</span>
                <strong>{featuredFixture?.datePrimary ?? '—'}</strong>
                <small>{featuredFixture?.dateSecondary ?? 'SEM JOGO'}</small>
              </div>
              {featuredFixture ? (
                <article className="agenda-featured">
                  <div className="agenda-line"><i /><span>{featuredFixture.time}</span></div>
                  <div>
                    <Badge tone="warning" dot>Próximo jogo</Badge>
                    <h3>{featuredFixture.home} <span>×</span> {featuredFixture.away}</h3>
                    <p>{featuredFixture.detail}</p>
                    <div className="agenda-clubs">
                      <ClubMark code={featuredFixture.homeCode} color={featuredFixture.homeColor} darkThemeColor={featuredFixture.homeDarkThemeColor} lightThemeColor={featuredFixture.homeLightThemeColor} imageUrl={featuredFixture.homeCrestImageUrl} size="sm" />
                      <span>{featuredFixture.scheduledAt ? 'Partida agendada' : 'Data ainda não definida'}</span>
                      <ClubMark code={featuredFixture.awayCode} color={featuredFixture.awayColor || '#ddd'} darkThemeColor={featuredFixture.awayDarkThemeColor} lightThemeColor={featuredFixture.awayLightThemeColor} imageUrl={featuredFixture.awayCrestImageUrl} size="sm" />
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
                  <div><strong>{emptyState.title}</strong><p>{emptyState.detail}</p></div>
                </article>
              )}

              {schedule.otherItems.length > 0 && (
                <>
                  <div className="agenda-date"><span>AGENDA</span><strong>+</strong><small>CONFIRMADA</small></div>
                  {schedule.otherItems.map((item) => {
                    const date = validCalendarDate(item.scheduledAt);
                    const displayFixture = item.kind === 'fixture' ? roomFixtureToDisplay(item.fixture) : null;
                    return (
                      <article className={`agenda-item${item.kind === 'fixture' ? ' fixture' : ''}`} key={item.id}>
                        <span className="agenda-icon">{commitmentIcon(item.kind)}</span>
                        <div>
                          <strong>{displayFixture ? `${displayFixture.home} × ${displayFixture.away}` : item.title}</strong>
                          <p>{displayFixture?.detail ?? item.detail}</p>
                        </div>
                        <time>
                          {displayFixture?.date ?? (date ? formattedDate(date) : 'A definir')}
                          <small>{displayFixture?.time ?? commitmentTiming(item.kind)}</small>
                        </time>
                      </article>
                    );
                  })}
                </>
              )}
            </div>

            <aside className="calendar-summary">
              <div>
                <p className="eyebrow">AGENDA DO SAVE</p>
                <h3>{schedule.items.length} {schedule.items.length === 1 ? 'compromisso pendente' : 'compromissos pendentes'}</h3>
                <p>Somente eventos confirmados no estado atual da sala.</p>
              </div>
              <dl>
                <div><dt><Swords size={14} /> Jogos</dt><dd>{counts.fixture}</dd></div>
                {counts['facility-project'] > 0 && <div><dt><Building2 size={14} /> Obras</dt><dd>{counts['facility-project']}</dd></div>}
                {counts['staff-contract'] > 0 && <div><dt><BriefcaseBusiness size={14} /> Contratos</dt><dd>{counts['staff-contract']}</dd></div>}
                {counts.lifecycle > 0 && <div><dt><UserRoundCheck size={14} /> Carreira</dt><dd>{counts.lifecycle}</dd></div>}
                {unscheduledGames > 0 && <div><dt><Trophy size={14} /> Datas a definir</dt><dd>{unscheduledGames}</dd></div>}
              </dl>
            </aside>
          </div>
        ) : (
          <div className="month-grid">
            <div className="weekday-row">{['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB', 'DOM'].map((day) => <span key={day}>{day}</span>)}</div>
            <div className="month-days">{days.map((day, index) => {
              const dayItems = day ? itemsByDay.get(day) ?? [] : [];
              const isToday = day === today.getUTCDate()
                && displayedMonth.getUTCMonth() === today.getUTCMonth()
                && displayedMonth.getUTCFullYear() === today.getUTCFullYear();
              const label = dayItems.length > 1
                ? `${dayItems.length} compromissos`
                : dayItems[0] ? commitmentLabel(dayItems[0].kind) : null;
              const hasFixture = dayItems.some((item) => item.kind === 'fixture');
              return (
                <button key={index} className={isToday ? 'today' : ''} disabled={!day}>
                  <span>{day}</span>
                  {label && <><i className={hasFixture ? 'match' : 'cup'} /><small>{label}</small></>}
                </button>
              );
            })}</div>
          </div>
        )}
      </section>
    </main>
  );
}
