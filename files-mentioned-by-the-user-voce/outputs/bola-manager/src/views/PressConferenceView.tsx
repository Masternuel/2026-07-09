import { useMemo, useState } from 'react';
import { BarChart3, Check, ChevronRight, Mic2, ShieldCheck } from 'lucide-react';
import { Badge } from '../components/shared/Badge';
import { Button } from '../components/shared/Button';
import type { ClubChoice, MatchSideStatistics, ServerMatchFinished } from '../types';

interface PressConferenceViewProps {
  result: ServerMatchFinished | null;
  club: ClubChoice;
  onComplete: () => void;
}

interface PressAnswer {
  id: string;
  tone: 'Confiante' | 'Neutro' | 'Evasivo' | 'Crítico' | 'Elogioso' | 'Provocador';
  text: string;
}

interface PressQuestion {
  id: string;
  journalist: string;
  outlet: string;
  prompt: string;
  answers: PressAnswer[];
}

const EMPTY_STATS: MatchSideStatistics = {
  possession: 50,
  shots: 0,
  shotsOnTarget: 0,
  fouls: 0,
  yellowCards: 0,
  redCards: 0,
  corners: 0,
};

const DEMO_RESULT: ServerMatchFinished = {
  code: 'DEMO',
  id: 'demo-match',
  homeTeam: 'Aurora FC',
  awayTeam: 'Santos',
  score: [2, 1],
  statistics: {
    home: { possession: 57, shots: 16, shotsOnTarget: 7, fouls: 10, yellowCards: 1, redCards: 0, corners: 6 },
    away: { possession: 43, shots: 10, shotsOnTarget: 4, fouls: 11, yellowCards: 2, redCards: 0, corners: 4 },
  },
  skipped: false,
};

function normalize(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('pt-BR');
}

