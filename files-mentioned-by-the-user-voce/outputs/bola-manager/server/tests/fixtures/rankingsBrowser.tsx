import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthContext, type AuthContextValue } from '../../../src/auth/AuthContext';
import { RankingsView } from '../../../src/views/season/RankingsView';
import type { ClubChoice, Player, Room } from '../../../src/types';
import { room, clubs, players } from './rankingsBrowserData.mjs';
import '../../../src/styles.css';
import '../../../src/styles/season.css';
import '../../../src/styles/rankings.css';
import '../../../src/styles/responsive.css';

const auth = { status: 'authenticated', identity: { uid: 'owner', mode: 'firebase', displayName: 'Teste' },
  getIdToken: async () => 'ranking-test-token' } as AuthContextValue;
function App() {
  const [revision, setRevision] = useState(1);
  const [log, setLog] = useState('');
  async function control(command: string) {
    const response = await fetch('/__rankings-test/' + command, { method: 'POST' });
    setLog(JSON.stringify(await response.json()));
    if (command !== 'query') setRevision((value) => value + 1);
  }
  return <AuthContext.Provider value={auth}><main style={{ padding: 24 }}>
    <h1>Rankings — sala descartável</h1>
    <nav aria-label="Controles do teste" style={{ display: 'flex', gap: 20, margin: '20px 0' }}>
      <button onClick={() => void control('query')}>Ver consulta enviada</button>
      <button onClick={() => void control('fail')}>Simular falha</button>
      <button onClick={() => void control('restore')}>Restaurar serviço</button>
      <button onClick={() => void control('invalid')}>Resposta inválida</button>
    </nav><output>{log}</output>
    <RankingsView room={{ ...room, revision } as unknown as Room} club={clubs[0] as ClubChoice}
      players={players.filter((player) => player.clubId === 'A') as unknown as Player[]} managerId="owner" />
  </main></AuthContext.Provider>;
}
createRoot(document.getElementById('root')!).render(<App />);
