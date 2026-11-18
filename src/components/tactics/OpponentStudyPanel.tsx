import { Button } from '../shared/Button';
import type { OpponentStudyController } from '../../hooks/useOpponentStudy';

const depthLabel = { none: 'Sem conhecimento', quick: 'Rápido', standard: 'Padrão', deep: 'Profundo' };
const tacticLabel: Record<string, string> = {
  cautious: 'Cautelosa', balanced: 'Equilibrada', positive: 'Positiva', attacking: 'Ofensiva', defensive: 'Defensiva',
  zonal: 'Por zona', mixed: 'Mista', 'man-to-man': 'Individual', passive: 'Passiva', moderate: 'Moderada', intense: 'Intensa', aggressive: 'Agressiva',
};
export function OpponentStudyPanel({ controller, onPlayerSelect }: {
  controller: OpponentStudyController; onPlayerSelect?: (id: string) => void;
}) {
  const { study, loading, pending, error, depth, setDepth, refresh, start } = controller;
  return <section className="assistant-note opponent-study" aria-label="Estudo tático do clube"><div>
    <h3>Estudo de {study?.opponentName ?? 'adversário'}</h3>
    <div className="opponent-study__depth" aria-label="Profundidade do estudo">
      {(['quick', 'standard', 'deep'] as const).map((value) => <button key={value} type="button" disabled={pending} aria-pressed={value === depth} onClick={() => setDepth(value)}>{depthLabel[value]}</button>)}
    </div>
    {loading && <p role="status">Carregando estudo…</p>}
    {error && <p role="alert">{error}</p>}
    {!loading && !study && !error && <p>Sem adversário disponível para análise.</p>}
    {study && !loading && <>
      <p>Olheiro/analista: nível {study.scoutLevel}/5 · {depthLabel[study.effectiveDepth]} · confiança {study.confidence}%</p>
      {study.dataStatus === 'partial' && <p role="status">Elenco disponível incompleto. Análise parcial, com confiança reduzida.</p>}
      {study.knowledge.status === 'unknown' && <p>Nenhuma análise registrada. Solicite um estudo para ampliar o conhecimento.</p>}
      {study.knowledge.status === 'expired' && <p>Relatório desatualizado. Solicite uma nova observação.</p>}
      {study.knowledge.status === 'studying' && <p role="status">Análise em andamento: {study.knowledge.progress}% · conclusão {new Date(study.knowledge.readyAt!).toLocaleString('pt-BR', { timeZone: 'UTC' })} no calendário da carreira.</p>}
      <p>Tempo estimado: {study.estimatedStudyHours.toFixed(1)} horas da carreira. Estudos padrão exigem nível 2; detalhes profundos, nível 4.</p>
      <p><b>Formação provável: {study.probableFormation ?? 'Ainda desconhecida'}</b> · {study.style ?? 'Estilo ainda desconhecido'}</p>
      {study.effectiveDepth !== 'none' && <p>{study.source === 'observed' ? 'Leitura de informações táticas públicas.' : 'Estimativa pelo elenco conhecido; não revela o plano secreto.'}</p>}
      {study.mentality && <p>Mentalidade: {tacticLabel[study.mentality] ?? study.mentality}</p>}
      {study.pressing && <p>Pressão: {tacticLabel[study.pressing] ?? study.pressing}</p>}
      {study.marking && <p>Marcação: {tacticLabel[study.marking] ?? study.marking}</p>}
      {study.probableLineup.length > 0 && <div className="opponent-study__section"><b>Onze provável</b><span>{study.probableLineup.map((player) => `${player.name} (${player.position})`).join(' · ')}</span></div>}
      {study.dangerousPlayers.length > 0 && <div className="opponent-study__section"><b>Jogadores-chave</b>{study.dangerousPlayers.map((player) => onPlayerSelect ? <button type="button" key={player.id} onClick={() => onPlayerSelect(player.id)}>{player.name} · {player.position}</button> : <span key={player.id}>{player.name} · {player.position}</span>)}</div>}
      {study.sectors.length > 0 && <div className="opponent-study__sectors">{study.sectors.map((sector) => <span key={sector.key} data-level={sector.level}>{sector.label} <b>{sector.rating}/20</b></span>)}</div>}
      {([['Pontos fortes', study.strengths], ['Vulnerabilidades', study.weaknesses], ['Recomendações', study.recommendations]] as const).map(([label, items]) => items.length > 0 && <div key={label} className="opponent-study__section"><b>{label}</b><ul>{items.map((item) => <li key={item.code}>{item.detail}</li>)}</ul></div>)}
    </>}
    <div className="opponent-study__depth">
      <Button size="sm" disabled={!study || loading || pending || study.knowledge.status === 'known'} onClick={() => void start()}>{pending ? 'Salvando…' : 'Solicitar estudo'}</Button>
      <Button size="sm" variant="ghost" disabled={loading || pending} onClick={() => void refresh()}>Atualizar estudo</Button>
    </div>
  </div></section>;
}
