import type { Receipt, ReceiptItem } from '../services/api';

const currencyFormatter = new Intl.NumberFormat('tr-TR', {
  style: 'currency',
  currency: 'TRY',
  minimumFractionDigits: 2,
});

const numberFormatter = new Intl.NumberFormat('tr-TR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatCurrency(value: number): string {
  return currencyFormatter.format(value || 0);
}

export function formatNumberTr(value: number): string {
  return numberFormatter.format(value || 0);
}

export function formatQuantity(qty: number): string {
  if (!qty || qty <= 0) return '1';
  return Number.isInteger(qty) ? String(qty) : qty.toLocaleString('tr-TR');
}

export function formatDateTr(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  return y && m && d ? `${d}.${m}.${y}` : isoDate;
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
