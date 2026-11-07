import { FormEvent, useEffect, useState } from 'react';
import { AlertCircle, Loader2, Pencil, Plus, Target, Trash2 } from 'lucide-react';
import { formatCurrency, RECEIPT_CATEGORIES } from '../lib/format';
import {
  BudgetState,
  BudgetStatus,
  BudgetStatusResponse,
  createBudget,
  deleteBudget,
  getApiErrorMessage,
  getBudgets,
  updateBudget,
} from '../services/api';
import { CARD_SURFACE_CLASS, INPUT_CLASS, Modal, PRIMARY_BUTTON, SECONDARY_BUTTON } from './ui';

const GENERAL = '__general__';

const BAR_COLOR: Record<BudgetState, string> = {
  ok: 'bg-emerald-500',
  warning: 'bg-amber-500',
  exceeded: 'bg-rose-500',
};

const STATE_TEXT: Record<BudgetState, string> = {
  ok: 'text-slate-500 dark:text-slate-400',
  warning: 'text-amber-700 dark:text-amber-400',
  exceeded: 'text-rose-700 dark:text-rose-400',
};

function parseAmount(text: string): number {
  const cleaned = text.trim().replace(/\s/g, '').replace('₺', '');
  const normalized = cleaned.includes(',') ? cleaned.replace(/\./g, '').replace(',', '.') : cleaned;
  return Number(normalized);
}

interface BudgetFormProps {
  editing: BudgetStatus | null;
  usedCategories: Set<string>;
  onClose: () => void;
  onSaved: (data: BudgetStatusResponse) => void;
}