function buildQuestions(result: ServerMatchFinished | null, club: ClubChoice): PressQuestion[] {
  const isAway = result ? normalize(result.awayTeam) === normalize(club.name) : false;
  const ownScore = result ? result.score[isAway ? 1 : 0] : 0;
  const rivalScore = result ? result.score[isAway ? 0 : 1] : 0;
  const ownStats = result?.statistics[isAway ? 'away' : 'home'] ?? EMPTY_STATS;
  const rivalStats = result?.statistics[isAway ? 'home' : 'away'] ?? EMPTY_STATS;
  const rival = result ? (isAway ? result.homeTeam : result.awayTeam) : 'adversário';
  const resultQuestion = ownScore > rivalScore
    ? `Vitória por ${ownScore} a ${rivalScore} sobre o ${rival}. O que mais decidiu a partida?`
    : ownScore < rivalScore
      ? `Derrota por ${ownScore} a ${rivalScore} para o ${rival}. Como você explica o resultado?`
      : `Empate em ${ownScore} a ${rivalScore} com o ${rival}. O resultado foi justo?`;
  const resultAnswers: PressAnswer[] = ownScore > rivalScore ? [
    { id: 'result-confident', tone: 'Confiante', text: 'Controlamos os momentos decisivos e merecemos essa vitória.' },
    { id: 'result-praise', tone: 'Elogioso', text: 'O grupo executou o plano com coragem e muita disciplina.' },
    { id: 'result-neutral', tone: 'Neutro', text: 'Foi um jogo equilibrado, definido nos detalhes.' },
  ] : ownScore < rivalScore ? [
    { id: 'result-critical', tone: 'Crítico', text: 'Cometemos erros que não podemos repetir na próxima rodada.' },
    { id: 'result-neutral', tone: 'Neutro', text: 'Precisamos rever a partida com calma antes de tirar conclusões.' },
    { id: 'result-confident', tone: 'Confiante', text: 'O placar machuca, mas a resposta do elenco virá imediatamente.' },
  ] : [
    { id: 'result-neutral', tone: 'Neutro', text: 'O empate refletiu o equilíbrio visto durante os noventa minutos.' },
    { id: 'result-critical', tone: 'Crítico', text: 'Criamos o suficiente e faltou transformar volume em gols.' },
    { id: 'result-praise', tone: 'Elogioso', text: 'A equipe competiu até o fim e mostrou personalidade.' },
  ];

  const possessionQuestion = ownStats.possession >= 55
    ? `Seu time teve ${ownStats.possession}% de posse, contra ${rivalStats.possession}% do rival. Faltou transformar controle em mais gols?`
    : ownStats.possession <= 45
      ? `A equipe terminou com apenas ${ownStats.possession}% de posse. Jogar sem a bola fazia parte do plano?`
      : `A posse ficou equilibrada em ${ownStats.possession}% a ${rivalStats.possession}%. Como avalia a disputa no meio-campo?`;
  const possessionAnswers: PressAnswer[] = ownStats.possession >= 55 ? [
    { id: 'possession-confident', tone: 'Confiante', text: 'A posse teve propósito; mantivemos o adversário sob pressão.' },
    { id: 'possession-critical', tone: 'Crítico', text: 'Precisamos acelerar mais perto da área e criar chances melhores.' },
    { id: 'possession-evasive', tone: 'Evasivo', text: 'Números isolados não contam toda a história da partida.' },
  ] : ownStats.possession <= 45 ? [
    { id: 'possession-confident', tone: 'Confiante', text: 'Cedemos espaço de forma consciente para atacar em velocidade.' },
    { id: 'possession-critical', tone: 'Crítico', text: 'Recuamos demais e precisamos ter mais coragem com a bola.' },
    { id: 'possession-neutral', tone: 'Neutro', text: 'A estratégia mudou conforme o jogo e o placar pediram.' },
  ] : [
    { id: 'possession-praise', tone: 'Elogioso', text: 'Os dois meios-campos fizeram uma partida intensa e muito tática.' },
    { id: 'possession-confident', tone: 'Confiante', text: 'Fomos superiores nas zonas que realmente importavam.' },
    { id: 'possession-evasive', tone: 'Evasivo', text: 'Prefiro avaliar nossas decisões, não somente a posse.' },
  ];

  const totalCards = ownStats.yellowCards + ownStats.redCards;
  const finalQuestion = totalCards > 0 || ownStats.fouls >= 10
    ? `O ${club.name} cometeu ${ownStats.fouls} faltas e recebeu ${totalCards} cartão(ões). A intensidade passou do limite?`
    : `Foram ${ownStats.shots} finalizações, ${ownStats.shotsOnTarget} no alvo. O ataque entregou o que você esperava?`;
  const finalAnswers: PressAnswer[] = totalCards > 0 || ownStats.fouls >= 10 ? [
    { id: 'discipline-neutral', tone: 'Neutro', text: 'A disputa foi forte, mas vamos analisar cada lance internamente.' },
    { id: 'discipline-critical', tone: 'Crítico', text: 'Precisamos competir com intensidade sem oferecer riscos desnecessários.' },
    { id: 'discipline-provocative', tone: 'Provocador', text: 'Futebol exige contato; nosso time não vai fugir de nenhuma disputa.' },
  ] : [
    { id: 'attack-confident', tone: 'Confiante', text: 'Nossa movimentação criou os espaços que planejamos durante a semana.' },
    { id: 'attack-critical', tone: 'Crítico', text: 'Precisamos acertar mais o alvo e ser frios na última decisão.' },
    { id: 'attack-praise', tone: 'Elogioso', text: 'Os atacantes trabalharam pelo coletivo mesmo quando a chance não apareceu.' },
  ];

  return [
    { id: 'result', journalist: 'Marina Lopes', outlet: 'Linha de Fundo', prompt: resultQuestion, answers: resultAnswers },
    { id: 'possession', journalist: 'Caio Nogueira', outlet: 'Rádio Nacional', prompt: possessionQuestion, answers: possessionAnswers },
    { id: 'performance', journalist: 'Bruna Teles', outlet: 'Futebol Agora', prompt: finalQuestion, answers: finalAnswers },
  ];
}

