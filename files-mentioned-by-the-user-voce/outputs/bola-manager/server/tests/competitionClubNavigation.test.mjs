import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let vite;
let buildCompetitionClubMatches;
let loadCompetitionClubDetail;
let buildPlayerProfileOfferInput;
let buildPlayerProfileOfferState;
let openListingForPlayer;
let resolveRankingProfilePlayer;

const rivalClub = {
  id: 'rival-fc',
  name: 'Rival FC',
  code: 'RFC',
  colors: ['#123456'],
  darkThemeColor: '#dcecff',
  lightThemeColor: '#102030',
  crestImageUrl: 'https://example.test/rival.png',
  country: 'Argentina',
  division: 'Primera Division',
  reputation: 76,
  stadium: 'Estadio Rival',
  stadiumCapacity: 42_500,
  city: 'Buenos Aires',
  budget: 'R$ 250 mi',
};

const knownFixtures = [
  {
    id: 'known-result',
    round: 1,
    scheduledAt: '2026-07-02T19:00:00.000Z',
    homeClubId: 'manager-fc',
    awayClubId: rivalClub.id,
    homeName: 'Manager FC',
    awayName: rivalClub.name,
    homeCode: 'MFC',
    awayCode: rivalClub.code,
    homeCrestImageUrl: null,
    awayCrestImageUrl: rivalClub.crestImageUrl,
    score: [1, 2],
    completed: true,
    competitionName: 'Liga Teste',
  },
  {
    id: 'known-upcoming',
    round: 2,
    scheduledAt: '2026-07-09T19:00:00.000Z',
    homeClubId: rivalClub.id,
    awayClubId: 'third-fc',
    homeName: rivalClub.name,
    awayName: 'Third FC',
    homeCode: rivalClub.code,
    awayCode: 'TFC',
    homeCrestImageUrl: rivalClub.crestImageUrl,
    awayCrestImageUrl: null,
    score: null,
    completed: false,
    competitionName: 'Liga Teste',
  },
];

function detailInput(overrides = {}) {
  return {
    club: rivalClub,
    managerClubId: 'manager-fc',
    currentSeason: 3,
    competitionName: 'Liga Teste',
    position: 4,
    fixtures: knownFixtures,
    players: [],
    ...overrides,
  };
}

before(async () => {
  vite = await createServer({
    root: projectRoot,
    configFile: false,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true },
  });
  ({ buildCompetitionClubMatches, loadCompetitionClubDetail } = await vite.ssrLoadModule(
    '/src/services/competitionClubService.ts',
  ));
  ({
    buildPlayerProfileOfferInput,
    buildPlayerProfileOfferState,
    openListingForPlayer,
    resolveRankingProfilePlayer,
  } = await vite.ssrLoadModule('/src/components/player/playerProfileModel.ts'));
});

after(async () => {
  await vite?.close();
});

test('detalhe do clube usa apenas roster e tatica reais', async () => {
  const first = await loadCompetitionClubDetail(detailInput());
  const second = await loadCompetitionClubDetail(detailInput());

  assert.deepEqual(second, first);
  assert.deepEqual(first.identity, {
    id: rivalClub.id,
    name: rivalClub.name,
    code: rivalClub.code,
    color: rivalClub.colors[0],
    darkThemeColor: rivalClub.darkThemeColor,
    lightThemeColor: rivalClub.lightThemeColor,
    crestImageUrl: rivalClub.crestImageUrl,
    country: rivalClub.country,
    division: rivalClub.division,
    reputation: rivalClub.reputation,
    stadium: rivalClub.stadium,
    capacity: rivalClub.stadiumCapacity,
    city: rivalClub.city,
    budget: 250_000_000,
  });
  assert.equal(first.isManagerClub, false);
  assert.equal(first.baseKnowledge, true);
  assert.equal(first.currentSeason, 3);
  assert.equal(first.position, 4);
  assert.equal(first.recentMatches[0].id, 'known-result');
  assert.equal(first.upcomingMatches[0].id, 'known-upcoming');

  assert.deepEqual(first.squad, []);
  assert.equal(first.visibility.squad, false);
  assert.equal(first.tacticalIntel, null);
  assert.equal(first.visibility.tactics, false);
  assert.equal(first.scoutLevel, 0);
  assert.equal(first.finances.transferBudget, null);
  assert.equal(first.finances.annualRevenue, null);
});

