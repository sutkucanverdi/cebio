import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FileText,
  Landmark,
  Link2,
  Loader2,
  PieChart as PieChartIcon,
  ReceiptText,
  Search,
  Trash2,
  Undo2,
  Upload,
  Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { formatDateTr, SPENDING_CATEGORIES, todayIso } from '../../lib/format';
import { formatMoney } from '../../lib/subscriptions';
import {
  BankTransaction,
  deleteStatementImport,
  deleteTransaction,
  getApiErrorMessage,
  getStatementImports,
  getTransactions,
  StatementImport,
  updateTransactionCategory,
} from '../../services/api';
import { CARD_SURFACE_CLASS, INPUT_CLASS, Notice, PRIMARY_BUTTON } from '../ui';
import { ImportStatementModal } from './ImportStatementModal';

import { categoryLabel, t } from '../../i18n';
/** Türkçe karakterlere duyarsız karşılaştırma için sadeleştirme */
function fold(text: string): string {
  return text.toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i');
}

function Stat({ label, value, hint, Icon }: { label: string; value: string; hint: string; Icon: LucideIcon }) {
  return (
    <div className={`${CARD_SURFACE_CLASS} p-5 flex items-center justify-between gap-3`}>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</p>
        <p className="text-xl sm:text-2xl font-bold mt-1.5 text-slate-900 dark:text-white truncate">{value}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 truncate">{hint}</p>
      </div>
      <div className="w-11 h-11 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0 text-emerald-600 dark:text-emerald-400">
        <Icon className="w-5 h-5" />
      </div>
    </div>
  );
}

