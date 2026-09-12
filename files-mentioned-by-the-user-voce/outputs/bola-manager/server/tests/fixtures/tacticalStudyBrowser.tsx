import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthContext, type AuthContextValue } from '../../../src/auth/AuthContext';
import { CompetitionClubPage, type CompetitionClubTab } from '../../../src/views/season/CompetitionClubPage';
import type { CompetitionClubIdentity, CompetitionClubMatch } from '../../../src/services/competitionClubService';
import '../../../src/styles.css';
import '../../../src/styles/tactics.css';
import '../../../src/styles/season.css';
import '../../../src/styles/responsive.css';

const auth = { status: 'authenticated', identity: { uid: 'uid-owner', mode: 'firebase', displayName: 'Teste' },
  getIdToken: async () => 'owner-token' } as AuthContextValue;
const clubs: CompetitionClubIdentity[] = ['OPP', 'OTHER'].map((id) => ({ id, name: 'Clube ' + id, code: id,
  color: '#70ca9d', country: 'Brasil', division: 'Série A', reputation: 50, stadium: 'Estádio de teste', capacity: 10000,
  city: 'Cidade de teste', budget: 0, darkThemeColor: null, lightThemeColor: null, crestImageUrl: null,
}));
const fixtures: CompetitionClubMatch[] = [];
function App() {
  const [clubIndex, setClubIndex] = useState(0);
  const [tab, setTab] = useState<CompetitionClubTab>('tactics');
  const [revision, setRevision] = useState(1);
  const [playerId, setPlayerId] = useState('');
  async function control(command: string) {
    const response = await fetch('/__study-test/' + command, { method: 'POST' });
    const result = await response.json(); setRevision(result.revision);
  }
  return <AuthContext.Provider value={auth}><main style={{ padding: 24 }}>
    <h1>Estudo tático — sala descartável</h1>
    <nav style={{ display: 'flex', gap: 16, marginBottom: 16 }} aria-label="Controles do teste">
      <button onClick={() => setClubIndex(0)}>Abrir OPP</button><button onClick={() => setClubIndex(1)}>Abrir OTHER</button>
      <button onClick={() => void control('advance')}>Avançar 2 dias</button><button onClick={() => void control('staff')}>Reduzir olheiro</button>
      <button onClick={() => void control('fail')}>Falhar catálogo</button><button onClick={() => void control('restore')}>Restaurar catálogo</button>
    </nav>
    {playerId && <p role="status">Jogador selecionado: {playerId}</p>}
    <CompetitionClubPage club={clubs[clubIndex]} managerClubId="VIEW" roomCode="BOLA-STDY" revision={revision}
      currentSeason={1} competitionName="Liga de teste" position={null} fixtures={fixtures}
      activeTab={tab} onTabChange={setTab} onBack={() => setClubIndex(0)} onPlayerSelect={setPlayerId} />
  </main></AuthContext.Provider>;
}
createRoot(document.getElementById('root')!).render(<App />);
