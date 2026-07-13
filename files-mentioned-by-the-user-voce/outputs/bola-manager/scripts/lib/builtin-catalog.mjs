const LEAGUE_ID = "BR-A";

const CLUB_SEEDS = Object.freeze([
  ["AUR", "Aurora FC", "AUR", "#c8ff3d", "Sao Paulo", "SP", "Estadio Boreal", 16, 72_000_000],
  ["SAN", "Santos", "SAN", "#e7e7e7", "Santos", "SP", "Vila Belmiro", 16, 49_000_000],
  ["PAL", "Palmeiras", "PAL", "#17814b", "Sao Paulo", "SP", "Allianz Parque", 19, 120_000_000],
  ["FLA", "Flamengo", "FLA", "#c92d35", "Rio de Janeiro", "RJ", "Maracana", 19, 125_000_000],
  ["COR", "Corinthians", "COR", "#e7e7e7", "Sao Paulo", "SP", "Neo Quimica Arena", 18, 95_000_000],
  ["GRE", "Gremio", "GRE", "#4b98cf", "Porto Alegre", "RS", "Arena do Gremio", 17, 75_000_000],
  ["INT", "Internacional", "INT", "#d72f35", "Porto Alegre", "RS", "Beira-Rio", 17, 78_000_000],
  ["CRU", "Cruzeiro", "CRU", "#2d61ca", "Belo Horizonte", "MG", "Mineirao", 17, 80_000_000],
  ["FLU", "Fluminense", "FLU", "#8b2635", "Rio de Janeiro", "RJ", "Maracana", 17, 82_000_000],
  ["BOT", "Botafogo", "BOT", "#d7d7d7", "Rio de Janeiro", "RJ", "Nilton Santos", 17, 76_000_000],
  ["BAH", "Bahia", "BAH", "#2d87e5", "Salvador", "BA", "Arena Fonte Nova", 15, 57_000_000],
  ["FOR", "Fortaleza", "FOR", "#4678e9", "Fortaleza", "CE", "Castelao", 15, 44_000_000],
  ["CAM", "Atletico-MG", "CAM", "#262626", "Belo Horizonte", "MG", "Arena MRV", 18, 100_000_000],
  ["CAP", "Athletico-PR", "CAP", "#d8292f", "Curitiba", "PR", "Joaquim Americo", 16, 68_000_000],
  ["VAS", "Vasco", "VAS", "#ededed", "Rio de Janeiro", "RJ", "Sao Januario", 16, 70_000_000],
  ["SAO", "Sao Paulo", "SAO", "#d12b35", "Sao Paulo", "SP", "Morumbi", 18, 105_000_000],
]);

// Atributos seguem a escala visual 1-10 da base demo e sao convertidos para 1-20.
const PLAYER_SEEDS = Object.freeze([
  ["p01", "Caio Monteiro", 1, "GOL", 28, 18_500_000, [5, 2, 3, 8, 9, 6, 8, 5], false, 6],
  ["p02", "Rafael Nogueira", 3, "ZAG", 27, 22_000_000, [6, 3, 4, 8, 9, 7, 8, 5], false, 6],
  ["p03", "Davi Luz", 4, "ZAG", 24, 28_000_000, [7, 4, 5, 8, 9, 7, 8, 6], false, 7],
  ["p04", "Renan Freitas", 6, "LE", 23, 25_500_000, [9, 6, 8, 7, 7, 8, 9, 6], false, 7],
  ["p05", "Matheus Lima", 2, "LD", 25, 19_000_000, [8, 5, 7, 7, 8, 7, 8, 6], false, 6],
  ["p06", "Diego Alves", 5, "VOL", 30, 16_000_000, [6, 5, 6, 9, 9, 8, 8, 6], false, 7],
  ["p07", "Bruno Mendes", 8, "MC", 26, 31_000_000, [8, 7, 8, 9, 7, 9, 9, 7], false, 8],
  ["p08", "Igor Sampaio", 10, "MEI", 24, 42_000_000, [8, 8, 9, 9, 4, 10, 9, 7], true, 9],
  ["p09", "Leandro Paiva", 11, "PE", 22, 35_000_000, [10, 8, 9, 8, 4, 7, 9, 6], false, 8],
  ["p10", "Felipe Rocha", 9, "ATA", 27, 38_000_000, [8, 10, 8, 9, 3, 6, 10, 7], true, 9],
  ["p11", "Victor Moura", 7, "PD", 21, 27_000_000, [9, 8, 9, 7, 4, 8, 9, 6], false, 7],
  ["p12", "Andre Castro", 12, "GOL", 21, 7_500_000, [5, 2, 3, 7, 8, 6, 7, 4], false, 5],
  ["p13", "Joao Pedro", 14, "ZAG", 20, 11_000_000, [7, 3, 4, 7, 8, 6, 7, 5], false, 6],
  ["p14", "Samuel Reis", 15, "LE", 29, 8_000_000, [7, 5, 6, 7, 7, 7, 8, 6], false, 6],
  ["p15", "Lucas Tavares", 16, "VOL", 22, 13_500_000, [7, 5, 6, 8, 8, 7, 8, 5], false, 6],
  ["p16", "Pedro Henrique", 18, "MC", 19, 16_000_000, [8, 7, 8, 8, 5, 8, 8, 6], false, 6],
  ["p17", "Thiago Nunes", 19, "MEI", 25, 14_000_000, [7, 7, 8, 8, 4, 8, 9, 7], false, 6],
  ["p18", "Gustavo Prado", 20, "ATA", 20, 19_500_000, [8, 9, 7, 7, 3, 5, 8, 5], false, 7],
  ["p19", "Murilo Azevedo", 22, "PD", 23, 12_000_000, [9, 6, 8, 7, 4, 7, 8, 6], false, 6],
  ["p20", "Wesley Santana", 23, "MC", 31, 6_000_000, [6, 6, 6, 8, 7, 8, 8, 7], false, 5],
]);

const ATTRIBUTE_KEYS = Object.freeze([
  "velocidade", "chute", "drible", "nocao", "defesa", "passe", "peBom", "peRuim",
]);

function playerRecord([id, name, shirtNumber, position, age, marketValue, scores, isStar, worldStar]) {
  const attributes = Object.fromEntries(ATTRIBUTE_KEYS.map((key, index) => [key, scores[index] * 2]));
  const overall = Math.round(Object.values(attributes).reduce((sum, value) => sum + value, 0) / ATTRIBUTE_KEYS.length);
  return {
    id,
    clubId: "AUR",
    name,
    shortName: name.split(" ").at(-1),
    position,
    age,
    nationality: "Brasil",
    shirtNumber,
    overall,
    attributes,
    isStar,
    worldStar,
    marketValue,
    avatarImageUrl: null,
    avatarImagePath: null,
    active: true,
  };
}

export function buildBuiltinCatalog() {
  return {
    leagues: [{
      id: LEAGUE_ID,
      name: "Brasileirao Serie A",
      country: "Brasil",
      level: 1,
      division: "Serie A",
      active: true,
    }],
    clubs: CLUB_SEEDS.map(([id, name, abbreviation, color, city, state, stadium, reputation, budget]) => ({
      id,
      name,
      abbreviation,
      colors: [color],
      stadium,
      reputation,
      division: "Serie A",
      country: "Brasil",
      state,
      city,
      leagueId: LEAGUE_ID,
      budget,
      crestImageUrl: null,
      crestImagePath: null,
      active: true,
    })),
    players: PLAYER_SEEDS.map(playerRecord),
  };
}
