import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { parseRankingQuery } from '../../shared/rankingQuery.mjs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { inspectEncoding } from '../../scripts/check-encoding.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

let vite;
let normalizeRankings;
let normalizeRankingsResponse;
let aggregateRankingManagerSeasonStats;
let filterRankingPlayers;
let localManagerRanking;
let sortRankingClubs;
let sortRankingManagers;
let sortRankingPlayers;
let sortRankingPlayersByCategory;

before(async () => {
  vite = await createServer({
    root: projectRoot,
    configFile: false, envFile: false,
    plugins: [{
      name: 'expose-ranking-timeline-for-tests',
      transform(source, id) {
        if (id.replaceAll('\\', '/').endsWith('/src/views/season/RankingsView.tsx')) {
          return { code: `${source}\nexport { TimelineEvolution };`, map: null };
        }
      },
    }],
    appType: "custom",
    logLevel: "silent",
    esbuild: { jsx: 'automatic' },
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true },
  });
  ({ normalizeRankings, normalizeRankingsResponse } = await vite.ssrLoadModule("/src/hooks/useRankings.ts"));
  ({
    aggregateRankingManagerSeasonStats,
    filterRankingPlayers,
    localManagerRanking,
    sortRankingClubs,
    sortRankingManagers,
    sortRankingPlayers,
    sortRankingPlayersByCategory,
  } = await vite.ssrLoadModule("/src/utils/rankings.ts"));
});

after(async () => {
  await vite?.close();
});

function rankingPlayer(id, name, overrides = {}) {
  return {
    id,
    name,
    clubId: "CLB",
    clubName: "Clube Real",
    clubCode: "CLR",
    clubCrestImageUrl: null,
    shirtNumber: 9,
    position: "ATA",
    age: 24,
    nationality: "BRA",
    isStar: false,
    avatarImageUrl: null,
    goals: 0,
    penaltyGoals: null,
    nonPenaltyGoals: null,
    ownGoals: null,
    assists: 0,
    goalContributions: 0,
    appearances: 0,
    starts: 0,
    minutes: 0,
    yellowCards: 0,
    redCards: 0,
    keyPasses: null,
    bigChancesCreated: null,
    tackles: null,
    saves: null,
    cleanSheets: null,
    shots: null,
    shotsOnTarget: null,
    overall: 10,
    rating: 10,
    averageRating: null,
    minutesPerGoal: null,
    minutesPerAssist: null,
    minutesPerContribution: null,
    contributionsPerGame: null,
    clubGoalParticipationPercent: null,
    marketValue: null,
    wage: null,
    rank: null,
    previousRank: null,
    rankChange: null,
    ...overrides,
  };
}

test("artilharia usa gols, minutos por gol, menos penaltis, assistencias e nota", () => {
  const ordered = sortRankingPlayers([
    rankingPlayer("nota", "Nota", { goals: 5, minutesPerGoal: 100, penaltyGoals: 1, assists: 2, averageRating: 9 }),
    rankingPlayer("assist", "Assist", { goals: 5, minutesPerGoal: 100, penaltyGoals: 1, assists: 3, averageRating: 7 }),
    rankingPlayer("penalti", "Pênalti", { goals: 5, minutesPerGoal: 100, penaltyGoals: 2, assists: 8, averageRating: 10 }),
    rankingPlayer("eficiente", "Eficiente", { goals: 5, minutesPerGoal: 80, penaltyGoals: 4 }),
    rankingPlayer("menos", "Menos gols", { goals: 4, minutesPerGoal: 30 }),
  ]);
  assert.deepEqual(ordered.map((player) => player.id), ["eficiente", "assist", "nota", "penalti", "menos"]);
  assert.deepEqual(ordered.map((player) => player.rank), [1, 2, 3, 4, 5]);

  const preseason = sortRankingPlayers([
    rankingPlayer("baixo", "Nota baixa", { rating: 8 }),
    rankingPlayer("alto", "Nota alta", { rating: 14 }),
  ]);
  assert.deepEqual(preseason.map((player) => player.id), ["alto", "baixo"]);
});