export function BankView({ refreshSignal }: { refreshSignal: number }) {
  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
  const [imports, setImports] = useState<StatementImport[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);
  const [confirmImportId, setConfirmImportId] = useState<number | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const [txs, imps] = await Promise.all([getTransactions(), getStatementImports()]);
      setTransactions(txs);
      setImports(imps);
    } catch (err) {
      setErrorMsg(getApiErrorMessage(err, t("Banka harcamaları alınamadı.")));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshSignal]);

  const monthKey = todayIso().slice(0, 7);
  const stats = useMemo(() => {
    // Toplamlara yalnızca TL olan ve fişle eşleşmemiş işlemler katılır (backend analizleriyle aynı kural)
    const counted = transactions.filter((t) => t.currency === 'TRY' && t.matched_receipt_id === null);
    const thisMonth = counted.filter((t) => t.date.startsWith(monthKey));
    const byCategory = new Map<string, number>();
    for (const t of thisMonth) byCategory.set(t.category, (byCategory.get(t.category) ?? 0) + t.amount);
    const top = [...byCategory.entries()].sort((a, b) => b[1] - a[1])[0];
    return {
      monthTotal: thisMonth.reduce((s, t) => s + t.amount, 0),
      monthCount: thisMonth.length,
      top,
    };
  }, [transactions, monthKey]);

  const visible = useMemo(() => {
    const q = fold(query.trim());
    return transactions.filter(
      (t) =>
        (!category || t.category === category) &&
        (!q || fold(t.merchant).includes(q) || fold(t.description).includes(q))
    );
  }, [transactions, query, category]);

  const changeCategory = async (tx: BankTransaction, next: string) => {
    setBusyId(tx.id);
    try {
      const updated = await updateTransactionCategory(tx.id, next);
      setTransactions((prev) => prev.map((t) => (t.id === tx.id ? updated : t)));
    } catch (err) {
      setErrorMsg(getApiErrorMessage(err, t("Kategori güncellenemedi.")));
    } finally {
      setBusyId(null);
    }
  };

  const removeTransaction = async (tx: BankTransaction) => {
    setBusyId(tx.id);
    try {
      await deleteTransaction(tx.id);
      setTransactions((prev) => prev.filter((t) => t.id !== tx.id));
    } catch (err) {
      setErrorMsg(getApiErrorMessage(err, t("İşlem silinemedi.")));
    } finally {
      setBusyId(null);
    }
  };

  const undoImport = async (imp: StatementImport) => {
    setConfirmImportId(null);
    try {
      await deleteStatementImport(imp.id);
      setSuccessMsg(t("\"{0}\" içe aktarması geri alındı ({1} işlem silindi).", { 0: imp.filename, 1: imp.transaction_count }));
      await refresh();
    } catch (err) {
      setErrorMsg(getApiErrorMessage(err, t("İçe aktarma geri alınamadı.")));
    }
  };

  return (
    <div className="space-y-6">
      {isImportOpen && (
        <ImportStatementModal
          onClose={() => setIsImportOpen(false)}
          onImported={async (result, subsAdded) => {
            setIsImportOpen(false);
            const parts = [t("{0} işlem içe aktarıldı", { 0: result.imported })];
            if (result.skipped_duplicates) parts.push(t("{0} mükerrer atlandı", { 0: result.skipped_duplicates }));
            if (result.matched_receipts) parts.push(t("{0} fişle eşleşti", { 0: result.matched_receipts }));
            if (subsAdded) parts.push(`${subsAdded} abonelik eklendi`);
            setSuccessMsg(parts.join(' • ') + '.');
            await refresh();
          }}
        />
      )}

      {successMsg && <Notice kind="success" message={successMsg} onClose={() => setSuccessMsg(null)} />}
      {errorMsg && <Notice kind="error" message={errorMsg} onClose={() => setErrorMsg(null)} />}

      <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Stat
          label={t("Bu Ay Kart Harcaması")}
          value={formatMoney(stats.monthTotal)}
          hint={t("Fişle eşleşenler hariç")}
          Icon={Wallet}
        />
        <Stat label={t("Bu Ay İşlem")} value={String(stats.monthCount)} hint={t("{0} işlem kayıtlı", { 0: transactions.length })} Icon={ReceiptText} />
        <Stat
          label={t("En Çok Harcanan")}
          value={stats.top ? stats.top[0] : '—'}
          hint={stats.top ? `${formatMoney(stats.top[1])} bu ay` : t("Bu ay işlem yok")}
          Icon={PieChartIcon}
        />
      </section>

      <section className={`${CARD_SURFACE_CLASS} overflow-hidden`}>
        <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <Landmark className="w-4 h-4 text-emerald-500" />{t("Banka & Kart Harcamaları")}</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{t("Ekstreden içe aktarılan harcamalar asistan, bütçe ve trend grafiğine dahil edilir.")}</p>
          </div>
          <button type="button" className={PRIMARY_BUTTON} onClick={() => setIsImportOpen(true)}>
            <Upload className="w-4 h-4" />{' '}{t("Ekstre Yükle")}</button>
        </div>

        {imports.length > 0 && (
          <div className="px-5 pt-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">{t("Yüklenen ekstreler")}</p>
            <ul className="flex flex-wrap gap-2">
              {imports.map((imp) => (
                <li
                  key={imp.id}
                  className="flex items-center gap-2 pl-3 pr-1.5 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-xs"
                >
                  <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span className="font-medium text-slate-700 dark:text-slate-200 truncate max-w-[160px]" title={imp.filename}>
                    {imp.filename}
                  </span>
                  <span className="text-slate-400">
                    {imp.period_start && imp.period_end
                      ? `${formatDateTr(imp.period_start)}–${formatDateTr(imp.period_end)}`
                      : ''}{' '}
                    • {imp.transaction_count}{' '}{t("işlem")}</span>
                  {confirmImportId === imp.id ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void undoImport(imp)}
                        className="px-2 py-0.5 rounded-lg font-semibold text-white bg-rose-600 hover:bg-rose-500"
                      >{t("Geri al")}</button>
                      <button type="button" onClick={() => setConfirmImportId(null)} className="px-1.5 text-slate-500">{t("Vazgeç")}</button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmImportId(imp.id)}
                      title={t("Bu ekstreyi ve tüm işlemlerini sil")}
                      aria-label={t("{0} içe aktarmasını geri al", { 0: imp.filename })}
                      className="p-1 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-500/10"
                    >
                      <Undo2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {transactions.length > 0 && (
          <div className="px-5 pt-4 flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("İşyeri ara (Örn: Migros, Shell)...")}
                aria-label={t("İşyeri ara")}
                className={`${INPUT_CLASS} !pl-8 !py-1.5 !text-xs`}
              />
            </div>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              aria-label={t("Kategori filtresi")}
              className={`${INPUT_CLASS} !w-auto !py-1.5 !text-xs`}
            >
              <option value="">{t("Tüm kategoriler")}</option>
              {SPENDING_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {categoryLabel(c)}
                </option>
              ))}
            </select>
          </div>
        )}

        {isLoading && transactions.length === 0 ? (
          <div className="p-12 flex flex-col items-center gap-2 text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
            <span className="text-xs">{t("Yükleniyor...")}</span>
          </div>
        ) : transactions.length === 0 ? (
          <div className="p-10 flex flex-col items-center text-center">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 mb-3">
              <Landmark className="w-6 h-6" />
            </div>
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{t("Henüz ekstre yüklemediniz")}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-md">{t("Banka veya kredi kartı ekstrenizi yükleyin; harcamalarınız kategorilere ayrılsın, asistana \"ekstreme göre markete ne kadar harcadım?\" diye sorabilin.")}</p>
            <button type="button" className={`${PRIMARY_BUTTON} mt-4`} onClick={() => setIsImportOpen(true)}>
              <Upload className="w-4 h-4" />{' '}{t("İlk ekstreyi yükle")}</button>
          </div>
        ) : visible.length === 0 ? (
          <p className="p-10 text-center text-xs text-slate-500 dark:text-slate-400">{t("Filtreye uyan işlem yok.")}</p>
        ) : (
          <ul className={`p-5 divide-y divide-slate-200 dark:divide-slate-800 transition-opacity ${isLoading ? 'opacity-60' : ''}`}>
            {visible.map((tx) => {
              const excluded = tx.matched_receipt_id !== null || tx.currency !== 'TRY';
              return (
                <li key={tx.id} className="py-2.5 flex items-center gap-3 text-sm">
                  <div className="w-12 shrink-0 text-center">
                    <p className="text-[11px] text-slate-400 leading-tight">{formatDateTr(tx.date).slice(0, 5)}</p>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-slate-800 dark:text-slate-100 truncate">{tx.merchant}</p>
                    <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                      <select
                        aria-label={`${tx.merchant} kategorisi`}
                        value={tx.category}
                        disabled={busyId === tx.id}
                        onChange={(e) => void changeCategory(tx, e.target.value)}
                        className="text-[11px] rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-0 py-0.5 pl-1.5 pr-5 focus:ring-1 focus:ring-emerald-500"
                      >
                        {SPENDING_CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {categoryLabel(c)}
                          </option>
                        ))}
                      </select>
                      {tx.matched_receipt_id !== null && (
                        <span
                          className="inline-flex items-center gap-1 text-[11px] text-sky-700 dark:text-sky-400"
                          title={t("Fişi kayıtlı olduğu için toplamlarda fiş esas alınır")}
                        >
                          <Link2 className="w-3 h-3" />{' '}{t("fişle eşleşti")}</span>
                      )}
                      <span className="text-[11px] text-slate-400 truncate max-w-[220px]" title={tx.description}>
                        {tx.description}
                      </span>
                    </div>
                  </div>
                  <span
                    className={`font-semibold shrink-0 ${excluded ? 'text-slate-400 line-through decoration-slate-400/50' : 'text-slate-900 dark:text-white'}`}
                    title={excluded ? t("Toplamlara katılmıyor") : undefined}
                  >
                    {formatMoney(tx.amount, tx.currency)}
                  </span>
                  <button
                    type="button"
                    onClick={() => void removeTransaction(tx)}
                    disabled={busyId === tx.id}
                    aria-label={t("{0} işlemini sil", { 0: tx.merchant })}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 disabled:opacity-50 shrink-0"
                  >
                    {busyId === tx.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
