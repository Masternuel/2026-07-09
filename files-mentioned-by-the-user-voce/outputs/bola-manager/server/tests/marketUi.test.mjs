import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import reactPlugin from "@vitejs/plugin-react";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const hookId = "\0market-ui-test-hook";
const authHookId = "\0finance-ui-test-auth-hook";
const starImpactHookId = "\0finance-ui-test-star-impact-hook";

const marketTestPlugin = {
  name: "market-ui-test",
  enforce: "pre",
  resolveId(source, importer) {
    if (
      source === "../../hooks/useMarket"
      && ["/src/views/club/MarketView.tsx", "/src/views/club/FinanceView.tsx"]
        .some((suffix) => importer?.replaceAll("\\", "/").endsWith(suffix))
    ) return hookId;
    if (source === "../../hooks/useAuth" && importer?.replaceAll("\\", "/").endsWith("/src/views/club/FinanceView.tsx")) {
      return authHookId;
    }
    if (source === "../../hooks/useStarImpact" && importer?.replaceAll("\\", "/").endsWith("/src/views/club/FinanceView.tsx")) {
      return starImpactHookId;
    }
    return null;
  },
  load(id) {
    if (id === hookId) return "export function useMarket() { return globalThis.__MARKET_UI_CONTROLLER__; }";
    if (id === authHookId) return "export function useAuth() { return { identity: null, async getIdToken() { return ''; } }; }";
    if (id === starImpactHookId) return "export function useStarImpact() { return { profile: null, loading: false, error: null }; }";
    return null;
  },
  transform(code, id) {
    if (!id.replaceAll("\\", "/").endsWith("/src/views/club/MarketView.tsx")) return null;
    const withTab = code.replace(
      "const [tab, setTab] = useState<MarketTab>('opportunities');",
      "const [tab, setTab] = useState<MarketTab>(() => (globalThis as any).__MARKET_UI_TAB__ ?? 'opportunities');",
    );
    const withDialog = withTab.replace(
      "const [dialog, setDialog] = useState<MarketDialog>(null);",
      "const [dialog, setDialog] = useState<MarketDialog>(() => (globalThis as any).__MARKET_UI_DIALOG__ ?? null);",
    );
    assert.notEqual(withTab, code, "instrumentacao da aba do Mercado ficou desatualizada");
    assert.notEqual(withDialog, withTab, "instrumentacao do modal do Mercado ficou desatualizada");
    return { code: withDialog, map: null };
  },
};

const club = {
  id: "SAN",
  name: "Santos",
  code: "SAN",
  city: "Santos, SP",
  stars: 4,
  budget: "R$ 80 mi",
  color: "#ffffff",
};

const room = {
  id: "room-market",
  code: "BOLA-MKT",
  name: "Sala Mercado",
  ownerId: "manager-1",
  status: "active",
  activeLeagues: ["BR-A"],
  seasonLength: 1,
  unlimitedSeasons: false,
  currentSeason: 1,
  seasonYear: 2026,
  seasonStartedAt: "2026-07-01T00:00:00.000Z",
  seasonHistory: [],
  careerCompleted: false,
  maxManagers: 4,
  createdAt: "2026-07-01T00:00:00.000Z",
  startedAt: "2026-07-01T00:00:00.000Z",
  revision: 7,
  managers: [{ id: "manager-1", name: "Emanuel", clubId: "SAN", ready: true, joinedAt: "2026-07-01T00:00:00.000Z" }],
};

function playerSummary(id, name, clubId = "PAL", clubName = "Palmeiras") {
  return {
    id,
    name,
    position: "ATA",
    age: 24,
    overall: 16,
    value: 20_000_000,
    clubId,
    clubName,
    isStar: false,
    avatarImageUrl: null,
  };
}

function rosterPlayer(id, name) {
  return {
    id,
    name,
    shortName: name,
    isStar: false,
    number: 9,
    position: "ATA",
    role: "Atacante",
    age: 24,
    nationality: "Brasil",
    value: 20_000_000,
    wage: 100_000,
    condition: 100,
    morale: "Boa",
    status: "Disponivel",
    foot: "Direito",
    personality: "Profissional",
    worldStar: 1,
    attributes: {
      velocidade: 14, chute: 16, drible: 14, nocao: 15, defesa: 6, passe: 12, peBom: 15, peRuim: 8,
      forca: 13, resistencia: 14, impulsao: 12, reflexos: 5, posicionamentoGol: 5, saidaGol: 5, penaltis: 10,
    },
    avatarImageUrl: null,
  };
}