test('jogadores fornecidos preservam identidade e deixam status não persistidos indisponíveis', async () => {
  const realPlayer = {
    id: 'real-player-10',
    name: 'Jogador Real',
    shortName: 'Real',
    isStar: false,
    number: 10,
    position: 'MEI',
    role: 'Meia criativo',
    age: 23,
    nationality: 'BRA',
    value: 37_500_000,
    wage: 125_000,
    condition: 96,
    morale: 'Boa',
    moraleScore: 82,
    status: 'Disponível',
    clubId: rivalClub.id,
    overall: 15,
    potential: 17,
    contract: {
      clubId: rivalClub.id,
      startSeason: 2,
      endSeason: 6,
      wage: 125_000,
      status: 'active',
      renewalCount: 0,
    },
    foot: 'Direito',
    personality: 'Profissional',
    worldStar: 4,
    attributes: {
      velocidade: 14,
      chute: 13,
      drible: 16,
      nocao: 15,
      defesa: 8,
      passe: 17,
      peBom: 16,
      peRuim: 10,
      forca: 11,
      resistencia: 14,
      impulsao: 9,
      reflexos: 3,
      posicionamentoGol: 2,
      saidaGol: 2,
      penaltis: 12,
    },
    avatarImageUrl: 'https://example.test/real-player.png',
  };

  const detail = await loadCompetitionClubDetail(detailInput({
    players: [realPlayer],
  }));

  assert.equal(detail.squad.length, 1);
  assert.equal(detail.squad[0].player.id, realPlayer.id);
  assert.equal(detail.squad[0].player.name, realPlayer.name);
  assert.equal(detail.squad[0].player.number, realPlayer.number);
  assert.equal(detail.squad[0].contractSeasonsRemaining, 3);
  assert.equal(detail.squad[0].squadStatus, 'unknown');
  assert.equal(detail.squad[0].negotiability, 'unknown');
  assert.equal(detail.squad[0].loanAvailable, null);
  assert.equal(detail.finances.squadValue, realPlayer.value);
  assert.equal(detail.finances.weeklyPayroll, realPlayer.wage);
  assert.equal(detail.visibility.squad, true);
  assert.equal(detail.tacticalIntel, null);

  const withoutFallback = await loadCompetitionClubDetail(detailInput({
    players: [],
  }));
  assert.deepEqual(withoutFallback.squad, []);
  assert.equal(withoutFallback.finances.squadValue, 0);
});

test('partidas do clube sao filtradas, deduplicadas e recebem o resultado da liga', () => {
  const room = {
    competitionCatalog: [{
      id: 'league-a',
      name: 'Liga A',
      country: 'Brasil',
      division: 'Serie A',
      legs: 'double',
      clubs: [
        { id: 'alpha', name: 'Alpha FC', code: 'ALP', color: '#111111', reputation: 70, crestImageUrl: null, leagueId: 'league-a' },
        { id: 'beta', name: 'Beta FC', code: 'BET', color: '#222222', reputation: 68, crestImageUrl: null, leagueId: 'league-a' },
        { id: 'gamma', name: 'Gamma FC', code: 'GAM', color: '#333333', reputation: 64, crestImageUrl: null, leagueId: 'league-a' },
      ],
    }],
    fixtureSchedule: [
      {
        fixtureId: 'fixture-1',
        leagueFixtureId: 'league-fixture-1',
        round: 1,
        scheduledAt: '2026-08-01T19:00:00.000Z',
        competition: 'Liga A',
        leagueId: 'league-a',
        homeClubId: 'alpha',
        awayClubId: 'beta',
        homeTeam: 'Alpha FC',
        awayTeam: 'Beta FC',
        homeManagerId: null,
        awayManagerId: null,
        managerIds: [],
      },
      {
        fixtureId: 'fixture-2',
        leagueFixtureId: 'league-fixture-2',
        round: 2,
        scheduledAt: '2026-08-08T19:00:00.000Z',
        competition: 'Liga A',
        leagueId: 'league-a',
        homeClubId: 'gamma',
        awayClubId: 'alpha',
        homeTeam: 'Gamma FC',
        awayTeam: 'Alpha FC',
        homeManagerId: null,
        awayManagerId: null,
        managerIds: [],
      },
    ],
    leagueFixtureSchedule: [
      { leagueFixtureId: 'league-fixture-1', leagueId: 'league-a', round: 1, scheduledAt: '2026-08-01T19:00:00.000Z', homeClubId: 'alpha', awayClubId: 'beta' },
      { leagueFixtureId: 'league-fixture-2', leagueId: 'league-a', round: 2, scheduledAt: '2026-08-08T19:00:00.000Z', homeClubId: 'gamma', awayClubId: 'alpha' },
    ],
    leagueMatchResults: [
      { leagueFixtureId: 'league-fixture-1', score: [2, 1], completedAt: '2026-08-01T21:00:00.000Z' },
    ],
  };

  const matches = buildCompetitionClubMatches(room, 'alpha', 'league-a');
  assert.equal(matches.length, 2, 'a agenda duplicada nao deve duplicar jogos');
  assert.deepEqual(matches.map((match) => match.id), ['fixture-1', 'fixture-2']);
  assert.deepEqual(matches[0].score, [2, 1]);
  assert.equal(matches[0].completed, true);
  assert.equal(matches[0].homeName, 'Alpha FC');
  assert.equal(matches[1].completed, false);
  assert.deepEqual(buildCompetitionClubMatches(room, 'beta', 'league-a').map((match) => match.id), ['fixture-1']);
  assert.deepEqual(buildCompetitionClubMatches(room, 'alp', 'league-a').map((match) => match.id), ['fixture-1', 'fixture-2']);
  assert.deepEqual(buildCompetitionClubMatches(room, 'alpha', 'league-b'), []);
});

