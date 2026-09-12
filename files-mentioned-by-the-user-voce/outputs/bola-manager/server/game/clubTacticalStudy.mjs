import { createHash } from 'node:crypto';
import { buildOpponentStudy } from './opponentStudy.mjs';
import { calculateStaffEffects } from './staffEngine.mjs';
import { careerDateFor } from './clubCareerSystem.mjs';
import { pendingManagedFixtures } from './officialCalendar.mjs';
import { scoutingClub, scoutingError } from './scouting.mjs';
import { mergePlayerStates } from './playerProgression.mjs';

export const TACTICAL_STUDY_PATHS = ['tacticalStudyState', 'competitionCatalog', 'tournamentCatalog',
  'fixtureSchedule', 'completedFixtureIds', 'leagueMatchResults', 'competitionSeason.completedFixtureIds',
  'lineups', 'careerState.players', 'careerState.trainingPlans', 'marketState.registrations', 'playerStates',
  'clubCareerState.currentDate', 'clubCareerState.staffMembers', 'clubCareerState.staffContracts'];
export const STUDY_POLICY = Object.freeze({ hours: { quick: 4, standard: 16, deep: 40 }, validDays: 14, maxRecords: 2000, cacheEntries: 128, cacheMs: 60000 });
const depths = ['none', 'quick', 'standard', 'deep'];
const key = (value) => String(value ?? '').trim().toUpperCase();
const fail = (message, code, status = 409) => { throw scoutingError(message, code, status); };

export function tacticalStudyContext(room, managerId, targetId, fallbackNow = new Date()) {
  const viewerClubId = scoutingClub(room, managerId);
  if (room.status !== 'active' || room.careerCompleted) fail('Estudo disponível apenas em uma carreira ativa.', 'STUDY_CAREER_INACTIVE');
  const fixture = !targetId ? pendingManagedFixtures(room).find((item) => [item.homeClubId, item.awayClubId].some((id) => key(id) === key(viewerClubId))) : null;
  const requested = targetId || (fixture && (key(fixture.homeClubId) === key(viewerClubId) ? fixture.awayClubId : fixture.homeClubId));
  if (!requested) return null;
  const clubs = [...(room.competitionCatalog ?? []).flatMap((league) => league.clubs ?? []),
    ...(room.tournamentCatalog ?? []).flatMap((tournament) => tournament.participants ?? [])];
  const target = clubs.find((club) => [club.id, club.code].some((id) => key(id) === key(requested)));
  if (!target) fail('Clube não pertence às competições deste save.', 'STUDY_CLUB_NOT_FOUND', 404);
  const now = careerDateFor(room, fallbackNow);
  const effects = calculateStaffEffects(room, viewerClubId, now);
  const members = (room.clubCareerState?.staffMembers ?? []).filter((member) => effects.sourceStaffIds.includes(member.id));
  const rating = Math.max(0, ...members.map((member) => Number(member.role === 'scout' ? member.attributes?.scouting : member.role === 'performance_analyst' ? member.attributes?.analysis : 0) || 0));
  const scoutLevel = Math.min(5, Math.ceil(rating / 4));
  return { viewerClubId, target, now, fixture, scoutLevel, effects, ownClub: key(viewerClubId) === key(target.id) };
}

function stateFor(room) {
  const state = room.tacticalStudyState ?? { version: 1, records: [] };
  if (state.version !== 1 || !Array.isArray(state.records)) fail('Estado de estudos inválido.', 'STUDY_STATE_INVALID', 500);
  return state;
}

