import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Calendar,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  Edit3,
  FileSpreadsheet,
  FileText,
  Filter,
  FolderOpen,
  Loader2,
  Moon,
  PieChart as PieChartIcon,
  Receipt as ReceiptIcon,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  Sun,
  Trash2,
  TrendingUp,
  UploadCloud,
  Wallet,
  X,
} from 'lucide-react';
import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  TooltipProps,
} from 'recharts';
import * as XLSX from 'xlsx';
import { ThermalReceiptModal } from './components/ThermalReceiptModal';
import {
  CategoryBreakdown,
  deleteReceipt,
  getReceipts,
  getSummary,
  Receipt,
  ReceiptItem,
  ReceiptSummary,
  uploadReceipt,
} from './services/api';

const CHART_COLORS = [
  '#10b981', // emerald-500
  '#6366f1', // indigo-500
  '#f59e0b', // amber-500
  '#ec4899', // pink-500
  '#06b6d4', // cyan-500
  '#8b5cf6', // violet-500
  '#f97316', // orange-500
  '#14b8a6', // teal-500
];

const CARD_SURFACE_CLASS =
  'rounded-2xl bg-white dark:bg-slate-900 border border-slate-300/80 dark:border-slate-800 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)] hover:shadow-md transition-shadow';

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency: 'TRY',
    minimumFractionDigits: 2,
  }).format(value);
}

