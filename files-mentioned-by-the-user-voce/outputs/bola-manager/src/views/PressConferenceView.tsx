import { useMemo, useRef, useState } from 'react';
import { BarChart3, Check, ChevronRight, Mic2, ShieldCheck } from 'lucide-react';
import { Badge } from '../components/shared/Badge';
import { Button } from '../components/shared/Button';
import { selectPressConferencePrompt } from '../data/pressConferenceQuestionBank';
import type {
  ClubChoice,
  MatchSideStatistics,
  PressConferenceAnswerInput,
  PressConferenceSubmissionResponse,
  ServerMatchFinished,
} from '../types';

interface PressConferenceViewProps {
  result: ServerMatchFinished | null;
  club: ClubChoice;
  onSubmit?: (answers: PressConferenceAnswerInput[]) => Promise<PressConferenceSubmissionResponse | void>;
  onComplete: (response?: PressConferenceSubmissionResponse) => void;
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

function normalize(value: unknown) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('pt-BR');
}

function finiteMetric(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : fallback;
}

function safeSideStatistics(value: unknown): MatchSideStatistics {
  const record = value && typeof value === 'object' ? value as Partial<MatchSideStatistics> : {};
  return {
    possession: Math.min(100, finiteMetric(record.possession, EMPTY_STATS.possession)),
    shots: finiteMetric(record.shots, EMPTY_STATS.shots),
    shotsOnTarget: finiteMetric(record.shotsOnTarget, EMPTY_STATS.shotsOnTarget),
    fouls: finiteMetric(record.fouls, EMPTY_STATS.fouls),
    yellowCards: finiteMetric(record.yellowCards, EMPTY_STATS.yellowCards),
    redCards: finiteMetric(record.redCards, EMPTY_STATS.redCards),
    corners: finiteMetric(record.corners, EMPTY_STATS.corners),
  };
}

function safeStatistics(value: unknown) {
  const record = value && typeof value === 'object'
    ? value as { home?: unknown; away?: unknown }
    : {};
  return {
    home: safeSideStatistics(record.home),
    away: safeSideStatistics(record.away),
  };
}

function safeScore(value: unknown): [number, number] {
  if (!Array.isArray(value) || value.length < 2) return [0, 0];
  return [finiteMetric(value[0], 0), finiteMetric(value[1], 0)];
}

