import { getLang } from '../i18n';

export type LegalDoc = 'privacy' | 'terms' | 'delete-account' | 'support';

/** Uygulamaya gömülü yasal sayfalar (public/). Mağaza formlarına bu sayfaların yayınlandığı adres girilir. */
const FILES: Record<LegalDoc, { tr: string; en: string }> = {
  privacy: { tr: 'gizlilik.html', en: 'privacy.html' },
  terms: { tr: 'kullanim-kosullari.html', en: 'terms.html' },
  'delete-account': { tr: 'hesap-silme.html', en: 'delete-account.html' },
  support: { tr: 'destek.html', en: 'support.html' },
};

export const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL || 'destek@cebio.app';

export function legalPath(doc: LegalDoc): string {
  return `/${FILES[doc][getLang()]}`;
}

/** Paylaşılabilir tam adres (yayın sitesi tanımlıysa onun üzerinden). */
export function legalUrl(doc: LegalDoc): string {
  const base = (import.meta.env.VITE_PUBLIC_SITE_URL || '').replace(/\/$/, '');
  return `${base}${legalPath(doc)}`;
}
