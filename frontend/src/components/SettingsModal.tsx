import { useState } from 'react';
import { Bot, ChevronRight, FileText, Globe, LifeBuoy, Loader2, ShieldCheck, Trash2, UserX } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { LANGUAGES, t, useI18n } from '../i18n';
import { formatDateTr } from '../lib/format';
import { LegalDoc, SUPPORT_EMAIL } from '../lib/legal';
import { getApiErrorMessage } from '../services/api';
import { markSettingsReopen } from './Dashboard';
import { LegalModal } from './LegalModal';
import { Modal, SECONDARY_BUTTON } from './ui';

const APP_VERSION = '1.0.0';

const ROW =
  'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-left text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1">
      <h3 className="px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{title}</h3>
      {children}
    </section>
  );
}

export function SettingsModal({ onClose, onDeleteAccount }: { onClose: () => void; onDeleteAccount: () => void }) {
  const { user, updatePreferences } = useAuth();
  const { lang, setLang } = useI18n();
  const [legal, setLegal] = useState<LegalDoc | null>(null);
  const [savingConsent, setSavingConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const consent = Boolean(user?.ai_consent_at);

  const toggleConsent = async () => {
    if (consent && !window.confirm(t('Yapay zeka iznini geri alırsan fiş tarama, ekstre analizi ve asistan kapanır. Kayıtlı verilerin silinmez. Devam edilsin mi?'))) {
      return;
    }
    setSavingConsent(true);
    setError(null);
    try {
      await updatePreferences({ ai_consent: !consent });
    } catch (err) {
      setError(getApiErrorMessage(err, t('Ayar kaydedilemedi.')));
    } finally {
      setSavingConsent(false);
    }
  };

  return (
    <>
      <Modal title={t('Ayarlar')} onClose={onClose}>
        <div className="space-y-5">
          <Section title={t('Dil')}>
            <div className="flex items-center gap-3 px-3 py-1.5">
              <Globe className="w-4 h-4 text-slate-400" />
              <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800 flex-1" role="radiogroup" aria-label={t('Dil')}>
                {LANGUAGES.map((l) => (
                  <button
                    key={l.code}
                    type="button"
                    role="radio"
                    aria-checked={lang === l.code}
                    onClick={() => {
                      if (l.code !== lang) markSettingsReopen();
                      setLang(l.code);
                    }}
                    className={`py-1.5 rounded-lg text-xs font-semibold transition ${
                      lang === l.code
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            </div>
          </Section>

          <Section title={t('Gizlilik')}>
            <div className="flex items-start gap-3 px-3 py-2">
              <Bot className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{t('Yapay zeka ile veri paylaşımı')}</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  {consent
                    ? t('Açık ({0} tarihinden beri). Fiş, ekstre ve sorular Google Gemini’ye gönderilir.', {
                        0: formatDateTr((user?.ai_consent_at ?? '').slice(0, 10)),
                      })
                    : t('Kapalı. Yapay zeka özellikleri kullanılmaz; verilerin hiçbir yapay zeka servisine gönderilmez.')}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={consent}
                aria-label={t('Yapay zeka ile veri paylaşımı')}
                disabled={savingConsent}
                onClick={() => void toggleConsent()}
                className={`relative w-11 h-6 rounded-full shrink-0 transition ${consent ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-700'}`}
              >
                {savingConsent ? (
                  <Loader2 className="absolute inset-0 m-auto w-3.5 h-3.5 animate-spin text-white" />
                ) : (
                  <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${consent ? 'left-[22px]' : 'left-0.5'}`} />
                )}
              </button>
            </div>
            {error && <p className="px-3 text-xs text-rose-600 dark:text-rose-400">{error}</p>}
            <button type="button" className={ROW} onClick={() => setLegal('privacy')}>
              <ShieldCheck className="w-4 h-4 text-slate-400" />
              <span className="flex-1">{t('Gizlilik Politikası ve KVKK')}</span>
              <ChevronRight className="w-4 h-4 text-slate-400" />
            </button>
            <button type="button" className={ROW} onClick={() => setLegal('terms')}>
              <FileText className="w-4 h-4 text-slate-400" />
              <span className="flex-1">{t('Kullanım Koşulları')}</span>
              <ChevronRight className="w-4 h-4 text-slate-400" />
            </button>
          </Section>

          <Section title={t('Destek')}>
            <button type="button" className={ROW} onClick={() => setLegal('support')}>
              <LifeBuoy className="w-4 h-4 text-slate-400" />
              <span className="flex-1">{t('Yardım ve iletişim')}</span>
              <ChevronRight className="w-4 h-4 text-slate-400" />
            </button>
            <a className={ROW} href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Cebio')}`}>
              <span className="w-4" />
              <span className="flex-1 text-xs text-slate-500 dark:text-slate-400">{SUPPORT_EMAIL}</span>
            </a>
          </Section>

          <Section title={t('Hesap')}>
            <p className="px-3 text-xs text-slate-500 dark:text-slate-400 truncate">{user?.email}</p>
            <button type="button" className={ROW} onClick={() => setLegal('delete-account')}>
              <UserX className="w-4 h-4 text-slate-400" />
              <span className="flex-1">{t('Hesap silme hakkında')}</span>
              <ChevronRight className="w-4 h-4 text-slate-400" />
            </button>
            <button
              type="button"
              onClick={onDeleteAccount}
              className={`${SECONDARY_BUTTON} w-full !justify-start !text-rose-600 dark:!text-rose-400`}
            >
              <Trash2 className="w-4 h-4" /> {t('Hesabımı ve tüm verilerimi sil')}
            </button>
          </Section>

          <p className="text-center text-[11px] text-slate-400">Cebio v{APP_VERSION}</p>
        </div>
      </Modal>
      {legal && <LegalModal doc={legal} onClose={() => setLegal(null)} />}
    </>
  );
}