const directListing = {
  id: "listing-direct",
  mode: "direct",
  dealType: "transfer",
  status: "open",
  player: playerSummary("EXT-1", "Alvaro Oferta"),
  sellerClubId: "PAL",
  sellerClubName: "Palmeiras",
  askingPrice: 18_000_000,
  minimumBid: null,
  currentBid: null,
  bidCount: 0,
  expiresAt: "2026-07-20T12:00:00.000Z",
  ownListing: false,
  canBid: false,
  canOffer: true,
};

const auctionListing = {
  ...directListing,
  id: "listing-auction",
  mode: "auction",
  player: playerSummary("EXT-2", "Bruno Leilao", "FLA", "Flamengo"),
  sellerClubId: "FLA",
  sellerClubName: "Flamengo",
  askingPrice: null,
  minimumBid: 12_000_000,
  currentBid: 14_000_000,
  bidCount: 3,
  canBid: true,
  canOffer: false,
};

const loanListing = {
  ...directListing,
  id: "listing-loan",
  dealType: "loan",
  player: playerSummary("EXT-3", "Carlos Emprestimo", "BOT", "Botafogo"),
  sellerClubId: "BOT",
  sellerClubName: "Botafogo",
  askingPrice: 2_000_000,
  loanTerms: { fee: 2_000_000, wageSharePercent: 50, durationRounds: 12, purchaseOption: 25_000_000 },
};

const incomingOffer = {
  id: "offer-incoming",
  listingId: null,
  player: playerSummary("OWN-1", "Joao Proposta", "SAN", "Santos"),
  buyerClubId: "FLA",
  buyerClubName: "Flamengo",
  sellerClubId: "SAN",
  sellerClubName: "Santos",
  dealType: "transfer",
  amount: 22_000_000,
  counterAmount: null,
  status: "pending",
  direction: "incoming",
  permissions: { accept: true, reject: true, counter: true, cancel: false },
  createdAt: "2026-07-18T10:00:00.000Z",
};

const borrowedSummary = playerSummary("OWN-2", "Matheus Emprestado", "PAL", "Palmeiras");

const snapshot = {
  revision: 11,
  serverTime: "2026-07-18T12:00:00.000Z",
  finance: {
    clubId: "SAN",
    balance: 100_000_000,
    committed: 20_000_000,
    available: 80_000_000,
    cashAvailable: 80_000_000,
    transferBudget: 60_000_000,
    transferAvailable: 55_000_000,
  },
  listings: [directListing, auctionListing, loanListing],
  candidates: [playerSummary("EXT-4", "Diego Candidato", "COR", "Corinthians")],
  offers: [incomingOffer],
  activeLoans: [{
    id: "loan-active",
    player: borrowedSummary,
    lenderClubId: "PAL",
    lenderClubName: "Palmeiras",
    borrowerClubId: "SAN",
    borrowerClubName: "Santos",
    fee: 1_500_000,
    wage: 100_000,
    wageSharePercent: 60,
    purchaseOption: 30_000_000,
    remainingRounds: 8,
    startedAt: "2026-07-10T00:00:00.000Z",
  }],
  transactions: [{
    id: "transaction-1",
    player: playerSummary("OLD-1", "Pedro Vendido", "SAN", "Santos"),
    dealType: "transfer",
    fromClubId: "SAN",
    fromClubName: "Santos",
    toClubId: "CRU",
    toClubName: "Cruzeiro",
    amount: 15_000_000,
    status: "completed",
    effectiveSeason: 1,
    completedAt: "2026-07-17T12:00:00.000Z",
  }, {
    id: "transaction-scheduled",
    player: playerSummary("NEXT-1", "Lucas Futuro", "PAL", "Palmeiras"),
    dealType: "transfer",
    eventType: "transfer-agreement",
    fromClubId: "PAL",
    fromClubName: "Palmeiras",
    toClubId: "SAN",
    toClubName: "Santos",
    amount: 18_000_000,
    status: "scheduled",
    effectiveSeason: 2,
    completedAt: "2026-07-18T12:00:00.000Z",
  }, {
    id: "transaction-cancelled",
    player: playerSummary("CANCEL-1", "Rafael Cancelado", "COR", "Corinthians"),
    dealType: "transfer",
    eventType: "transfer-agreement",
    fromClubId: "COR",
    fromClubName: "Corinthians",
    toClubId: "SAN",
    toClubName: "Santos",
    amount: 12_000_000,
    status: "cancelled",
    effectiveSeason: 2,
    completedAt: "2026-07-18T13:00:00.000Z",
  }],
  activity: [{ id: "activity-1", message: "abriu um leilao", actorName: "Emanuel", createdAt: "2026-07-18T11:55:00.000Z" }],
};

