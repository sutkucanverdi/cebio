import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
  deleteAccount as apiDeleteAccount,
  getMe,
  getStoredToken,
  login as apiLogin,
  onUnauthorized,
  PreferencesPayload,
  register as apiRegister,
  setStoredToken,
  TokenResponse,
  updateMe,
  User,
} from '../services/api';
import { getLang, onLangChange } from '../i18n';
import { initPurchases, logoutPurchases } from '../lib/purchases';

// offline: kayıtlı oturum var ama sunucuya ulaşılamıyor (tekrar deneniyor)
type AuthStatus = 'loading' | 'offline' | 'authenticated' | 'anonymous';

interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, fullName?: string, aiConsent?: boolean) => Promise<void>;
  logout: () => void;
  /** Dil, yapay zeka izni, ad soyad gibi ayarları sunucuya kaydeder. */
  updatePreferences: (payload: PreferencesPayload) => Promise<User>;
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
    void logoutPurchases();
  }, []);

  // Mağaza aboneliği (RevenueCat) kullanıcıyı bizim ID'mizle tanısın
  useEffect(() => {
    if (user) initPurchases(user.id).catch(() => undefined);
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Dil değişince hesaba kaydet (e-postalar ve bildirimler bu dilde gelsin)
  useEffect(
    () =>
      onLangChange((lang) => {
        if (getStoredToken()) updateMe({ locale: lang }).then(setUser).catch(() => undefined);
      }),
    []
  );

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
          // Bu cihazda seçili dil hesaptakinden farklıysa hesabı güncelle
          if (me.locale && me.locale !== getLang()) updateMe({ locale: getLang() }).then(setUser).catch(() => undefined);
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
      register: async (email, password, fullName, aiConsent) =>
        applyToken(await apiRegister(email, password, fullName, aiConsent)),
      updatePreferences: async (payload) => {
        const updated = await updateMe(payload);
        setUser(updated);
        return updated;
      },
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