function BudgetForm({ editing, usedCategories, onClose, onSaved }: BudgetFormProps) {
  const available = [GENERAL, ...RECEIPT_CATEGORIES].filter((c) => !usedCategories.has(c));
  const [category, setCategory] = useState<string>(available[0] ?? GENERAL);
  const [amountText, setAmountText] = useState(editing ? String(editing.monthly_limit).replace('.', ',') : '');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const amount = parseAmount(amountText);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Geçerli bir aylık limit girin (Örn: 5.000).');
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const data = editing
        ? await updateBudget(editing.id, amount)
        : await createBudget(category === GENERAL ? null : category, amount);
      onSaved(data);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Bütçe kaydedilemedi.'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      title={editing ? `Bütçeyi Düzenle: ${editing.category ?? 'Genel'}` : 'Bütçe Ekle'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={SECONDARY_BUTTON} onClick={onClose}>
            Vazgeç
          </button>
          <button type="submit" form="budget-form" className={PRIMARY_BUTTON} disabled={isSaving}>
            {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
            Kaydet
          </button>
        </>
      }
    >
      <form id="budget-form" onSubmit={submit} className="space-y-4">
        {!editing && (
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Neyin bütçesi?</span>
            <select className={INPUT_CLASS} value={category} onChange={(e) => setCategory(e.target.value)}>
              {available.map((c) => (
                <option key={c} value={c}>
                  {c === GENERAL ? 'Genel (tüm fiş harcamaları)' : c}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Aylık limit (₺)</span>
          <input
            className={INPUT_CLASS}
            inputMode="decimal"
            autoFocus
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            placeholder="5.000"
          />
        </label>
        <p className="text-[11px] text-slate-400">
          Limitin %80'ine gelince sarı, aşınca kırmızı uyarı görürsünüz. Abonelikler bu bütçeye dahil değildir.
        </p>
        {error && (
          <div className="flex items-start gap-2 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-700 dark:text-rose-300 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
      </form>
    </Modal>
  );
}

export function BudgetsCard({ reloadKey }: { reloadKey: number }) {
  const [data, setData] = useState<BudgetStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<BudgetStatus | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    getBudgets()
      .then((res) => !cancelled && setData(res))
      .catch((err) => !cancelled && setError(getApiErrorMessage(err, 'Bütçeler yüklenemedi.')));
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const budgets = data?.budgets ?? [];
  const used = new Set(budgets.map((b) => b.category ?? GENERAL));

  const remove = async (id: number) => {
    setConfirmId(null);
    try {
      await deleteBudget(id);
      setData(await getBudgets());
    } catch (err) {
      setError(getApiErrorMessage(err, 'Bütçe silinemedi.'));
    }
  };

  return (
    <div className={`lg:col-span-5 ${CARD_SURFACE_CLASS} p-6 flex flex-col`}>
      {formOpen && (
        <BudgetForm
          editing={editing}
          usedCategories={used}
          onClose={() => setFormOpen(false)}
          onSaved={(res) => {
            setData(res);
            setFormOpen(false);
          }}
        />
      )}

      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <Target className="w-4 h-4 text-emerald-500" />
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">Aylık Bütçeler</h2>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{data?.label ?? 'Bu ay'}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
          disabled={used.size > RECEIPT_CATEGORIES.length}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 disabled:opacity-40 transition"
        >
          <Plus className="w-3.5 h-3.5" /> Ekle
        </button>
      </div>

      {error && <p className="text-xs text-rose-600 dark:text-rose-400 mb-2">{error}</p>}

      {budgets.length === 0 ? (
        <div className="flex-1 min-h-[180px] flex flex-col items-center justify-center text-center gap-1">
          <Target className="w-8 h-8 text-slate-300 dark:text-slate-600" />
          <p className="text-sm font-medium text-slate-600 dark:text-slate-300">Henüz bütçe yok</p>
          <p className="text-xs text-slate-400 max-w-[240px]">
            Aylık genel veya kategori bazlı limit belirleyin, aşmadan önce uyaralım.
          </p>
        </div>
      ) : (
        <ul className="space-y-3.5 max-h-[260px] overflow-y-auto scrollbar-thin pr-1">
          {budgets.map((b) => {
            const width = Math.min(100, Math.max(b.percent, 2));
            const overProjection = b.state !== 'exceeded' && b.projected > b.monthly_limit;
            return (
              <li key={b.id} className="group">
                <div className="flex items-center justify-between gap-2 text-xs mb-1">
                  <span className="font-semibold text-slate-800 dark:text-slate-100 truncate">
                    {b.category ?? 'Genel'}
                  </span>
                  <span className="flex items-center gap-1 shrink-0">
                    <span className="font-semibold text-slate-900 dark:text-white">{formatCurrency(b.spent)}</span>
                    <span className="text-slate-400">/ {formatCurrency(b.monthly_limit)}</span>
                    {confirmId === b.id ? (
                      <>
                        <button
                          type="button"
                          onClick={() => void remove(b.id)}
                          className="ml-1 px-1.5 py-0.5 rounded text-[11px] font-semibold text-white bg-rose-600"
                        >
                          Sil
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmId(null)}
                          className="px-1.5 py-0.5 rounded text-[11px] text-slate-500"
                        >
                          Vazgeç
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          aria-label={`${b.category ?? 'Genel'} bütçesini düzenle`}
                          onClick={() => {
                            setEditing(b);
                            setFormOpen(true);
                          }}
                          className="ml-1 p-1 rounded text-slate-400 hover:text-indigo-500 hover:bg-indigo-500/10"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          aria-label={`${b.category ?? 'Genel'} bütçesini sil`}
                          onClick={() => setConfirmId(b.id)}
                          className="p-1 rounded text-slate-400 hover:text-rose-500 hover:bg-rose-500/10"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </>
                    )}
                  </span>
                </div>
                <div
                  className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden"
                  role="progressbar"
                  aria-valuenow={Math.round(b.percent)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${b.category ?? 'Genel'} bütçesi`}
                >
                  <div className={`h-full rounded-full ${BAR_COLOR[b.state]}`} style={{ width: `${width}%` }} />
                </div>
                <p className={`mt-1 text-[11px] ${STATE_TEXT[b.state]}`}>
                  {b.state === 'exceeded'
                    ? `Limit ${formatCurrency(-b.remaining)} aşıldı (%${b.percent.toFixed(0)})`
                    : `%${b.percent.toFixed(0)} kullanıldı • ${formatCurrency(b.remaining)} kaldı`}
                  {overProjection && ` • Bu hızla ay sonu ~${formatCurrency(b.projected)}`}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