const players = [rosterPlayer("OWN-1", "Joao Proposta"), rosterPlayer("OWN-2", "Matheus Emprestado")];

function controller(overrides = {}) {
  return {
    snapshot,
    loading: false,
    syncing: false,
    pendingAction: null,
    error: null,
    actionError: null,
    async refresh() {},
    async offer() { return { snapshot }; },
    async respond() { return { snapshot }; },
    async list() { return { snapshot }; },
    async bid() { return { snapshot }; },
    async cancelListing() { return { snapshot }; },
    clearActionError() {},
    ...overrides,
  };
}

function plain(value) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function articleContaining(html, name) {
  const articles = html.match(/<article[\s\S]*?<\/article>/g) ?? [];
  const article = articles.find((candidate) => candidate.includes(name));
  assert.ok(article, `card ausente para ${name}`);
  return article;
}

let vite;
let MarketView;
let FinanceView;

before(async () => {
  vite = await createServer({
    root: projectRoot,
    configFile: false,
    plugins: [marketTestPlugin, reactPlugin()],
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ MarketView } = await vite.ssrLoadModule("/src/views/club/MarketView.tsx"));
  ({ FinanceView } = await vite.ssrLoadModule("/src/views/club/FinanceView.tsx"));
});

after(async () => {
  delete globalThis.__MARKET_UI_CONTROLLER__;
  delete globalThis.__MARKET_UI_TAB__;
  delete globalThis.__MARKET_UI_DIALOG__;
  await vite?.close();
});

function renderMarket({ tab = "opportunities", dialog = null, market = controller() } = {}) {
  globalThis.__MARKET_UI_CONTROLLER__ = market;
  globalThis.__MARKET_UI_TAB__ = tab;
  globalThis.__MARKET_UI_DIALOG__ = dialog;
  return renderToStaticMarkup(React.createElement(MarketView, {
    room,
    club,
    players,
    socket: null,
    managerId: "manager-1",
    onRosterChanged() {},
    onToast() {},
  }));
}

function renderFinance({ market, roster }) {
  globalThis.__MARKET_UI_CONTROLLER__ = market;
  return renderToStaticMarkup(React.createElement(FinanceView, {
    room,
    club,
    players: roster,
    socket: null,
    managerId: "manager-1",
    onRosterChanged() {},
    onToast() {},
  }));
}

test("snapshot renderiza financas, candidatos e controles de oferta, leilao e emprestimo", () => {
  const html = plain(renderMarket());
  assert.match(html, /ORCAMENTO DISPONIVEL/i);
  assert.match(html, /R\$[^<]*80[^<]*mi/i);
  assert.match(html, /Alvaro Oferta/);
  assert.match(articleContaining(html, "Alvaro Oferta"), /Fazer oferta/);
  assert.match(articleContaining(html, "Bruno Leilao"), /Dar lance[^<]*3/);
  assert.match(articleContaining(html, "Carlos Emprestimo"), /Emprestimo/);
  assert.match(articleContaining(html, "Diego Candidato"), /Negociacao direta/);
  assert.match(html, /Oportunidades[^<]*<span>4<\/span>/);
});

