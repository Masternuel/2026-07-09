import type { LeagueTeam, MatchEvent, NewsItem, Player, PlayerPosition } from '../types';

type Scores = [number, number, number, number, number, number, number, number];

function player(
  id: string,
  name: string,
  number: number,
  position: PlayerPosition,
  age: number,
  value: number,
  scores: Scores,
  options: Partial<Pick<Player, 'status' | 'morale' | 'condition' | 'foot' | 'personality' | 'role' | 'worldStar' | 'isStar'>> = {},
): Player {
  const names = name.split(' ');
  const goalkeeper = position === 'GOL';
  const forca = Math.round((scores[4] * 2 + scores[3]) / 3);
  const resistencia = Math.round((scores[0] + scores[3]) / 2);
  const impulsao = Math.round((scores[0] + scores[4]) / 2);
  return {
    id,
    name,
    shortName: names[names.length - 1],
    isStar: options.isStar ?? false,
    number,
    position,
    role: options.role ?? position,
    age,
    nationality: 'Brasil',
    value,
    wage: Math.round(value * 0.0035),
    condition: options.condition ?? 100,
    morale: options.morale ?? 'Boa',
    status: options.status ?? 'Disponível',
    foot: options.foot ?? 'Direito',
    personality: options.personality ?? 'Profissional',
    worldStar: options.worldStar ?? Math.max(2, Math.round(scores.reduce((sum, score) => sum + score, 0) / 16)),
    attributes: {
      velocidade: scores[0], chute: scores[1], drible: scores[2], nocao: scores[3],
      defesa: scores[4], passe: scores[5], peBom: scores[6], peRuim: scores[7],
      forca, resistencia, impulsao,
      reflexos: goalkeeper ? Math.max(scores[3], scores[4]) : 5,
      posicionamentoGol: goalkeeper ? scores[3] : 5,
      saidaGol: goalkeeper ? Math.round((scores[4] + scores[5]) / 2) : 5,
      penaltis: goalkeeper ? Math.round((scores[3] + scores[6]) / 2) : 5,
    },
  };
}

export const players: Player[] = [
  player('p01', 'Caio Monteiro', 1, 'GOL', 28, 18_500_000, [5, 2, 3, 8, 9, 6, 8, 5], { role: 'Goleiro líbero', morale: 'Excelente', worldStar: 6 }),
  player('p02', 'Rafael Nogueira', 3, 'ZAG', 27, 22_000_000, [6, 3, 4, 8, 9, 7, 8, 5], { role: 'Zagueiro construtor', worldStar: 6 }),
  player('p03', 'Davi Luz', 4, 'ZAG', 24, 28_000_000, [7, 4, 5, 8, 9, 7, 8, 6], { role: 'Zagueiro rápido', morale: 'Excelente', worldStar: 7 }),
  player('p04', 'Renan Freitas', 6, 'LE', 23, 25_500_000, [9, 6, 8, 7, 7, 8, 9, 6], { foot: 'Esquerdo', role: 'Ala apoiador', worldStar: 7 }),
  player('p05', 'Matheus Lima', 2, 'LD', 25, 19_000_000, [8, 5, 7, 7, 8, 7, 8, 6], { role: 'Lateral invertido' }),
  player('p06', 'Diego Alves', 5, 'VOL', 30, 16_000_000, [6, 5, 6, 9, 9, 8, 8, 6], { role: 'Volante âncora', morale: 'Excelente', personality: 'Líder', worldStar: 7 }),
  player('p07', 'Bruno Mendes', 8, 'MC', 26, 31_000_000, [8, 7, 8, 9, 7, 9, 9, 7], { role: 'Meia área a área', worldStar: 8 }),
  player('p08', 'Igor Sampaio', 10, 'MEI', 24, 42_000_000, [8, 8, 9, 9, 4, 10, 9, 7], { role: 'Armador avançado', morale: 'Excelente', worldStar: 9, isStar: true }),
  player('p09', 'Leandro Paiva', 11, 'PE', 22, 35_000_000, [10, 8, 9, 8, 4, 7, 9, 6], { foot: 'Esquerdo', role: 'Ponta invertido', worldStar: 8 }),
  player('p10', 'Felipe Rocha', 9, 'ATA', 27, 38_000_000, [8, 10, 8, 9, 3, 6, 10, 7], { role: 'Atacante completo', morale: 'Excelente', personality: 'Ambicioso', worldStar: 9, isStar: true }),
  player('p11', 'Victor Moura', 7, 'PD', 21, 27_000_000, [9, 8, 9, 7, 4, 8, 9, 6], { foot: 'Esquerdo', role: 'Ponta criativo', worldStar: 7 }),
  player('p12', 'André Castro', 12, 'GOL', 21, 7_500_000, [5, 2, 3, 7, 8, 6, 7, 4], { role: 'Goleiro', condition: 96 }),
  player('p13', 'João Pedro', 14, 'ZAG', 20, 11_000_000, [7, 3, 4, 7, 8, 6, 7, 5], { role: 'Zagueiro', condition: 89 }),
  player('p14', 'Samuel Reis', 15, 'LE', 29, 8_000_000, [7, 5, 6, 7, 7, 7, 8, 6], { foot: 'Esquerdo', role: 'Lateral defensivo', condition: 88 }),
  player('p15', 'Lucas Tavares', 16, 'VOL', 22, 13_500_000, [7, 5, 6, 8, 8, 7, 8, 5], { role: 'Volante marcador', condition: 83, status: 'Cansado' }),
  player('p16', 'Pedro Henrique', 18, 'MC', 19, 16_000_000, [8, 7, 8, 8, 5, 8, 8, 6], { role: 'Meia central', personality: 'Reservado', worldStar: 6 }),
  player('p17', 'Thiago Nunes', 19, 'MEI', 25, 14_000_000, [7, 7, 8, 8, 4, 8, 9, 7], { role: 'Meia ofensivo', condition: 86 }),
  player('p18', 'Gustavo Prado', 20, 'ATA', 20, 19_500_000, [8, 9, 7, 7, 3, 5, 8, 5], { role: 'Avançado móvel', morale: 'Neutra', worldStar: 7 }),
  player('p19', 'Murilo Azevedo', 22, 'PD', 23, 12_000_000, [9, 6, 8, 7, 4, 7, 8, 6], { role: 'Ponta', status: 'Lesionado', condition: 61, morale: 'Baixa' }),
  player('p20', 'Wesley Santana', 23, 'MC', 31, 6_000_000, [6, 6, 6, 8, 7, 8, 8, 7], { role: 'Organizador recuado', status: 'Suspenso', condition: 94 }),
];

