import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
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

// offline: kayıtlı oturum var ama sunucuya ulaşılamıyor (tekrar deneniyor)
type AuthStatus = 'loading' | 'offline' | 'authenticated' | 'anonymous';

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

  // Uygulama açılışında kayıtlı token'ı doğrula.
  // Yalnızca sunucu oturumu reddederse (401) çıkış yapılır; bağlantı hatasında oturum korunur ve
  // artan aralıklarla tekrar denenir (telefonda internet bir anlığına kesilince kullanıcı atılmasın).
  useEffect(() => {
    if (!getStoredToken()) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;

    const verify = () => {
      getMe()
        .then((me) => {
          if (cancelled) return;
          setUser(me);
          setStatus('authenticated');
        })
        .catch((err) => {
          if (cancelled) return;
          if (axios.isAxiosError(err) && err.response?.status === 401) {
            logout();
            return;
          }
          setStatus('offline');
          attempt += 1;
          timer = setTimeout(verify, Math.min(15_000, 2_000 * attempt));
        });
    };
    verify();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
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