test('perfil resolve somente por playerId e inclui listingId na oferta real', () => {
  const first = { id: 'player-1', name: 'Nome Repetido' };
  const second = { id: 'PLAYER-2', name: 'Nome Repetido' };
  assert.equal(resolveRankingProfilePlayer(' player-2 ', [first, second]), second);
  assert.equal(resolveRankingProfilePlayer('Nome Repetido', [first, second]), null);
  assert.equal(resolveRankingProfilePlayer('missing-player', [first, second]), null);

  const listing = {
    id: 'listing-open',
    mode: 'direct',
    dealType: 'transfer',
    status: 'open',
    player: { id: 'player-1', value: 15_000_000 },
    askingPrice: 18_000_000,
    canOffer: true,
  };
  assert.equal(openListingForPlayer({ listings: [listing] }, 'PLAYER-1'), listing);
  assert.equal(openListingForPlayer({ listings: [listing] }, 'player-2'), null);

  const payload = buildPlayerProfileOfferInput({
    playerId: 'player-1',
    requestedType: 'loan',
    amount: 12_000_000,
    purchaseOption: 20_000_000,
    listing,
  });
  assert.deepEqual(payload, {
    playerId: 'player-1',
    listingId: 'listing-open',
    dealType: 'transfer',
    amount: 12_000_000,
    noticeApproval: true,
  });

  const offerState = buildPlayerProfileOfferState({
    marketConfigured: true,
    snapshotAvailable: true,
    loading: false,
    syncing: false,
    pending: true,
    marketError: null,
    actionError: null,
    blockedReason: null,
    listing,
  });
  assert.deepEqual(offerState, {
    available: true,
    loading: false,
    syncing: false,
    pending: true,
    error: null,
    blockedReason: null,
    listingId: 'listing-open',
    listingMode: 'direct',
    dealType: 'transfer',
    suggestedAmount: 18_000_000,
  });
  assert.equal(buildPlayerProfileOfferState({
    marketConfigured: true,
    snapshotAvailable: true,
    loading: false,
    syncing: false,
    pending: false,
    marketError: null,
    actionError: null,
    blockedReason: 'Já existe uma proposta ativa.',
    listing,
  }).available, false);
});

