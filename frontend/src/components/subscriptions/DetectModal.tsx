import { useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, FileSearch, Loader2, TrendingUp, UploadCloud } from 'lucide-react';
import { formatDateTr } from '../../lib/format';
import { CYCLE_LABELS, CYCLE_SUFFIX, formatMoney } from '../../lib/subscriptions';
import {
  createSubscription,
  detectSubscriptions,
  DetectionResult,
  getApiErrorMessage,
  SubscriptionCandidate,
} from '../../services/api';
import { Modal, PRIMARY_BUTTON, SECONDARY_BUTTON } from '../ui';

import { t } from '../../i18n';
import { useAiConsent } from '../AiConsent';
const MAX_MB = 10;
const ACCEPT = '.pdf,.csv,.txt,.jpg,.jpeg,.png,.webp,application/pdf,text/csv,text/plain,image/jpeg,image/png,image/webp';

const CONFIDENCE: Record<SubscriptionCandidate['confidence'], { label: string; className: string }> = {
  high: { label: 'Kesin', className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20' },
  medium: { label: 'Muhtemel', className: 'bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/20' },
  low: { label: 'Tek ödeme', className: 'bg-slate-500/10 text-slate-600 dark:text-slate-300 border-slate-500/20' },
};

interface DetectModalProps {
  onClose: () => void;
  onAdded: (count: number) => void;
}

export function DetectModal({ onClose, onAdded }: DetectModalProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [result, setResult] = useState<DetectionResult | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const ensureAiConsent = useAiConsent();

  const analyze = async (file: File) => {
    if (file.size > MAX_MB * 1024 * 1024) {
      setError(t("Dosya çok büyük. En fazla {0} MB yükleyebilirsiniz.", { 0: MAX_MB }));
      return;
    }
    // Ekstre Google Gemini'ye gönderilmeden önce açık rıza (App Store 5.1.2(i), KVKK)
    if (!(await ensureAiConsent())) return;
    setError(null);
    setResult(null);
    setIsAnalyzing(true);
    try {
      const res = await detectSubscriptions(file);
      setResult(res);
      // Varsayılan seçim: henüz eklenmemiş, kesin veya muhtemel adaylar
      setSelected(
        new Set(
          res.candidates
            .map((c, i) => (!c.already_tracked && c.confidence !== 'low' ? i : -1))
            .filter((i) => i >= 0)
        )
      );
    } catch (err) {
      setError(getApiErrorMessage(err, t("Ekstre analiz edilemedi.")));
    } finally {
      setIsAnalyzing(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const toggle = (index: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  const addSelected = async () => {
    if (!result) return;
    setIsAdding(true);
    setError(null);
    let added = 0;
    try {
      for (const index of [...selected].sort((a, b) => a - b)) {
        const c = result.candidates[index];
        await createSubscription({
          name: c.name,
          amount: c.amount,
          currency: c.currency,
          billing_cycle: c.billing_cycle,
          next_billing_date: c.next_billing_date,
          category: c.category,
          status: 'active',
          trial_ends_at: null,
          cancel_url: c.cancel_url,
          notes: c.matched_descriptions.length ? t("Ekstrede: {0}", { 0: c.matched_descriptions.join(', ') }).slice(0, 1000) : null,
        });
        added += 1;
      }
      onAdded(added);
    } catch (err) {
      setError(
        t("{0} abonelik eklendi, sonrakinde hata oluştu: {1}", { 0: added, 1: getApiErrorMessage(err, 'Bilinmeyen hata.') })
      );
      if (added > 0) onAdded(added);
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <Modal
      title={t("Ekstreden Abonelik Bul")}
      onClose={onClose}
      wide
      footer={
        result && result.candidates.length > 0 ? (
          <>
            <button type="button" className={SECONDARY_BUTTON} onClick={() => inputRef.current?.click()}>{t("Başka ekstre")}</button>
            <button
              type="button"
              className={PRIMARY_BUTTON}
              disabled={selected.size === 0 || isAdding}
              onClick={() => void addSelected()}
            >
              {isAdding && <Loader2 className="w-4 h-4 animate-spin" />}{t("Seçilenleri ekle (")}{selected.size})
            </button>
          </>
        ) : undefined
      }
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void analyze(file);
        }}
      />

      {!result && (
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{t("Banka veya kredi kartı ekstrenizi yükleyin. Cebio tekrarlayan ödemeleri bulur, siz onayladıklarınızı eklersiniz.")}{' '}<span className="font-medium">{t("Hiçbir şey onayınız olmadan kaydedilmez.")}</span>
          </p>
          <ul className="text-xs text-slate-500 dark:text-slate-400 space-y-1 list-disc pl-5">
            <li>{t("En iyi sonuç için son 2–3 ayın ekstresini yükleyin.")}</li>
            <li>{t("PDF, CSV veya ekran görüntüsü (en fazla")}{' '}{MAX_MB}{' '}{t("MB).")}</li>
            <li>{t("Ekstre analiz için Google Gemini'ye gönderilir ve saklanmaz.")}</li>
          </ul>
          <button
            type="button"
            disabled={isAnalyzing}
            onClick={() => inputRef.current?.click()}
            className="w-full min-h-[150px] rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-emerald-500 bg-slate-50 dark:bg-slate-800/40 flex flex-col items-center justify-center gap-2 text-sm text-slate-600 dark:text-slate-300 disabled:cursor-wait transition"
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
                <span>{t("Ekstre analiz ediliyor, bu biraz sürebilir...")}</span>
              </>
            ) : (
              <>
                <UploadCloud className="w-6 h-6 text-emerald-500" />
                <span className="font-medium">{t("Ekstre dosyası seçin")}</span>
              </>
            )}
          </button>
        </div>
      )}

      {result && result.candidates.length === 0 && (
        <div className="py-8 flex flex-col items-center text-center gap-2">
          <FileSearch className="w-8 h-8 text-slate-400" />
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{t("Tekrarlayan ödeme bulunamadı")}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm">{t('Ekstrede {0} harcama okundu ama düzenli tekrar eden bir ödeme görünmüyor. Daha uzun bir dönemin ekstresini deneyebilirsiniz.', { 0: result.transactions_found })}</p>
          <button type="button" className={`${SECONDARY_BUTTON} mt-2`} onClick={() => inputRef.current?.click()}>{t("Başka ekstre yükle")}</button>
        </div>
      )}

      {result && result.candidates.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {t('{0} harcama tarandı, {1} olası abonelik bulundu. Eklemek istediklerinizi seçin.', { 0: result.transactions_found, 1: result.candidates.length })}</p>
          <ul className="space-y-2">
            {result.candidates.map((c, index) => {
              const isSelected = selected.has(index);
              const conf = CONFIDENCE[c.confidence];
              return (
                <li key={`${c.name}-${c.currency}-${index}`}>
                  <label
                    className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition ${
                      isSelected
                        ? 'border-emerald-500 bg-emerald-500/5 ring-1 ring-emerald-500/30'
                        : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="mt-1 accent-emerald-600"
                      checked={isSelected}
                      onChange={() => toggle(index)}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-sm text-slate-900 dark:text-white truncate">{c.name}</span>
                        <span className="font-semibold text-sm text-slate-900 dark:text-white shrink-0">
                          {formatMoney(c.amount, c.currency)}
                          <span className="text-xs font-normal text-slate-500">{t(CYCLE_SUFFIX[c.billing_cycle])}</span>
                        </span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                        <span className={`px-1.5 py-0.5 rounded border font-medium ${conf.className}`}>{t(conf.label)}</span>
                        <span className="text-slate-500 dark:text-slate-400">
                          {t(CYCLE_LABELS[c.billing_cycle])} • {c.occurrences}{' '}{t("ödeme • son")}{' '}{formatDateTr(c.last_charge_date)}
                        </span>
                        {c.previous_amount !== null && c.previous_amount < c.amount && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20 font-medium">
                            <TrendingUp className="w-3 h-3" />{t("Zam:")}{' '}{formatMoney(c.previous_amount, c.currency)} → {formatMoney(c.amount, c.currency)}
                          </span>
                        )}
                        {c.already_tracked && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border bg-slate-500/10 text-slate-600 dark:text-slate-300 border-slate-500/20 font-medium">
                            <CheckCircle2 className="w-3 h-3" />{t("Zaten ekli")}</span>
                        )}
                      </div>
                      {c.matched_descriptions.length > 0 && (
                        <p className="mt-1 text-[11px] text-slate-400 truncate">{t("Ekstrede:")}{' '}{c.matched_descriptions.join(' • ')}
                        </p>
                      )}
                    </div>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {error && (
        <div className="mt-4 flex items-start gap-2 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-700 dark:text-rose-300 text-xs">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
    </Modal>
  );
}
