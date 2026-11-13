import { useCallback, useEffect, useState } from 'react';
import { DashboardFilters, EMPTY_FILTERS, useDashboard } from '../hooks/useDashboard';
import { buildExportRows, exportCsv, exportExcel } from '../lib/export';
import { formatCurrency, formatQuantity, getReceiptTotalQuantity } from '../lib/format';
import { deleteReceipt, getApiErrorMessage, Receipt, uploadReceipt } from '../services/api';
import { BudgetsCard } from './BudgetsCard';
import { CategoryChart } from './CategoryChart';
import { ReceiptTable } from './ReceiptTable';
import { StatCards } from './StatCards';
import { ThermalReceiptModal } from './ThermalReceiptModal';
import { TrendChart } from './TrendChart';
import { Notice } from './ui';
import { UploadCard, validateReceiptFile } from './UploadCard';

import { t } from '../i18n';
import { todayIso } from '../lib/format';
import { useAiConsent } from './AiConsent';
import { PriceWatchCard } from './PriceWatchCard';

/** Elle fiş ekleme için boş taslak (id 0 = henüz kaydedilmedi). */
function emptyReceipt(): Receipt {
  return {
    id: 0,
    merchant: '',
    date: todayIso(),
    total_amount: 0,
    created_at: new Date().toISOString(),
    items: [{ id: -1, receipt_id: 0, name: '', price: 0, quantity: 1, unit_price: null, category: 'Gıda' }],
  };
}
interface ReceiptsViewProps {
  darkMode: boolean;
  /** Üst bardaki "Yenile" butonuna her basıldığında artar. */
  refreshSignal: number;
  onOpenReport: () => void;
}

export function ReceiptsView({ darkMode, refreshSignal, onOpenReport }: ReceiptsViewProps) {

  const [filters, setFilters] = useState<DashboardFilters>(EMPTY_FILTERS);
  const { receipts, summary, isLoading, error: loadError, refresh: refreshList } = useDashboard(filters);
  // Trend ve bütçe kartları fiş verisi değiştiğinde yeniden yüklenir
  const [dataVersion, setDataVersion] = useState(0);
  const refresh = useCallback(async () => {
    await refreshList();
    setDataVersion((v) => v + 1);
  }, [refreshList]);

  const [isUploading, setIsUploading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const [isThermalOpen, setIsThermalOpen] = useState(false);
  const [thermalReceipt, setThermalReceipt] = useState<Receipt | null>(null);
  const [thermalInitialEdit, setThermalInitialEdit] = useState(false);

  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (loadError) setErrorMsg(loadError);
  }, [loadError]);

  useEffect(() => {
    if (refreshSignal > 0) void refresh();
  }, [refreshSignal, refresh]);

  const hasActiveFilters = Boolean(
    filters.merchant.trim() || filters.category || filters.startDate || filters.endDate
  );
  const hasSummaryFilters = Boolean(filters.merchant.trim() || filters.startDate || filters.endDate);

  const patchFilters = (patch: Partial<DashboardFilters>) => setFilters((prev) => ({ ...prev, ...patch }));

  const ensureAiConsent = useAiConsent();

  const handleFileUpload = async (file: File) => {
    const invalid = validateReceiptFile(file);
    if (invalid) {
      setErrorMsg(invalid);
      return;
    }
    // Fotoğraf Google Gemini'ye gönderilmeden önce açık rıza (App Store 5.1.2(i), KVKK)
    if (!(await ensureAiConsent())) return;

    setIsUploading(true);
    setThermalReceipt(null);
    setThermalInitialEdit(false);
    setIsThermalOpen(true);
    setSuccessMsg(null);
    setErrorMsg(null);

    try {
      const created = await uploadReceipt(file);
      setThermalReceipt(created);
      setExpandedId(created.id);
      await refresh();
    } catch (err) {
      setIsThermalOpen(false);
      setErrorMsg(getApiErrorMessage(err, t("Fiş yüklenirken veya analiz edilirken bir hata oluştu.")));
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = async (receipt: Receipt) => {
    setDeletingId(receipt.id);
    setErrorMsg(null);
    try {
      await deleteReceipt(receipt.id);
      setSuccessMsg(t("\"{0}\" fişi silindi.", { 0: receipt.merchant }));
      await refresh();
    } catch (err) {
      setErrorMsg(getApiErrorMessage(err, t("Fiş silinirken bir hata oluştu.")));
    } finally {
      setDeletingId(null);
    }
  };

  const handleExportExcel = async () => {
    setIsExporting(true);
    try {
      await exportExcel(buildExportRows(receipts, filters.category));
    } catch {
      setErrorMsg(t("Excel dosyası oluşturulamadı."));
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-8">
      <ThermalReceiptModal
        isOpen={isThermalOpen}
        isAnalyzing={isUploading}
        receipt={thermalReceipt}
        initialEditMode={thermalInitialEdit}
        onClose={() => {
          if (thermalReceipt && !thermalInitialEdit) {
            setSuccessMsg(
              t("\"{0}\" fişi onaylandı! ({1} ürün • {2})", { 0: thermalReceipt.merchant, 1: formatQuantity(
                getReceiptTotalQuantity(thermalReceipt)
              ), 2: formatCurrency(thermalReceipt.total_amount) })
            );
          }
          setIsThermalOpen(false);
        }}
        onSaved={async (updated) => {
          setThermalReceipt(updated);
          setIsThermalOpen(false);
          setExpandedId(updated.id);
          setSuccessMsg(t("\"{0}\" fişi başarıyla güncellendi ({1}).", { 0: updated.merchant, 1: formatCurrency(updated.total_amount) }));
          await refresh();
        }}
      />

        {successMsg && <Notice kind="success" message={successMsg} onClose={() => setSuccessMsg(null)} />}
        {errorMsg && <Notice kind="error" message={errorMsg} onClose={() => setErrorMsg(null)} />}

        <StatCards summary={summary} isFiltered={hasSummaryFilters} />

        <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <TrendChart darkMode={darkMode} reloadKey={dataVersion} onOpenReport={onOpenReport} />
          <BudgetsCard reloadKey={dataVersion} />
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <UploadCard
            isUploading={isUploading}
            onFile={(f) => void handleFileUpload(f)}
            onManual={() => {
              setThermalReceipt(emptyReceipt());
              setThermalInitialEdit(true);
              setIsThermalOpen(true);
            }}
          />
          <CategoryChart
            summary={summary}
            categoryFilter={filters.category}
            darkMode={darkMode}
            onToggleCategory={(c) => patchFilters({ category: filters.category === c ? '' : c })}
          />
        </section>

        <PriceWatchCard reloadKey={dataVersion} />

        <ReceiptTable
          receipts={receipts}
          isLoading={isLoading}
          filters={filters}
          hasActiveFilters={hasActiveFilters}
          expandedId={expandedId}
          deletingId={deletingId}
          isExporting={isExporting}
          onFiltersChange={patchFilters}
          onClearFilters={() => setFilters(EMPTY_FILTERS)}
          onToggleExpand={(id) => setExpandedId((prev) => (prev === id ? null : id))}
          onEdit={(receipt) => {
            setThermalReceipt(receipt);
            setThermalInitialEdit(true);
            setIsThermalOpen(true);
          }}
          onDelete={(receipt) => void handleDelete(receipt)}
          onExportCsv={() =>
            exportCsv(buildExportRows(receipts, filters.category)).catch(() => setErrorMsg(t('CSV dosyası oluşturulamadı.')))
          }
          onExportExcel={() => void handleExportExcel()}
        />
    </div>
  );
}
