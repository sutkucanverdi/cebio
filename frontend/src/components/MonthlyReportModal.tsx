import { useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Landmark,
  Lightbulb,
  Loader2,
  ReceiptText,
  Repeat,
  Target,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { formatCurrency, formatDateTr, formatPercent } from '../lib/format';
import { getApiErrorMessage, getMonthlyReport, getReportMonths, MonthlyReport } from '../services/api';
import { CHART_COLORS, Modal } from './ui';

import { categoryLabel, t } from '../i18n';
function ChangeBadge({ pct, small = false }: { pct: number | null; small?: boolean }) {
  if (pct === null) return small ? <span className="text-[10px] text-slate-400">{t("yeni")}</span> : null;
  const up = pct > 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-md font-semibold ${
        small ? 'text-[10px] px-1 py-0.5' : 'text-xs px-1.5 py-0.5'
      } ${up ? 'bg-rose-500/10 text-rose-700 dark:text-rose-400' : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'}`}
    >
      <Icon className={small ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
      {up ? '+' : pct < 0 ? '−' : ''}
      {formatPercent(Math.round(Math.abs(pct)))}
    </span>
  );
}

function Section({ title, icon: Icon, children }: { title: string; icon: typeof Lightbulb; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2 flex items-center gap-1.5">
        <Icon className="w-3.5 h-3.5" /> {title}
      </h3>
      {children}
    </section>
  );
}

function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

interface MonthlyReportModalProps {
  /** Açılacak ay (YYYY-MM); verilmezse tamamlanmış son ay */
  initialMonth?: string;
  onClose: () => void;
}

export function MonthlyReportModal({ initialMonth, onClose }: MonthlyReportModalProps) {
  const [month, setMonth] = useState<string | undefined>(initialMonth);
  const [report, setReport] = useState<MonthlyReport | null>(null);
  const [months, setMonths] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getReportMonths().then(setMonths).catch(() => setMonths([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    getMonthlyReport(month)
      .then((r) => !cancelled && setReport(r))
      .catch((err) => !cancelled && setError(getApiErrorMessage(err, t("Rapor oluşturulamadı."))))
      .finally(() => !cancelled && setIsLoading(false));
    return () => {
      cancelled = true;
    };
  }, [month]);

  const current = report?.month ?? month;
  const thisMonth = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }, []);
  const oldest = months.length ? months[months.length - 1] : undefined;
  const canPrev = current !== undefined && (!oldest || current > oldest);
  const canNext = current !== undefined && current < thisMonth;
  const maxCategory = Math.max(1, ...(report?.by_category.map((c) => c.total) ?? [1]));

  return (
    <Modal title={t("Aylık Rapor")} onClose={onClose} wide>
      <div className="flex items-center justify-between gap-2 mb-4">
        <button
          type="button"
          disabled={!canPrev || isLoading}
          onClick={() => current && setMonth(shiftMonth(current, -1))}
          aria-label={t("Önceki ay")}
          className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="text-center">
          <p className="text-base font-bold text-slate-900 dark:text-white">{report?.label ?? '…'}</p>
          {report && !report.is_complete && <p className="text-[11px] text-amber-600 dark:text-amber-400">{t("Ay henüz bitmedi")}</p>}
        </div>
        <button
          type="button"
          disabled={!canNext || isLoading}
          onClick={() => current && setMonth(shiftMonth(current, 1))}
          aria-label={t("Sonraki ay")}
          className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {isLoading && !report && (
        <div className="py-12 flex justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-emerald-500" />
        </div>
      )}
      {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}

      {report && (
        <div className={`space-y-6 transition-opacity ${isLoading ? 'opacity-50' : ''}`}>
          <div className="rounded-2xl bg-gradient-to-br from-emerald-500/10 to-indigo-500/10 border border-emerald-500/20 p-4">
            <p className="text-xs text-slate-500 dark:text-slate-400">{t("Toplam harcama")}</p>
            <div className="flex items-baseline gap-2 flex-wrap">
              <p className="text-3xl font-bold text-slate-900 dark:text-white">{formatCurrency(report.total)}</p>
              <ChangeBadge pct={report.change_pct} />
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              {report.previous_label}: {formatCurrency(report.previous_total)}{' '}{t("• Günlük ortalama")}{' '}
              {formatCurrency(report.daily_average)}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                <ReceiptText className="w-3.5 h-3.5 text-emerald-500" />{t("Fişler:")}{' '}<strong>{formatCurrency(report.receipts_total)}</strong> ({report.receipt_count})
              </div>
              <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                <Landmark className="w-3.5 h-3.5 text-indigo-500" />{t("Banka/Kart:")}{' '}<strong>{formatCurrency(report.bank_total)}</strong> ({report.bank_transaction_count})
              </div>
            </div>
          </div>

          {report.insights.length > 0 && (
            <Section title={t("Öne çıkanlar")} icon={Lightbulb}>
              <ul className="space-y-1.5">
                {report.insights.map((text) => (
                  <li key={text} className="flex gap-2 text-sm text-slate-700 dark:text-slate-200">
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                    {text}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {report.by_category.length > 0 && (
            <Section title={t("Kategoriler")} icon={Target}>
              <ul className="space-y-2.5">
                {report.by_category.map((c, i) => (
                  <li key={c.category}>
                    <div className="flex items-center justify-between gap-2 text-xs mb-1">
                      <span className="font-medium text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                        {categoryLabel(c.category)} <ChangeBadge pct={c.change_pct} small />
                      </span>
                      <span className="font-semibold text-slate-900 dark:text-white">{formatCurrency(c.total)}</span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.max(2, (c.total / maxCategory) * 100)}%`,
                          backgroundColor: CHART_COLORS[i % CHART_COLORS.length],
                        }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {report.top_merchants.length > 0 && (
              <Section title={t("En çok harcanan yerler")} icon={TrendingUp}>
                <ol className="space-y-1.5 text-sm">
                  {report.top_merchants.map((m, i) => (
                    <li key={m.merchant} className="flex items-center justify-between gap-2">
                      <span className="truncate text-slate-700 dark:text-slate-200">
                        <span className="text-slate-400 mr-1.5">{i + 1}.</span>
                        {m.merchant}
                        <span className="text-[11px] text-slate-400"> ×{m.count}</span>
                      </span>
                      <span className="font-semibold text-slate-900 dark:text-white shrink-0">{formatCurrency(m.total)}</span>
                    </li>
                  ))}
                </ol>
              </Section>
            )}
            {report.top_expenses.length > 0 && (
              <Section title={t("En büyük harcamalar")} icon={ReceiptText}>
                <ul className="space-y-1.5 text-sm">
                  {report.top_expenses.map((e, i) => (
                    <li key={`${e.merchant}-${e.date}-${i}`} className="flex items-center justify-between gap-2">
                      <span className="truncate text-slate-700 dark:text-slate-200">
                        {e.merchant}
                        <span className="text-[11px] text-slate-400">
                          {' '}
                          • {formatDateTr(e.date).slice(0, 5)} • {e.source === 'bank' ? 'kart' : t("fiş")}
                        </span>
                      </span>
                      <span className="font-semibold text-slate-900 dark:text-white shrink-0">{formatCurrency(e.amount)}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}
          </div>

          {(report.subscriptions.active_count > 0 || report.budgets.length > 0) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {report.subscriptions.active_count > 0 && (
                <Section title={t("Abonelikler")} icon={Repeat}>
                  <p className="text-sm text-slate-700 dark:text-slate-200">
                    {report.subscriptions.active_count}{' '}{t("aktif abonelik •")}{' '}
                    <strong>{formatCurrency(report.subscriptions.monthly_fixed_try)}</strong>{t("/ay")}</p>
                  {report.subscriptions.price_increases.map((p) => (
                    <p key={`${p.name}-${p.changed_at}`} className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                      {p.name}{' '}{t("zam yaptı:")}{' '}{formatCurrency(p.old_amount)} → {formatCurrency(p.new_amount)}
                    </p>
                  ))}
                  {report.subscriptions.new_subscriptions.length > 0 && (
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{t("Bu ay eklenen:")}{' '}{report.subscriptions.new_subscriptions.join(', ')}
                    </p>
                  )}
                </Section>
              )}
              {report.budgets.length > 0 && (
                <Section title={t("Bütçeler")} icon={Target}>
                  <ul className="space-y-1 text-sm">
                    {report.budgets.map((b) => (
                      <li key={b.id} className="flex items-center justify-between gap-2">
                        <span className="text-slate-700 dark:text-slate-200">{categoryLabel(b.category ?? 'Genel')}</span>
                        <span
                          className={`text-xs font-semibold ${
                            b.state === 'exceeded'
                              ? 'text-rose-600 dark:text-rose-400'
                              : b.state === 'warning'
                              ? 'text-amber-600 dark:text-amber-400'
                              : 'text-emerald-600 dark:text-emerald-400'
                          }`}
                        >
                          {formatCurrency(b.spent)} / {formatCurrency(b.monthly_limit)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
