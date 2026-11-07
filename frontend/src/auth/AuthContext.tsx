import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  deleteAccount as apiDeleteAccount,
  getMe,
  getStoredToken,
  login as apiLogin,
  onUnauthorized,
  register as apiRegister,
  setStoredToken,
  TokenResponse,
  User,
} from '../services/api';

type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, fullName?: string) => Promise<void>;
  logout: () => void;
  deleteAccount: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>(() => (getStoredToken() ? 'loading' : 'anonymous'));
  const [user, setUser] = useState<User | null>(null);

  const logout = useCallback(() => {
    setStoredToken(null);
    setUser(null);
    setStatus('anonymous');
  }, []);

  // Herhangi bir istek 401 dönerse oturumu kapat
  useEffect(() => {
    onUnauthorized(logout);
    return () => onUnauthorized(null);
  }, [logout]);

  // Uygulama açılışında kayıtlı token'ı doğrula
  useEffect(() => {
    if (!getStoredToken()) return;
    let cancelled = false;
    getMe()
      .then((me) => {
        if (cancelled) return;
        setUser(me);
        setStatus('authenticated');
      })
      .catch(() => {
        if (!cancelled) logout();
      });
    return () => {
      cancelled = true;
    };
  }, [logout]);

  const applyToken = useCallback((res: TokenResponse) => {
    setStoredToken(res.access_token);
    setUser(res.user);
    setStatus('authenticated');
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      logout,
      login: async (email, password) => applyToken(await apiLogin(email, password)),
      register: async (email, password, fullName) =>
        applyToken(await apiRegister(email, password, fullName)),
      deleteAccount: async () => {
        await apiDeleteAccount();
        logout();
      },
    }),
    [status, user, logout, applyToken]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth, AuthProvider içinde kullanılmalı');
  return ctx;
}