function safeTeamName(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

export function buildPressConferenceQuestions(result: ServerMatchFinished | null, club: ClubChoice): PressQuestion[] {
  const isAway = result ? normalize(result.awayTeam) === normalize(club.name) : false;
  const score = safeScore(result?.score);
  const statistics = safeStatistics(result?.statistics);
  const ownScore = score[isAway ? 1 : 0];
  const rivalScore = score[isAway ? 0 : 1];
  const ownStats = statistics[isAway ? 'away' : 'home'];
  const rivalStats = statistics[isAway ? 'home' : 'away'];
  const rival = result
    ? safeTeamName(isAway ? result.homeTeam : result.awayTeam, 'adversário')
    : 'adversário';
  const seed = `${result?.id ?? 'demo'}:${club.id ?? club.name}`;
  const scoreline = ownScore > rivalScore
    ? `uma vitória por ${ownScore} a ${rivalScore}`
    : ownScore < rivalScore
      ? `uma derrota por ${ownScore} a ${rivalScore}`
      : `um empate em ${ownScore} a ${rivalScore}`;
  const sharedPromptValues = {
    club: club.name,
    rival,
    scoreline,
    possession: ownStats.possession,
    rivalPossession: rivalStats.possession,
    shots: ownStats.shots,
    shotsOnTarget: ownStats.shotsOnTarget,
    fouls: ownStats.fouls,
    cards: ownStats.yellowCards + ownStats.redCards,
  };
  const resultQuestion = selectPressConferencePrompt('result', seed, sharedPromptValues);
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

  const possessionQuestion = selectPressConferencePrompt('possession', seed, sharedPromptValues);
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
  const finalQuestion = selectPressConferencePrompt('performance', seed, sharedPromptValues);
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

export function PressConferenceView({ result, club, onSubmit, onComplete }: PressConferenceViewProps) {
  const questions = useMemo(() => result ? buildPressConferenceQuestions(result, club) : [], [result, club]);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [confirmedAnswers, setConfirmedAnswers] = useState<PressConferenceAnswerInput[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const submitLock = useRef(false);
  if (!result) {
    return (
      <main className="secondary-view press-conference-view view-enter">
        <header className="press-conference-heading">
          <div>
            <p className="eyebrow">COLETIVA PÓS-JOGO</p>
            <h1>Nenhuma coletiva pendente</h1>
            <p>A coletiva aparecerá quando existir um resultado real ainda não respondido.</p>
          </div>
          <Button variant="secondary" onClick={() => onComplete()}>Voltar à central</Button>
        </header>
      </main>
    );
  }
  const resolvedResult = result;
  const currentQuestion = questions[questionIndex];
  const isLastQuestion = questionIndex === questions.length - 1;
  const score = safeScore(resolvedResult.score);
  const statistics = safeStatistics(resolvedResult.statistics);
  const homeTeam = safeTeamName(resolvedResult.homeTeam, 'Mandante');
  const awayTeam = safeTeamName(resolvedResult.awayTeam, 'Visitante');

  async function confirmAnswer() {
    if (!selectedAnswer || submitting || submitLock.current) return;
    const answer = { questionId: currentQuestion.id, answerId: selectedAnswer };
    if (isLastQuestion) {
      const answers = [...confirmedAnswers, answer];
      submitLock.current = true;
      setSubmitting(true);
      setSubmitError(null);
      try {
        const response = await onSubmit?.(answers);
        onComplete(response ?? undefined);
      } catch (error: unknown) {
        setSubmitError(error instanceof Error
          ? error.message
          : 'Não foi possível registrar a coletiva. Tente novamente.');
      } finally {
        submitLock.current = false;
        setSubmitting(false);
      }
      return;
    }
    setConfirmedAnswers((current) => [...current, answer]);
    setQuestionIndex((current) => current + 1);
    setSelectedAnswer(null);
    setSubmitError(null);
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
          <strong>{homeTeam}</strong>
          <span>Mandante</span>
        </div>
        <div className="press-score-result">
          <span>{score[0]}</span>
          <i aria-hidden="true">–</i>
          <span>{score[1]}</span>
          <small>Resultado final</small>
        </div>
        <div className="press-score-team press-score-team--away">
          <strong>{awayTeam}</strong>
          <span>Visitante</span>
        </div>
        <div className="press-score-meta">
          <span><BarChart3 size={18} aria-hidden="true" /> {statistics.home.shots} a {statistics.away.shots} finalizações</span>
          <span><ShieldCheck size={18} aria-hidden="true" /> Coletiva obrigatória</span>
        </div>
      </section>

      <section className="press-interview" aria-labelledby="press-question-title" aria-busy={submitting}>
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
                disabled={submitting}
                onChange={() => setSelectedAnswer(answer.id)}
              />
              <span className="press-answer-tone">{answer.tone}</span>
              <strong>{answer.text}</strong>
              <span className="press-answer-check" aria-hidden="true"><Check size={18} /></span>
            </label>
          ))}
        </fieldset>

        {submitError && <p className="press-submit-error" role="alert">{submitError}</p>}

        <footer className="press-interview-actions">
          <p>{submitting
            ? 'Registrando respostas e repercussões…'
            : selectedAnswer
              ? 'Resposta selecionada. Confirme para continuar.'
              : 'Escolha um tom e uma resposta.'}</p>
          <Button
            variant="primary"
            icon={<ChevronRight size={18} aria-hidden="true" />}
            disabled={!selectedAnswer || submitting}
            loading={submitting}
            onClick={() => void confirmAnswer()}
          >
            {submitting ? 'Enviando respostas…' : isLastQuestion ? 'Encerrar coletiva' : 'Confirmar resposta'}
          </Button>
        </footer>
      </section>
    </main>
  );
}
