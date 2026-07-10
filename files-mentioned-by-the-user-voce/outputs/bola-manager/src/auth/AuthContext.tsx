import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { FirebaseError } from 'firebase/app';
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { firebaseAuth, hasFirebaseConfig, initializeFirebaseAnalytics } from '../lib/firebaseClient';
import type { AuthStatus, ManagerIdentity } from '../types';

export interface AuthContextValue {
  status: AuthStatus;
  identity: ManagerIdentity | null;
  error: string | null;
  firebaseConfigured: boolean;
  signInEmail: (email: string, password: string) => Promise<void>;
  createEmailAccount: (email: string, password: string) => Promise<void>;
  signInGoogle: () => Promise<void>;
  startDemo: () => void;
  signOut: () => Promise<void>;
  getIdToken: (forceRefresh?: boolean) => Promise<string | null>;
  clearError: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

function firebaseIdentity(user: User): ManagerIdentity {
  return {
    uid: user.uid,
    displayName: user.displayName || user.email?.split('@')[0] || 'Manager',
    email: user.email,
    photoURL: user.photoURL,
    mode: 'firebase',
  };
}

function authMessage(error: unknown): string {
  if (!(error instanceof FirebaseError)) return 'Não foi possível concluir a autenticação.';
  const messages: Record<string, string> = {
    'auth/email-already-in-use': 'Este e-mail já possui uma conta.',
    'auth/invalid-credential': 'E-mail ou senha inválidos.',
    'auth/invalid-email': 'Informe um e-mail válido.',
    'auth/popup-blocked': 'O navegador bloqueou a janela de login do Google.',
    'auth/popup-closed-by-user': 'A janela de login foi fechada antes da conclusão.',
    'auth/too-many-requests': 'Muitas tentativas. Aguarde alguns minutos e tente novamente.',
    'auth/weak-password': 'A senha precisa ter pelo menos seis caracteres.',
    'auth/network-request-failed': 'Não foi possível acessar o Firebase. Verifique sua conexão.',
    'auth/operation-not-allowed': 'Este método de login ainda não foi habilitado no Firebase.',
  };
  return messages[error.code] ?? 'Falha ao autenticar no Firebase.';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [demoIdentity, setDemoIdentity] = useState<ManagerIdentity | null>(null);
  const [loading, setLoading] = useState(Boolean(firebaseAuth));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void initializeFirebaseAnalytics();
    if (!firebaseAuth) {
      setLoading(false);
      return;
    }
    return onAuthStateChanged(firebaseAuth, (user) => {
      setFirebaseUser(user);
      setLoading(false);
    }, (nextError) => {
      setError(authMessage(nextError));
      setLoading(false);
    });
  }, []);

  const runFirebaseAction = useCallback(async (action: () => Promise<void>) => {
    setError(null);
    setDemoIdentity(null);
    if (!firebaseAuth) {
      const message = 'A configuração do Firebase não está disponível.';
      setError(message);
      throw new Error(message);
    }
    try {
      await action();
    } catch (nextError) {
      const message = authMessage(nextError);
      setError(message);
      throw new Error(message);
    }
  }, []);

  const signInEmail = useCallback((email: string, password: string) => runFirebaseAction(async () => {
    if (!firebaseAuth) return;
    await signInWithEmailAndPassword(firebaseAuth, email.trim(), password);
  }), [runFirebaseAction]);

  const createEmailAccount = useCallback((email: string, password: string) => runFirebaseAction(async () => {
    if (!firebaseAuth) return;
    const credential = await createUserWithEmailAndPassword(firebaseAuth, email.trim(), password);
    const displayName = email.trim().split('@')[0] || 'Manager';
    await updateProfile(credential.user, { displayName });
    setFirebaseUser(credential.user);
  }), [runFirebaseAction]);

  const signInGoogle = useCallback(() => runFirebaseAction(async () => {
    if (!firebaseAuth) return;
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    await signInWithPopup(firebaseAuth, provider);
  }), [runFirebaseAction]);

  const startDemo = useCallback(() => {
    setError(null);
    setDemoIdentity({
      uid: `demo-${crypto.randomUUID()}`,
      displayName: 'Manager Demo',
      email: null,
      photoURL: null,
      mode: 'demo',
    });
  }, []);

  const signOut = useCallback(async () => {
    setError(null);
    setDemoIdentity(null);
    if (firebaseAuth?.currentUser) await firebaseSignOut(firebaseAuth);
  }, []);

  const getIdToken = useCallback(async (forceRefresh = false) => {
    if (demoIdentity) return null;
    return firebaseAuth?.currentUser ? firebaseAuth.currentUser.getIdToken(forceRefresh) : null;
  }, [demoIdentity]);

  const identity = demoIdentity ?? (firebaseUser ? firebaseIdentity(firebaseUser) : null);
  const status: AuthStatus = loading && !demoIdentity ? 'loading' : identity ? 'authenticated' : 'anonymous';
  const value = useMemo<AuthContextValue>(() => ({
    status,
    identity,
    error,
    firebaseConfigured: hasFirebaseConfig,
    signInEmail,
    createEmailAccount,
    signInGoogle,
    startDemo,
    signOut,
    getIdToken,
    clearError: () => setError(null),
  }), [status, identity, error, signInEmail, createEmailAccount, signInGoogle, startDemo, signOut, getIdToken]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
