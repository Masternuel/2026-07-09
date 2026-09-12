import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthContext, type AuthContextValue } from '../../../src/auth/AuthContext';
import { Header } from '../../../src/components/layout/Header';
import { RankingTable, type RankingSortDirection } from '../../../src/components/rankings/RankingTable';
import { Modal } from '../../../src/components/shared/Modal';
import { SquadView } from '../../../src/views/SquadView';
import { MatchView } from '../../../src/views/MatchView';
import type { ClubChoice, Player } from '../../../src/types';
import '../../../src/styles.css';
import '../../../src/styles/season.css';
import '../../../src/styles/rankings.css';
import '../../../src/styles/responsive.css';

// Isolated UI fixtures, never connected to a save or external API.
const auth = { status: 'anonymous', identity: null, getIdToken: async () => null } as AuthContextValue;
const club: ClubChoice = { id: 'A', code: 'TES', name: 'Clube de teste', country: 'Brasil',
  city: 'São Paulo', stars: 3, budget: 'R$ 1 mi', color: '#77c99d' };
const players = ['Zulu', 'Alfa'].map((name, index) => ({ id: `p${index}`, name, shortName: name,
  position: index ? 'GOL' : 'ATA', role: index ? 'GOL' : 'ATA', number: index + 1, age: 25,
  nationality: 'BRA', value: 100000, wage: 10000, condition: 100, morale: 'Boa', status: 'Disponível',
  foot: 'Direito', personality: 'Profissional', worldStar: 1, attributes: {},
})) as Player[];
const columns = [{ id: 'name', label: 'Nome', sortable: true, value: (player: Player) => player.name, render: (player: Player) => player.name }];
function App() {
  const [screen, setScreen] = useState('squad');
  const [modal, setModal] = useState(false);
  const [log, setLog] = useState('');
  const [sort, setSort] = useState<{ column: string; direction: RankingSortDirection }>({ column: 'name', direction: 'asc' });
  return <AuthContext.Provider value={auth}><div className="app-shell" style={{ display: 'block', padding: 20 }}>
    <Header route="squad" club={club} manager={{ uid: 'fixture', displayName: 'Teste', mode: 'demo', email: null, photoURL: null }}
      nextFixture={null} onMenu={() => setLog('Menu')} onNavigate={setScreen} lightMode={false} onToggleTheme={() => setLog('Tema')} />
    <nav aria-label="Controles de teste" style={{ display: 'flex', gap: 16, margin: '100px 0 20px' }}>
      <button onClick={() => setScreen('squad')}>Elenco teste</button>
      <button onClick={() => setScreen('tables')}>Tabelas teste</button>
      <button onClick={() => setScreen('match')}>Partida demo teste</button>
      <button onClick={() => setModal(true)}>Abrir diálogo teste</button>
      <label>Outra edição<input aria-label="Outra edição" /></label>
    </nav><output aria-label="Resultado da ação">{log || screen}</output>
    {screen === 'squad' && <SquadView players={players} club={club} room={null} socket={null} managerId="" onToast={setLog} />}
    {screen === 'tables' && <>
      <section aria-label="Resumo estático"><h2>Resumo</h2><RankingTable caption="Resumo" columns={columns} items={players}
        rowKey={(player) => player.id} sort={{ column: 'name', direction: 'asc' }} onRowClick={(player) => setLog(player.name)} /></section>
      <section aria-label="Tabela ordenável"><h2>Tabela completa</h2><RankingTable caption="Tabela completa" columns={columns} items={players}
        rowKey={(player) => player.id} sort={sort} onSortChange={setSort} onRowClick={(player) => setLog(player.name)} /></section>
    </>}
    {screen === 'match' && <MatchView players={players} club={club} room={null} onlineMatch={null} demoMode onToast={setLog} onNavigate={setScreen} />}
    <Modal open={modal} onClose={() => setModal(false)} title="Diálogo teste"><input aria-label="Edição no diálogo" /></Modal>
  </div></AuthContext.Provider>;
}
createRoot(document.getElementById('root')!).render(<App />);
