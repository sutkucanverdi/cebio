import { ExternalLink } from 'lucide-react';
import { t } from '../i18n';
import { isNative } from '../lib/native';
import { LegalDoc, legalPath, legalUrl } from '../lib/legal';
import { Modal } from './ui';

const TITLES: Record<LegalDoc, string> = {
  privacy: 'Gizlilik Politikası ve KVKK Aydınlatma Metni',
  terms: 'Kullanım Koşulları',
  'delete-account': 'Hesap ve Veri Silme',
  support: 'Destek',
};

/**
 * Yasal metni uygulamadan çıkmadan gösterir (telefonda target=_blank bağlantıları geri dönülemeyen
 * bir sayfa açabiliyordu). Sayfalar uygulamaya gömülüdür, internet olmadan da açılır.
 */
export function LegalModal({ doc, onClose }: { doc: LegalDoc; onClose: () => void }) {
  return (
    <Modal title={t(TITLES[doc])} onClose={onClose} wide>
      <iframe
        title={t(TITLES[doc])}
        src={legalPath(doc)}
        className="w-full h-[65vh] rounded-xl border border-slate-200 dark:border-slate-800 bg-white"
      />
      {!isNative() && (
        <a
          href={legalUrl(doc)}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:underline"
        >
          <ExternalLink className="w-3.5 h-3.5" /> {t('Yeni sekmede aç')}
        </a>
      )}
    </Modal>
  );
}

/** Metin içinde yasal sayfayı açan bağlantı görünümlü buton. */
export function LegalLink({
  doc,
  onOpen,
  children,
  className = 'font-semibold text-emerald-700 dark:text-emerald-400 underline',
}: {
  doc: LegalDoc;
  onOpen: (doc: LegalDoc) => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button type="button" onClick={() => onOpen(doc)} className={className}>
      {children}
    </button>
  );
}
