import { FormEvent, useState } from 'react';
import { AlertCircle, CheckCircle2, Globe, Loader2, Wallet } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { getApiErrorMessage } from '../services/api';
import { ForgotPasswordFlow } from './ForgotPasswordFlow';

import { Lang, LANGUAGES, t, useI18n } from '../i18n';
import type { LegalDoc } from '../lib/legal';
import { LegalLink, LegalModal } from './LegalModal';
type Mode = 'login' | 'register';

const INPUT_CLASS =
  'w-full px-3.5 py-2.5 rounded-xl text-sm bg-slate-50 dark:bg-slate-800 border border-slate-300/80 dark:border-slate-700 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20';

export function AuthScreen() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [aiConsent, setAiConsent] = useState(false);
  const [legal, setLegal] = useState<LegalDoc | null>(null);
  const { lang, setLang } = useI18n();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isForgot, setIsForgot] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const isRegister = mode === 'register';

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (isRegister && password.length < 8) {
      setError(t("Şifre en az 8 karakter olmalı."));
      return;
    }
    if (isRegister && !acceptTerms) {
      setError(t("Devam etmek için kullanım koşullarını ve gizlilik politikasını onaylamanız gerekiyor."));
      return;
    }
    setIsSubmitting(true);
    try {
      if (isRegister) {
        await register(email.trim(), password, fullName.trim() || undefined, aiConsent);
      } else {
        await login(email.trim(), password);
      }
    } catch (err) {
      setError(
        getApiErrorMessage(err, isRegister ? t("Hesap oluşturulamadı.") : t("Giriş yapılamadı."))
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10 pt-safe pb-safe bg-slate-100 dark:bg-slate-950">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <Wallet className="w-7 h-7 text-white" />
          </div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{t("Cebio")}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t("Fişlerini tara, harcamalarını yapay zekayla takip et.")}</p>
        </div>

        {notice && !isForgot && (
          <div className="mb-3 flex items-start gap-2 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-800 dark:text-emerald-300 text-xs">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{notice}</span>
          </div>
        )}

        {isForgot ? (
          <ForgotPasswordFlow
            initialEmail={email}
            onBack={() => setIsForgot(false)}
            onDone={(resetEmail) => {
              setEmail(resetEmail);
              setPassword('');
              setMode('login');
              setError(null);
              setIsForgot(false);
              setNotice(t("Şifren değiştirildi. Yeni şifrenle giriş yapabilirsin."));
            }}
          />
        ) : (
        <form
          onSubmit={handleSubmit}
          className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-300/80 dark:border-slate-800 shadow-sm p-6 space-y-4"
        >
          <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800">
            {(['login', 'register'] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode(m);
                  setError(null);
                }}
                className={`py-2 rounded-lg text-xs font-semibold transition ${
                  mode === m
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                {m === 'login' ? t("Giriş Yap") : t("Hesap Oluştur")}
              </button>
            ))}
          </div>

          {isRegister && (
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{t("Ad Soyad (isteğe bağlı)")}</span>
              <input
                type="text"
                autoComplete="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className={INPUT_CLASS}
              />
            </label>
          )}

          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{t("E-posta")}</span>
            <input
              type="email"
              required
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={INPUT_CLASS}
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{t("Şifre")}</span>
            <input
              type="password"
              required
              minLength={isRegister ? 8 : 1}
              autoComplete={isRegister ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={INPUT_CLASS}
            />
            {isRegister && (
              <span className="block text-[11px] text-slate-400">{t("En az 8 karakter")}</span>
            )}
            {!isRegister && (
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setNotice(null);
                  setIsForgot(true);
                }}
                className="block ml-auto text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:underline"
              >{t("Şifremi unuttum")}</button>
            )}
          </label>

          {isRegister && (
            <div className="space-y-3">
              <label className="flex items-start gap-2.5 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                <input
                  type="checkbox"
                  checked={acceptTerms}
                  onChange={(e) => setAcceptTerms(e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-emerald-600 shrink-0"
                />
                <span>
                  {t('Şunları okudum ve kabul ediyorum:')}{' '}
                  <LegalLink doc="terms" onOpen={setLegal}>{t('Kullanım Koşulları')}</LegalLink>
                  {', '}
                  <LegalLink doc="privacy" onOpen={setLegal}>{t('Gizlilik Politikası ve KVKK Aydınlatma Metni')}</LegalLink>
                  {' '}<span className="text-rose-500">*</span>
                </span>
              </label>
              <label className="flex items-start gap-2.5 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                <input
                  type="checkbox"
                  checked={aiConsent}
                  onChange={(e) => setAiConsent(e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-emerald-600 shrink-0"
                />
                <span>
                  <strong>{t('(İsteğe bağlı)')}</strong>{' '}
                  {t('Fiş fotoğraflarımın, ekstrelerimin ve asistana sorduğum soruların analiz için yurt dışındaki yapay zeka servisine (Google Gemini) aktarılmasına açık rıza veriyorum. Daha sonra Ayarlar’dan geri alabilirim.')}
                </span>
              </label>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-700 dark:text-rose-300 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-2.5 rounded-xl text-sm font-semibold inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white dark:bg-emerald-500 dark:hover:bg-emerald-400 dark:text-slate-950 shadow-sm disabled:opacity-60 transition"
          >
            {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
            {isRegister ? t("Hesap Oluştur") : t("Giriş Yap")}
          </button>
        </form>
        )}

        <div className="mt-4 flex items-center justify-center gap-2 text-[11px] text-slate-400">
          <LegalLink doc="privacy" onOpen={setLegal} className="hover:underline">{t('Gizlilik')}</LegalLink>
          <span>•</span>
          <LegalLink doc="terms" onOpen={setLegal} className="hover:underline">{t('Kullanım Koşulları')}</LegalLink>
          <span>•</span>
          <LegalLink doc="support" onOpen={setLegal} className="hover:underline">{t('Destek')}</LegalLink>
          <span>•</span>
          <label className="inline-flex items-center gap-1">
            <Globe className="w-3 h-3" />
            <select
              aria-label={t('Dil')}
              value={lang}
              onChange={(e) => setLang(e.target.value as Lang)}
              className="bg-transparent hover:underline focus:outline-none cursor-pointer"
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      {legal && <LegalModal doc={legal} onClose={() => setLegal(null)} />}
    </div>
  );
}