export function PressConferenceView({ result, club, onComplete }: PressConferenceViewProps) {
  const resolvedResult = result ?? DEMO_RESULT;
  const questions = useMemo(() => buildQuestions(resolvedResult, club), [resolvedResult, club]);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const currentQuestion = questions[questionIndex];
  const isLastQuestion = questionIndex === questions.length - 1;
  const score = resolvedResult.score;

  function confirmAnswer() {
    if (!selectedAnswer) return;
    if (isLastQuestion) {
      onComplete();
      return;
    }
    setQuestionIndex((current) => current + 1);
    setSelectedAnswer(null);
  }

  return (
    <main className="secondary-view press-conference-view view-enter">
      <header className="press-conference-heading">
        <div>
          <p className="eyebrow">COLETIVA PÓS-JOGO</p>
          <h1>Sala de imprensa</h1>
          <p>Suas respostas repercutirão entre elenco, torcida e outros managers.</p>
        </div>
        <Badge tone="warning" dot>Ao vivo</Badge>
      </header>

      <section className="press-score-card" aria-label="Resumo da partida">
        <div className="press-score-team press-score-team--home">
          <strong>{resolvedResult.homeTeam}</strong>
          <span>Mandante</span>
        </div>
        <div className="press-score-result">
          <span>{score[0]}</span>
          <i aria-hidden="true">–</i>
          <span>{score[1]}</span>
          <small>Resultado final</small>
        </div>
        <div className="press-score-team press-score-team--away">
          <strong>{resolvedResult.awayTeam}</strong>
          <span>Visitante</span>
        </div>
        <div className="press-score-meta">
          <span><BarChart3 size={18} aria-hidden="true" /> {resolvedResult.statistics.home.shots} a {resolvedResult.statistics.away.shots} finalizações</span>
          <span><ShieldCheck size={18} aria-hidden="true" /> Coletiva obrigatória</span>
        </div>
      </section>

      <section className="press-interview" aria-labelledby="press-question-title">
        <header className="press-interview-progress">
          <span>Pergunta {questionIndex + 1} de {questions.length}</span>
          <div aria-hidden="true">
            {questions.map((question, index) => <i key={question.id} className={index <= questionIndex ? 'is-active' : ''} />)}
          </div>
        </header>

        <div className="press-journalist">
          <span aria-hidden="true"><Mic2 size={24} /></span>
          <div>
            <strong>{currentQuestion.journalist}</strong>
            <small>{currentQuestion.outlet}</small>
          </div>
        </div>

        <h2 id="press-question-title" aria-live="polite">{currentQuestion.prompt}</h2>

        <fieldset className="press-answers">
          <legend className="sr-only">Escolha sua resposta</legend>
          {currentQuestion.answers.map((answer) => (
            <label key={answer.id} className={selectedAnswer === answer.id ? 'press-answer is-selected' : 'press-answer'}>
              <input
                type="radio"
                name={`answer-${currentQuestion.id}`}
                value={answer.id}
                checked={selectedAnswer === answer.id}
                onChange={() => setSelectedAnswer(answer.id)}
              />
              <span className="press-answer-tone">{answer.tone}</span>
              <strong>{answer.text}</strong>
              <span className="press-answer-check" aria-hidden="true"><Check size={18} /></span>
            </label>
          ))}
        </fieldset>

        <footer className="press-interview-actions">
          <p>{selectedAnswer ? 'Resposta selecionada. Confirme para continuar.' : 'Escolha um tom e uma resposta.'}</p>
          <Button
            variant="primary"
            icon={<ChevronRight size={18} aria-hidden="true" />}
            disabled={!selectedAnswer}
            onClick={confirmAnswer}
          >
            {isLastQuestion ? 'Encerrar coletiva' : 'Confirmar resposta'}
          </Button>
        </footer>
      </section>
    </main>
  );
}
