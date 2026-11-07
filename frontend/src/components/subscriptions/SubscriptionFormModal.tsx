import { FormEvent, useMemo, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { todayIso } from '../../lib/format';
import {
  CURRENCIES,
  CYCLE_LABELS,
  STATUS_LABELS,
  SUBSCRIPTION_CATEGORIES,
} from '../../lib/subscriptions';
import {
  BillingCycle,
  CatalogEntry,
  createSubscription,
  getApiErrorMessage,
  Subscription,
  SubscriptionPayload,
  SubscriptionStatus,
  updateSubscription,
} from '../../services/api';
import { INPUT_CLASS, Modal, PRIMARY_BUTTON, SECONDARY_BUTTON } from '../ui';

interface SubscriptionFormModalProps {
  /** Düzenlenecek abonelik; null ise yeni kayıt. */
  subscription: Subscription | null;
  catalog: CatalogEntry[];
  onClose: () => void;
  onSaved: (saved: Subscription, isNew: boolean) => void;
}

function nextMonthIso(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  const offset = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - offset).toISOString().slice(0, 10);
}

function initialForm(sub: Subscription | null): SubscriptionPayload & { amountText: string } {
  if (sub) {
    return {
      name: sub.name,
      amount: sub.amount,
      amountText: String(sub.amount).replace('.', ','),
      currency: sub.currency,
      billing_cycle: sub.billing_cycle,
      next_billing_date: sub.next_billing_date,
      category: sub.category,
      status: sub.status,
      trial_ends_at: sub.trial_ends_at,
      cancel_url: sub.cancel_url,
      notes: sub.notes,
    };
  }
  return {
    name: '',
    amount: 0,
    amountText: '',
    currency: 'TRY',
    billing_cycle: 'monthly',
    next_billing_date: nextMonthIso(),
    category: 'Dizi & Film',
    status: 'active',
    trial_ends_at: null,
    cancel_url: null,
    notes: null,
  };
}

/** "1.234,56" / "1234.56" / "129,99" -> sayı */
function parseAmount(text: string): number {
  const cleaned = text.trim().replace(/\s/g, '').replace(/[₺$€£]/g, '');
  const normalized = cleaned.includes(',') ? cleaned.replace(/\./g, '').replace(',', '.') : cleaned;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : NaN;
}

