import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthContext, type AuthContextValue } from '../../../src/auth/AuthContext';
import { PlayerProfileHost } from '../../../src/components/player/PlayerProfileHost';
import type { RankingProfilePlayer } from '../../../src/components/rankings/RankingEntityProfiles';
import type { Room } from '../../../src/types';
import '../../../src/styles.css';
import '../../../src/styles/rankings.css';
import '../../../src/styles/responsive.css';

const auth = { identity: { uid: 'uid-owner', mode: 'firebase', displayName: 'Teste' },
  getIdToken: async () => 'owner-token' } as AuthContextValue;
const room = { code: 'BOLA-SCOT', status: 'active', managers: [{ id: 'uid-owner', clubId: 'A' }] } as Room;
const players = [{ id: 'p1', name: 'Jogador de teste', clubId: 'C', clubName: 'Clube visitante',
  clubCode: 'VIS', position: 'ATA', age: 25, nationality: 'BRA', shirtNumber: 9,
  overall: 12, rating: 12, marketValue: 5000000, wage: 45000, goals: 0, assists: 0, appearances: 0,
  contract: { wage: 45000, endSeason: 3 } }] as RankingProfilePlayer[];
function App() {
  const [open, setOpen] = useState(true);
  return <AuthContext.Provider value={auth}><main>
    <h1>Scouting — teste isolado</h1><button onClick={() => setOpen(true)}>Reabrir perfil</button>
    <PlayerProfileHost playerId={open ? 'p1' : null} players={players} room={room}
      managerId="uid-owner" currentClubId="A" onClose={() => setOpen(false)} />
  </main></AuthContext.Provider>;
}
createRoot(document.getElementById('root')!).render(<App />);
