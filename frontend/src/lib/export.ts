import type { Receipt } from '../services/api';
import { getUnitPrice, safeQuantity, todayIso } from './format';

export interface ExportRow {
  date: string;
  merchant: string;
  category: string;
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

const HEADERS: { key: keyof ExportRow; label: string; width: number; money?: boolean }[] = [
  { key: 'date', label: 'Tarih', width: 14 },
  { key: 'merchant', label: 'Mağaza', width: 26 },
  { key: 'category', label: 'Kategori', width: 18 },
  { key: 'name', label: 'Ürün Adı', width: 32 },
  { key: 'quantity', label: 'Adet', width: 10 },
  { key: 'unitPrice', label: 'Birim Fiyat (₺)', width: 16, money: true },
  { key: 'total', label: 'Toplam Tutar (₺)', width: 18, money: true },
];

const round2 = (n: number) => Math.round(n * 100) / 100;

export function buildExportRows(receipts: Receipt[], categoryFilter: string): ExportRow[] {
  const target = categoryFilter.toLowerCase();
  const rows: ExportRow[] = [];

  for (const receipt of receipts) {
    const items = target
      ? receipt.items.filter((i) => i.category.toLowerCase() === target)
      : receipt.items;

    if (items.length === 0) {
      rows.push({
        date: receipt.date,
        merchant: receipt.merchant,
        category: 'Diğer',
        name: 'Genel Fiş Tutarı',
        quantity: 1,
        unitPrice: round2(receipt.total_amount),
        total: round2(receipt.total_amount),
      });
      continue;
    }

    for (const item of items) {
      rows.push({
        date: receipt.date,
        merchant: receipt.merchant,
        category: item.category,
        name: item.name,
        quantity: safeQuantity(item.quantity),
        unitPrice: round2(getUnitPrice(item)),
        total: round2(item.price),
      });
    }
  }
  return rows;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function escapeCsvCell(value: string | number): string {
  let str = String(value ?? '');
  // CSV/Formula injection koruması: Excel'de =, +, -, @ ile başlayan hücreler formül olarak çalışır.
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  if (/[",;\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function exportCsv(rows: ExportRow[]): void {
  const lines = [HEADERS.map((h) => h.label).join(',')];
  for (const row of rows) {
    lines.push(
      HEADERS.map((h) => {
        const v = row[h.key];
        return escapeCsvCell(h.money && typeof v === 'number' ? v.toFixed(2) : v);
      }).join(',')
    );
  }
  // UTF-8 BOM ile Excel'de Türkçe karakterler doğru görünür
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, `cebio-harcamalar-${todayIso()}.csv`);
}

export async function exportExcel(rows: ExportRow[]): Promise<void> {
  // exceljs büyük bir paket; yalnızca kullanıcı Excel indirmek istediğinde yüklenir.
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Cebio';
  const sheet = workbook.addWorksheet('Harcamalar', { views: [{ state: 'frozen', ySplit: 1 }] });

  sheet.columns = HEADERS.map((h) => ({
    header: h.label,
    key: h.key,
    width: h.width,
    style: h.money ? { numFmt: '#,##0.00' } : undefined,
  }));
  sheet.getRow(1).font = { bold: true };
  sheet.addRows(rows);

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  downloadBlob(blob, `cebio-harcamalar-${todayIso()}.xlsx`);
}
