/**
 * Yapay zeka (Google Gemini) ile veri paylaşımı için AYRI, açık ve geri alınabilir rıza.
 *
 * - App Store 5.1.2(i): kişisel veri üçüncü taraf yapay zekaya gönderilmeden önce açıkça
 *   bildirilmeli ve izin alınmalı.
 * - KVKK m.5 ve m.9: yurt dışına aktarım için açık rıza; hizmetin geri kalanı rızaya bağlanmaz
 *   (rıza verilmezse elle fiş ekleme, abonelikler, bütçeler ve raporlar çalışmaya devam eder).
 *
 * Kullanım: const ensureAiConsent = useAiConsent();  if (!(await ensureAiConsent())) return;
 */
import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Bot, Loader2, ShieldCheck } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { t } from '../i18n';
import { AI_CONSENT_EVENT, getApiErrorMessage } from '../services/api';
import { LegalLink, LegalModal } from './LegalModal';
import type { LegalDoc } from '../lib/legal';
import { Modal, PRIMARY_BUTTON, SECONDARY_BUTTON } from './ui';

type Ensure = () => Promise<boolean>;
const AiConsentContext = createContext<Ensure | null>(null);

export function useAiConsent(): Ensure {
  const ctx = useContext(AiConsentContext);
  if (!ctx) throw new Error('useAiConsent, AiConsentProvider içinde kullanılmalı');
  return ctx;
}

export function AiConsentProvider({ children }: { children: ReactNode }) {
  const { user, updatePreferences } = useAuth();
  const [open, setOpen] = useState(false);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const ensure = useCallback<Ensure>(() => {
    if (user?.ai_consent_at) return Promise.resolve(true);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolver.current?.(false);
      resolver.current = resolve;
    });
  }, [user?.ai_consent_at]);

  // Sunucu rıza yok derse (ör. başka cihazdan geri alındıysa) pencereyi aç
  useEffect(() => {
    const onRequired = () => setOpen(true);
    window.addEventListener(AI_CONSENT_EVENT, onRequired);
    return () => window.removeEventListener(AI_CONSENT_EVENT, onRequired);
  }, []);

  const finish = (ok: boolean) => {
    setOpen(false);
    resolver.current?.(ok);
    resolver.current = null;
  };

  return (
    <AiConsentContext.Provider value={ensure}>
      {children}
      {open && (
        <AiConsentModal
          onDecline={() => finish(false)}
          onAccept={async () => {
            await updatePreferences({ ai_consent: true });
            finish(true);
          }}
        />
      )}
    </AiConsentContext.Provider>
  );
}

function AiConsentModal({ onAccept, onDecline }: { onAccept: () => Promise<void>; onDecline: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [legal, setLegal] = useState<LegalDoc | null>(null);

  const accept = async () => {
    setSaving(true);
    setError(null);
    try {
      await onAccept();
    } catch (err) {
      setError(getApiErrorMessage(err, t('İzin kaydedilemedi. Lütfen tekrar deneyin.')));
      setSaving(false);
    }
  };

  return (
    <>
      <Modal
        title={t('Yapay zeka özellikleri için izin')}
        onClose={onDecline}
        footer={
          <>
            <button type="button" onClick={onDecline} className={SECONDARY_BUTTON}>
              {t('Şimdi değil')}
            </button>
            <button type="button" onClick={() => void accept()} disabled={saving} className={PRIMARY_BUTTON}>
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {t('İzin veriyorum')}
            </button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-slate-700 dark:text-slate-200">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
              <Bot className="w-5 h-5" />
            </div>
            <p>
              {t(
                'Fiş tarama, ekstre analizi ve asistan, verilerini işlemek için üçüncü taraf bir yapay zeka servisi kullanır.'
              )}
            </p>
          </div>
          <ul className="space-y-1.5 text-xs leading-relaxed list-disc pl-5 text-slate-600 dark:text-slate-300">
            <li>
              <strong>{t('Gönderilenler:')}</strong>{' '}
              {t('yüklediğin fiş fotoğrafı veya ekstre dosyası; asistana sorduğun sorular ve cevap için gereken harcama özetleri.')}
            </li>
            <li>
              <strong>{t('Kime:')}</strong>{' '}
              {t('Google LLC (Gemini API). Sunucular ABD dahil yurt dışında olabilir.')}
            </li>
            <li>
              <strong>{t('Amaç:')}</strong>{' '}
              {t('yalnızca fişi/ekstreyi okumak ve sorunu cevaplamak. Reklam veya profil çıkarma için kullanılmaz; dosyalar Cebio sunucularında saklanmaz.')}
            </li>
            <li>
              <strong>{t('İsteğe bağlı:')}</strong>{' '}
              {t('izin vermesen de fişleri elle ekleyebilir, abonelik, bütçe ve raporları kullanabilirsin. İznini Ayarlar’dan istediğin an geri alabilirsin.')}
            </li>
          </ul>
          <p className="flex items-start gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
            <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>
              {t('Ayrıntılar:')}{' '}
              <LegalLink doc="privacy" onOpen={setLegal}>
                {t('Gizlilik Politikası')}
              </LegalLink>
            </span>
          </p>
          {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
        </div>
      </Modal>
      {legal && <LegalModal doc={legal} onClose={() => setLegal(null)} />}
    </>
  );
}
