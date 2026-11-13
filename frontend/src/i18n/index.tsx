/**
 * Çok dillilik (Türkçe / İngilizce).
 *
 * Kaynak dil Türkçedir: arayüz metinleri kodda Türkçe yazılır ve `t('Türkçe metin')` ile sarılır.
 * İngilizce seçiliyse metin `en.ts` sözlüğünden çevrilir; sözlükte yoksa Türkçe hali gösterilir
 * (eksik çeviri uygulamayı bozmaz, testte yakalanır: i18n.test.ts).
 *
 * Değişkenler: t('{count} ürün', { count: 3 })
 *
 * Dil değişince uygulama ağacı yeniden kurulur (App.tsx'teki `key`), böylece modül seviyesinde
 * `t` çağıran yardımcılar (format, export, bildirimler) da yeni dili kullanır.
 */
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { storageGet, storageSet } from '../lib/storage';
import { EN } from './en';

export type Lang = 'tr' | 'en';
export const LANGUAGES: { code: Lang; label: string }[] = [
  { code: 'tr', label: 'Türkçe' },
  { code: 'en', label: 'English' },
];

const LANG_KEY = 'cebio.lang';

function detectLang(): Lang {
  // Testler Türkçe kaynak metinlerle çalışır (Node'un navigator.language değeri en-US olabilir)
  if (import.meta.env?.MODE === 'test') return 'tr';
  const saved = storageGet(LANG_KEY);
  if (saved === 'tr' || saved === 'en') return saved;
  const nav = (typeof navigator !== 'undefined' ? navigator.language : 'tr') || 'tr';
  return nav.toLowerCase().startsWith('tr') ? 'tr' : 'en';
}

let currentLang: Lang = detectLang();

export function getLang(): Lang {
  return currentLang;
}

/** Intl için yerel ayar kodu. */
export function getLocaleTag(): string {
  return currentLang === 'en' ? 'en-US' : 'tr-TR';
}

type Vars = Record<string, string | number>;

function interpolate(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

/** Türkçe metni seçili dile çevirir. */
export function t(text: string, vars?: Vars): string {
  const translated = currentLang === 'en' ? EN[text] ?? text : text;
  return interpolate(translated, vars);
}

/** Kategori adını (veritabanında Türkçe tutulur) ekranda seçili dilde göster. */
export function categoryLabel(category: string | null | undefined): string {
  return category ? t(category) : '';
}

interface I18nContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: typeof t;
}

const I18nContext = createContext<I18nContextValue | null>(null);
const listeners = new Set<(lang: Lang) => void>();

/** Dil değişimini React dışından dinlemek için (ör. sunucuya kaydetme). */
export function onLangChange(listener: (lang: Lang) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(currentLang);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = t('Cebio — Harcama & Fiş Takibi');
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    if (next === currentLang) return;
    currentLang = next;
    storageSet(LANG_KEY, next);
    setLangState(next);
    listeners.forEach((l) => l(next));
  }, []);

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n, I18nProvider içinde kullanılmalı');
  return ctx;
}