function formatNumberTr(value: number): string {
  return new Intl.NumberFormat('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatQuantity(qty: number): string {
  if (!qty || qty <= 0) return '1';
  return Number.isInteger(qty) ? String(qty) : qty.toLocaleString('tr-TR');
}

function getReceiptTotalQuantity(receipt: Receipt): number {
  return receipt.items.reduce(
    (sum, item) => sum + (item.quantity && item.quantity > 0 ? item.quantity : 1),
    0
  );
}

function getUnitPrice(item: ReceiptItem): number {
  if (item.unit_price !== null && item.unit_price !== undefined && item.unit_price > 0) {
    return item.unit_price;
  }
  const qty = item.quantity && item.quantity > 0 ? item.quantity : 1;
  return item.price / qty;
}

function escapeCsvCell(value: string | number): string {
  const str = String(value ?? '');
  if (str.includes(',') || str.includes(';') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

interface CustomPieTooltipProps extends TooltipProps<number, string> {
  totalAmount: number;
}

function CustomPieTooltip({ active, payload, totalAmount }: CustomPieTooltipProps) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const item = payload[0];
  const data = item.payload as CategoryBreakdown;
  const amount = Number(item.value ?? data.total_amount ?? 0);
  const pct = totalAmount > 0 ? ((amount / totalAmount) * 100).toFixed(1) : '0.0';
  const color = item.color || '#10b981';

  return (
    <div className="bg-white/95 text-slate-800 border border-slate-200 shadow-lg backdrop-blur-sm rounded-xl p-2.5 dark:bg-slate-900/95 dark:text-white dark:border-slate-700 min-w-[175px]">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-xs font-semibold">
          <span
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{ backgroundColor: color }}
          />
          {data.category}
        </span>
        <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          %{pct}
        </span>
      </div>
      <div className="mt-1.5 flex items-baseline justify-between gap-3 border-t border-slate-100 dark:border-slate-800 pt-1.5">
        <span className="text-[11px] text-slate-500 dark:text-slate-400">
          {data.item_count} ürün
        </span>
        <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
          {formatCurrency(amount)}
        </span>
      </div>
      <p className="mt-1 text-[10px] text-slate-400 dark:text-slate-500">
        Filtrelemek için tıklayın
      </p>
    </div>
  );
}

export default function App() {
  const [darkMode, setDarkMode] = useState<boolean>(true);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [summary, setSummary] = useState<ReceiptSummary>({
    total_receipts: 0,
    total_amount: 0,
    category_breakdown: [],
  });

  const [isLoadingData, setIsLoadingData] = useState<boolean>(true);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [expandedReceiptId, setExpandedReceiptId] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  // Termal Fiş Yazdırma & Kağıt Üzerinde Düzenleme Modalı state'leri
  const [isThermalOpen, setIsThermalOpen] = useState<boolean>(false);
  const [thermalReceipt, setThermalReceipt] = useState<Receipt | null>(null);
  const [thermalInitialEdit, setThermalInitialEdit] = useState<boolean>(false);

  // Bildirim state'leri
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Filtre state'leri
  const [merchantFilter, setMerchantFilter] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [darkMode]);

  const fetchDashboardData = useCallback(async () => {
    setIsLoadingData(true);
    try {
      const [receiptsData, summaryData] = await Promise.all([
        getReceipts({
          merchant: merchantFilter,
          category: categoryFilter,
          start_date: startDate,
          end_date: endDate,
        }),
        getSummary(),
      ]);
      setReceipts(receiptsData);
      setSummary(summaryData);
      setErrorMsg(null);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Veriler alınırken sunucu bağlantı hatası oluştu.';
      setErrorMsg(`Backend servisine ulaşılamadı: ${message}`);
    } finally {
      setIsLoadingData(false);
    }
  }, [merchantFilter, categoryFilter, startDate, endDate]);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  // İstemci tarafında da anlık kategori filtresi güvencesi
  const filteredReceipts = useMemo(() => {
    if (!categoryFilter) return receipts;
    const target = categoryFilter.toLowerCase();
    return receipts.filter((r) =>
      r.items.some((item) => item.category.toLowerCase() === target)
    );
  }, [receipts, categoryFilter]);

  const hasActiveFilters = Boolean(
    merchantFilter.trim() || categoryFilter.trim() || startDate || endDate
  );

  const clearAllFilters = () => {
    setMerchantFilter('');
    setCategoryFilter('');
    setStartDate('');
    setEndDate('');
  };

  const handleToggleCategoryFilter = (category: string) => {
    setCategoryFilter((prev) => (prev === category ? '' : category));
  };

  const handleFileUpload = async (file: File) => {
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    const validExts = ['.jpg', '.jpeg', '.png', '.webp'];
    const lastDotIdx = file.name.lastIndexOf('.');
    const fileExt = lastDotIdx !== -1 ? file.name.toLowerCase().slice(lastDotIdx) : '';

    if (
      !validTypes.includes(file.type.toLowerCase()) &&
      !validExts.includes(fileExt) &&
      !file.type.toLowerCase().startsWith('image/')
    ) {
      setErrorMsg('Lütfen geçerli bir fiş görseli (.jpg, .jpeg, .png, .webp) seçin.');
      return;
    }

    setIsUploading(true);
    setThermalReceipt(null);
    setThermalInitialEdit(false);
    setIsThermalOpen(true);
    setUploadSuccess(null);
    setErrorMsg(null);

    try {
      const created = await uploadReceipt(file);
      setThermalReceipt(created);
      setExpandedReceiptId(created.id);
      await fetchDashboardData();
    } catch (err: any) {
      setIsThermalOpen(false);
      const apiDetail = err?.response?.data?.detail;
      setErrorMsg(apiDetail || 'Fiş yüklenirken veya analiz edilirken bir hata oluştu.');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      if (cameraInputRef.current) {
        cameraInputRef.current.value = '';
      }
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (isUploading) return;
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) {
      handleFileUpload(droppedFile);
    }
  };

  const handleDelete = async (id: number, merchant: string) => {
    setDeletingId(id);
    setErrorMsg(null);
    try {
      await deleteReceipt(id);
      setUploadSuccess(`"${merchant}" fişi silindi.`);
      await fetchDashboardData();
    } catch (err: any) {
      const apiDetail = err?.response?.data?.detail;
      setErrorMsg(apiDetail || 'Fiş silinirken bir hata oluştu.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleOpenThermalEdit = (receipt: Receipt) => {
    setThermalReceipt(receipt);
    setThermalInitialEdit(true);
    setIsThermalOpen(true);
  };

  // Dışa aktarma satırlarını hazırlayan ortak yardımcı
  const buildExportRows = () => {
    const rows: Array<{
      Tarih: string;
      Mağaza: string;
      Kategori: string;
      'Ürün Adı': string;
      Adet: number;
      'Birim Fiyat (₺)': number;
      'Toplam Tutar (₺)': number;
    }> = [];

    for (const receipt of filteredReceipts) {
      const itemsToExport = categoryFilter
        ? receipt.items.filter(
            (i) => i.category.toLowerCase() === categoryFilter.toLowerCase()
          )
        : receipt.items;

      if (itemsToExport.length === 0) {
        rows.push({
          Tarih: receipt.date,
          Mağaza: receipt.merchant,
          Kategori: 'Diğer',
          'Ürün Adı': 'Genel Fiş Tutarı',
          Adet: 1,
          'Birim Fiyat (₺)': Number(receipt.total_amount.toFixed(2)),
          'Toplam Tutar (₺)': Number(receipt.total_amount.toFixed(2)),
        });
      } else {
        for (const item of itemsToExport) {
          const qty = item.quantity && item.quantity > 0 ? item.quantity : 1;
          const unitPrice = getUnitPrice(item);
          rows.push({
            Tarih: receipt.date,
            Mağaza: receipt.merchant,
            Kategori: item.category,
            'Ürün Adı': item.name,
            Adet: qty,
            'Birim Fiyat (₺)': Number(unitPrice.toFixed(2)),
            'Toplam Tutar (₺)': Number(item.price.toFixed(2)),
          });
        }
      }
    }

    return rows;
  };

  const handleExportCsv = () => {
    if (filteredReceipts.length === 0) return;

    const exportData = buildExportRows();
    const headers = [
      'Tarih',
      'Mağaza',
      'Kategori',
      'Ürün Adı',
      'Adet',
      'Birim Fiyat (₺)',
      'Toplam Tutar (₺)',
    ];

    const lines: string[] = [headers.join(',')];
    for (const row of exportData) {
      lines.push(
        [
          escapeCsvCell(row.Tarih),
          escapeCsvCell(row.Mağaza),
          escapeCsvCell(row.Kategori),
          escapeCsvCell(row['Ürün Adı']),
          escapeCsvCell(row.Adet),
          escapeCsvCell(row['Birim Fiyat (₺)'].toFixed(2)),
          escapeCsvCell(row['Toplam Tutar (₺)'].toFixed(2)),
        ].join(',')
      );
    }

    // UTF-8 BOM (\uFEFF) ile Türkçe karakter ve sütun uyumluluğu
    const csvContent = '\uFEFF' + lines.join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const today = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.setAttribute('download', `cebio-harcamalar-${today}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleExportExcel = () => {
    if (filteredReceipts.length === 0) return;

    const exportData = buildExportRows();
    const worksheet = XLSX.utils.json_to_sheet(exportData);

    // Sütun genişliklerini otomatik ayarla
    worksheet['!cols'] = [
      { wch: 14 }, // Tarih
      { wch: 26 }, // Mağaza
      { wch: 18 }, // Kategori
      { wch: 32 }, // Ürün Adı
      { wch: 10 }, // Adet
      { wch: 16 }, // Birim Fiyat (₺)
      { wch: 18 }, // Toplam Tutar (₺)
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Harcamalar');

    const today = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(workbook, `cebio-harcamalar-${today}.xlsx`);
  };

  const topCategory =
    summary.category_breakdown.length > 0 ? summary.category_breakdown[0] : null;

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors duration-200">
      {/* Termal Fiş Yazdırma & Doğrudan Kağıt Üzerinde Düzenleme Modalı */}
      <ThermalReceiptModal
        isOpen={isThermalOpen}
        isAnalyzing={isUploading}
        receipt={thermalReceipt}
        initialEditMode={thermalInitialEdit}
        onClose={() => {
          if (thermalReceipt && !thermalInitialEdit) {
            const totalQty = getReceiptTotalQuantity(thermalReceipt);
            setUploadSuccess(
              `"${thermalReceipt.merchant}" fişi onaylandı! (${formatQuantity(totalQty)} ürün • ${formatCurrency(thermalReceipt.total_amount)})`
            );
          }
          setIsThermalOpen(false);
        }}
        onSaved={async (updated) => {
          setThermalReceipt(updated);
          setIsThermalOpen(false);
          setExpandedReceiptId(updated.id);
          setUploadSuccess(
            `"${updated.merchant}" fişi başarıyla güncellendi (${formatCurrency(updated.total_amount)}).`
          );
          await fetchDashboardData();
        }}
      />

      {/* Üst Navigasyon / Header */}
      <header className="sticky top-0 z-30 border-b border-slate-300/80 dark:border-slate-800 bg-white/95 dark:bg-slate-900/85 backdrop-blur-md shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <Wallet className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold tracking-tight bg-gradient-to-r from-emerald-600 to-teal-500 dark:from-emerald-400 dark:to-teal-300 bg-clip-text text-transparent">
                  Cebio
                </h1>
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20">
                  AI Denetçi
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Otonom Fiş & Harcama Analiz Paneli
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={fetchDashboardData}
              disabled={isLoadingData}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-slate-100 hover:bg-slate-200/80 border border-slate-300/80 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition"
              title="Verileri Yenile"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingData ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Yenile</span>
            </button>

            <button
              onClick={() => setDarkMode(!darkMode)}
              className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200/80 border border-slate-300/80 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition"
              title={darkMode ? 'Açık Mod' : 'Karanlık Mod'}
            >
              {darkMode ? (
                <Sun className="w-4 h-4 text-amber-400" />
              ) : (
                <Moon className="w-4 h-4 text-slate-700" />
              )}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Bildirim Alanları */}
        {uploadSuccess && (
          <div className="flex items-center justify-between gap-3 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-800 dark:text-emerald-300 text-sm shadow-sm">
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
              <span>{uploadSuccess}</span>
            </div>
            <button
              onClick={() => setUploadSuccess(null)}
              className="p-1 rounded-lg hover:bg-emerald-500/20 transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {errorMsg && (
          <div className="flex items-center justify-between gap-3 p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-800 dark:text-rose-300 text-sm shadow-sm">
            <div className="flex items-center gap-2.5">
              <AlertCircle className="w-5 h-5 text-rose-500 shrink-0" />
              <span>{errorMsg}</span>
            </div>
            <button
              onClick={() => setErrorMsg(null)}
              className="p-1 rounded-lg hover:bg-rose-500/20 transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* İstatistik Kartları */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* Toplam Harcama */}
          <div className={`${CARD_SURFACE_CLASS} p-6 flex items-center justify-between`}>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Toplam Harcama Tutarı
              </p>
              <p className="text-2xl sm:text-3xl font-bold mt-2 text-slate-900 dark:text-white">
                {formatCurrency(summary.total_amount)}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Tüm kayıtlı fişlerin genel toplamı
              </p>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-slate-100 border border-slate-200 dark:bg-emerald-500/10 dark:border-emerald-500/20 flex items-center justify-center text-emerald-600 dark:text-emerald-500 shrink-0">
              <Wallet className="w-6 h-6" />
            </div>
          </div>

          {/* Fiş Sayısı */}
          <div className={`${CARD_SURFACE_CLASS} p-6 flex items-center justify-between`}>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Kaydedilen Fiş Sayısı
              </p>
              <p className="text-2xl sm:text-3xl font-bold mt-2 text-slate-900 dark:text-white">
                {summary.total_receipts}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                AI tarafından ayrıştırılan belge
              </p>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-slate-100 border border-slate-200 dark:bg-indigo-500/10 dark:border-indigo-500/20 flex items-center justify-center text-indigo-600 dark:text-indigo-500 shrink-0">
              <ReceiptIcon className="w-6 h-6" />
            </div>
          </div>

          {/* En Çok Harcama Yapılan Kategori */}
          <div className={`${CARD_SURFACE_CLASS} p-6 flex items-center justify-between`}>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Lider Harcama Kategorisi
              </p>
              <p className="text-2xl sm:text-3xl font-bold mt-2 text-slate-900 dark:text-white truncate max-w-[200px]">
                {topCategory ? topCategory.category : '—'}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                {topCategory
                  ? `${formatCurrency(topCategory.total_amount)} (${topCategory.item_count} ürün)`
                  : 'Henüz kategori verisi yok'}
              </p>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-slate-100 border border-slate-200 dark:bg-amber-500/10 dark:border-amber-500/20 flex items-center justify-center text-amber-600 dark:text-amber-500 shrink-0">
              <TrendingUp className="w-6 h-6" />
            </div>
          </div>
        </section>

        {/* Orta Bölüm: Hızlı Fiş Yükleme + Kategori Dağılımı Grafiği */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Hızlı Fiş Yükleme Alanı (5 kolon) */}
          <div className={`lg:col-span-5 ${CARD_SURFACE_CLASS} p-6 flex flex-col justify-between`}>
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-emerald-500" />
                  <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                    Hızlı Fiş Yükleme
                  </h2>
                </div>
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  JPEG • PNG • WEBP
                </span>
              </div>

              <p className="text-xs text-slate-600 dark:text-slate-400 mb-4 leading-relaxed">
                Fiş veya fatura fotoğrafını sürükleyip bırakın. Gemini AI mağaza adını, tarihi ve tüm
                ürünleri adetleriyle birlikte otomatik olarak ayrıştırır.
              </p>
            </div>

            {/* Gizli Dosya Seçici ve Mobil Kamera Inputları */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
              className="hidden"
              onChange={(e) => {
                const selected = e.target.files?.[0];
                if (selected) handleFileUpload(selected);
              }}
            />
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const selected = e.target.files?.[0];
                if (selected) handleFileUpload(selected);
              }}
            />

            <div
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!isUploading) setIsDragging(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsDragging(false);
              }}
              onDrop={handleDrop}
              onClick={() => {
                if (!isUploading) fileInputRef.current?.click();
              }}
              className={`relative flex-1 min-h-[190px] rounded-xl border-2 border-dashed transition-all cursor-pointer flex flex-col items-center justify-center p-5 text-center ${
                isUploading
                  ? 'border-emerald-500/50 bg-emerald-50/40 dark:bg-emerald-500/5 cursor-wait'
                  : isDragging
                  ? 'border-emerald-500 bg-emerald-50/70 dark:bg-emerald-500/10 scale-[0.99]'
                  : 'bg-slate-50 dark:bg-slate-800/30 border-slate-300 dark:border-slate-700 hover:border-emerald-500 hover:bg-emerald-50/40 dark:hover:border-emerald-500/80 dark:hover:bg-slate-800/50'
              }`}
            >
              <div className="flex flex-col items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm flex items-center justify-center text-emerald-600 dark:text-emerald-500 transition">
                  <UploadCloud className="w-6 h-6" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                    Fiş fotoğrafını buraya sürükleyin
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Maksimum netlik için fişin tamamının görünür olduğundan emin olun
                  </p>
                </div>
              </div>
            </div>

            {/* Mobil Öncelikli Aksiyon Butonları: Dosya Seçin & Kamerayla Çek */}
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                disabled={isUploading}
                onClick={() => fileInputRef.current?.click()}
                className="py-2.5 px-4 rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-2 bg-slate-100 hover:bg-slate-200/80 text-slate-800 border border-slate-300/80 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-100 dark:border-slate-700 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                <FolderOpen className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span>Dosya Seçin</span>
              </button>

              <button
                type="button"
                disabled={isUploading}
                onClick={() => cameraInputRef.current?.click()}
                className="py-2.5 px-4 rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white border border-emerald-600 dark:bg-emerald-500 dark:hover:bg-emerald-400 dark:text-slate-950 shadow-sm shadow-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                <Camera className="w-4 h-4 shrink-0" />
                <span>Kamerayla Çek</span>
              </button>
            </div>
          </div>

          {/* Kategori Dağılımı Grafiği (7 kolon) */}
          <div className={`lg:col-span-7 ${CARD_SURFACE_CLASS} p-6 flex flex-col`}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="flex items-center gap-2">
                  <PieChartIcon className="w-4 h-4 text-indigo-500" />
                  <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                    Kategori Bazlı Harcama Dağılımı
                  </h2>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  Tabloyu filtrelemek için grafikteki bir dilime veya sağdaki kategoriye tıklayın.
                </p>
              </div>
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400 shrink-0">
                {summary.category_breakdown.length} aktif kategori
              </span>
            </div>

            {summary.category_breakdown.length === 0 ? (
              <div className="flex-1 min-h-[260px] flex flex-col items-center justify-center text-center text-slate-400">
                <PieChartIcon className="w-10 h-10 mb-2 opacity-40" />
                <p className="text-sm font-medium">Henüz harcama verisi bulunmuyor</p>
                <p className="text-xs mt-1">
                  İlk fişinizi yüklediğinizde kategori dağılım grafiği burada oluşacaktır.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-center flex-1">
                <div className="md:col-span-7 h-[270px] relative">
                  {/* Donut Grafiği Merkez Toplam Etiketi */}
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center pb-7">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                      {categoryFilter ? categoryFilter : 'Toplam'}
                    </span>
                    <span className="text-sm font-bold text-slate-800 dark:text-slate-100 mt-0.5">
                      {categoryFilter
                        ? formatCurrency(
                            summary.category_breakdown.find(
                              (c) => c.category === categoryFilter
                            )?.total_amount ?? summary.total_amount
                          )
                        : formatCurrency(summary.total_amount)}
                    </span>
                  </div>

                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={summary.category_breakdown}
                        dataKey="total_amount"
                        nameKey="category"
                        cx="50%"
                        cy="48%"
                        innerRadius={62}
                        outerRadius={94}
                        paddingAngle={2}
                        className="cursor-pointer outline-none"
                        onClick={(data: CategoryBreakdown) => {
                          if (data && data.category) {
                            handleToggleCategoryFilter(data.category);
                          }
                        }}
                      >
                        {summary.category_breakdown.map((entry, index) => {
                          const isSelected =
                            !categoryFilter || categoryFilter === entry.category;
                          return (
                            <Cell
                              key={`cell-${entry.category}`}
                              fill={CHART_COLORS[index % CHART_COLORS.length]}
                              fillOpacity={isSelected ? 1 : 0.3}
                              stroke={darkMode ? '#0f172a' : '#ffffff'}
                              strokeWidth={categoryFilter === entry.category ? 3 : 2}
                              className="cursor-pointer transition-opacity"
                            />
                          );
                        })}
                      </Pie>
                      <Tooltip
                        content={<CustomPieTooltip totalAmount={summary.total_amount} />}
                        wrapperStyle={{ outline: 'none' }}
                      />
                      <Legend
                        verticalAlign="bottom"
                        height={32}
                        formatter={(value: string) => (
                          <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                            {value}
                          </span>
                        )}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                {/* Kategori Listesi (Tıklanabilir Filtre Kartları) */}
                <div className="md:col-span-5 flex flex-col justify-center space-y-2.5 max-h-[320px] overflow-y-auto scrollbar-thin pr-1">
                  {summary.category_breakdown.map((cat, idx) => {
                    const pct =
                      summary.total_amount > 0
                        ? Math.round((cat.total_amount / summary.total_amount) * 100)
                        : 0;
                    const color = CHART_COLORS[idx % CHART_COLORS.length];
                    const isSelected = categoryFilter === cat.category;
                    return (
                      <button
                        key={cat.category}
                        type="button"
                        onClick={() => handleToggleCategoryFilter(cat.category)}
                        className={`w-full text-left p-3 rounded-xl border transition ${
                          isSelected
                            ? 'bg-emerald-500/10 dark:bg-emerald-500/15 border-emerald-500 ring-1 ring-emerald-500/40'
                            : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between text-xs font-medium">
                          <span className="flex items-center gap-2 truncate text-slate-800 dark:text-slate-100">
                            <span
                              className="w-2.5 h-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: color }}
                            />
                            <span className="font-semibold">{cat.category}</span>
                          </span>
                          <span className="font-semibold text-slate-900 dark:text-white">
                            {formatCurrency(cat.total_amount)}
                          </span>
                        </div>
                        <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                          <span>{cat.item_count} ürün</span>
                          <span className="font-medium">%{pct}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Son Fişler Tablosu & Arama/Filtreleme + CSV & Excel İndirme */}
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
                      onClick={() => setCategoryFilter('')}
                      className="hover:text-emerald-950 dark:hover:text-white"
                      title="Kategori filtresini kaldır"
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

            {/* Filtre Barı ve Dışa Aktarma Butonları */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Mağaza ara (Örn: Migros)..."
                  value={merchantFilter}
                  onChange={(e) => setMerchantFilter(e.target.value)}
                  className="pl-8 pr-3 py-1.5 rounded-lg text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300/80 dark:border-slate-700 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex items-center gap-1.5 text-xs">
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300/80 dark:border-slate-700 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-emerald-500"
                  title="Başlangıç Tarihi"
                />
                <span className="text-slate-400">—</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300/80 dark:border-slate-700 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-emerald-500"
                  title="Bitiş Tarihi"
                />
              </div>

              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={clearAllFilters}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-rose-600 dark:text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 transition"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Filtreyi Temizle</span>
                </button>
              )}

              <button
                type="button"
                onClick={handleExportCsv}
                disabled={filteredReceipts.length === 0}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200/80 text-slate-800 border border-slate-300/80 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-100 dark:border-slate-700 shadow-sm disabled:opacity-40 disabled:cursor-not-allowed transition"
                title="Filtrelenmiş fişleri CSV olarak indir"
              >
                <Download className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>CSV İndir</span>
              </button>

              <button
                type="button"
                onClick={handleExportExcel}
                disabled={filteredReceipts.length === 0}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white dark:bg-emerald-500 dark:hover:bg-emerald-400 dark:text-slate-950 shadow-sm disabled:opacity-40 disabled:cursor-not-allowed transition"
                title="Filtrelenmiş fişleri Excel (.xlsx) olarak indir"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>Excel İndir</span>
              </button>
            </div>
          </div>

          {isLoadingData ? (
            <div className="p-12 flex flex-col items-center justify-center gap-2 text-slate-400">
              <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
              <span className="text-xs">Fiş kayıtları yükleniyor...</span>
            </div>
          ) : filteredReceipts.length === 0 ? (
            /* Boş Durum (Empty State) Gösterimi */
            <div className="p-12 flex flex-col items-center justify-center text-center">
              <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-400 mb-3">
                {hasActiveFilters ? (
                  <Search className="w-6 h-6 text-slate-400" />
                ) : (
                  <ReceiptIcon className="w-6 h-6 text-slate-400" />
                )}
              </div>
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                {hasActiveFilters
                  ? 'Kriterlere uygun fiş bulunamadı'
                  : 'Henüz kayıtlı fiş bulunmuyor'}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-md">
                {hasActiveFilters
                  ? 'Aradığınız mağaza adına, seçili kategoriye veya tarih aralığına ait bir harcama kaydı eşleşmedi.'
                  : 'Yukarıdaki yükleme alanından yeni bir fiş fotoğrafı yükleyerek veya kamerayla çekerek başlayabilirsiniz.'}
              </p>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={clearAllFilters}
                  className="mt-4 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white dark:bg-emerald-500 dark:hover:bg-emerald-400 dark:text-slate-950 shadow-sm transition"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Filtreyi Temizle</span>
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
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
                  {filteredReceipts.map((receipt) => {
                    const isExpanded = expandedReceiptId === receipt.id;
                    const totalQty = getReceiptTotalQuantity(receipt);
                    return (
                      <React.Fragment key={receipt.id}>
                        <tr
                          onClick={() =>
                            setExpandedReceiptId(isExpanded ? null : receipt.id)
                          }
                          className="hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer transition"
                        >
                          <td className="py-4 px-6 font-medium text-slate-900 dark:text-white flex items-center gap-2.5">
                            {isExpanded ? (
                              <ChevronUp className="w-4 h-4 text-emerald-500 shrink-0" />
                            ) : (
                              <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                            )}
                            <span>{receipt.merchant}</span>
                          </td>
                          <td className="py-4 px-4 text-slate-600 dark:text-slate-300">
                            {receipt.date}
                          </td>
                          <td className="py-4 px-4">
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300">
                              {formatQuantity(totalQty)} ürün
                            </span>
                          </td>
                          <td className="py-4 px-4 font-semibold text-emerald-600 dark:text-emerald-400">
                            {formatCurrency(receipt.total_amount)}
                          </td>
                          <td
                            className="py-4 px-6 text-right"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="inline-flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleOpenThermalEdit(receipt)}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/10 transition"
                                title="Termal Fiş Üzerinde Düzenle"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                                <span>Düzenle</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => handleDelete(receipt.id, receipt.merchant)}
                                disabled={deletingId === receipt.id}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-rose-600 dark:text-rose-500 hover:bg-rose-500/10 disabled:opacity-50 transition"
                                title="Fişi Sil"
                              >
                                {deletingId === receipt.id ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <Trash2 className="w-3.5 h-3.5" />
                                )}
                                <span>Sil</span>
                              </button>
                            </div>
                          </td>
                        </tr>

                        {isExpanded && (
                          <tr className="bg-slate-50 dark:bg-slate-900/60">
                            <td colSpan={5} className="px-6 py-4">
                              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                                {receipt.items.map((item) => {
                                  const qty = item.quantity && item.quantity > 0 ? item.quantity : 1;
                                  const unitPrice = getUnitPrice(item);
                                  const isHighlightedCategory =
                                    categoryFilter &&
                                    item.category.toLowerCase() === categoryFilter.toLowerCase();
                                  return (
                                    <div
                                      key={item.id}
                                      className={`flex items-center justify-between p-2.5 rounded-xl bg-white dark:bg-slate-800/80 border shadow-sm text-xs ${
                                        isHighlightedCategory
                                          ? 'border-emerald-500 ring-1 ring-emerald-500/30'
                                          : 'border-slate-300/70 dark:border-slate-700/70'
                                      }`}
                                    >
                                      <div className="min-w-0 pr-2">
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                          <p className="font-medium text-slate-800 dark:text-slate-100 truncate">
                                            {item.name}
                                          </p>
                                          {qty > 1 && (
                                            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700/80 border border-slate-200 dark:border-slate-600 text-[11px] font-medium text-slate-600 dark:text-slate-300 shrink-0">
                                              ({formatQuantity(qty)}x {formatNumberTr(unitPrice)} ₺)
                                            </span>
                                          )}
                                        </div>
                                        <span className="inline-block mt-1 text-[10px] font-medium px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                                          {item.category}
                                        </span>
                                      </div>
                                      <span className="font-semibold text-slate-900 dark:text-white shrink-0">
                                        {formatCurrency(item.price)}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
