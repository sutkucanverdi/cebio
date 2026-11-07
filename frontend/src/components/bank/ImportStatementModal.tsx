import { useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Link2, Loader2, Repeat, UploadCloud } from 'lucide-react';
import { formatDateTr, SPENDING_CATEGORIES } from '../../lib/format';
import { CYCLE_SUFFIX, formatMoney } from '../../lib/subscriptions';
import {
  createSubscription,
  getApiErrorMessage,
  importStatement,
  ImportResult,
  PreviewRow,
  previewStatement,
  StatementPreview,
} from '../../services/api';
import { INPUT_CLASS, Modal, PRIMARY_BUTTON, SECONDARY_BUTTON } from '../ui';

const MAX_MB = 10;
const ACCEPT = '.pdf,.csv,.txt,.jpg,.jpeg,.png,.webp,application/pdf,text/csv,text/plain,image/jpeg,image/png,image/webp';

interface ImportStatementModalProps {
  onClose: () => void;
  onImported: (result: ImportResult, subscriptionsAdded: number) => void;
}

export function ImportStatementModal({ onClose, onImported }: ImportStatementModalProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [filename, setFilename] = useState('ekstre');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [preview, setPreview] = useState<StatementPreview | null>(null);
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [selectedSubs, setSelectedSubs] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const analyze = async (file: File) => {
    if (file.size > MAX_MB * 1024 * 1024) {
      setError(`Dosya çok büyük. En fazla ${MAX_MB} MB yükleyebilirsiniz.`);
      return;
    }
    setError(null);
    setPreview(null);
    setIsAnalyzing(true);
    setFilename(file.name);
    try {
      const res = await previewStatement(file);
      setPreview(res);
      setRows(res.rows);
      setSelected(new Set(res.rows.map((r, i) => (r.already_imported ? -1 : i)).filter((i) => i >= 0)));
      setSelectedSubs(
        new Set(
          res.subscription_candidates
            .map((c, i) => (!c.already_tracked && c.confidence !== 'low' ? i : -1))
            .filter((i) => i >= 0)
        )
      );
    } catch (err) {
      setError(getApiErrorMessage(err, 'Ekstre analiz edilemedi.'));
    } finally {
      setIsAnalyzing(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const toggle = (set: Set<number>, setter: (s: Set<number>) => void, index: number) => {
    const next = new Set(set);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    setter(next);
  };

  const importable = useMemo(() => rows.filter((r) => !r.already_imported).length, [rows]);
  const selectedTotal = useMemo(
    () =>
      [...selected].reduce(
        (sum, i) => (rows[i] && rows[i].currency === 'TRY' && !rows[i].matched_receipt ? sum + rows[i].amount : sum),
        0
      ),
    [selected, rows]
  );
  const matchedCount = rows.filter((r) => r.matched_receipt && !r.already_imported).length;

  const save = async () => {
    if (!preview) return;
    setIsSaving(true);
    setError(null);
    try {
      const chosen = [...selected].sort((a, b) => a - b).map((i) => rows[i]);
      const result =
        chosen.length > 0
          ? await importStatement(
              filename,
              chosen.map(({ date, description, amount, currency, category }) => ({
                date,
                description,
                amount,
                currency,
                category,
              }))
            )
          : { import_id: null, imported: 0, skipped_duplicates: 0, matched_receipts: 0 };

      let subsAdded = 0;
      for (const i of [...selectedSubs].sort((a, b) => a - b)) {
        const c = preview.subscription_candidates[i];
        await createSubscription({
          name: c.name,
          amount: c.amount,
          currency: c.currency,
          billing_cycle: c.billing_cycle,
          next_billing_date: c.next_billing_date,
          category: c.category,
          status: 'active',
          trial_ends_at: null,
          cancel_url: c.cancel_url,
          notes: null,
        });
        subsAdded += 1;
      }
      onImported(result, subsAdded);
    } catch (err) {
      setError(getApiErrorMessage(err, 'İçe aktarma sırasında bir hata oluştu.'));
    } finally {
      setIsSaving(false);
    }
  };

  const nothingSelected = selected.size === 0 && selectedSubs.size === 0;

  return (
    <Modal
      title="Ekstre İçe Aktar"
      onClose={onClose}
      wide
      footer={
        preview && preview.rows.length > 0 ? (
          <>
            <button type="button" className={SECONDARY_BUTTON} onClick={() => inputRef.current?.click()}>
              Başka ekstre
            </button>
            <button type="button" className={PRIMARY_BUTTON} disabled={nothingSelected || isSaving} onClick={() => void save()}>
              {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
              {selected.size > 0 ? `${selected.size} işlemi içe aktar` : 'Abonelikleri ekle'}
            </button>
          </>
        ) : undefined
      }
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void analyze(file);
        }}
      />

      {!preview && (
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            Banka veya kredi kartı ekstrenizi yükleyin. Harcamalar okunup kategorilere ayrılır; siz kontrol edip
            onayladıktan sonra kaydedilir. Böylece asistan, bütçeler ve trend grafiği kart harcamalarınızı da görür.
          </p>
          <ul className="text-xs text-slate-500 dark:text-slate-400 space-y-1 list-disc pl-5">
            <li>Aynı ekstreyi tekrar yüklerseniz işlemler iki kez eklenmez.</li>
            <li>Fişini zaten taradığınız harcamalar otomatik eşleştirilir ve iki kez sayılmaz.</li>
            <li>Dosya analiz için Google Gemini'ye gönderilir ve saklanmaz; yalnızca onayladığınız satırlar kaydedilir.</li>
          </ul>
          <button
            type="button"
            disabled={isAnalyzing}
            onClick={() => inputRef.current?.click()}
            className="w-full min-h-[150px] rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-emerald-500 bg-slate-50 dark:bg-slate-800/40 flex flex-col items-center justify-center gap-2 text-sm text-slate-600 dark:text-slate-300 disabled:cursor-wait transition"
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
                <span>Ekstre okunuyor, bu biraz sürebilir...</span>
              </>
            ) : (
              <>
                <UploadCloud className="w-6 h-6 text-emerald-500" />
                <span className="font-medium">Ekstre dosyası seçin</span>
                <span className="text-xs text-slate-400">PDF, CSV veya ekran görüntüsü • en fazla {MAX_MB} MB</span>
              </>
            )}
          </button>
        </div>
      )}

      {preview && preview.rows.length === 0 && (
        <div className="py-8 text-center space-y-2">
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Ekstrede harcama bulunamadı</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">Dosyanın okunaklı olduğundan emin olup tekrar deneyin.</p>
          <button type="button" className={`${SECONDARY_BUTTON} mt-2`} onClick={() => inputRef.current?.click()}>
            Başka ekstre yükle
          </button>
        </div>
      )}

      {preview && preview.rows.length > 0 && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
            {[
              ['Okunan', String(preview.transactions_found)],
              ['Yeni', String(importable)],
              ['Fişle eşleşen', String(matchedCount)],
              ['Seçilen toplam', formatMoney(selectedTotal)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl bg-slate-50 dark:bg-slate-800/60 p-2.5">
                <p className="text-[11px] text-slate-500 dark:text-slate-400">{label}</p>
                <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{value}</p>
              </div>
            ))}
          </div>

          {preview.subscription_candidates.length > 0 && (
            <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-3">
              <p className="text-xs font-semibold text-indigo-700 dark:text-indigo-300 flex items-center gap-1.5 mb-2">
                <Repeat className="w-3.5 h-3.5" /> Ekstrede olası abonelikler — Abonelikler'e eklemek için seçin
              </p>
              <ul className="space-y-1.5">
                {preview.subscription_candidates.map((c, i) => (
                  <li key={`${c.name}-${i}`}>
                    <label className="flex items-center gap-2 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        className="accent-indigo-600"
                        checked={selectedSubs.has(i)}
                        disabled={c.already_tracked}
                        onChange={() => toggle(selectedSubs, setSelectedSubs, i)}
                      />
                      <span className="font-medium text-slate-800 dark:text-slate-100">{c.name}</span>
                      <span className="text-slate-500">
                        {formatMoney(c.amount, c.currency)}
                        {CYCLE_SUFFIX[c.billing_cycle]}
                      </span>
                      {c.already_tracked && (
                        <span className="inline-flex items-center gap-1 text-slate-400">
                          <CheckCircle2 className="w-3 h-3" /> zaten ekli
                        </span>
                      )}
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500 dark:text-slate-400">Kategorileri kontrol edin, istemediklerinizin işaretini kaldırın.</span>
            <button
              type="button"
              className="font-semibold text-emerald-700 dark:text-emerald-400 hover:underline shrink-0 ml-2"
              onClick={() =>
                setSelected(
                  selected.size === importable
                    ? new Set()
                    : new Set(rows.map((r, i) => (r.already_imported ? -1 : i)).filter((i) => i >= 0))
                )
              }
            >
              {selected.size === importable ? 'Hiçbirini seçme' : 'Tümünü seç'}
            </button>
          </div>

          <ul className="divide-y divide-slate-200 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-800 max-h-[45vh] overflow-y-auto">
            {rows.map((row, i) => (
              <li
                key={i}
                className={`flex items-start gap-2.5 px-3 py-2.5 text-xs ${row.already_imported ? 'opacity-50' : ''}`}
              >
                <input
                  type="checkbox"
                  className="mt-1 accent-emerald-600"
                  aria-label={`${row.merchant} işlemini seç`}
                  checked={selected.has(i)}
                  disabled={row.already_imported}
                  onChange={() => toggle(selected, setSelected, i)}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-800 dark:text-slate-100 truncate">{row.merchant}</p>
                      <p className="text-[11px] text-slate-400 truncate" title={row.description}>
                        {formatDateTr(row.date)} • {row.description}
                      </p>
                    </div>
                    <span className="font-semibold text-slate-900 dark:text-white shrink-0">
                      {formatMoney(row.amount, row.currency)}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <select
                      aria-label="Kategori"
                      value={row.category}
                      disabled={row.already_imported}
                      onChange={(e) =>
                        setRows((prev) => prev.map((r, j) => (j === i ? { ...r, category: e.target.value } : r)))
                      }
                      className={`${INPUT_CLASS} !w-auto !py-1 !px-2 !text-[11px]`}
                    >
                      {SPENDING_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                    {row.already_imported && (
                      <span className="px-1.5 py-0.5 rounded bg-slate-500/10 text-slate-500 font-medium">Zaten içe aktarıldı</span>
                    )}
                    {row.matched_receipt && !row.already_imported && (
                      <span
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-700 dark:text-sky-400 font-medium"
                        title="Bu harcamanın fişi zaten kayıtlı; toplamlarda iki kez sayılmaz"
                      >
                        <Link2 className="w-3 h-3" /> {row.matched_receipt.merchant} fişiyle eşleşti
                      </span>
                    )}
                    {row.currency !== 'TRY' && (
                      <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-700 dark:text-amber-400 font-medium">
                        {row.currency} — TL toplamlarına katılmaz
                      </span>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <div className="mt-4 flex items-start gap-2 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-700 dark:text-rose-300 text-xs">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
    </Modal>
  );
}