test("categorias ordenam producao e mantem metricas avancadas desconhecidas por ultimo", () => {
  const players = [
    rankingPlayer("a", "A", { assists: 2, goalContributions: 4, minutes: 500, appearances: 8, keyPasses: null, saves: 10, cleanSheets: 2 }),
    rankingPlayer("b", "B", { assists: 5, goalContributions: 5, minutes: 200, appearances: 3, keyPasses: 12, saves: null, cleanSheets: null }),
    rankingPlayer("c", "C", { assists: 1, goalContributions: 7, minutes: 800, appearances: 10, keyPasses: 4, saves: 20, cleanSheets: 5 }),
  ];
  assert.deepEqual(sortRankingPlayersByCategory(players, "assists").map((player) => player.id), ["b", "a", "c"]);
  assert.deepEqual(sortRankingPlayersByCategory(players, "contributions").map((player) => player.id), ["c", "b", "a"]);
  assert.deepEqual(sortRankingPlayersByCategory(players, "minutes").map((player) => player.id), ["c", "a", "b"]);
  assert.deepEqual(sortRankingPlayersByCategory(players, "keyPasses").map((player) => player.id), ["b", "c", "a"]);
  assert.deepEqual(sortRankingPlayersByCategory(players, "saves").map((player) => player.id), ["c", "a", "b"]);

  const ratings = [
    rankingPlayer("sem-media", "Sem média", { rating: 20, averageRating: null }),
    rankingPlayer("media-baixa", "Média baixa", { rating: 8, averageRating: 6.5 }),
    rankingPlayer("media-alta", "Média alta", { rating: 7, averageRating: 7.5 }),
  ];
  assert.deepEqual(sortRankingPlayersByCategory(ratings, "rating").map((player) => player.id), ["media-alta", "media-baixa", "sem-media"]);
});

test("filtros combinam busca, clube, nacionalidade, posicao, idade e sub-21", () => {
  const players = [
    rankingPlayer("joao", "João Ávila", { clubId: "SAN", clubCode: "SAN", clubName: "Santos", nationality: "Brasil", position: "ATA", age: 20 }),
    rankingPlayer("jose", "José Lima", { clubId: "PAL", clubCode: "PAL", clubName: "Palmeiras", nationality: "Brasil", position: "ATA", age: 22 }),
    rankingPlayer("juan", "Juan", { clubId: "SAN", clubCode: "SAN", clubName: "Santos", nationality: "Argentina", position: "MEI", age: 19 }),
  ];
  assert.deepEqual(filterRankingPlayers(players, {
    search: "joao",
    clubId: "SAN",
    nationality: "brasil",
    position: "ata",
    ageMin: 18,
    u21: true,
  }).map((player) => player.id), ["joao"]);
  assert.deepEqual(filterRankingPlayers(players, { clubId: "Santos", under21: true }).map((player) => player.id), ["joao", "juan"]);
});

