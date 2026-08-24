export type PressQuestionCategory = 'result' | 'possession' | 'performance';

const RESULT_OPENINGS = [
  'Depois de {scoreline} contra {rival},',
  'Ao analisar {scoreline} diante de {rival},',
  'Com o apito final confirmando {scoreline} contra {rival},',
  'O torcedor viu {scoreline} no duelo com {rival};',
  'A rodada terminou com {scoreline} diante de {rival};',
  'No confronto em que tivemos {scoreline} contra {rival},',
  'O vestiário sai de campo após {scoreline} diante de {rival};',
  'A leitura imediata de {scoreline} contra {rival} levanta uma questão:',
  'Depois de noventa minutos e {scoreline} diante de {rival},',
  'Considerando o contexto de {scoreline} contra {rival},',
];

const RESULT_ENDINGS = [
  'qual foi o fator decisivo para o {club}?',
  'o plano de jogo funcionou como você esperava?',
  'qual mensagem você deixa para elenco e torcida?',
  'o que precisa ser mantido ou corrigido para a próxima rodada?',
];

const POSSESSION_OPENINGS = [
  'O {club} terminou com {possession}% de posse, contra {rivalPossession}% de {rival};',
  'A disputa pela bola fechou em {possession}% a {rivalPossession}%;',
  'Seu time controlou a bola em {possession}% do jogo;',
  'Os números apontam {possession}% de posse para o {club};',
  'No meio-campo, a posse ficou em {possession}% contra {rivalPossession}%;',
  'A equipe passou {possession}% da partida com a bola;',
  'Contra {rival}, o {club} registrou {possession}% de posse;',
  'O ritmo da partida produziu {possession}% de posse para sua equipe;',
  'A circulação de bola terminou em {possession}% para o {club};',
  'O controle territorial aparece nos {possession}% de posse do seu time;',
];

const POSSESSION_ENDINGS = [
  'esse controle fez parte do plano original?',
  'a equipe transformou esse volume em perigo suficiente?',
  'como você avalia a atuação do meio-campo?',
  'o que faltou na tomada de decisão com a bola?',
];

const PERFORMANCE_OPENINGS = [
  'O {club} finalizou {shots} vezes, com {shotsOnTarget} chutes no alvo;',
  'A súmula registra {fouls} faltas e {cards} cartões para sua equipe;',
  'Entre criação e disciplina, foram {shots} finalizações e {fouls} faltas;',
  'O desempenho produziu {shotsOnTarget} chutes certos em {shots} tentativas;',
  'A intensidade do {club} resultou em {fouls} faltas e {cards} cartões;',
  'Nos dois lados do campo, o time somou {shots} finalizações e {fouls} faltas;',
  'A eficiência ofensiva foi de {shotsOnTarget} chutes no alvo em {shots} finalizações;',
  'Contra {rival}, sua equipe recebeu {cards} cartões e cometeu {fouls} faltas;',
  'Os números de execução mostram {shots} finalizações e {shotsOnTarget} no alvo;',
  'A atuação coletiva terminou com {shots} chutes, {fouls} faltas e {cards} cartões;',
];

const PERFORMANCE_ENDINGS = [
  'a execução ficou no nível que você cobra?',
  'qual setor mais precisa evoluir antes do próximo jogo?',
  'a intensidade esteve no ponto certo ou passou do limite?',
  'quem merece destaque pela entrega coletiva?',
];

function combine(openings: string[], endings: string[]) {
  return openings.flatMap((opening) => endings.map((ending) => `${opening} ${ending}`));
}

export const PRESS_CONFERENCE_PROMPT_BANK = Object.freeze({
  result: Object.freeze(combine(RESULT_OPENINGS, RESULT_ENDINGS)),
  possession: Object.freeze(combine(POSSESSION_OPENINGS, POSSESSION_ENDINGS)),
  performance: Object.freeze(combine(PERFORMANCE_OPENINGS, PERFORMANCE_ENDINGS)),
});

export const PRESS_CONFERENCE_PROMPT_COUNT = Object.values(PRESS_CONFERENCE_PROMPT_BANK)
  .reduce((total, prompts) => total + prompts.length, 0);

function hashSeed(value: string) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function interpolate(template: string, values: Record<string, string | number>) {
  return template.replace(/\{([a-zA-Z]+)\}/g, (_match, key: string) => String(values[key] ?? ''));
}

export function selectPressConferencePrompt(
  category: PressQuestionCategory,
  seed: string,
  values: Record<string, string | number>,
) {
  const prompts = PRESS_CONFERENCE_PROMPT_BANK[category];
  return interpolate(prompts[hashSeed(`${seed}:${category}`) % prompts.length], values);
}
