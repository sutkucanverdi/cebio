import { Receipt as ReceiptIcon, TrendingUp, Wallet } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReceiptSummary } from '../services/api';
import { formatCurrency, formatQuantity } from '../lib/format';
import { CARD_SURFACE_CLASS } from './ui';

interface StatCardProps {
  label: string;
  value: string;
  hint: string;
  Icon: LucideIcon;
  accent: string;
}

function StatCard({ label, value, hint, Icon, accent }: StatCardProps) {
  return (
    <div className={`${CARD_SURFACE_CLASS} p-6 flex items-center justify-between gap-4`}>
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</p>
        <p className="text-2xl sm:text-3xl font-bold mt-2 text-slate-900 dark:text-white truncate">{value}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 truncate">{hint}</p>
      </div>
      <div
        className={`w-12 h-12 rounded-2xl bg-slate-100 border border-slate-200 dark:border-transparent flex items-center justify-center shrink-0 ${accent}`}
      >
        <Icon className="w-6 h-6" />
      </div>
    </div>
  );
}

export function StatCards({ summary, isFiltered }: { summary: ReceiptSummary; isFiltered: boolean }) {
  const top = summary.category_breakdown[0] ?? null;
  return (
    <section className="grid grid-cols-1 md:grid-cols-3 gap-5">
      <StatCard
        label="Toplam Harcama Tutarı"
        value={formatCurrency(summary.total_amount)}
        hint={isFiltered ? 'Seçili mağaza / tarih filtresine göre' : 'Tüm kayıtlı fişlerin genel toplamı'}
        Icon={Wallet}
        accent="text-emerald-600 dark:text-emerald-500 dark:bg-emerald-500/10"
      />
      <StatCard
        label="Kaydedilen Fiş Sayısı"
        value={String(summary.total_receipts)}
        hint="AI tarafından ayrıştırılan belge"
        Icon={ReceiptIcon}
        accent="text-indigo-600 dark:text-indigo-500 dark:bg-indigo-500/10"
      />
      <StatCard
        label="Lider Harcama Kategorisi"
        value={top ? top.category : '—'}
        hint={
          top
            ? `${formatCurrency(top.total_amount)} (${formatQuantity(top.item_count)} ürün)`
            : 'Henüz kategori verisi yok'
        }
        Icon={TrendingUp}
        accent="text-amber-600 dark:text-amber-500 dark:bg-amber-500/10"
      />
    </section>
  );
}