test("normalizador aceita contrato rico e conserva compatibilidade legada", () => {
  const snapshot = normalizeRankings({
    scope: {
      leagueIds: ["BR-A"],
      leagueId: "BR-A",
      leagueName: "Liga Teste",
      competitionId: "COPA",
      competitionName: "Copa Teste",
      seasonNumber: 2,
      round: 7,
    },
    options: {
      competitions: [{ id: "BR-A", name: "Brasileirão", count: 20 }],
      seasons: [2026],
      positions: ["ATA"],
    },
    meta: { generatedAt: "2026-07-20T12:00:00.000Z", currentRound: 7, totalRounds: 38, source: "firestore" },
    history: [{ id: "h1", type: "player", playerId: "p1", rank: 2, points: 15, round: 6 }],
    players: [{
      id: "p1",
      name: "Jogador Real",
      club: { id: "A", name: "Clube A", code: "CLA" },
      shirtNumber: 7,
      position: "ATA",
      age: 21,
      nationality: "BRA",
      seasonStats: { goals: 4, assists: 2, appearances: 5, starts: 4, minutes: 360, yellowCards: 1 },
      advancedStats: { penaltyGoals: 1, keyPasses: 9 },
      averageRating: 7.4,
    }],
    clubs: [{
      id: "A",
      name: "Clube A",
      code: "CLA",
      color: "#111111",
      campaign: { played: 5, wins: 4, draws: 1, points: 13, goalsFor: 12, goalsAgainst: 4, form: ["V", "V", "E"] },
      finance: { squadValue: 123456789, payroll: 1200000 },
      playerCount: 22,
    }],
    managers: [{
      id: "m1",
      name: "Manager Um",
      club: { id: "A", name: "Clube A", code: "CLA" },
      campaign: { played: 5, wins: 4, draws: 1, points: 13, goalsFor: 12, goalsAgainst: 4, form: ["W", "W", "D"] },
      preferredFormation: "4-3-3",
      careerHistory: [{ id: "job-a", seasonNumber: 2, clubId: "A", clubName: "Clube A", played: 5, wins: 4, draws: 1, losses: 0, points: 13, titles: 0 }],
      seasonStats: [{ id: "season-a", seasonNumber: 2, competitionId: "COPA", competitionName: "Copa Teste", clubId: "A", played: 5, wins: 4, draws: 1, losses: 0, points: 13, goalsFor: 12, goalsAgainst: 4 }],
      matchHistory: [{ fixtureId: "f-real", clubId: "A", opponentId: "B", competitionId: "COPA", seasonNumber: 2, round: 7, result: "D", goalsFor: 0, goalsAgainst: 1 }],
      isOwner: true,
      isViewer: true,
    }],
  });

  assert.ok(snapshot);
  assert.equal(snapshot.scope.competitionId, "COPA");
  assert.equal(snapshot.options.competitions[0].label, "Brasileirão");
  assert.equal(snapshot.options.seasons[0].id, "2026");
  assert.equal(snapshot.meta.totalRounds, 38);
  assert.deepEqual(snapshot.history[0], {
    id: "h1", type: "player", label: null, seasonNumber: null, round: 6, competitionId: null,
    playerId: "p1", clubId: null, managerId: null, position: 2, value: 15, createdAt: null,
    seasonYear: null, completedFixtureCount: null, matchCount: null,
  });
  assert.deepEqual(
    {
      goals: snapshot.players[0].goals,
      contributions: snapshot.players[0].goalContributions,
      minutesPerGoal: snapshot.players[0].minutesPerGoal,
      penalties: snapshot.players[0].penaltyGoals,
      keyPasses: snapshot.players[0].keyPasses,
      saves: snapshot.players[0].saves,
    },
    { goals: 4, contributions: 6, minutesPerGoal: 90, penalties: 1, keyPasses: 9, saves: null },
  );
  assert.deepEqual(snapshot.clubs[0].recentForm, ["W", "W", "D"]);
  assert.equal(snapshot.clubs[0].payroll, 1200000);
  assert.equal(snapshot.managers[0].preferredFormation, "4-3-3");
  assert.equal(snapshot.managers[0].performancePercent, 13 / 15 * 100);
  assert.equal(snapshot.managers[0].rankingPoints, null);
  assert.equal(snapshot.managers[0].titles, null);
  assert.equal(snapshot.managers[0].seasonStats[0].clubName, "Clube A");
  assert.deepEqual(snapshot.managers[0].matchHistory[0], {
    id: "f-real", managerId: null, opponentManagerId: null, clubId: "A", opponentId: "B", opponentName: null, competitionId: "COPA", competitionName: null,
    seasonNumber: 2, round: 7, venue: null, playedAt: null, result: "L", goalsFor: 0, goalsAgainst: 1,
  });

  const portugueseForm = normalizeRankings({
    players: [],
    clubs: [{ id: "PT", name: "Português", form: ["V", "E", "D"] }],
    managers: [],
  });
  assert.deepEqual(portugueseForm.clubs[0].recentForm, ["W", "D", "L"]);

  const legacy = normalizeRankings({
    scope: { leagueIds: ["L"], leagueName: "Legada" },
    players: [{ id: "old", name: "Antigo", clubId: "A", seasonStats: { goals: 1 }, rating: 10 }],
    clubs: [{ id: "A", name: "Antigo FC", squadValue: 50, playerCount: 1 }],
    managers: [{ id: "m", name: "Técnico", points: 0 }],
  });
  assert.ok(legacy);
  assert.equal(legacy.players[0].goals, 1);
  assert.equal(legacy.players[0].keyPasses, null);
  assert.deepEqual(legacy.options.competitions, []);
  assert.deepEqual(legacy.history, []);
});

