import { useEffect, useState } from 'react';
import { Check, Crown, Loader2, MessageSquareText, ReceiptText, ScrollText } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { formatDateTr } from '../lib/format';
import { isNative } from '../lib/native';
import { FeatureUsage, getApiErrorMessage, getPlanStatus, PlanStatus } from '../services/api';
import { Modal, PRIMARY_BUTTON } from './ui';

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

// Fiyat mağazada (Google Play / App Store) belirlenir; burada yalnızca bilgi amaçlı gösterilir.
const PREMIUM_PRICE_HINT = 'Aylık veya yıllık abonelik';

const PREMIUM_PERKS = [
  'Ayda 200 fiş tarama (ücretsizde 15)',
  'Ayda 20 ekstre analizi (ücretsizde 2)',
  'Ayda 300 asistan sorusu (ücretsizde 30)',
  'Gelecek premium özelliklere öncelikli erişim',
];

function UsageBar({ item }: { item: FeatureUsage }) {
  const Icon = FEATURE_ICON[item.feature];
  const pct = item.limit > 0 ? Math.min(100, Math.round((item.used / item.limit) * 100)) : 100;
  const full = item.used >= item.limit;
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="flex items-center gap-1.5 font-medium text-slate-700 dark:text-slate-200">
          <Icon className="w-3.5 h-3.5 text-slate-400" />
          {FEATURE_TITLE[item.feature]}
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
        aria-label={`${FEATURE_TITLE[item.feature]} kullanımı`}
      >
        <div
          className={`h-full rounded-full ${full ? 'bg-rose-500' : pct >= 80 ? 'bg-amber-500' : 'bg-emerald-500'}`}
          style={{ width: `${Math.max(pct, item.used > 0 ? 3 : 0)}%` }}
        />
      </div>
    </div>
  );
}

export function PlanModal({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<PlanStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getPlanStatus()
      .then(setStatus)
      .catch((err) => setError(getApiErrorMessage(err, 'Plan bilgisi alınamadı.')));
  }, []);

  const premium = status?.plan === 'premium';

  return (
    <Modal title="Planım" onClose={onClose}>
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
              <p className="text-xs text-slate-500 dark:text-slate-400">Mevcut plan</p>
              <p className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                {premium && <Crown className="w-5 h-5 text-amber-500" />}
                {premium ? 'Premium' : 'Ücretsiz'}
              </p>
              {premium && status.premium_until && (
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {formatDateTr(status.premium_until.slice(0, 10))} tarihine kadar
                  {status.plan_source === 'promo' ? ' (promosyon)' : ''}
                </p>
              )}
            </div>
            <span className="text-[11px] text-slate-400 text-right">
              Bu ayki kullanım
              <br />
              {formatDateTr(status.resets_on)} tarihinde yenilenir
            </span>
          </div>

          <div className="space-y-3">
            {status.features.map((f) => (
              <UsageBar key={f.feature} item={f} />
            ))}
          </div>

          {!premium && (
            <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-500/10 to-emerald-500/10 p-4">
              <p className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                <Crown className="w-4 h-4 text-amber-500" /> Cebio Premium
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-3">{PREMIUM_PRICE_HINT}</p>
              <ul className="space-y-1.5 mb-4">
                {PREMIUM_PERKS.map((perk) => (
                  <li key={perk} className="flex items-start gap-2 text-xs text-slate-700 dark:text-slate-200">
                    <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                    {perk}
                  </li>
                ))}
              </ul>
              <button type="button" disabled className={`${PRIMARY_BUTTON} w-full`}>
                Premium'a geç
              </button>
              <p className="mt-2 text-center text-[11px] text-slate-500 dark:text-slate-400">
                {isNative()
                  ? 'Satın alma, uygulama mağazada yayınlandığında aktif olacak.'
                  : 'Premium, mobil uygulama üzerinden Google Play / App Store ile alınabilecek.'}
              </p>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
