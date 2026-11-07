import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { DashboardFilters, EMPTY_FILTERS, useDashboard } from '../hooks/useDashboard';
import { buildExportRows, exportCsv, exportExcel } from '../lib/export';
import { formatCurrency, formatQuantity, getReceiptTotalQuantity } from '../lib/format';
import { storageGet, storageSet } from '../lib/storage';
import { deleteReceipt, getApiErrorMessage, Receipt, uploadReceipt } from '../services/api';
import { CategoryChart } from './CategoryChart';
import { Header } from './Header';
import { ReceiptTable } from './ReceiptTable';
import { StatCards } from './StatCards';
import { ThermalReceiptModal } from './ThermalReceiptModal';
import { Notice } from './ui';
import { UploadCard, validateReceiptFile } from './UploadCard';

const THEME_KEY = 'cebio.theme';

function useDarkMode(): [boolean, () => void] {
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    const saved = storageGet(THEME_KEY);
    if (saved) return saved === 'dark';
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true;
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    storageSet(THEME_KEY, darkMode ? 'dark' : 'light');
  }, [darkMode]);

  return [darkMode, () => setDarkMode((v) => !v)];
}

export function Dashboard() {
  const { user, logout, deleteAccount } = useAuth();
  const [darkMode, toggleDarkMode] = useDarkMode();

  const [filters, setFilters] = useState<DashboardFilters>(EMPTY_FILTERS);
  const { receipts, summary, isLoading, error: loadError, refresh } = useDashboard(filters);

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

  const hasActiveFilters = Boolean(
    filters.merchant.trim() || filters.category || filters.startDate || filters.endDate
  );
  const hasSummaryFilters = Boolean(filters.merchant.trim() || filters.startDate || filters.endDate);

  const patchFilters = (patch: Partial<DashboardFilters>) => setFilters((prev) => ({ ...prev, ...patch }));

  const handleFileUpload = async (file: File) => {
    const invalid = validateReceiptFile(file);
    if (invalid) {
      setErrorMsg(invalid);
      return;
    }

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
      setErrorMsg(getApiErrorMessage(err, 'Fiş yüklenirken veya analiz edilirken bir hata oluştu.'));
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = async (receipt: Receipt) => {
    setDeletingId(receipt.id);
    setErrorMsg(null);
    try {
      await deleteReceipt(receipt.id);
      setSuccessMsg(`"${receipt.merchant}" fişi silindi.`);
      await refresh();
    } catch (err) {
      setErrorMsg(getApiErrorMessage(err, 'Fiş silinirken bir hata oluştu.'));
    } finally {
      setDeletingId(null);
    }
  };

  const handleDeleteAccount = async () => {
    const ok = window.confirm(
      'Hesabınız ve tüm fiş kayıtlarınız kalıcı olarak silinecek. Bu işlem geri alınamaz. Devam edilsin mi?'
    );
    if (!ok) return;
    try {
      await deleteAccount();
    } catch (err) {
      setErrorMsg(getApiErrorMessage(err, 'Hesap silinirken bir hata oluştu.'));
    }
  };

  const handleExportExcel = async () => {
    setIsExporting(true);
    try {
      await exportExcel(buildExportRows(receipts, filters.category));
    } catch {
      setErrorMsg('Excel dosyası oluşturulamadı.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors duration-200">
      <ThermalReceiptModal
        isOpen={isThermalOpen}
        isAnalyzing={isUploading}
        receipt={thermalReceipt}
        initialEditMode={thermalInitialEdit}
        onClose={() => {
          if (thermalReceipt && !thermalInitialEdit) {
            setSuccessMsg(
              `"${thermalReceipt.merchant}" fişi onaylandı! (${formatQuantity(
                getReceiptTotalQuantity(thermalReceipt)
              )} ürün • ${formatCurrency(thermalReceipt.total_amount)})`
            );
          }
          setIsThermalOpen(false);
        }}
        onSaved={async (updated) => {
          setThermalReceipt(updated);
          setIsThermalOpen(false);
          setExpandedId(updated.id);
          setSuccessMsg(`"${updated.merchant}" fişi başarıyla güncellendi (${formatCurrency(updated.total_amount)}).`);
          await refresh();
        }}
      />

      <Header
        user={user}
        darkMode={darkMode}
        isLoading={isLoading}
        onRefresh={() => void refresh()}
        onToggleDarkMode={toggleDarkMode}
        onLogout={logout}
        onDeleteAccount={() => void handleDeleteAccount()}
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {successMsg && <Notice kind="success" message={successMsg} onClose={() => setSuccessMsg(null)} />}
        {errorMsg && <Notice kind="error" message={errorMsg} onClose={() => setErrorMsg(null)} />}

        <StatCards summary={summary} isFiltered={hasSummaryFilters} />

        <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <UploadCard isUploading={isUploading} onFile={(f) => void handleFileUpload(f)} />
          <CategoryChart
            summary={summary}
            categoryFilter={filters.category}
            darkMode={darkMode}
            onToggleCategory={(c) => patchFilters({ category: filters.category === c ? '' : c })}
          />
        </section>

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
          onExportCsv={() => exportCsv(buildExportRows(receipts, filters.category))}
          onExportExcel={() => void handleExportExcel()}
        />
      </main>
    </div>
  );
}