test("abas mostram negociacoes, elenco proprio e historico do snapshot", () => {
  const negotiations = plain(renderMarket({ tab: "negotiations" }));
  assert.match(negotiations, /Joao Proposta/);
  assert.match(negotiations, /Recebida de Flamengo/);
  assert.match(negotiations, /Pendente/);
  assert.match(negotiations, /Ver negociacao/);

  const squad = plain(renderMarket({ tab: "squad" }));
  assert.match(articleContaining(squad, "Joao Proposta"), /Criar anuncio/);
  const borrowed = articleContaining(squad, "Matheus Emprestado");
  assert.match(borrowed, /Emprestado ao clube/);
  assert.match(borrowed, /disabled=""/);
  assert.match(borrowed, /Nao pode anunciar/);
  assert.doesNotMatch(borrowed, />Criar anuncio<\/button>/);

  const history = plain(renderMarket({ tab: "history" }));
  assert.doesNotMatch(history, /snapshot\?\.activeLoans/);
  assert.match(history, /Emprestimos ativos/);
  assert.match(history, /Matheus Emprestado/);
  assert.match(history, /60% pelo destino/);
  assert.match(history, /Movimentacoes do mercado/);
  assert.match(history, /Pedro Vendido/);
  assert.match(articleContaining(history, "Pedro Vendido"), /Concluida[^<]*Temporada 1/);
  assert.match(articleContaining(history, "Lucas Futuro"), /Transferencia futura/);
  assert.match(articleContaining(history, "Lucas Futuro"), /Agendada[^<]*Temporada 2/);
  assert.match(articleContaining(history, "Rafael Cancelado"), /Cancelada[^<]*Temporada 2/);

  const emptyHistory = plain(renderMarket({
    tab: "history",
    market: controller({ snapshot: { ...snapshot, activeLoans: [], transactions: [] } }),
  }));
  assert.match(emptyHistory, /Historico vazio/);
  assert.doesNotMatch(emptyHistory, /snapshot\?\.activeLoans/);
});

test("modais cobrem lance, proposta de emprestimo, anuncio e resposta", () => {
  const auction = plain(renderMarket({ dialog: { kind: "deal", listing: auctionListing } }));
  assert.match(auction, /Fazer lance/);
  assert.match(auction, /SEU LANCE/);
  assert.match(auction, /Confirmar lance/);
  assert.match(auction, /superar o valor atual/);

  const loan = plain(renderMarket({ dialog: { kind: "deal", listing: loanListing } }));
  assert.match(loan, /TAXA DO EMPRESTIMO/);
  assert.match(loan, /SALARIO PAGO PELO DESTINO/);
  assert.match(loan, /DURACAO/);
  assert.match(loan, /CLAUSULA DE COMPRA/);
  assert.match(loan, /Opcao de compra/);
  assert.match(loan, /Obrigacao de compra/);
  assert.match(loan, /Enviar oferta/);

  const listing = plain(renderMarket({ dialog: { kind: "list", player: snapshot.candidates[0] } }));
  assert.match(listing, /Criar anuncio/);
  assert.match(listing, /TIPO DO NEGOCIO/);
  assert.match(listing, /Transferencia/);
  assert.match(listing, /Emprestimo/);
  assert.match(listing, /Negociacao direta/);
  assert.match(listing, /Leilao/);
  assert.match(listing, /Publicar anuncio/);

  const response = plain(renderMarket({ dialog: { kind: "respond", offer: incomingOffer } }));
  assert.match(response, /Responder negociacao/);
  assert.match(response, /Enviar contraproposta/);
  assert.match(response, /Recusar/);
  assert.match(response, /Aceitar/);
});

test("loading e falha de sincronizacao possuem feedback e recuperacao", () => {
  const loading = plain(renderMarket({ market: controller({ snapshot: null, loading: true }) }));
  assert.match(loading, /Sincronizando mercado/);
  assert.match(loading, /Buscando anuncios, financas e negociacoes/);

  const failed = plain(renderMarket({ market: controller({ snapshot: null, error: "Servidor de mercado indisponivel" }) }));
  assert.match(failed, /role="alert"/);
  assert.match(failed, /Servidor de mercado indisponivel/);
  assert.match(failed, /Tentar novamente/);
  assert.match(failed, /Indisponivel/);
});

