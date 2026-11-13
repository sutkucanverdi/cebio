import { useEffect, useState } from 'react';
import { Check, Crown, ExternalLink, Loader2, MessageSquareText, ReceiptText, RotateCcw, ScrollText } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { t } from '../i18n';
import { formatDateTr } from '../lib/format';
import type { LegalDoc } from '../lib/legal';
import { isNative } from '../lib/native';
import {
  buyPackage,
  getPremiumPackages,
  manageSubscriptionsUrl,
  PremiumPackage,
  purchasesAvailable,
  restorePurchases,
} from '../lib/purchases';
import { FeatureUsage, getApiErrorMessage, getPlanStatus, PlanStatus } from '../services/api';
import { LegalLink, LegalModal } from './LegalModal';
import { Modal, PRIMARY_BUTTON, SECONDARY_BUTTON } from './ui';

const FEATURE_ICON: Record<FeatureUsage['feature'], LucideIcon> = {
  receipt_scan: ReceiptText,
  statement_scan: ScrollText,
  assistant: MessageSquareText,
};

const FEATURE_TITLE: Record<FeatureUsage['feature'], string> = {
  receipt_scan: 'Fiş tarama',
  statement_scan: 'Ekstre analizi',
  assistant: 'Asistan sorusu',
};

const PREMIUM_PERKS = [
  'Ayda 200 fiş tarama (ücretsizde 15)',
  'Ayda 20 ekstre analizi (ücretsizde 2)',
  'Ayda 300 asistan sorusu (ücretsizde 30)',
  'Gelecek premium özelliklere öncelikli erişim',
];

const PERIOD_LABEL: Record<PremiumPackage['period'], string> = {
  monthly: 'Aylık',
  yearly: 'Yıllık',
  other: 'Abonelik',
};

function UsageBar({ item }: { item: FeatureUsage }) {
  const Icon = FEATURE_ICON[item.feature];
  const pct = item.limit > 0 ? Math.min(100, Math.round((item.used / item.limit) * 100)) : 100;
  const full = item.used >= item.limit;
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="flex items-center gap-1.5 font-medium text-slate-700 dark:text-slate-200">
          <Icon className="w-3.5 h-3.5 text-slate-400" />
          {t(FEATURE_TITLE[item.feature])}
        </span>
        <span className={full ? 'font-semibold text-rose-600 dark:text-rose-400' : 'text-slate-500 dark:text-slate-400'}>
          {item.used} / {item.limit}
        </span>
      </div>
      <div
        className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t('{0} kullanımı', { 0: t(FEATURE_TITLE[item.feature]) })}
      >
        <div
          className={`h-full rounded-full ${full ? 'bg-rose-500' : pct >= 80 ? 'bg-amber-500' : 'bg-emerald-500'}`}
          style={{ width: `${Math.max(pct, item.used > 0 ? 3 : 0)}%` }}
        />
      </div>
    </div>
  );
}