test("clubes e managers possuem helpers de ordenacao deterministica", () => {
  const clubs = [
    { id: "a", name: "A", points: 3, wins: 1, goalDifference: 1, goalsFor: 2, squadValue: 10, averagePlayerValue: 5, payroll: 2, reputation: 3, recentForm: ["L"] },
    { id: "b", name: "B", points: 6, wins: 2, goalDifference: 2, goalsFor: 3, squadValue: 8, averagePlayerValue: 4, payroll: 4, reputation: 2, recentForm: ["W"] },
  ];
  assert.deepEqual(sortRankingClubs(clubs, "points").map((club) => club.id), ["b", "a"]);
  assert.deepEqual(sortRankingClubs(clubs, "squadValue").map((club) => club.id), ["a", "b"]);

  const managers = [
    { id: "a", name: "A", points: 3, wins: 1, goalDifference: 1, goalsFor: 2, performancePercent: 40, rankingPoints: 50, titles: 0, position: 1 },
    { id: "b", name: "B", points: 2, wins: 0, goalDifference: 0, goalsFor: 1, performancePercent: 80, rankingPoints: 30, titles: 2, position: 2 },
  ];
  assert.deepEqual(sortRankingManagers(managers, "performance").map((manager) => manager.id), ["b", "a"]);
  assert.deepEqual(sortRankingManagers(managers, "titles").map((manager) => manager.id), ["b", "a"]);
  assert.deepEqual(sortRankingManagers(managers, "reputation").map((manager) => manager.id), ["a", "b"]);
  assert.deepEqual(
    sortRankingManagers(managers, "performance").map((manager) => manager.position),
    [2, 1],
    "ordenacao alternativa nao renumera a posicao oficial",
  );
});

test("estatisticas do treinador agregam multiplos mandatos sem perder ranking final", () => {
  const base = {
    seasonNumber: 2,
    seasonYear: 2027,
    competitionId: "L1",
    competitionName: "Liga Real",
    status: "unemployed",
    startedAt: null,
    endedAt: null,
    titles: 0,
  };
  const aggregated = aggregateRankingManagerSeasonStats([
    { ...base, id: "spell-a", clubId: "A", clubName: "Clube A", played: 10, wins: 5, draws: 3, losses: 2, goalsFor: 18, goalsAgainst: 10, points: 18, performancePercent: 60, rankingPoints: 44, position: 4 },
    { ...base, id: "spell-b", clubId: "B", clubName: "Clube B", played: 5, wins: 4, draws: 0, losses: 1, goalsFor: 11, goalsAgainst: 4, points: 12, performancePercent: 80, rankingPoints: 58, position: 2, titles: 1 },
    { ...base, id: "older", seasonNumber: 1, seasonYear: 2026, clubId: "A", clubName: "Clube A", played: 3, wins: 1, draws: 1, losses: 1, goalsFor: 3, goalsAgainst: 3, points: 4, performancePercent: 44.4, rankingPoints: 20, position: 7 },
  ]);

  assert.equal(aggregated.length, 2);
  assert.deepEqual({
    clubName: aggregated[0].clubName,
    played: aggregated[0].played,
    wins: aggregated[0].wins,
    draws: aggregated[0].draws,
    losses: aggregated[0].losses,
    goalsFor: aggregated[0].goalsFor,
    goalsAgainst: aggregated[0].goalsAgainst,
    points: aggregated[0].points,
    rankingPoints: aggregated[0].rankingPoints,
    position: aggregated[0].position,
    titles: aggregated[0].titles,
  }, {
    clubName: "Clube A → Clube B",
    played: 15,
    wins: 9,
    draws: 3,
    losses: 3,
    goalsFor: 29,
    goalsAgainst: 14,
    points: 30,
    rankingPoints: 58,
    position: 2,
    titles: 1,
  });
});