export const leagueTable: LeagueTeam[] = [
  { position: 1, name: 'Palmeiras', code: 'PAL', played: 13, wins: 9, draws: 2, losses: 2, goalDifference: 15, points: 29, form: ['V', 'V', 'E', 'V', 'V'], accent: '#17a768' },
  { position: 2, name: 'Aurora FC', code: 'AUR', played: 13, wins: 8, draws: 3, losses: 2, goalDifference: 12, points: 27, form: ['V', 'V', 'V', 'E', 'V'], accent: '#c8ff3d' },
  { position: 3, name: 'Flamengo', code: 'FLA', played: 13, wins: 8, draws: 2, losses: 3, goalDifference: 10, points: 26, form: ['D', 'V', 'V', 'V', 'E'], accent: '#d84545' },
  { position: 4, name: 'Botafogo', code: 'BOT', played: 13, wins: 7, draws: 3, losses: 3, goalDifference: 8, points: 24, form: ['V', 'E', 'D', 'V', 'V'], accent: '#f0f0f0' },
  { position: 5, name: 'Bahia', code: 'BAH', played: 13, wins: 6, draws: 4, losses: 3, goalDifference: 5, points: 22, form: ['V', 'E', 'V', 'D', 'E'], accent: '#3d8cff' },
  { position: 6, name: 'São Paulo', code: 'SAO', played: 13, wins: 6, draws: 3, losses: 4, goalDifference: 4, points: 21, form: ['E', 'V', 'D', 'V', 'E'], accent: '#e8e8e8' },
  { position: 7, name: 'Cruzeiro', code: 'CRU', played: 13, wins: 5, draws: 4, losses: 4, goalDifference: 2, points: 19, form: ['V', 'D', 'E', 'V', 'D'], accent: '#2d61ca' },
  { position: 8, name: 'Fortaleza', code: 'FOR', played: 13, wins: 5, draws: 3, losses: 5, goalDifference: 0, points: 18, form: ['D', 'V', 'E', 'D', 'V'], accent: '#4870d8' },
  { position: 9, name: 'Fluminense', code: 'FLU', played: 13, wins: 4, draws: 4, losses: 5, goalDifference: -2, points: 16, form: ['E', 'D', 'V', 'E', 'D'], accent: '#8b2635' },
  { position: 10, name: 'Santos', code: 'SAN', played: 13, wins: 4, draws: 3, losses: 6, goalDifference: -4, points: 15, form: ['D', 'D', 'V', 'E', 'V'], accent: '#d7d7d7' },
];