/** Mağaza satın alması: paketler, otomatik yenileme açıklaması, geri yükleme (Apple 3.1.2). */
function StorePurchase({ onPremium, onOpenLegal }: { onPremium: () => void; onOpenLegal: (d: LegalDoc) => void }) {
  const [packages, setPackages] = useState<PremiumPackage[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);

  useEffect(() => {
    getPremiumPackages()
      .then(setPackages)
      .catch(() => {
        setPackages([]);
        setMessage({ kind: 'error', text: t('Mağaza fiyatları alınamadı. İnternet bağlantını kontrol edip tekrar dene.') });
      });
  }, []);

  const buy = async (pkg: PremiumPackage) => {
    setBusy(pkg.id);
    setMessage(null);
    try {
      if (await buyPackage(pkg)) onPremium();
    } catch {
      setMessage({ kind: 'error', text: t('Satın alma tamamlanamadı. Ücret alınmadı; lütfen tekrar dene.') });
    } finally {
      setBusy(null);
    }
  };

  const restore = async () => {
    setBusy('restore');
    setMessage(null);
    try {
      if (await restorePurchases()) onPremium();
      else setMessage({ kind: 'info', text: t('Bu mağaza hesabında etkin bir Premium aboneliği bulunamadı.') });
    } catch {
      setMessage({ kind: 'error', text: t('Satın alımlar geri yüklenemedi.') });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-2">
      {packages === null && <Loader2 className="w-4 h-4 animate-spin text-emerald-500 mx-auto" />}
      {packages?.map((pkg) => (
        <button
          key={pkg.id}
          type="button"
          disabled={busy !== null}
          onClick={() => void buy(pkg)}
          className={`${PRIMARY_BUTTON} w-full !justify-between`}
        >
          <span>{t(PERIOD_LABEL[pkg.period])}</span>
          <span className="flex items-center gap-2">
            {busy === pkg.id && <Loader2 className="w-4 h-4 animate-spin" />}
            {pkg.priceString}
            {pkg.period === 'monthly' ? t(' / ay') : pkg.period === 'yearly' ? t(' / yıl') : ''}
          </span>
        </button>
      ))}
      {packages?.some((p) => p.intro) && (
        <p className="text-[11px] text-slate-500 dark:text-slate-400 text-center">
          {t('Giriş teklifi mağazada gösterilir; teklif bitince normal fiyat uygulanır.')}
        </p>
      )}
      <button type="button" onClick={() => void restore()} disabled={busy !== null} className={`${SECONDARY_BUTTON} w-full`}>
        {busy === 'restore' ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
        {t('Satın alımları geri yükle')}
      </button>
      {message && (
        <p className={`text-xs text-center ${message.kind === 'error' ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500'}`}>
          {message.text}
        </p>
      )}
      <p className="text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">
        {t(
          'Ödeme, onayladığında App Store / Google Play hesabından alınır. Abonelik, dönem bitmeden en az 24 saat önce iptal edilmezse aynı süre ve fiyatla otomatik yenilenir; yenileme ücreti dönem bitmeden önceki 24 saat içinde tahsil edilir. Aboneliğini mağaza hesabının ayarlarından yönetebilir ve iptal edebilirsin.'
        )}{' '}
        <LegalLink doc="terms" onOpen={onOpenLegal} className="underline">
          {t('Kullanım Koşulları')}
        </LegalLink>
        {' • '}
        <LegalLink doc="privacy" onOpen={onOpenLegal} className="underline">
          {t('Gizlilik Politikası')}
        </LegalLink>
      </p>
    </div>
  );
}

export function PlanModal({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<PlanStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [legal, setLegal] = useState<LegalDoc | null>(null);
  const [activating, setActivating] = useState(false);

  const load = () =>
    getPlanStatus()
      .then((s) => {
        setStatus(s);
        return s;
      })
      .catch((err) => {
        setError(getApiErrorMessage(err, t('Plan bilgisi alınamadı.')));
        return null;
      });

  useEffect(() => {
    void load();
  }, []);

  /** Mağaza onayından sonra sunucu, RevenueCat webhook'u gelince premium'u açar; birkaç kez kontrol et. */
  const waitForPremium = async () => {
    setActivating(true);
    for (let i = 0; i < 8; i += 1) {
      const s = await load();
      if (s?.plan === 'premium') break;
      await new Promise((r) => setTimeout(r, 2000));
    }
    setActivating(false);
  };

  const premium = status?.plan === 'premium';
  const canBuy = purchasesAvailable();
  const manageUrl = manageSubscriptionsUrl();

  return (
    <>
      <Modal title={t('Planım')} onClose={onClose}>
        {!status && !error && (
          <div className="py-10 flex justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-emerald-500" />
          </div>
        )}
        {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}

        {status && (
          <div className="space-y-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs text-slate-500 dark:text-slate-400">{t('Mevcut plan')}</p>
                <p className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                  {premium && <Crown className="w-5 h-5 text-amber-500" />}
                  {premium ? 'Premium' : t('Ücretsiz')}
                </p>
                {premium && status.premium_until && (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {t('{0} tarihine kadar', { 0: formatDateTr(status.premium_until.slice(0, 10)) })}
                    {status.plan_source === 'promo' ? t(' (promosyon)') : ''}
                  </p>
                )}
              </div>
              <span className="text-[11px] text-slate-400 text-right">
                {t('Bu ayki kullanım')}
                <br />
                {t('{0} tarihinde yenilenir', { 0: formatDateTr(status.resets_on) })}
              </span>
            </div>

            <div className="space-y-3">
              {status.features.map((f) => (
                <UsageBar key={f.feature} item={f} />
              ))}
            </div>

            {activating && (
              <p className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-400">
                <Loader2 className="w-4 h-4 animate-spin" /> {t('Satın alma doğrulanıyor...')}
              </p>
            )}

            {premium && status.plan_source === 'revenuecat' && manageUrl && (
              <a href={manageUrl} target="_blank" rel="noopener noreferrer" className={`${SECONDARY_BUTTON} w-full`}>
                <ExternalLink className="w-4 h-4" /> {t('Aboneliği yönet / iptal et')}
              </a>
            )}

            {/* Satın alma yalnızca mağaza faturalandırması hazırsa gösterilir (yarım kalmış buton = inceleme reddi) */}
            {!premium && (canBuy || !isNative()) && (
              <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-500/10 to-emerald-500/10 p-4">
                <p className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5 mb-3">
                  <Crown className="w-4 h-4 text-amber-500" /> Cebio Premium
                </p>
                <ul className="space-y-1.5 mb-4">
                  {PREMIUM_PERKS.map((perk) => (
                    <li key={perk} className="flex items-start gap-2 text-xs text-slate-700 dark:text-slate-200">
                      <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                      {t(perk)}
                    </li>
                  ))}
                </ul>
                {canBuy ? (
                  <StorePurchase onPremium={() => void waitForPremium()} onOpenLegal={setLegal} />
                ) : (
                  <p className="text-center text-[11px] text-slate-500 dark:text-slate-400">
                    {t('Premium, Cebio mobil uygulamasından App Store / Google Play aboneliğiyle alınabilir.')}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>
      {legal && <LegalModal doc={legal} onClose={() => setLegal(null)} />}
    </>
  );
}
