import { Bot, CheckCircle2, Clock3, Users } from 'lucide-react';
import type { ServerRoundSummary } from '../../types';
import { cx } from '../../utils/formatters';
import { Badge } from '../shared/Badge';
import { ClubMark } from '../shared/ClubMark';

interface RoundResultsPanelProps {
  summary: ServerRoundSummary;
  managedClubIds?: readonly string[];
}

function clubKey(value: string | null | undefined): string {
  return String(value ?? '').trim().toLocaleUpperCase('pt-BR');
}

function displayText(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function displayInteger(value: unknown, fallback: number): number {
  if (typeof value !== 'number' && typeof value !== 'string') return fallback;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.trunc(numeric)) : fallback;
}

function displayScore(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  if (!['number', 'string'].includes(typeof value[0]) || !['number', 'string'].includes(typeof value[1])) return null;
  const home = Number(value[0]);
  const away = Number(value[1]);
  return Number.isFinite(home) && Number.isFinite(away)
    ? [Math.max(0, Math.trunc(home)), Math.max(0, Math.trunc(away))]
    : null;
}

function clubCode(code: unknown, clubId: string | null | undefined, name: unknown, fallback: string) {
  const normalizedCode = typeof code === 'string' ? code.trim() : '';
  const normalizedName = String(name ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]/g, '');
  return normalizedCode || clubKey(clubId).slice(0, 3) || normalizedName.slice(0, 3).toLocaleUpperCase('pt-BR') || fallback;
}

export function RoundResultsPanel({ summary, managedClubIds = [] }: RoundResultsPanelProps) {
  const managedKeys = new Set(managedClubIds.map(clubKey).filter(Boolean));
  const matches = (Array.isArray(summary.matches) ? summary.matches : []).filter(
    (match) => Boolean(match && typeof match === 'object'),
  );
  const round = displayInteger(summary.round, 1);
  const competition = displayText(summary.competition, 'Competição');
  const seasonNumber = displayInteger(summary.seasonNumber, 1);
  const seasonYear = displayInteger(summary.seasonYear, new Date().getUTCFullYear());
  const complete = summary.complete === true;
  const titleId = `round-results-${round}-title`;

  return (
    <section className="round-results" aria-labelledby={titleId}>
      <header className="round-results__header">
        <div>
          <p className="eyebrow">PLACAR COMPLETO</p>
          <h2 id={titleId}>Resultados da rodada {round}</h2>
          <p>{competition} · Temporada {seasonNumber} · {seasonYear}</p>
        </div>
        <Badge tone={complete ? 'positive' : 'warning'} dot>
          {complete ? 'Rodada concluída' : 'Em andamento'}
        </Badge>
      </header>

      {matches.length ? (
        <ol className="round-results__list" aria-label={`Jogos da rodada ${round}`}>
          {matches.map((match, index) => {
            const isManaged = managedKeys.has(clubKey(match.homeClubId)) || managedKeys.has(clubKey(match.awayClubId));
            const homeTeam = displayText(match.homeTeam, 'Mandante');
            const awayTeam = displayText(match.awayTeam, 'Visitante');
            const score = displayScore(match.score);
            const scoreLabel = score
              ? `${homeTeam} ${score[0]}, ${awayTeam} ${score[1]}`
              : `${homeTeam} contra ${awayTeam}, pendente`;

            return (
              <li
                key={match.id || match.fixtureId || `round-match-${index}`}
                className={cx('round-result', isManaged && 'round-result--managed')}
                aria-label={isManaged ? `Seu jogo: ${scoreLabel}` : scoreLabel}
              >
                <span className="round-result__source">
                  <Badge tone={match.source === 'manager' ? 'info' : 'neutral'}>
                    {match.source === 'manager'
                      ? <><Users size={12} aria-hidden="true" /> Managers</>
                      : <><Bot size={12} aria-hidden="true" /> IA</>}
                  </Badge>
                  {isManaged && <small>Seu jogo</small>}
                </span>

                <span className="round-result__team round-result__team--home">
                  <strong>{homeTeam}</strong>
                  <ClubMark
                    code={clubCode(match.homeCode, match.homeClubId, match.homeTeam, 'MAN')}
                    color={match.homeColor || '#9ba3ad'}
                    darkThemeColor={match.homeDarkThemeColor}
                    lightThemeColor={match.homeLightThemeColor}
                    imageUrl={match.homeCrestImageUrl}
                    size="sm"
                  />
                </span>

                <span className={cx('round-result__score', !score && 'is-pending')} aria-label={scoreLabel}>
                  {score
                    ? <><strong>{score[0]}</strong><i>–</i><strong>{score[1]}</strong></>
                    : <><Clock3 size={14} aria-hidden="true" /><em>Pendente</em></>}
                </span>

                <span className="round-result__team round-result__team--away">
                  <ClubMark
                    code={clubCode(match.awayCode, match.awayClubId, match.awayTeam, 'VIS')}
                    color={match.awayColor || '#dedede'}
                    darkThemeColor={match.awayDarkThemeColor}
                    lightThemeColor={match.awayLightThemeColor}
                    imageUrl={match.awayCrestImageUrl}
                    size="sm"
                  />
                  <strong>{awayTeam}</strong>
                </span>

                <span className="round-result__state" aria-hidden="true">
                  {score ? <CheckCircle2 size={16} /> : <Clock3 size={16} />}
                </span>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="round-results__empty">Nenhum jogo encontrado nesta rodada.</p>
      )}
    </section>
  );
}
