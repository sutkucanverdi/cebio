import { PieChart as PieChartIcon } from 'lucide-react';
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, TooltipProps } from 'recharts';
import type { CategoryBreakdown, ReceiptSummary } from '../services/api';
import { formatCurrency, formatQuantity, formatPercent } from '../lib/format';
import { CARD_SURFACE_CLASS, CHART_COLORS } from './ui';

import { categoryLabel, t } from '../i18n';
interface CustomPieTooltipProps extends TooltipProps<number, string> {
  totalAmount: number;
}

function CustomPieTooltip({ active, payload, totalAmount }: CustomPieTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  const item = payload[0];
  const data = item.payload as CategoryBreakdown;
  const amount = Number(item.value ?? data.total_amount ?? 0);
  const pct = totalAmount > 0 ? ((amount / totalAmount) * 100).toFixed(1) : '0.0';

  return (
    <div className="bg-white/95 text-slate-800 border border-slate-200 shadow-lg backdrop-blur-sm rounded-xl p-2.5 dark:bg-slate-900/95 dark:text-white dark:border-slate-700 min-w-[175px]">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-xs font-semibold">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: item.color || '#10b981' }} />
          {categoryLabel(data.category)}
        </span>
        <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {formatPercent(Number(pct))}
        </span>
      </div>
      <div className="mt-1.5 flex items-baseline justify-between gap-3 border-t border-slate-100 dark:border-slate-800 pt-1.5">
        <span className="text-[11px] text-slate-500 dark:text-slate-400">{formatQuantity(data.item_count)}{' '}{t("ürün")}</span>
        <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(amount)}</span>
      </div>
      <p className="mt-1 text-[10px] text-slate-400 dark:text-slate-500">{t("Filtrelemek için tıklayın")}</p>
    </div>
  );
}

interface CategoryChartProps {
  summary: ReceiptSummary;
  categoryFilter: string;
  darkMode: boolean;
  onToggleCategory: (category: string) => void;
}

export function CategoryChart({ summary, categoryFilter, darkMode, onToggleCategory }: CategoryChartProps) {
  const breakdown = summary.category_breakdown;
  const selectedTotal = categoryFilter
    ? breakdown.find((c) => c.category === categoryFilter)?.total_amount ?? summary.total_amount
    : summary.total_amount;

  return (
    <div className={`lg:col-span-7 ${CARD_SURFACE_CLASS} p-6 flex flex-col`}>
      <div className="flex items-center justify-between mb-4 gap-3">
        <div>
          <div className="flex items-center gap-2">
            <PieChartIcon className="w-4 h-4 text-indigo-500" />
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">{t("Kategori Bazlı Harcama Dağılımı")}</h2>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{t("Tabloyu filtrelemek için grafikteki bir dilime veya kategoriye tıklayın.")}</p>
        </div>
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400 shrink-0">
          {breakdown.length}{' '}{t("aktif kategori")}</span>
      </div>

      {breakdown.length === 0 ? (
        <div className="flex-1 min-h-[260px] flex flex-col items-center justify-center text-center text-slate-400">
          <PieChartIcon className="w-10 h-10 mb-2 opacity-40" />
          <p className="text-sm font-medium">{t("Henüz harcama verisi bulunmuyor")}</p>
          <p className="text-xs mt-1">{t("İlk fişinizi yüklediğinizde kategori dağılım grafiği burada oluşacaktır.")}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-center flex-1">
          <div className="md:col-span-7 h-[270px] relative">
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center pb-7">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                {categoryFilter || 'Toplam'}
              </span>
              <span className="text-sm font-bold text-slate-800 dark:text-slate-100 mt-0.5">
                {formatCurrency(selectedTotal)}
              </span>
            </div>

            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={breakdown}
                  dataKey="total_amount"
                  nameKey="category"
                  cx="50%"
                  cy="48%"
                  innerRadius={62}
                  outerRadius={94}
                  paddingAngle={2}
                  className="cursor-pointer outline-none"
                  onClick={(data: CategoryBreakdown) => data?.category && onToggleCategory(data.category)}
                >
                  {breakdown.map((entry, index) => (
                    <Cell
                      key={`cell-${entry.category}`}
                      fill={CHART_COLORS[index % CHART_COLORS.length]}
                      fillOpacity={!categoryFilter || categoryFilter === entry.category ? 1 : 0.3}
                      stroke={darkMode ? '#0f172a' : '#ffffff'}
                      strokeWidth={categoryFilter === entry.category ? 3 : 2}
                      className="cursor-pointer transition-opacity"
                    />
                  ))}
                </Pie>
                <Tooltip
                  content={<CustomPieTooltip totalAmount={summary.total_amount} />}
                  wrapperStyle={{ outline: 'none' }}
                />
                <Legend
                  verticalAlign="bottom"
                  height={32}
                  formatter={(value: string) => (
                    <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{categoryLabel(value)}</span>
                  )}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="md:col-span-5 flex flex-col justify-center space-y-2.5 max-h-[320px] overflow-y-auto scrollbar-thin pr-1">
            {breakdown.map((cat, idx) => {
              const pct = summary.total_amount > 0 ? Math.round((cat.total_amount / summary.total_amount) * 100) : 0;
              const isSelected = categoryFilter === cat.category;
              return (
                <button
                  key={cat.category}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => onToggleCategory(cat.category)}
                  className={`w-full text-left p-3 rounded-xl border transition ${
                    isSelected
                      ? 'bg-emerald-500/10 dark:bg-emerald-500/15 border-emerald-500 ring-1 ring-emerald-500/40'
                      : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs font-medium gap-2">
                    <span className="flex items-center gap-2 truncate text-slate-800 dark:text-slate-100">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: CHART_COLORS[idx % CHART_COLORS.length] }}
                      />
                      <span className="font-semibold truncate">{categoryLabel(cat.category)}</span>
                    </span>
                    <span className="font-semibold text-slate-900 dark:text-white shrink-0">
                      {formatCurrency(cat.total_amount)}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                    <span>{formatQuantity(cat.item_count)}{' '}{t("ürün")}</span>
                    <span className="font-medium">{formatPercent(Number(pct))}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