test("fallback de managers usa tabela da liga, marca viewer e preserva manager sem clube", () => {
  const room = {
    id: "room",
    code: "REAL",
    ownerId: "m1",
    maxManagers: 3,
    managers: [
      { id: "m1", name: "Ana Real", clubId: "A" },
      { id: "m2", name: "Beto Real", clubId: "B" },
      { id: "m3", name: "Cris Real", clubId: null },
    ],
    competitionCatalog: [{
      id: "L1",
      name: "Liga Real",
      clubs: [
        { id: "A", code: "CLA", name: "Clube A", color: "#111", crestImageUrl: null },
        { id: "B", code: "CLB", name: "Clube B", color: "#222", crestImageUrl: null },
      ],
    }],
    leagueFixtureSchedule: [{ leagueFixtureId: "f1", leagueId: "L1", round: 1, homeClubId: "A", awayClubId: "B" }],
    leagueMatchResults: [{ leagueFixtureId: "f1", score: [2, 0] }],
  };
  const managers = localManagerRanking(room, "m2");
  assert.deepEqual(managers.map((manager) => [manager.name, manager.points]), [["Ana Real", 3], ["Beto Real", 0], ["Cris Real", 0]]);
  assert.equal(managers.find((manager) => manager.id === "m2").isViewer, true);
  assert.equal(managers.find((manager) => manager.id === "m3").status, "unemployed");
});

test("fallback local cria somente um treinador IA por clube repetido no catálogo", () => {
  const club = { id: "C", code: "CLC", name: "Clube C", color: "#333", crestImageUrl: null };
  const managers = localManagerRanking({
    id: "room-ai",
    code: "AI",
    ownerId: "",
    maxManagers: 0,
    managers: [],
    competitionCatalog: [
      { id: "L1", name: "Liga 1", clubs: [club] },
      { id: "L2", name: "Liga 2", clubs: [{ ...club }] },
    ],
    leagueFixtureSchedule: [],
    leagueMatchResults: [],
  });
  assert.deepEqual(managers.map((manager) => manager.id), ["ai-coach:C"]);
});

test("hook envia competitionId, preserva snapshot no refresh e expoe refresh", async () => {
  const hook = await readFile(path.join(projectRoot, "src/hooks/useRankings.ts"), "utf8");
  assert.match(hook, /query\.set\('competitionId', competition\)/);
  assert.match(hook, /const refresh = useCallback/);
  assert.match(hook, /setRefreshing\(hasSnapshot\)/);
  assert.match(hook, /const sameScope = scopeRef\.current === requestScope/);
  assert.match(hook, /rankings: scopeMatches && authenticated \? rankings : null/);
  assert.match(hook, /normalizeRankingsResponse\(response.rankings, selection\)/);
});

test('resposta valida eco da consulta e preserva ordem do servidor, inclusive métricas nulas', () => {
  const query = parseRankingQuery({ playerColumn: 'player', playerDirection: 'asc', managerPeriod: 'last5' });
  const dto = { meta: {}, scope: {}, players: [rankingPlayer('p1', 'Alfa'), rankingPlayer('p2', 'Beta')], clubs: [],
    managers: [{ id: 'm1', name: 'Treinador', points: 15, played: 5 }],
    selection: { query, playerIds: ['p2', 'p1'], clubIds: [], managers: [{ id: 'm1', name: 'Treinador', rankingPoints: null, titles: null }], managerScope: [] } };
  const normalized = normalizeRankingsResponse(dto, query);
  assert.deepEqual(normalized.selection.playerIds, ['p2', 'p1']);
  assert.equal(normalized.selection.managers[0].rankingPoints, null);
  assert.equal(normalized.selection.managers[0].titles, null);
  for (const invalid of [{}, { ...dto, selection: null }, { ...dto, selection: { ...dto.selection, query: {} } },
    { ...dto, selection: { ...dto.selection, playerIds: ['p1', 'p1'] } },
    { ...dto, selection: { ...dto.selection, managers: [{ id: 'intruso', name: 'Intruso' }] } }]) {
    assert.equal(normalizeRankingsResponse(invalid, query), null);
  }
});