export function SubscriptionFormModal({ subscription, catalog, onClose, onSaved }: SubscriptionFormModalProps) {
  const isNew = subscription === null;
  const [form, setForm] = useState(() => initialForm(subscription));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const categories = useMemo(() => {
    const set = new Set(SUBSCRIPTION_CATEGORIES);
    catalog.forEach((c) => set.add(c.category));
    if (form.category) set.add(form.category);
    return [...set];
  }, [catalog, form.category]);

  const patch = (p: Partial<typeof form>) => setForm((prev) => ({ ...prev, ...p }));

  const pickFromCatalog = (entry: CatalogEntry) => {
    patch({
      name: entry.name,
      category: entry.category,
      billing_cycle: entry.default_cycle,
      cancel_url: entry.cancel_url,
    });
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const amount = parseAmount(form.amountText);
    if (!form.name.trim()) return setError('Abonelik adı boş bırakılamaz.');
    if (!Number.isFinite(amount) || amount < 0) return setError('Geçerli bir ücret girin (Örn: 129,99).');
    if (!form.next_billing_date) return setError('Sonraki ödeme tarihini seçin.');
    if (form.status === 'trial' && !form.trial_ends_at) return setError('Deneme süresinin bitiş tarihini seçin.');

    const { amountText: _ignored, ...rest } = form;
    void _ignored;
    const payload: SubscriptionPayload = {
      ...rest,
      name: form.name.trim(),
      amount,
      trial_ends_at: form.status === 'trial' ? form.trial_ends_at : null,
      cancel_url: form.cancel_url?.trim() || null,
      notes: form.notes?.trim() || null,
    };

    setIsSaving(true);
    try {
      const saved = isNew ? await createSubscription(payload) : await updateSubscription(subscription.id, payload);
      onSaved(saved, isNew);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Abonelik kaydedilemedi.'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      title={isNew ? 'Abonelik Ekle' : 'Aboneliği Düzenle'}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className={SECONDARY_BUTTON}>
            Vazgeç
          </button>
          <button type="submit" form="subscription-form" disabled={isSaving} className={PRIMARY_BUTTON}>
            {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
            {isNew ? 'Ekle' : 'Kaydet'}
          </button>
        </>
      }
    >
      <form id="subscription-form" onSubmit={handleSubmit} className="space-y-4">
        {isNew && catalog.length > 0 && (
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">Hızlı seç</p>
            <div className="flex flex-wrap gap-1.5">
              {catalog.map((entry) => (
                <button
                  key={entry.key}
                  type="button"
                  onClick={() => pickFromCatalog(entry)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border transition ${
                    form.name === entry.name
                      ? 'bg-emerald-500/15 border-emerald-500 text-emerald-700 dark:text-emerald-300'
                      : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-emerald-500'
                  }`}
                >
                  {entry.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Abonelik adı</span>
          <input
            className={INPUT_CLASS}
            value={form.name}
            maxLength={120}
            onChange={(e) => patch({ name: e.target.value })}
            placeholder="Örn: Netflix, Spor salonu"
            required
          />
        </label>

        <div className="grid grid-cols-3 gap-3">
          <label className="col-span-2 block space-y-1.5">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Ücret</span>
            <input
              className={INPUT_CLASS}
              inputMode="decimal"
              value={form.amountText}
              onChange={(e) => patch({ amountText: e.target.value })}
              placeholder="129,99"
              required
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Para birimi</span>
            <select className={INPUT_CLASS} value={form.currency} onChange={(e) => patch({ currency: e.target.value })}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Ödeme sıklığı</span>
            <select
              className={INPUT_CLASS}
              value={form.billing_cycle}
              onChange={(e) => patch({ billing_cycle: e.target.value as BillingCycle })}
            >
              {(Object.keys(CYCLE_LABELS) as BillingCycle[]).map((c) => (
                <option key={c} value={c}>
                  {CYCLE_LABELS[c]}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Sonraki ödeme</span>
            <input
              type="date"
              className={INPUT_CLASS}
              value={form.next_billing_date}
              onChange={(e) => patch({ next_billing_date: e.target.value })}
              required
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Kategori</span>
            <select className={INPUT_CLASS} value={form.category} onChange={(e) => patch({ category: e.target.value })}>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Durum</span>
            <select
              className={INPUT_CLASS}
              value={form.status}
              onChange={(e) => {
                const status = e.target.value as SubscriptionStatus;
                patch({
                  status,
                  trial_ends_at: status === 'trial' ? form.trial_ends_at || form.next_billing_date || todayIso() : null,
                });
              }}
            >
              {(Object.keys(STATUS_LABELS) as SubscriptionStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
        </div>

        {form.status === 'trial' && (
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Deneme süresi bitişi</span>
            <input
              type="date"
              className={INPUT_CLASS}
              value={form.trial_ends_at ?? ''}
              onChange={(e) => patch({ trial_ends_at: e.target.value || null })}
            />
            <span className="block text-[11px] text-slate-400">
              Bitmeden önce uyarılırsınız; bitince abonelik otomatik olarak aktife geçer.
            </span>
          </label>
        )}

        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-300">İptal linki (isteğe bağlı)</span>
          <input
            type="url"
            className={INPUT_CLASS}
            value={form.cancel_url ?? ''}
            onChange={(e) => patch({ cancel_url: e.target.value })}
            placeholder="https://..."
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Not (isteğe bağlı)</span>
          <textarea
            className={`${INPUT_CLASS} min-h-[64px]`}
            value={form.notes ?? ''}
            maxLength={1000}
            onChange={(e) => patch({ notes: e.target.value })}
            placeholder="Örn: Aile planı, kardeşimle paylaşıyoruz"
          />
        </label>

        {!isNew && (
          <p className="text-[11px] text-slate-400">
            Ücreti değiştirirseniz eski ve yeni tutar zam geçmişine kaydedilir.
          </p>
        )}

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
