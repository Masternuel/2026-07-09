import type { Room } from '../../types';
import { Badge } from '../shared/Badge';
import { formatMetadataCount, formatSaveDate, saveMetadata, summarizeSaves, type SaveCountSummary } from './mainMenuModel';

function aggregateLabel(summary: SaveCountSummary, saveCount: number) {
  if (!saveCount) return '—';
  if (!summary.knownSaves) return 'Não informado';
  return `${summary.total.toLocaleString('pt-BR')}${summary.missingSaves ? ' · parcial' : ''}`;
}

export function HistoryPage({ saves, loading }: { saves: Room[]; loading: boolean }) {
  const summary = summarizeSaves(saves);
  return (
    <section className="menu-history" aria-labelledby="menu-history-title">
      <header className="menu-page-heading"><div><p className="eyebrow">DADOS DISPONÍVEIS</p><h1 id="menu-history-title">Estatísticas / histórico</h1><p>Resumo dos saves disponíveis nesta identidade. Não é um histórico global de conquistas.</p></div><Badge>Metadados dos saves</Badge></header>
      {loading ? <p className="menu-notice" role="status">Consultando o resumo das carreiras…</p> : <>
        <dl className="menu-history__summary"><div><dt>Carreiras disponíveis</dt><dd>{summary.saves}</dd><small>{summary.active} em andamento · {summary.waiting} em preparação · {summary.completed} concluídas</small></div><div><dt>Jogos concluídos</dt><dd>{aggregateLabel(summary.completedFixtures, summary.saves)}</dd><small>Contador de jogos do calendário</small></div><div><dt>Partidas registradas</dt><dd>{aggregateLabel(summary.completedMatches, summary.saves)}</dd><small>Contador de registros de partidas</small></div><div><dt>Históricos de temporada</dt><dd>{aggregateLabel(summary.seasonHistory, summary.saves)}</dd><small>Entradas informadas pelos saves</small></div></dl>
        <p className="menu-notice">Contadores ausentes aparecem como “Não informado”, nunca como zero. Totais parciais somam apenas os saves com dados. Vitórias, títulos e rodadas atuais não estão disponíveis neste resumo.</p>
        {saves.length ? <div className="menu-history__records">{saves.map((room) => {
          const metadata = saveMetadata(room);
          return <article className="menu-history__record" key={room.code}><header><div><h2>{room.name}</h2><p>{room.code} · Atualização: {formatSaveDate(room)}</p></div><Badge tone={metadata.status === 'active' ? 'positive' : metadata.status === 'waiting' ? 'warning' : 'neutral'}>{metadata.statusLabel}</Badge></header><dl><div><dt>Temporada / ano</dt><dd>{metadata.season ?? 'Não informada'} / {metadata.year ?? 'Não informado'}</dd></div><div><dt>Jogos concluídos</dt><dd>{formatMetadataCount(metadata.completedFixtures)}</dd></div><div><dt>Partidas registradas</dt><dd>{formatMetadataCount(metadata.completedMatches)}</dd></div><div><dt>Históricos de temporada</dt><dd>{formatMetadataCount(metadata.seasonHistory)}</dd></div></dl></article>;
        })}</div> : <div className="menu-empty"><h2>Nenhuma carreira para resumir</h2><p>Os metadados aparecerão aqui quando houver um save disponível. Consultar esta página não carrega nem altera carreiras.</p></div>}
      </>}
    </section>
  );
}