test("financas contam somente transacoes concluidas e rateiam salarios de emprestimos", () => {
  const regular = { ...rosterPlayer("PAY-1", "Titular"), wage: 100_000 };
  const borrowed = {
    ...rosterPlayer("PAY-2", "Emprestado recebido"),
    wage: 200_000,
    contract: { clubId: "PAL", wage: 200_000 },
  };
  const financeSnapshot = {
    ...snapshot,
    activeLoans: [{
      id: "loan-in",
      player: playerSummary("PAY-2", "Emprestado recebido", "SAN", "Santos"),
      lenderClubId: "PAL",
      lenderClubName: "Palmeiras",
      borrowerClubId: "SAN",
      borrowerClubName: "Santos",
      fee: 0,
      wage: 200_000,
      wageSharePercent: 25,
      purchaseOption: null,
      remainingRounds: 5,
    }, {
      id: "loan-out",
      player: playerSummary("PAY-3", "Emprestado cedido", "FLA", "Flamengo"),
      lenderClubId: "SAN",
      lenderClubName: "Santos",
      borrowerClubId: "FLA",
      borrowerClubName: "Flamengo",
      fee: 0,
      wage: 120_000,
      wageSharePercent: 60,
      purchaseOption: null,
      remainingRounds: 5,
    }],
    transactions: [{
      ...snapshot.transactions[0],
      id: "expense-completed",
      fromClubId: "PAL",
      toClubId: "SAN",
      amount: 10_000_000,
      status: "completed",
    }, {
      ...snapshot.transactions[0],
      id: "income-completed",
      fromClubId: "SAN",
      toClubId: "PAL",
      amount: 3_000_000,
      status: "completed",
    }, {
      ...snapshot.transactions[0],
      id: "expense-scheduled",
      fromClubId: "PAL",
      toClubId: "SAN",
      amount: 20_000_000,
      status: "scheduled",
    }, {
      ...snapshot.transactions[0],
      id: "income-cancelled",
      fromClubId: "SAN",
      toClubId: "PAL",
      amount: 50_000_000,
      status: "cancelled",
    }, {
      ...snapshot.transactions[0],
      id: "expense-failed",
      fromClubId: "PAL",
      toClubId: "SAN",
      amount: 30_000_000,
      status: "failed",
    }],
  };
  const html = plain(renderFinance({
    market: controller({ snapshot: financeSnapshot }),
    roster: [regular, borrowed],
  }));

  assert.match(html, /RESULTADO DE TRANSFERENCIAS/);
  assert.match(html, /R\$[^<]*7[^<]*mi/);
  assert.match(html, /Negocios concluidos no mercado/);
  assert.match(html, /FOLHA MENSAL TOTAL/);
  assert.match(html, /R\$[^<]*198[^<]*mil/);
  assert.match(html, /3 vinculos/);
});

test("financas diferencia carregamento, falha e caixa realmente zerado", () => {
  const loading = plain(renderFinance({
    market: controller({ snapshot: null, loading: true }),
    roster: [],
  }));
  assert.match(loading, /Sincronizando financas/);
  assert.doesNotMatch(loading, /SALDO EM CAIXA/);

  const failed = plain(renderFinance({
    market: controller({ snapshot: null, error: "Servidor financeiro indisponivel" }),
    roster: [],
  }));
  assert.match(failed, /Financas indisponiveis/);
  assert.match(failed, /Servidor financeiro indisponivel/);
  assert.match(failed, /Tentar novamente/);
  assert.doesNotMatch(failed, /SALDO EM CAIXA/);

  const zero = plain(renderFinance({
    market: controller({
      snapshot: {
        ...snapshot,
        finance: { ...snapshot.finance, balance: 0, committed: 0, cashAvailable: 0 },
      },
    }),
    roster: [],
  }));
  assert.match(zero, /SALDO EM CAIXA/);
  assert.match(zero, /R\$[^<]*0/);
  assert.doesNotMatch(zero, /Dados financeiros nao carregados/);
});

test("infraestrutura usa caixa operacional, nao limite de transferencias", async () => {
  const source = await readFile(path.join(projectRoot, "src/views/club/StadiumView.tsx"), "utf8");
  assert.match(source, /snapshot\?\.finance\.cashAvailable/);
  assert.doesNotMatch(source, /snapshot\?\.finance\.available/);
  assert.match(source, /cashAvailable === null/);
  assert.match(source, /market\.refresh\(\)/);
});
