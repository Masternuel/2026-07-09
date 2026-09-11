import { calculateLineupAttributeProfile } from "./lineupStrength.mjs";
import {
  careerDateFor,
  clubCareerPerformanceEffects,
  recordPlayerAvailabilityEvents,
} from "./clubCareerSystem.mjs";
import { simulateMatch } from "./matchSimulator.mjs";
import { applyFanAtmosphereToFixture } from "./coachJobSecurity.mjs";
import { applyMatchPlayerProgression, mergePlayerStates } from "./playerProgression.mjs";
import { calculateTacticalMatchup } from "./tacticalAnalysis.mjs";
import { calculateTacticalProfile, createAiTacticPlan } from "./tactics.mjs";
import { validateSymmetricRosterCoverage } from "./rosterCoverage.mjs";
import {
  calculateStarImpact,
  isPlayerAvailableForMatch,
  sortPlayersForSelection,
} from "./starImpact.mjs";

const DEFENDERS = new Set(["LE", "ZAG", "LD"]);
const MIDFIELDERS = new Set(["VOL", "MC", "MEI"]);
const ATTACKERS = new Set(["PE", "ATA", "PD"]);

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const rounded = (value) => Math.round(value * 1_000) / 1_000;

function identifier(value) {
  return String(value ?? "").trim();
}

function fixtureIdentity(fixture) {
  const fixtureId = [
    fixture?.leagueFixtureId,
    fixture?.competitionFixtureId,
    fixture?.fixtureId,
    fixture?.id,
  ].map(identifier).find(Boolean);
  if (!fixtureId) throw new TypeError("Partida IA sem identificador");
  return fixtureId;
}

