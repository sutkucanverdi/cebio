import type { BillingCycle, CurrencyTotal, SubscriptionStatus } from '../services/api';

export const CYCLE_LABELS: Record<BillingCycle, string> = {
  weekly: 'Haftalık',
  monthly: 'Aylık',
  quarterly: '3 Aylık',
  yearly: 'Yıllık',
};

export const CYCLE_SUFFIX: Record<BillingCycle, string> = {
  weekly: '/hafta',
  monthly: '/ay',
  quarterly: '/3 ay',
  yearly: '/yıl',
};

export const STATUS_LABELS: Record<SubscriptionStatus, string> = {
  active: 'Aktif',
  trial: 'Deneme',
  paused: 'Durduruldu',
  cancelled: 'İptal Edildi',
};

export const STATUS_BADGE: Record<SubscriptionStatus, string> = {
  active: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20',
  trial: 'bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/20',
  paused: 'bg-slate-500/10 text-slate-600 dark:text-slate-300 border-slate-500/20',
  cancelled: 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20',
};

export const SUBSCRIPTION_CATEGORIES = [
  'Dizi & Film',
  'Müzik',
  'Spor',
  'Bulut Depolama',
  'Yazılım',
  'Oyun',
  'Eğitim',
  'Kitap',
  'Spor Salonu',
  'Fatura & İletişim',
  'Diğer',
];

export const CURRENCIES = ['TRY', 'USD', 'EUR', 'GBP'];

const moneyFormatters = new Map<string, Intl.NumberFormat>();

export function formatMoney(amount: number, currency = 'TRY'): string {
  let fmt = moneyFormatters.get(currency);
  if (!fmt) {
    try {
      fmt = new Intl.NumberFormat('tr-TR', { style: 'currency', currency, minimumFractionDigits: 2 });
    } catch {
      fmt = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    moneyFormatters.set(currency, fmt);
  }
  return fmt.format(amount || 0);
}

/** TRY toplamı + varsa diğer para birimleri: "₺1.240,00 + $20,00" */
export function formatTotals(totals: CurrencyTotal[]): string {
  if (totals.length === 0) return formatMoney(0);
  return totals.map((t) => formatMoney(t.amount, t.currency)).join(' + ');
}

export function relativeDays(days: number): string {
  if (days < 0) return `${Math.abs(days)} gün önce`;
  if (days === 0) return 'Bugün';
  if (days === 1) return 'Yarın';
  return `${days} gün sonra`;
}

/** Abonelik adından avatar rengi (her servis hep aynı rengi alır). */
const AVATAR_COLORS = [
  'from-emerald-500 to-teal-600',
  'from-indigo-500 to-violet-600',
  'from-amber-500 to-orange-600',
  'from-pink-500 to-rose-600',
  'from-cyan-500 to-sky-600',
  'from-fuchsia-500 to-purple-600',
];

export function avatarGradient(name: string): string {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toLocaleUpperCase('tr-TR');
  return (words[0][0] + words[1][0]).toLocaleUpperCase('tr-TR');
}