export const news: NewsItem[] = [
  { id: 'n1', source: 'Linha de Fundo', sourceType: 'imprensa', time: 'há 18 min', headline: 'Aurora chega ao clássico com o melhor ataque do mês', body: 'A equipe marcou 11 gols nas últimas cinco rodadas e encostou na liderança.', reactions: 284, tag: 'Análise' },
  { id: 'n2', source: 'Aurora FC', sourceType: 'clube', time: 'há 42 min', headline: 'Ingressos esgotados para o duelo no Estádio Boreal', body: 'A torcida ocupará os 36 mil lugares na noite desta quarta-feira.', reactions: 612, tag: 'Clube' },
  { id: 'n3', source: 'Felipe Rocha', sourceType: 'jogador', time: 'há 1 h', headline: '“É jogo para assumir responsabilidade.”', body: 'O camisa 9 falou com a imprensa após o último treino no CT da Alvorada.', reactions: 437, tag: 'Vestiário' },
  { id: 'n4', source: 'Comando Verde', sourceType: 'torcida', time: 'há 2 h', headline: 'Mosaico preparado para empurrar o Aurora', body: 'A organizada promete uma recepção especial na entrada das equipes.', reactions: 793, tag: 'Torcida' },
];

export const matchEvents: MatchEvent[] = [
  { minute: 0, kind: 'whistle', text: 'Rola a bola no Estádio Boreal. Aurora FC e Santos começam o clássico.' },
  { minute: 3, kind: 'info', text: 'Bruno Mendes recebe na esquerda, acelera e cruza para a área.' },
  { minute: 7, kind: 'goal-home', text: 'GOOOOL! Felipe Rocha sobe entre os zagueiros e testa no canto.', score: [1, 0] },
  { minute: 14, kind: 'chance', text: 'Igor Sampaio acha Victor Moura livre. O chute passa raspando a trave.' },
  { minute: 23, kind: 'chance', text: 'Falta perigosa para o Santos na meia-lua. Caio organiza a barreira.' },
  { minute: 31, kind: 'info', text: 'Aurora controla a posse e alterna o corredor com muita paciência.' },
  { minute: 38, kind: 'card', text: 'Cartão amarelo para Diego Alves após entrada dura no meio-campo.' },
  { minute: 45, kind: 'whistle', text: 'Fim do primeiro tempo. O Aurora leva a vantagem para o intervalo.' },
  { minute: 52, kind: 'chance', text: 'DEFESAÇA! Caio Monteiro espalma finalização à queima-roupa.' },
  { minute: 58, kind: 'injury', text: 'Pedro Henrique sente a coxa no aquecimento. O banco fica em alerta.' },
  { minute: 63, kind: 'sub', text: 'SUBSTITUIÇÃO: sai Victor Moura, entra Thiago Nunes.' },
  { minute: 71, kind: 'goal-away', text: 'Gol do Santos. Após escanteio, a bola sobra e o chute desvia na zaga.', score: [1, 1] },
  { minute: 77, kind: 'chance', text: 'NA TRAVE! Felipe recebe de Igor e acerta o poste esquerdo.' },
  { minute: 84, kind: 'goal-home', text: 'GOOOOL! Leandro Paiva corta para dentro e acerta o ângulo. Que golaço!', score: [2, 1] },
  { minute: 90, kind: 'whistle', text: 'APITO FINAL! Vitória do Aurora no clássico: 2 a 1.' },
];

export const upcomingFixtures = [
  { date: '16 JUL', competition: 'Brasileirão · Rodada 1', home: 'Aurora FC', away: 'Santos', venue: 'Estádio Boreal', time: '21:30', kind: 'home' },
  { date: '20 JUL', competition: 'Brasileirão · Rodada 2', home: 'Fluminense', away: 'Aurora FC', venue: 'Maracanã', time: '18:30', kind: 'away' },
  { date: '24 JUL', competition: 'Copa do Brasil · Oitavas', home: 'Aurora FC', away: 'Fortaleza', venue: 'Estádio Boreal', time: '20:00', kind: 'cup' },
  { date: '28 JUL', competition: 'Brasileirão · Rodada 3', home: 'Aurora FC', away: 'Bahia', venue: 'Estádio Boreal', time: '16:00', kind: 'home' },
];
