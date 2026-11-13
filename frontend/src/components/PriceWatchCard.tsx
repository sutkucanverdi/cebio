/**
 * Kişisel Enflasyon: kullanıcının fişlerinde tekrar aldığı ürünlerin birim fiyat değişimi.
 * "Resmi enflasyon değil, SENİN sepetin ne kadar pahalandı?" sorusunu cevaplar.
 */
import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Loader2, TrendingDown, TrendingUp, Flame } from 'lucide-react';
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { t } from '../i18n';
import { formatCurrency, formatDateTr, formatPercent } from '../lib/format';
import { getApiErrorMessage, getPriceHistory, getPriceWatch, PriceHistory, PriceWatch, PriceWatchItem } from '../services/api';
import { CARD_SURFACE_CLASS } from './ui';

function pctText(pct: number): string {
  return formatPercent(Math.abs(pct), 1);
}

function ChangePill({ pct, big = false }: { pct: number; big?: boolean }) {
  const up = pct > 0.05;
  const down = pct < -0.05;
  const Icon = up ? TrendingUp : TrendingDown;
  const cls = up
    ? 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30'
    : down
    ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
    : 'bg-slate-500/10 text-slate-600 dark:text-slate-300 border-slate-500/20';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border font-semibold ${cls} ${
        big ? 'px-3 py-1 text-sm' : 'px-2 py-0.5 text-[11px]'
      }`}
    >
      {(up || down) && <Icon className={big ? 'w-4 h-4' : 'w-3 h-3'} />}
      {up ? '+' : down ? '−' : ''}
      {pctText(pct)}
    </span>
  );
}

function HistoryChart({ name }: { name: string }) {
  const [data, setData] = useState<PriceHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    getPriceHistory(name)
      .then(setData)
      .catch((err) => setError(getApiErrorMessage(err, t('Fiyat geçmişi alınamadı.'))));
  }, [name]);

  if (error) return <p className="text-xs text-rose-600 dark:text-rose-400 py-2">{error}</p>;
  if (!data) return <Loader2 className="w-4 h-4 animate-spin text-emerald-500 my-3 mx-auto" />;
  const points = data.points.map((p) => ({ ...p, label: formatDateTr(p.date) }));
  return (
    <div className="h-36 -ml-2">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
          <YAxis
            width={52}
            tick={{ fontSize: 10, fill: '#94a3b8' }}
            axisLine={false}
            tickLine={false}
            domain={['dataMin - 1', 'dataMax + 1']}
            tickFormatter={(v: number) => formatCurrency(v).replace(/[,.]00(?=\D*$)/, '')}
          />
          <Tooltip
            formatter={(v: number) => [formatCurrency(v), t('Birim fiyat')]}
            labelFormatter={(label: string, payload) => {
              const merchant = payload?.[0]?.payload?.merchant as string | undefined;
              return merchant ? `${label} • ${merchant}` : label;
            }}
            contentStyle={{ borderRadius: 12, fontSize: 12 }}
          />
          <Line type="monotone" dataKey="unit_price" stroke="#f43f5e" strokeWidth={2} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function ItemRow({ item, open, onToggle }: { item: PriceWatchItem; open: boolean; onToggle: () => void }) {
  return (
    <li className="py-2.5">
      <button type="button" onClick={onToggle} className="w-full flex items-center gap-3 text-left" aria-expanded={open}>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">{item.name}</p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            {formatCurrency(item.first_price)} → <strong>{formatCurrency(item.last_price)}</strong>
            {' • '}
            {t('{0} kez alındı', { 0: item.purchases })}
          </p>
        </div>
        <ChangePill pct={item.change_pct} />
        {open ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
      </button>
      {open && <HistoryChart name={item.name} />}
    </li>
  );
}

export function PriceWatchCard({ reloadKey }: { reloadKey: number }) {
  const [data, setData] = useState<PriceWatch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openName, setOpenName] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getPriceWatch(12)
      .then((d) => !cancelled && setData(d))
      .catch((err) => !cancelled && setError(getApiErrorMessage(err, t('Fiyat takibi yüklenemedi.'))));
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const items = data?.items ?? [];
  const visible = showAll ? items : items.slice(0, 5);

  return (
    <section className={`${CARD_SURFACE_CLASS} p-6`}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
        <div>
          <div className="flex items-center gap-2">
            <Flame className="w-4 h-4 text-rose-500" />
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">{t('Kişisel Enflasyon')}</h2>
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-600 dark:text-rose-300">
              {t('YENİ')}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {t('Fişlerinde tekrar aldığın ürünlerin fiyatı son 12 ayda nasıl değişti?')}
          </p>
        </div>
        {data?.basket_change_pct != null && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 dark:text-slate-400">{t('Senin sepetin')}</span>
            <ChangePill pct={data.basket_change_pct} big />
          </div>
        )}
      </div>

      {error && <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
      {!data && !error && <Loader2 className="w-5 h-5 animate-spin text-emerald-500 mx-auto my-6" />}
      {data && items.length === 0 && (
        <p className="text-sm text-slate-500 dark:text-slate-400 py-4 text-center">
          {t('Aynı ürünü farklı günlerde en az iki kez aldığında fiyat değişimini burada görürsün.')}
        </p>
      )}
      {items.length > 0 && (
        <>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {visible.map((item) => (
              <ItemRow
                key={item.name}
                item={item}
                open={openName === item.name}
                onToggle={() => setOpenName((prev) => (prev === item.name ? null : item.name))}
              />
            ))}
          </ul>
          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="text-[11px] text-slate-400">
              {t('{0} ürün takip ediliyor • {1} tarihinden beri', {
                0: data!.tracked_items,
                1: formatDateTr(data!.since),
              })}
            </p>
            {items.length > 5 && (
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline"
              >
                {showAll ? t('Daha az göster') : t('Tümünü göster')}
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
