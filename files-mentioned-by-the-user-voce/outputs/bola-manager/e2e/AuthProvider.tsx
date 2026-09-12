import { useMemo, type ReactNode } from 'react';
import { AuthContext, type AuthContextValue } from '../src/auth/AuthContext';

// Only the E2E build imports this adapter. App/hooks/HTTP/Socket.IO remain real.
export function AuthProvider({ children }: { children: ReactNode }) {
  const value = useMemo<AuthContextValue>(() => ({
    status: 'authenticated',
    identity: { uid: 'uid-owner', displayName: 'Dona da Sala', email: 'owner@example.com', photoURL: null, mode: 'firebase' },
    firebaseConfigured: true, error: null,
    getIdToken: async () => 'owner-token',
    signInEmail: async () => { throw new Error('Login externo fora do escopo E2E'); },
    createEmailAccount: async () => { throw new Error('Cadastro externo fora do escopo E2E'); },
    signInGoogle: async () => { throw new Error('Google externo fora do escopo E2E'); },
    signOut: async () => { throw new Error('Logout externo fora do escopo E2E'); },
    updateDisplayName: async () => { throw new Error('Perfil externo fora do escopo E2E'); },
    startDemo() { throw new Error('E2E não utiliza modo demo'); }, clearError() {},
  }), []);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
