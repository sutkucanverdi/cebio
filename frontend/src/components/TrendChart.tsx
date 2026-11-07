import { useEffect, useState } from 'react';
import { BarChart3, TrendingDown, TrendingUp } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatCurrency } from '../lib/format';
import { getTrend, TrendPoint } from '../services/api';
import { CARD_SURFACE_CLASS } from './ui';

const oneDecimal = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });

/** Eksen etiketi: 6000 -> "₺6 bin", 1500000 -> "₺1,5 mn" ("B" milyar sanılmasın diye açık yazılır). */
function axisLabel(v: number): string {
  if (v >= 1_000_000) return `₺${oneDecimal.format(v / 1_000_000)} mn`;
  if (v >= 1_000) return `₺${oneDecimal.format(v / 1_000)} bin`;
  return `₺${oneDecimal.format(v)}`;
}

interface TrendChartProps {
  darkMode: boolean;
  /** Veriler değiştiğinde (fiş eklendi/silindi) artar ve grafik yeniden yüklenir. */
  reloadKey: number;
}

export function TrendChart({ darkMode, reloadKey }: TrendChartProps) {
  const [points, setPoints] = useState<TrendPoint[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getTrend(6)
      .then((data) => {
        if (!cancelled) {
          setPoints(data);
          setFailed(false);
        }
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const current = points[points.length - 1];
  const previous = points[points.length - 2];
  const change =
    // Bu ay henüz fiş yoksa "-%100" gibi yanıltıcı bir karşılaştırma gösterme
    current && previous && previous.total > 0 && current.total > 0
      ? ((current.total - previous.total) / previous.total) * 100
      : null;
  const hasData = points.some((p) => p.total > 0);
  const axisColor = darkMode ? '#94a3b8' : '#64748b';

  return (
    <div className={`lg:col-span-7 ${CARD_SURFACE_CLASS} p-6 flex flex-col`}>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-indigo-500" />
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">Aylık Harcama Trendi</h2>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Son 6 ay • fişler + banka/kart</p>
        </div>
        {change !== null && (
          <span
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold ${
              change > 0
                ? 'bg-rose-500/10 text-rose-700 dark:text-rose-400'
                : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
            }`}
            title="Bu ayın şu ana kadarki toplamı, geçen ayın tamamına göre"
          >
            {change > 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
            {change > 0 ? '+' : ''}
            {change.toFixed(0)}% geçen aya göre
          </span>
        )}
      </div>

      {failed ? (
        <p className="flex-1 min-h-[220px] flex items-center justify-center text-xs text-slate-400">
          Trend verisi yüklenemedi.
        </p>
      ) : !hasData ? (
        <p className="flex-1 min-h-[220px] flex items-center justify-center text-center text-xs text-slate-400">
          Fiş veya ekstre ekledikçe aylık harcama grafiğiniz burada oluşacak.
        </p>
      ) : (
        <div className="h-[230px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={points} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={darkMode ? '#1e293b' : '#e2e8f0'} />
              <XAxis dataKey="label" tick={{ fill: axisColor, fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis
                tick={{ fill: axisColor, fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={52}
                tickFormatter={axisLabel}
              />
              <Tooltip
                cursor={{ fill: darkMode ? 'rgba(148,163,184,0.08)' : 'rgba(100,116,139,0.08)' }}
                contentStyle={{
                  background: darkMode ? '#0f172a' : '#ffffff',
                  border: `1px solid ${darkMode ? '#334155' : '#e2e8f0'}`,
                  borderRadius: 12,
                  fontSize: 12,
                }}
                labelStyle={{ color: darkMode ? '#e2e8f0' : '#0f172a', fontWeight: 600 }}
                formatter={(value: number, name: string) => [formatCurrency(value), name]}
                labelFormatter={(label: string, payload) => {
                  const p = payload?.[0]?.payload as TrendPoint | undefined;
                  return p ? `${label} • toplam ${formatCurrency(p.total)}` : label;
                }}
              />
              <Legend
                verticalAlign="top"
                align="right"
                height={24}
                iconType="circle"
                iconSize={8}
                formatter={(value: string) => <span className="text-[11px] text-slate-500 dark:text-slate-400">{value}</span>}
              />
              <Bar dataKey="receipts_total" name="Fişler" stackId="s" fill="#10b981" maxBarSize={44} />
              <Bar dataKey="bank_total" name="Banka/Kart" stackId="s" fill="#6366f1" radius={[6, 6, 0, 0]} maxBarSize={44} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
