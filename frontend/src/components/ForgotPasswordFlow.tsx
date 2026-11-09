import { FormEvent, useState } from 'react';
import { AlertCircle, ArrowLeft, Loader2, MailCheck } from 'lucide-react';
import { getApiErrorMessage, requestPasswordReset, resetPassword } from '../services/api';
import { INPUT_CLASS } from './ui';

interface ForgotPasswordFlowProps {
  initialEmail: string;
  onBack: () => void;
  onDone: (email: string) => void;
}

const SUBMIT_CLASS =
  'w-full py-2.5 rounded-xl text-sm font-semibold inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white dark:bg-emerald-500 dark:hover:bg-emerald-400 dark:text-slate-950 shadow-sm disabled:opacity-60 transition';

export function ForgotPasswordFlow({ initialEmail, onBack, onDone }: ForgotPasswordFlowProps) {
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [passwordAgain, setPasswordAgain] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendCode = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await requestPasswordReset(email.trim());
      setStep('code');
    } catch (err) {
      setError(getApiErrorMessage(err, 'Kod gönderilemedi. Lütfen tekrar deneyin.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitNewPassword = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!/^[0-9]{6}$/.test(code)) {
      setError('Kod 6 haneli olmalı.');
      return;
    }
    if (password.length < 8) {
      setError('Şifre en az 8 karakter olmalı.');
      return;
    }
    if (password !== passwordAgain) {
      setError('Şifreler birbiriyle aynı değil.');
      return;
    }
    setIsSubmitting(true);
    try {
      await resetPassword(email.trim(), code, password);
      onDone(email.trim());
    } catch (err) {
      setError(getApiErrorMessage(err, 'Şifre değiştirilemedi. Lütfen tekrar deneyin.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const errorBox = error && (
    <div className="flex items-start gap-2 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-700 dark:text-rose-300 text-xs">
      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
      <span>{error}</span>
    </div>
  );

  const cardClass =
    'rounded-2xl bg-white dark:bg-slate-900 border border-slate-300/80 dark:border-slate-800 shadow-sm p-6 space-y-4';

  if (step === 'email') {
    return (
      <form onSubmit={sendCode} className={cardClass}>
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">Şifremi unuttum</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            E-posta adresini yaz, sana 6 haneli bir sıfırlama kodu gönderelim.
          </p>
        </div>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-300">E-posta</span>
          <input
            type="email"
            required
            autoFocus
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={INPUT_CLASS}
          />
        </label>
        {errorBox}
        <button type="submit" disabled={isSubmitting} className={SUBMIT_CLASS}>
          {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
          Kodu gönder
        </button>
        <button
          type="button"
          onClick={onBack}
          className="w-full inline-flex items-center justify-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 hover:underline"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Girişe dön
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={submitNewPassword} className={cardClass}>
      <div className="flex items-start gap-2.5 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-800 dark:text-emerald-300 text-xs">
        <MailCheck className="w-4 h-4 shrink-0 mt-0.5" />
        <span>
          <strong>{email}</strong> kayıtlıysa kod gönderildi. Gelen kutunu ve spam klasörünü kontrol et. Kod 15 dakika
          geçerli.
        </span>
      </div>
      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-slate-600 dark:text-slate-300">6 haneli kod</span>
        <input
          required
          autoFocus
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          className={`${INPUT_CLASS} tracking-[0.4em] text-center font-semibold`}
        />
      </label>
      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Yeni şifre</span>
        <input
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={INPUT_CLASS}
        />
        <span className="block text-[11px] text-slate-400">En az 8 karakter</span>
      </label>
      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Yeni şifre (tekrar)</span>
        <input
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={passwordAgain}
          onChange={(e) => setPasswordAgain(e.target.value)}
          className={INPUT_CLASS}
        />
      </label>
      {errorBox}
      <button type="submit" disabled={isSubmitting} className={SUBMIT_CLASS}>
        {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
        Şifreyi değiştir
      </button>
      <button
        type="button"
        onClick={() => {
          setStep('email');
          setCode('');
          setError(null);
        }}
        className="w-full text-xs font-medium text-slate-500 dark:text-slate-400 hover:underline"
      >
        Kod gelmedi, tekrar gönder
      </button>
    </form>
  );
}
