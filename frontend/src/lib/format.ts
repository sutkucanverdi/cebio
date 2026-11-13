import { getLocaleTag } from '../i18n';
import type { Receipt, ReceiptItem } from '../services/api';

/** Gemini'nin fiş ürünlerine atadığı kategoriler (backend SYSTEM_PROMPT ile aynı liste). */
export const RECEIPT_CATEGORIES = [
  'Gıda',
  'Atıştırmalık',
  'İçecek',
  'Temizlik',
  'Kişisel Bakım',
  'Ev & Yaşam',
  'Elektronik',
  'Giyim',
  'Restoran & Kafe',
  'Ulaşım',
  'Diğer',
];

/** Banka/kart işlemleri için kategoriler (backend services/categories.py SPENDING_CATEGORIES ile aynı). */
export const SPENDING_CATEGORIES = [
  ...RECEIPT_CATEGORIES.slice(0, -1),
  'Fatura & İletişim',
  'Sağlık',
  'Eğlence',
  'Eğitim',
  'Abonelik',
  'Nakit & Transfer',
  'Diğer',
];

// Biçimlendiriciler dile göre önbelleğe alınır (dil değişince yenisi oluşturulur)
const formatters = new Map<string, Intl.NumberFormat>();
function nf(kind: 'currency' | 'number'): Intl.NumberFormat {
  const key = `${getLocaleTag()}:${kind}`;
  let fmt = formatters.get(key);
  if (!fmt) {
    fmt =
      kind === 'currency'
        ? new Intl.NumberFormat(getLocaleTag(), { style: 'currency', currency: 'TRY', minimumFractionDigits: 2 })
        : new Intl.NumberFormat(getLocaleTag(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    formatters.set(key, fmt);
  }
  return fmt;
}

export function formatCurrency(value: number): string {
  return nf('currency').format(value || 0);
}

export function formatNumberTr(value: number): string {
  return nf('number').format(value || 0);
}

/** 45 -> "%45" (tr) / "45%" (en); ondalık en fazla 1 hane. */
export function formatPercent(value: number, digits = 0): string {
  const n = new Intl.NumberFormat(getLocaleTag(), { maximumFractionDigits: digits }).format(value);
  return getLocaleTag() === 'tr-TR' ? `%${n}` : `${n}%`;
}

/** 2026-11-01 tarihli Date -> "Kasım 2026" / "November 2026" */
export function monthLabel(d: Date): string {
  const text = d.toLocaleDateString(getLocaleTag(), { month: 'long', year: 'numeric' });
  return text.charAt(0).toLocaleUpperCase(getLocaleTag()) + text.slice(1);
}

export function formatQuantity(qty: number): string {
  if (!qty || qty <= 0) return '1';
  return Number.isInteger(qty) ? String(qty) : qty.toLocaleString(getLocaleTag());
}

/** YYYY-MM-DD -> 13.11.2026 (tr) / 11/13/2026 (en). Saat dilimi kaymasın diye elle biçimlenir. */
export function formatDateTr(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  if (!(y && m && d)) return isoDate;
  return getLocaleTag() === 'en-US' ? `${m}/${d.slice(0, 2)}/${y}` : `${d.slice(0, 2)}.${m}.${y}`;
}

export function safeQuantity(qty: number | null | undefined): number {
  return qty && qty > 0 ? qty : 1;
}

export function getUnitPrice(item: Pick<ReceiptItem, 'unit_price' | 'price' | 'quantity'>): number {
  if (item.unit_price !== null && item.unit_price !== undefined && item.unit_price > 0) {
    return item.unit_price;
  }
  return item.price / safeQuantity(item.quantity);
}

export function getReceiptTotalQuantity(receipt: Receipt): number {
  return receipt.items.reduce((sum, item) => sum + safeQuantity(item.quantity), 0);
}

/** Kalemlerin toplamı ile fişin genel toplamı arasındaki fark (kuruş hassasiyetinde). */
export function getItemsTotalMismatch(receipt: Receipt): number {
  const itemsTotal = receipt.items.reduce((sum, item) => sum + (item.price || 0), 0);
  return Math.round((receipt.total_amount - itemsTotal) * 100) / 100;
}

export function todayIso(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}