test('tabela remota não reordena página; cabeçalho continua indicando a coluna e direção', async () => {
  const { RankingTable } = await vite.ssrLoadModule('/src/components/rankings/RankingTable.tsx');
  const markup = renderToStaticMarkup(createElement(RankingTable, {
    caption: 'Ordem remota', serverSorted: true,
    columns: [{ id: 'name', label: 'Nome', sortable: true, value: (item) => item.name, render: (item) => item.name }],
    items: [{ id: '2', name: 'Zulu' }, { id: '1', name: 'Alfa' }], rowKey: (item) => item.id,
    sort: { column: 'name', direction: 'asc' }, onSortChange() {},
  }));
  assert.ok(markup.indexOf('Zulu') < markup.indexOf('Alfa'));
  assert.match(markup, /aria-sort="ascending"/);
});

test('derrotas D do backend não viram empates quando a sequência não contém V ou E', () => {
  const query = parseRankingQuery({});
  const manager = { id: 'm1', name: 'Treinador', recentForm: ['D', 'D', 'D'] };
  const normalized = normalizeRankingsResponse({ meta: {}, scope: {}, players: [], clubs: [{ id: 'C', name: 'Clube', recentForm: ['D', 'D'] }],
    managers: [manager], selection: { query, playerIds: [], clubIds: ['C'], managers: [manager], managerScope: [manager] } }, query);
  assert.deepEqual(normalized.clubs[0].recentForm, ['L', 'L']);
  assert.deepEqual(normalized.managers[0].recentForm, ['L', 'L', 'L']);
  assert.deepEqual(normalized.selection.managers[0].recentForm, ['L', 'L', 'L']);
});

test("view nao contem participantes, XP ou valores estimados fixos", async () => {
  const view = await readFile(path.join(projectRoot, "src/views/season/RankingsView.tsx"), "utf8");
  assert.doesNotMatch(view, /demoClubRanking|estimatedClubValue|1\.840 XP|2\.140 XP|1\.720 XP/);
  assert.doesNotMatch(view, /Tática<\/dt>|Vestiário<\/dt>|Jovens<\/dt>|Reputação nacional/);
  assert.match(view, /<ManagerEntity manager=\{item\} rank=\{item\.position\} \/>/);
  assert.doesNotMatch(view, /<details className="rankings-filters-shell">/);
  assert.equal((view.match(/serverSorted=\{useRemote\}/g) ?? []).length, 3);
  assert.doesNotMatch(view, /tab: 'players', playerCategory: '[a-z]+' \}/);
});

test('histórico renderiza acentos, ordinais e traços sem corrupção', async () => {
  const { TimelineEvolution } = await vite.ssrLoadModule('/src/views/season/RankingsView.tsx');
  const html = renderToStaticMarkup(createElement(TimelineEvolution, {
    entries: [{ id: 'r1', round: 1, position: 2, positionChange: null, points: 3,
      played: 1, wins: 1, draws: 0, losses: 0, goalDifference: 1 }],
    historyRound: 'all', onRoundChange() {}, clubName: 'São Paulo',
    competitionName: 'Brasileirão Série A', seasonLabel: 'Temporada 2026', totalClubs: 20,
  }));
  for (const label of ['EVOLUÇÃO REAL POR RODADA', 'Melhor posição', 'Pior posição', 'Rodadas líder',
    'Histórico de posições', 'Variação', 'Evolução de São Paulo', '2º', '—', ' · ']) {
    assert.ok(html.includes(label), label);
  }
  assert.deepEqual(inspectEncoding(Buffer.from(html)), []);
});
