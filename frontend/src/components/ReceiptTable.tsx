import React, { useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  ChevronDown,
  ChevronUp,
  Download,
  Edit3,
  FileSpreadsheet,
  FileText,
  Filter,
  Loader2,
  Receipt as ReceiptIcon,
  RotateCcw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import type { Receipt } from '../services/api';
import type { DashboardFilters } from '../hooks/useDashboard';
import {
  formatCurrency,
  formatDateTr,
  formatNumberTr,
  formatQuantity,
  getItemsTotalMismatch,
  getReceiptTotalQuantity,
  getUnitPrice,
  safeQuantity,
} from '../lib/format';
import { CARD_SURFACE_CLASS } from './ui';

const FIELD_CLASS =
  'py-1.5 rounded-lg text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300/80 dark:border-slate-700 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-emerald-500';

interface ReceiptTableProps {
  receipts: Receipt[];
  isLoading: boolean;
  filters: DashboardFilters;
  hasActiveFilters: boolean;
  expandedId: number | null;
  deletingId: number | null;
  isExporting: boolean;
  onFiltersChange: (patch: Partial<DashboardFilters>) => void;
  onClearFilters: () => void;
  onToggleExpand: (id: number) => void;
  onEdit: (receipt: Receipt) => void;
  onDelete: (receipt: Receipt) => void;
  onExportCsv: () => void;
  onExportExcel: () => void;
}

export function ReceiptTable({
  receipts,
  isLoading,
  filters,
  hasActiveFilters,
  expandedId,
  deletingId,
  isExporting,
  onFiltersChange,
  onClearFilters,
  onToggleExpand,
  onEdit,
  onDelete,
  onExportCsv,
  onExportExcel,
}: ReceiptTableProps) {
  const categoryFilter = filters.category;
  const isEmpty = receipts.length === 0;

  return (
    <section className={`${CARD_SURFACE_CLASS} overflow-hidden`}>
      <div className="p-6 border-b border-slate-200 dark:border-slate-800 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <FileText className="w-4 h-4 text-emerald-500" />
              Son Fişler ve Harcama Ürünleri
            </h2>
            {categoryFilter && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                <Filter className="w-3 h-3" />
                <span>Kategori: {categoryFilter}</span>
                <button
                  type="button"
                  onClick={() => onFiltersChange({ category: '' })}
                  className="hover:text-emerald-950 dark:hover:text-white"
                  aria-label="Kategori filtresini kaldır"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Bir fiş satırına tıklayarak ürünleri inceleyebilir veya "Düzenle" ile termal fiş üzerinde güncelleyebilirsiniz.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              placeholder="Mağaza ara (Örn: Migros)..."
              aria-label="Mağaza ara"
              value={filters.merchant}
              onChange={(e) => onFiltersChange({ merchant: e.target.value })}
              className={`${FIELD_CLASS} pl-8 pr-3`}
            />
          </div>

          <div className="flex items-center gap-1.5 text-xs">
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
            <input
              type="date"
              value={filters.startDate}
              max={filters.endDate || undefined}
              onChange={(e) => onFiltersChange({ startDate: e.target.value })}
              className={`${FIELD_CLASS} px-2.5`}
              aria-label="Başlangıç tarihi"
            />
            <span className="text-slate-400">—</span>
            <input
              type="date"
              value={filters.endDate}
              min={filters.startDate || undefined}
              onChange={(e) => onFiltersChange({ endDate: e.target.value })}
              className={`${FIELD_CLASS} px-2.5`}
              aria-label="Bitiş tarihi"
            />
          </div>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={onClearFilters}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-rose-600 dark:text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 transition"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Filtreyi Temizle</span>
            </button>
          )}

          <button
            type="button"
            onClick={onExportCsv}
            disabled={isEmpty}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200/80 text-slate-800 border border-slate-300/80 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-100 dark:border-slate-700 shadow-sm disabled:opacity-40 disabled:cursor-not-allowed transition"
            title="Filtrelenmiş fişleri CSV olarak indir"
          >
            <Download className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            <span>CSV İndir</span>
          </button>

          <button
            type="button"
            onClick={onExportExcel}
            disabled={isEmpty || isExporting}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white dark:bg-emerald-500 dark:hover:bg-emerald-400 dark:text-slate-950 shadow-sm disabled:opacity-40 disabled:cursor-not-allowed transition"
            title="Filtrelenmiş fişleri Excel (.xlsx) olarak indir"
          >
            {isExporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileSpreadsheet className="w-3.5 h-3.5" />}
            <span>Excel İndir</span>
          </button>
        </div>
      </div>

      {isLoading && isEmpty ? (
        <div className="p-12 flex flex-col items-center justify-center gap-2 text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
          <span className="text-xs">Fiş kayıtları yükleniyor...</span>
        </div>
      ) : isEmpty ? (
        <EmptyState hasActiveFilters={hasActiveFilters} onClearFilters={onClearFilters} />
      ) : (
        <div className={`overflow-x-auto transition-opacity ${isLoading ? 'opacity-60' : ''}`}>
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900/50">
                <th className="py-3.5 px-6">Mağaza / İşletme</th>
                <th className="py-3.5 px-4">Fiş Tarihi</th>
                <th className="py-3.5 px-4">Ürün Sayısı</th>
                <th className="py-3.5 px-4">Toplam Tutar</th>
                <th className="py-3.5 px-6 text-right">İşlem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800/70 text-sm">
              {receipts.map((receipt) => (
                <ReceiptRow
                  key={receipt.id}
                  receipt={receipt}
                  categoryFilter={categoryFilter}
                  isExpanded={expandedId === receipt.id}
                  isDeleting={deletingId === receipt.id}
                  onToggle={() => onToggleExpand(receipt.id)}
                  onEdit={() => onEdit(receipt)}
                  onDelete={() => onDelete(receipt)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function EmptyState({ hasActiveFilters, onClearFilters }: { hasActiveFilters: boolean; onClearFilters: () => void }) {
  return (
    <div className="p-12 flex flex-col items-center justify-center text-center">
      <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-400 mb-3">
        {hasActiveFilters ? <Search className="w-6 h-6" /> : <ReceiptIcon className="w-6 h-6" />}
      </div>
      <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
        {hasActiveFilters ? 'Kriterlere uygun fiş bulunamadı' : 'Henüz kayıtlı fiş bulunmuyor'}
      </p>
      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-md">
        {hasActiveFilters
          ? 'Aradığınız mağaza adına, seçili kategoriye veya tarih aralığına ait bir harcama kaydı eşleşmedi.'
          : 'Yukarıdaki yükleme alanından yeni bir fiş fotoğrafı yükleyerek veya kamerayla çekerek başlayabilirsiniz.'}
      </p>
      {hasActiveFilters && (
        <button
          type="button"
          onClick={onClearFilters}
          className="mt-4 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white dark:bg-emerald-500 dark:hover:bg-emerald-400 dark:text-slate-950 shadow-sm transition"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Filtreyi Temizle</span>
        </button>
      )}
    </div>
  );
}

interface ReceiptRowProps {
  receipt: Receipt;
  categoryFilter: string;
  isExpanded: boolean;
  isDeleting: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function ReceiptRow({ receipt, categoryFilter, isExpanded, isDeleting, onToggle, onEdit, onDelete }: ReceiptRowProps) {
  const [confirming, setConfirming] = useState(false);
  const totalQty = getReceiptTotalQuantity(receipt);
  const mismatch = receipt.items.length > 0 ? getItemsTotalMismatch(receipt) : 0;
  const target = categoryFilter.toLowerCase();

  return (
    <React.Fragment>
      <tr
        onClick={onToggle}
        aria-expanded={isExpanded}
        className="hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer transition"
      >
        <td className="py-4 px-6 font-medium text-slate-900 dark:text-white">
          <span className="flex items-center gap-2.5">
            {isExpanded ? (
              <ChevronUp className="w-4 h-4 text-emerald-500 shrink-0" />
            ) : (
              <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
            )}
            <span>{receipt.merchant}</span>
            {mismatch !== 0 && (
              <span title="Kalemlerin toplamı fiş toplamıyla uyuşmuyor">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              </span>
            )}
          </span>
        </td>
        <td className="py-4 px-4 text-slate-600 dark:text-slate-300 whitespace-nowrap">{formatDateTr(receipt.date)}</td>
        <td className="py-4 px-4">
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 whitespace-nowrap">
            {formatQuantity(totalQty)} ürün
          </span>
        </td>
        <td className="py-4 px-4 font-semibold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
          {formatCurrency(receipt.total_amount)}
        </td>
        <td className="py-4 px-6 text-right" onClick={(e) => e.stopPropagation()}>
          <div className="inline-flex items-center justify-end gap-1.5">
            {confirming ? (
              <>
                <span className="text-xs text-slate-500 dark:text-slate-400 mr-1 whitespace-nowrap">Silinsin mi?</span>
                <button
                  type="button"
                  onClick={() => {
                    setConfirming(false);
                    onDelete();
                  }}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 transition"
                >
                  Evet, sil
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                >
                  Vazgeç
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onEdit}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/10 transition"
                  title="Termal Fiş Üzerinde Düzenle"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>Düzenle</span>
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  disabled={isDeleting}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-rose-600 dark:text-rose-500 hover:bg-rose-500/10 disabled:opacity-50 transition"
                  title="Fişi Sil"
                >
                  {isDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  <span>Sil</span>
                </button>
              </>
            )}
          </div>
        </td>
      </tr>

      {isExpanded && (
        <tr className="bg-slate-50 dark:bg-slate-900/60">
          <td colSpan={5} className="px-6 py-4">
            {mismatch !== 0 && (
              <div className="mb-3 flex items-center gap-2 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 text-xs">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>
                  Kalemlerin toplamı fiş toplamından {formatCurrency(Math.abs(mismatch))}{' '}
                  {mismatch > 0 ? 'eksik' : 'fazla'}. Yapay zeka bir satırı kaçırmış olabilir; "Düzenle" ile
                  kontrol edin.
                </span>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
              {receipt.items.map((item) => {
                const qty = safeQuantity(item.quantity);
                const highlighted = target && item.category.toLowerCase() === target;
                return (
                  <div
                    key={item.id}
                    className={`flex items-center justify-between p-2.5 rounded-xl bg-white dark:bg-slate-800/80 border shadow-sm text-xs ${
                      highlighted
                        ? 'border-emerald-500 ring-1 ring-emerald-500/30'
                        : 'border-slate-300/70 dark:border-slate-700/70'
                    }`}
                  >
                    <div className="min-w-0 pr-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="font-medium text-slate-800 dark:text-slate-100 truncate">{item.name}</p>
                        {qty > 1 && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700/80 border border-slate-200 dark:border-slate-600 text-[11px] font-medium text-slate-600 dark:text-slate-300 shrink-0">
                            ({formatQuantity(qty)}x {formatNumberTr(getUnitPrice(item))} ₺)
                          </span>
                        )}
                      </div>
                      <span className="inline-block mt-1 text-[10px] font-medium px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                        {item.category}
                      </span>
                    </div>
                    <span className="font-semibold text-slate-900 dark:text-white shrink-0">{formatCurrency(item.price)}</span>
                  </div>
                );
              })}
            </div>
          </td>
        </tr>
      )}
    </React.Fragment>
  );
}
