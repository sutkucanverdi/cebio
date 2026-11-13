import { categoryLabel, t } from '../i18n';
import type { Receipt } from '../services/api';
import { isNative } from './native';
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
        category: categoryLabel('Diğer'),
        name: t('Genel Fiş Tutarı'),
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
        category: categoryLabel(item.category),
        name: item.name,
        quantity: safeQuantity(item.quantity),
        unitPrice: round2(getUnitPrice(item)),
        total: round2(item.price),
      });
    }
  }
  return rows;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Web'de dosyayı indirir. Telefonda WebView indirme yapamadığı için dosya uygulama önbelleğine yazılır
 * ve sistem paylaşım menüsü açılır (Dosyalar'a kaydet, e-postayla gönder, Drive...).
 */
async function downloadBlob(blob: Blob, filename: string): Promise<void> {
  if (isNative()) {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([
      import('@capacitor/filesystem'),
      import('@capacitor/share'),
    ]);
    const written = await Filesystem.writeFile({
      path: filename,
      data: await blobToBase64(blob),
      directory: Directory.Cache,
    });
    await Share.share({ title: filename, files: [written.uri], dialogTitle: t('Dosyayı paylaş veya kaydet') });
    return;
  }
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

export async function exportCsv(rows: ExportRow[]): Promise<void> {
  const lines = [HEADERS.map((h) => t(h.label)).join(',')];
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
  await downloadBlob(blob, `cebio-harcamalar-${todayIso()}.csv`);
}

export async function exportExcel(rows: ExportRow[]): Promise<void> {
  // exceljs büyük bir paket; yalnızca kullanıcı Excel indirmek istediğinde yüklenir.
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Cebio';
  const sheet = workbook.addWorksheet(t('Harcamalar'), { views: [{ state: 'frozen', ySplit: 1 }] });

  sheet.columns = HEADERS.map((h) => ({
    header: t(h.label),
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
  await downloadBlob(blob, `cebio-harcamalar-${todayIso()}.xlsx`);
}