export function studyKnowledge(room, context) {
  if (context.ownClub) return { earned: 3, available: 3, status: 'known', progress: 100, readyAt: null };
  const record = stateFor(room).records.find((entry) => key(entry.clubId) === key(context.viewerClubId) && key(entry.targetClubId) === key(context.target.id));
  if (record && (!Number.isFinite(Date.parse(record.startedAt)) || !Object.hasOwn(STUDY_POLICY.hours, record.depth)
    || !(record.speed >= 0.7 && record.speed <= 1) || !Number.isFinite(record.season))) fail('Progresso de estudo inválido.', 'STUDY_STATE_INVALID', 500);
  const age = record ? (Date.parse(context.now) - Date.parse(record.startedAt)) / 3600000 : 0;
  const valid = record && record.season === (room.currentSeason ?? 1) && age < STUDY_POLICY.validDays * 24;
  if (!valid) return { earned: 0, available: 0, status: record ? 'expired' : 'unknown', progress: 0, readyAt: null };
  if (!Number.isFinite(age) || !depths.includes(record.depth) || !(record.speed > 0)) fail('Progresso de estudo inválido.', 'STUDY_STATE_INVALID', 500);
  const earned = depths.reduce((level, depth, index) => index <= depths.indexOf(record.depth) && STUDY_POLICY.hours[depth] * record.speed <= age ? index : level, 0);
  const staffLimit = context.scoutLevel >= 4 ? 3 : context.scoutLevel >= 2 ? 2 : 1;
  const hours = STUDY_POLICY.hours[record.depth] * record.speed;
  return { earned, available: Math.min(earned, staffLimit), status: age < hours ? 'studying' : 'ready',
    progress: Math.max(0, Math.min(100, Math.floor(age / hours * 100))),
    readyAt: new Date(Date.parse(record.startedAt) + hours * 3600000).toISOString(), requestedDepth: record.depth };
}

export function startTacticalStudy(room, managerId, input, fallbackNow) {
  const context = tacticalStudyContext(room, managerId, input.clubId, fallbackNow);
  if (!context) fail('Nenhum adversário disponível.', 'STUDY_TARGET_REQUIRED');
  if (input.viewerClubId && key(input.viewerClubId) !== key(context.viewerClubId)) fail('Seu clube mudou. Atualize a página.', 'STUDY_CLUB_CHANGED');
  if (!STUDY_POLICY.hours[input.depth]) fail('Profundidade inválida.', 'STUDY_DEPTH_INVALID', 400);
  if (context.ownClub) return false;
  const state = stateFor(room);
  const index = state.records.findIndex((entry) => key(entry.clubId) === key(context.viewerClubId) && key(entry.targetClubId) === key(context.target.id));
  const previous = state.records[index];
  const knowledge = studyKnowledge(room, context);
  const valid = previous && knowledge.status !== 'expired';
  if (valid && depths.indexOf(previous.depth) >= depths.indexOf(input.depth)) return false;
  if (index < 0 && state.records.length >= STUDY_POLICY.maxRecords) fail('Limite de estudos neste save atingido.', 'STUDY_LIMIT');
  const record = { clubId: context.viewerClubId, targetClubId: context.target.id, season: room.currentSeason ?? 1,
    depth: input.depth, startedAt: valid ? previous.startedAt : context.now,
    speed: valid ? previous.speed : context.effects.scoutingSpeedMultiplier, updatedAt: context.now };
  if (index < 0) state.records.push(record); else state.records[index] = record;
  room.tacticalStudyState = state;
  return true;
}

