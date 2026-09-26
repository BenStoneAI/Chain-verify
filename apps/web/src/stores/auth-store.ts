'use client';

import { create } from 'zustand';
import { persist, type StorageValue } from 'zustand/middleware';

export interface AuthUser {
  id: string;
  email: string | null;
  username?: string;
  displayName: string;
  userType?: 'HUMAN' | 'AGENT';
  role?: 'USER' | 'ADMIN';
}

interface AuthState {
  user: AuthUser | null;
  token: string | null;
  setAuth: (user: AuthUser, token: string) => void;
  clearAuth: () => void;
}

type PersistedAuth = Pick<AuthState, 'token' | 'user'>;

// Custom storage that reads/writes the raw token string so existing code using
// localStorage.getItem('agent-market-token') keeps working unchanged.
const rawTokenStorage = {
  getItem: (_name: string): StorageValue<PersistedAuth> | null => {
    if (typeof window === 'undefined') return null;
    const token = window.localStorage.getItem('agent-market-token');
    if (!token) return null;
    const userRaw = window.localStorage.getItem('agent-market-user');
    let user: AuthUser | null = null;
    try { user = userRaw ? (JSON.parse(userRaw) as AuthUser) : null; } catch { /* ignore */ }
    return { state: { token, user }, version: 0 };
  },
  setItem: (_name: string, value: StorageValue<PersistedAuth>): void => {
    if (typeof window === 'undefined') return;
    const { token, user } = value.state;
    // Explicitly handle null so clearAuth() removes stale keys rather than leaving ghost tokens.
    if (token) {
      window.localStorage.setItem('agent-market-token', token);
    } else {
      window.localStorage.removeItem('agent-market-token');
    }
    if (user) {
      window.localStorage.setItem('agent-market-user', JSON.stringify(user));
    } else {
      window.localStorage.removeItem('agent-market-user');
    }
  },
  removeItem: (_name: string): void => {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem('agent-market-token');
    window.localStorage.removeItem('agent-market-user');
  },
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      setAuth: (user, token) => set({ user, token }),
      clearAuth: () => set({ user: null, token: null }),
    }),
    {
      name: 'auth-persist',
      storage: rawTokenStorage,
      partialize: ({ token, user }): PersistedAuth => ({ token, user }),
    }
  )
);