function clubKey(value) {
  return identifier(value).toLocaleUpperCase("pt-BR");
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function rosterFor(rosters, clubId) {
  if (!(rosters instanceof Map)) return [];
  return rosters.get(clubKey(clubId)) ?? rosters.get(identifier(clubId)) ?? [];
}

function selectLineup(players) {
  const available = sortPlayersForSelection(players.filter(isPlayerAvailableForMatch));
  const selected = [];
  const selectedIds = new Set();
  const take = (predicate, maximum) => {
    for (const player of available) {
      if (selected.length >= 11 || maximum <= 0) break;
      if (selectedIds.has(String(player.id)) || !predicate(player)) continue;
      selected.push(player);
      selectedIds.add(String(player.id));
      maximum -= 1;
    }
  };
  take((player) => String(player.position).toUpperCase() === "GOL", 1);
  take((player) => DEFENDERS.has(String(player.position).toUpperCase()), 4);
  take((player) => MIDFIELDERS.has(String(player.position).toUpperCase()), 3);
  take((player) => ATTACKERS.has(String(player.position).toUpperCase()), 3);
  take(() => true, 11 - selected.length);
  return selected;
}

function preparedTeam(room, clubId, rawPlayers) {
  const roster = mergePlayerStates(rawPlayers, room, clubId);
  const lineup = selectLineup(roster);
  const lineupIds = lineup.map((player) => String(player.id));
  const goalkeeperCount = lineup.filter(
    (player) => String(player?.position ?? "").trim().toUpperCase() === "GOL",
  ).length;
  const validLineup = lineup.length === 11
    && goalkeeperCount === 1
    && String(lineup[0]?.position ?? "").trim().toUpperCase() === "GOL";
  const tactics = validLineup ? createAiTacticPlan(roster, lineupIds) : null;
  return {
    roster,
    lineup,
    lineupIds,
    realIds: new Set(roster.map((player) => String(player.id))),
    profile: calculateLineupAttributeProfile(lineup),
    stars: calculateStarImpact(clubId, roster, { lineupIds }),
    tactics,
    tacticalProfile: tactics
      ? calculateTacticalProfile(tactics, roster, lineupIds)
      : null,
  };
}

function preparedFixtureRosters(room, fixture, rosters) {
  const homeClubId = identifier(fixture?.homeClubId);
  const awayClubId = identifier(fixture?.awayClubId);
  const home = preparedTeam(room, homeClubId, rosterFor(rosters, homeClubId));
  const away = preparedTeam(room, awayClubId, rosterFor(rosters, awayClubId));
  const coverage = validateSymmetricRosterCoverage({
    clubId: homeClubId,
    players: home.roster,
    lineupIds: home.lineupIds,
  }, {
    clubId: awayClubId,
    players: away.roster,
    lineupIds: away.lineupIds,
  });
  return { homeClubId, awayClubId, home, away, coverage };
}

export function validateAiFixtureRosterCoverage(room, fixture, rosters) {
  return preparedFixtureRosters(room, fixture, rosters).coverage;
}

function tacticalContext(home, away) {
  if (!home.tacticalProfile || !away.tacticalProfile) return null;
  const matchup = calculateTacticalMatchup({
    homeTactics: home.tactics,
    awayTactics: away.tactics,
    homeProfile: home.tacticalProfile,
    awayProfile: away.tacticalProfile,
    homeAttributes: home.profile,
    awayAttributes: away.profile,
  });
  const side = (team, matchupSide) => {
    const formationFitBonus = clamp(finite(team.tacticalProfile.formationFitBonus), -0.4, 0.2);
    const matchupBonus = clamp(finite(matchupSide.modifier), -0.4, 0.4);
    return {
      formationFitBonus: rounded(formationFitBonus),
      tacticalMatchupBonus: rounded(matchupBonus),
      totalBonus: rounded(clamp(formationFitBonus + matchupBonus, -0.8, 0.6)),
    };
  };
  return {
    matchup,
    home: side(home, matchup.home),
    away: side(away, matchup.away),
  };
}

function strengthBreakdown(fixture, team, tacticalSide, side, careerEffects) {
  const base = finite(side === "home" ? fixture.homeStrength : fixture.awayStrength, 10);
  const attributeBonus = finite(team.profile.strengthBonus);
  const starBonus = finite(team.stars.matchStrengthBonus);
  const tacticalBonus = finite(tacticalSide?.totalBonus);
  const careerBonus = finite(careerEffects?.matchStrengthBonus);
  return {
    base,
    attributeBonus,
    starBonus,
    formationFitBonus: finite(tacticalSide?.formationFitBonus),
    tacticalMatchupBonus: finite(tacticalSide?.tacticalMatchupBonus),
    careerBonus,
    effective: rounded(base + attributeBonus + starBonus + tacticalBonus + careerBonus),
  };
}

function simulationMetadata(result, home, away, context, strengthProfile) {
  if (!context) return result;
  return {
    ...result,
    homeTacticalProfile: home.tacticalProfile,
    awayTacticalProfile: away.tacticalProfile,
    tacticalMatchup: context.matchup,
    strengthProfile,
  };
}

function realPlayerResult(result, homeIds, awayIds) {
  const statistics = {
    home: (result.playerStatistics?.home ?? []).filter((entry) => homeIds.has(String(entry.playerId))),
    away: (result.playerStatistics?.away ?? []).filter((entry) => awayIds.has(String(entry.playerId))),
  };
  const effects = (result.playerEffects ?? []).filter((entry) => (
    entry.side === "away"
      ? awayIds.has(String(entry.playerId))
      : homeIds.has(String(entry.playerId))
  ));
  return { ...result, playerStatistics: statistics, playerEffects: effects };
}

function playerStateBaselines(...teams) {
  return teams.flatMap((team) => team.roster.flatMap((player) => {
    const condition = Math.max(0, Math.min(100, finite(player?.condition, 100)));
    const injuryMatches = Math.max(0, Math.trunc(finite(player?.injuryMatches)));
    const suspensionMatches = Math.max(0, Math.trunc(finite(player?.suspensionMatches)));
    if (condition >= 100 && injuryMatches === 0 && suspensionMatches === 0) return [];
    return [{
      playerId: String(player.id),
      clubId: String(player.clubId ?? team.clubId),
      condition,
      injuryMatches,
      suspensionMatches,
    }];
  }));
}

/** Simulate an unmanaged fixture and persist its save-scoped player progression. */
export function simulateAiFixture(room, fixture, rosters, completedAt) {
  fixture = applyFanAtmosphereToFixture(room, fixture);
  const fixtureId = fixtureIdentity(fixture);
  const competitionId = identifier(fixture?.leagueId ?? fixture?.tournamentId ?? fixture?.competitionId) || null;
  const prepared = preparedFixtureRosters(room, fixture, rosters);
  const { homeClubId, awayClubId, coverage: rosterCoverageState } = prepared;
  // Never mix catalog bonuses from one club with legacy fallback on the other.
  const home = rosterCoverageState.valid ? prepared.home : preparedTeam(room, homeClubId, []);
  const away = rosterCoverageState.valid ? prepared.away : preparedTeam(room, awayClubId, []);
  const tactical = tacticalContext(home, away);
  const homeTacticalProfile = tactical ? home.tacticalProfile : null;
  const awayTacticalProfile = tactical ? away.tacticalProfile : null;
  const careerEffects = {
    home: clubCareerPerformanceEffects(room, homeClubId, careerDateFor(room, completedAt)),
    away: clubCareerPerformanceEffects(room, awayClubId, careerDateFor(room, completedAt)),
  };
  const strengthProfile = {
    home: strengthBreakdown(fixture, home, tactical?.home, "home", careerEffects.home),
    away: strengthBreakdown(fixture, away, tactical?.away, "away", careerEffects.away),
  };
  const seed = [
    room.id,
    room.currentSeason,
    identifier(fixture.leagueId ?? fixture.tournamentId ?? fixture.competitionId) || "legacy",
    fixture.round,
    fixtureId,
  ].join("|");
  // Individual incidents are only authoritative when both catalog rosters are
  // available. A partial fetch must not create an asymmetric statistical record.
  const canTrackPlayers = rosterCoverageState.valid;
  const simulated = simulationMetadata(simulateMatch({
    simulationVersion: canTrackPlayers ? 2 : undefined,
    roomCode: room.code,
    fixtureId,
    seasonNumber: room.currentSeason,
    homeClubId,
    awayClubId,
    homeTeam: fixture.homeTeam,
    awayTeam: fixture.awayTeam,
    homeStrength: strengthProfile.home.effective,
    awayStrength: strengthProfile.away.effective,
    homeGoalkeeperRating: home.profile.goalkeeping ?? 10,
    awayGoalkeeperRating: away.profile.goalkeeping ?? 10,
    homePhysicalSecondHalfModifier: clamp(
      finite(home.profile.physicalSecondHalfModifier)
        + finite(homeTacticalProfile?.fatigueSecondHalfModifier)
        + finite(careerEffects.home.physicalSecondHalfBonus),
      -0.4,
      0.4,
    ),
    awayPhysicalSecondHalfModifier: clamp(
      finite(away.profile.physicalSecondHalfModifier)
        + finite(awayTacticalProfile?.fatigueSecondHalfModifier)
        + finite(careerEffects.away.physicalSecondHalfBonus),
      -0.4,
      0.4,
    ),
    homeTacticalProfile,
    awayTacticalProfile,
    homePlayers: home.lineup,
    awayPlayers: away.lineup,
    homeRoster: home.roster,
    awayRoster: away.roster,
    clubCareerEffects: careerEffects,
    homeInjuryRiskMultiplier: careerEffects.home.injuryRiskMultiplier,
    awayInjuryRiskMultiplier: careerEffects.away.injuryRiskMultiplier,
    seed,
  }), home, away, tactical, strengthProfile);
  simulated.clubCareerEffects = careerEffects;
  simulated.strengthProfile = strengthProfile;
  simulated.rosterMode = canTrackPlayers ? "catalog" : "symmetric_fallback";
  simulated.rosterCoverage = rosterCoverageState;
  const progressionIdentity = {
    id: `ai:${room.id}:${room.currentSeason}:${fixtureId}`,
    homeClubId,
    awayClubId,
    playerStateBaselines: playerStateBaselines(
      { ...home, clubId: homeClubId },
      { ...away, clubId: awayClubId },
    ),
  };
  const previousPlayerStates = structuredClone(room.playerStates ?? []);
  if (!canTrackPlayers) {
    // The fixture still serves existing bans/injuries and recovers unused
    // players, but no fabricated individual incident is persisted.
    applyMatchPlayerProgression(room, fixture, {
      ...progressionIdentity,
      playerStatistics: { home: [], away: [] },
      playerEffects: [],
    }, completedAt);
    recordPlayerAvailabilityEvents(room, {
      fixtureId,
      competitionId,
      seasonNumber: room.currentSeason,
      previousPlayerStates,
      occurredAt: completedAt,
    });
    return simulated;
  }

  const tracked = realPlayerResult(simulated, home.realIds, away.realIds);
  applyMatchPlayerProgression(room, fixture, {
    ...tracked,
    ...progressionIdentity,
  }, completedAt);
  recordPlayerAvailabilityEvents(room, {
    fixtureId,
    competitionId,
    seasonNumber: room.currentSeason,
    previousPlayerStates,
    occurredAt: completedAt,
  });
  return tracked;
}