test('fontes usam host unico, estado real de oferta e nenhuma acao ou dado demo', async () => {
  const [competitionsSource, rankingsSource, clubPageSource, hostSource, modelSource, playerProfileSource, serviceSource, squadSource, tacticsSource, marketSource] = await Promise.all([
    readFile(path.join(projectRoot, 'src/views/season/CompetitionsView.tsx'), 'utf8'),
    readFile(path.join(projectRoot, 'src/views/season/RankingsView.tsx'), 'utf8'),
    readFile(path.join(projectRoot, 'src/views/season/CompetitionClubPage.tsx'), 'utf8'),
    readFile(path.join(projectRoot, 'src/components/player/PlayerProfileHost.tsx'), 'utf8'),
    readFile(path.join(projectRoot, 'src/components/player/playerProfileModel.ts'), 'utf8'),
    readFile(path.join(projectRoot, 'src/components/rankings/RankingEntityProfiles.tsx'), 'utf8'),
    readFile(path.join(projectRoot, 'src/services/competitionClubService.ts'), 'utf8'),
    readFile(path.join(projectRoot, 'src/views/SquadView.tsx'), 'utf8'),
    readFile(path.join(projectRoot, 'src/views/TacticsView.tsx'), 'utf8'),
    readFile(path.join(projectRoot, 'src/views/club/MarketView.tsx'), 'utf8'),
  ]);

  assert.match(competitionsSource, /onClubSelect\(team, row\.position, event\.currentTarget\)/);
  assert.match(competitionsSource, /const \[selectedClub, setSelectedClub\] = useState/);
  assert.match(competitionsSource, /buildCompetitionClubMatches\(room, selectedClub\.club\.id, selectedClub\.competitionId\)/);
  assert.match(competitionsSource, /<CompetitionClubPage[\s\S]*onBack=\{closeClubDetails\}/);
  assert.match(competitionsSource, /<PlayerProfileHost/);
  assert.match(competitionsSource, /onPlayerSelect=\{setSelectedPlayerId\}/);
  assert.match(competitionsSource, /publicSnapshot=\{selectedPublicSnapshot\}/);
  assert.match(competitionsSource, /roomCode=\{room\?\.code\}/);
  assert.match(competitionsSource, /event\.key !== 'Escape'/);
  assert.match(competitionsSource, /returnFocusRef\.current\?\.focus\(\{ preventScroll: true \}\)/);

  assert.match(clubPageSource, /usePlayerCatalog\(playerCatalogClub, roomCode\)/);
  assert.match(clubPageSource, /loadCompetitionClubDetail\(/);
  assert.match(clubPageSource, /players: playerCatalog\.players/);
  assert.match(clubPageSource, /onPlayerSelect\(member\.player\.id\)/);
  assert.doesNotMatch(clubPageSource, /CompetitionPlayerProfile/);
  assert.match(clubPageSource, /Tática indisponível/);
  assert.doesNotMatch(clubPageSource, /Últimas formações/);
  assert.match(clubPageSource, /type CompetitionClubTab = 'overview' \| 'squad' \| 'tactics' \| 'calendar' \| 'information'/);
  assert.match(clubPageSource, /tactical\.formation/);
  assert.match(clubPageSource, /Object\.entries\(tactical\.sectors\)/);
  assert.match(clubPageSource, /tactical\.dangerousPlayers\.map/);
  assert.match(clubPageSource, /tactical\.strengths\.map/);
  assert.match(clubPageSource, /tactical\.weaknesses\.map/);
  assert.match(clubPageSource, /tactical\.recommendations\.map/);

  assert.match(rankingsSource, /CompetitionClubPage/);
  assert.match(rankingsSource, /<CompetitionClubPage[\s\S]*originLabel="Rankings"/);
  assert.match(rankingsSource, /<PlayerProfileHost/);
  assert.match(rankingsSource, /publicSnapshot=\{selectedClub\}/);
  assert.doesNotMatch(rankingsSource, /<RankingClubDetail/);

  for (const source of [squadSource, tacticsSource, marketSource]) {
    assert.match(source, /<PlayerProfileHost/);
    assert.doesNotMatch(source, /<PlayerModal/);
  }
  assert.match(tacticsSource, /profilePlayersFromLocalRoster/);
  assert.match(marketSource, /profilePlayerFromMarketSummary/);
  assert.match(marketSource, /MarketPlayerIdentity/);

  assert.match(modelSource, /listingId: listing\.id/);
  assert.match(hostSource, /blockedReason/);
  assert.match(hostSource, /pending: market\.pendingAction === `offer:/);
  assert.match(playerProfileSource, /offerDisabled/);
  assert.match(playerProfileSource, /offerStatusLabel/);
  assert.match(playerProfileSource, /Observação indisponível/);
  assert.match(playerProfileSource, /Interesse indisponível/);
  assert.match(playerProfileSource, /Contato indisponível/);
  assert.doesNotMatch(playerProfileSource, /localStorage/);

  for (const forbidden of ['generateSquad', 'mock-player', 'loadMock', 'abortableDelay', 'setTimeout', 'allowGeneratedFallback', 'buildTacticalIntel']) {
    assert.equal(serviceSource.includes(forbidden), false, `${forbidden} não deve existir no serviço de produção`);
  }
});