export function buildClubTacticalStudy(room, context, players, requestedDepth, cache) {
  players = mergePlayerStates(players, room, context.target.id);
  const knowledge = studyKnowledge(room, context);
  const level = Math.min(knowledge.available, depths.indexOf(requestedDepth));
  const manager = room.managers.find((entry) => key(entry.clubId) === key(context.target.id));
  const lineup = (room.lineups ?? []).find((entry) => key(entry.clubId) === key(context.target.id))
    ?? (room.lineups ?? []).find((entry) => !entry.clubId && manager && entry.managerId === manager.id);
  const publicTactics = context.ownClub || lineup?.tactics?.secret === false ? lineup?.tactics : null;
  const preview = publicTactics && level >= 2 ? { formationId: publicTactics.formationId,
    mentality: publicTactics.mentality,
    ...(level >= 3 ? { teamInstructions: publicTactics.teamInstructions } : {}) } : null;
  const observed = publicTactics && level >= 3 ? { lineupIds: lineup.lineupIds } : null;
  const cacheKey = `${room.code}:${context.viewerClubId}:${context.target.id}:${requestedDepth}`;
  const signature = createHash('sha256').update(JSON.stringify([room.revision, room.currentSeason, context, knowledge, preview, observed, players])).digest('hex');
  const cached = cache?.get(cacheKey);
  if (cached?.signature === signature && cached.expiresAt > Date.now()) return structuredClone(cached.report);
  const base = { fixtureId: context.fixture?.fixtureId ?? null, viewerClubId: context.viewerClubId,
    opponentClubId: context.target.id, opponentName: context.target.name, depth: requestedDepth,
    effectiveDepth: depths[level], scoutLevel: context.scoutLevel, knowledge, revision: room.revision ?? 0,
    confidence: 0, dataStatus: 'unknown', source: 'estimated', probableFormation: null, style: null, mentality: null, pressing: null, marking: null,
    probableLineup: [], dangerousPlayers: [], sectors: [], strengths: [], weaknesses: [], recommendations: [],
    estimatedStudyHours: STUDY_POLICY.hours[requestedDepth] * context.effects.scoutingSpeedMultiplier,
    scoutingSpeedMultiplier: context.effects.scoutingSpeedMultiplier, generatedAt: context.now };
  if (level > 0) {
    const report = buildOpponentStudy({ viewerClubId: context.viewerClubId, opponentClub: context.target, players,
      tacticPreview: preview, lineup: observed, depth: depths[level],
      professionalConfidenceBonus: context.effects.scoutingConfidenceBonus + context.effects.tacticalAnalysisBonus,
      professionalSpeedMultiplier: context.effects.scoutingSpeedMultiplier });
    if (report.status === 'unavailable') fail('Não há atletas disponíveis para analisar este clube.', 'STUDY_ROSTER_UNAVAILABLE');
    base.dataStatus = report.status === 'partial' ? 'partial' : 'complete';
    base.confidence = Math.min(report.confidence.score, report.status === 'partial' ? 50 : 100, context.ownClub ? 100 : 45 + context.scoutLevel * 10);
    base.source = preview ? 'observed' : 'estimated';
    base.probableFormation = level >= 2 && report.probableFormation.source !== 'default' ? report.probableFormation.id : null;
    base.style = report.style.label;
    base.mentality = preview?.mentality ?? null;
    base.pressing = preview?.teamInstructions?.pressing ?? null;
    base.marking = preview?.teamInstructions?.marking ?? null;
    const playerDto = (player) => ({ id: player.id, name: player.name, position: player.position,
      rating: Math.round(player.overall ?? player.score), reason: player.role ? `Provável função: ${player.role}` : 'Dados do elenco' });
    base.dangerousPlayers = report.dangerousPlayers.filter((player) => Number.isFinite(player.score)).slice(0, level === 1 ? 1 : 3).map(playerDto);
    if (level >= 2) {
      base.sectors = Object.values(report.sectors).filter((sector) => Number.isFinite(sector.rating)).map((sector) => ({
        key: sector.code.toLowerCase(), label: sector.label, rating: Math.round(sector.rating), level: sector.classification,
      }));
      const insight = ({ code, label, detail }) => ({ code, label, detail });
      base.strengths = report.strengths.map(insight);
      base.weaknesses = report.weaknesses.map(insight);
      base.recommendations = report.recommendations.map(insight);
    }
    if (level >= 3) base.probableLineup = report.probableLineup.filter((player) => Number.isFinite(player.overall)).map(playerDto);
  }
  if (cache) {
    cache.delete(cacheKey);
    cache.set(cacheKey, { signature, expiresAt: Date.now() + STUDY_POLICY.cacheMs, report: structuredClone(base) });
    while (cache.size > STUDY_POLICY.cacheEntries) cache.delete(cache.keys().next().value);
  }
  return base;
}
