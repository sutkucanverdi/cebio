import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  BellOff,
  CalendarClock,
  ExternalLink,
  FileSearch,
  Hourglass,
  Loader2,
  Pause,
  Pencil,
  Play,
  Plus,
  Repeat,
  Trash2,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { formatDateTr } from '../../lib/format';
import {
  avatarGradient,
  CYCLE_LABELS,
  CYCLE_SUFFIX,
  formatMoney,
  formatTotals,
  initials,
  relativeDays,
  STATUS_BADGE,
  STATUS_LABELS,
} from '../../lib/subscriptions';
import { useSubscriptions } from '../../hooks/useSubscriptions';
import { isNative } from '../../lib/native';
import { ReminderState, remindersPreference, setRemindersEnabled, syncReminders } from '../../lib/reminders';
import {
  deleteSubscription,
  getApiErrorMessage,
  Subscription,
  SubscriptionPayload,
  SubscriptionStatus,
  updateSubscription,
} from '../../services/api';
import { CARD_SURFACE_CLASS, Notice, PRIMARY_BUTTON, SECONDARY_BUTTON } from '../ui';
import { DetectModal } from './DetectModal';
import { SubscriptionFormModal } from './SubscriptionFormModal';

type StatusFilter = 'all' | SubscriptionStatus;

const FILTERS: { id: StatusFilter; label: string }[] = [
  { id: 'all', label: 'Tümü' },
  { id: 'active', label: 'Aktif' },
  { id: 'trial', label: 'Deneme' },
  { id: 'paused', label: 'Durdurulan' },
  { id: 'cancelled', label: 'İptal' },
];

function toPayload(sub: Subscription, overrides: Partial<SubscriptionPayload> = {}): SubscriptionPayload {
  return {
    name: sub.name,
    amount: sub.amount,
    currency: sub.currency,
    billing_cycle: sub.billing_cycle,
    next_billing_date: sub.next_billing_date,
    category: sub.category,
    status: sub.status,
    trial_ends_at: sub.trial_ends_at,
    cancel_url: sub.cancel_url,
    notes: sub.notes,
    ...overrides,
  };
}

function Stat({ label, value, hint, Icon, accent }: { label: string; value: string; hint: string; Icon: LucideIcon; accent: string }) {
  return (
    <div className={`${CARD_SURFACE_CLASS} p-5 flex items-center justify-between gap-3`}>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</p>
        <p className="text-xl sm:text-2xl font-bold mt-1.5 text-slate-900 dark:text-white truncate" title={value}>
          {value}
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 truncate">{hint}</p>
      </div>
      <div className={`w-11 h-11 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0 ${accent}`}>
        <Icon className="w-5 h-5" />
      </div>
    </div>
  );
}

export function SubscriptionsView({ refreshSignal }: { refreshSignal: number }) {
  const { subscriptions, summary, catalog, isLoading, error: loadError, refresh } = useSubscriptions();
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [editing, setEditing] = useState<Subscription | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isDetectOpen, setIsDetectOpen] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (loadError) setErrorMsg(loadError);
  }, [loadError]);

  useEffect(() => {
    if (refreshSignal > 0) void refresh();
  }, [refreshSignal, refresh]);

  // Telefonda: abonelikler her değiştiğinde yenileme hatırlatıcılarını yeniden planla
  const [reminderState, setReminderState] = useState<ReminderState>(() =>
    !isNative() ? 'unsupported' : remindersPreference() ? 'on' : 'off'
  );
  useEffect(() => {
    if (isLoading) return;
    void syncReminders(subscriptions).then(setReminderState);
  }, [subscriptions, isLoading]);

  const toggleReminders = async () => {
    const next = await setRemindersEnabled(reminderState !== 'on', subscriptions);
    setReminderState(next);
    if (next === 'denied') {
      setErrorMsg('Bildirim izni verilmedi. Telefon ayarlarından Cebio için bildirimlere izin verebilirsiniz.');
    } else if (next === 'on') {
      setSuccessMsg('Hatırlatıcılar açık: yenilemeden 1 gün, deneme bitiminden 2 gün önce bildirim alacaksınız.');
    }
  };

  const visible = useMemo(
    () => (filter === 'all' ? subscriptions : subscriptions.filter((s) => s.status === filter)),
    [subscriptions, filter]
  );

  const nextUp = summary.upcoming[0] ?? subscriptions.find((s) => s.status === 'active' || s.status === 'trial');
  const tryMonthly = summary.monthly_totals.find((t) => t.currency === 'TRY')?.amount ?? 0;

  const openNew = () => {
    setEditing(null);
    setIsFormOpen(true);
  };

  const setStatus = async (sub: Subscription, status: SubscriptionStatus) => {
    setBusyId(sub.id);
    setErrorMsg(null);
    try {
      await updateSubscription(sub.id, toPayload(sub, { status, trial_ends_at: status === 'trial' ? sub.trial_ends_at : null }));
      setSuccessMsg(`"${sub.name}" ${status === 'paused' ? 'durduruldu' : status === 'cancelled' ? 'iptal edildi olarak işaretlendi' : 'yeniden aktif'}.`);
      await refresh();
    } catch (err) {
      setErrorMsg(getApiErrorMessage(err, 'Abonelik güncellenemedi.'));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (sub: Subscription) => {
    setBusyId(sub.id);
    setConfirmDeleteId(null);
    try {
      await deleteSubscription(sub.id);
      setSuccessMsg(`"${sub.name}" silindi.`);
      await refresh();
    } catch (err) {
      setErrorMsg(getApiErrorMessage(err, 'Abonelik silinemedi.'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      {isFormOpen && (
        <SubscriptionFormModal
          subscription={editing}
          catalog={catalog}
          onClose={() => setIsFormOpen(false)}
          onSaved={async (saved, isNew) => {
            setIsFormOpen(false);
            setSuccessMsg(isNew ? `"${saved.name}" eklendi.` : `"${saved.name}" güncellendi.`);
            await refresh();
          }}
        />
      )}
      {isDetectOpen && (
        <DetectModal
          onClose={() => setIsDetectOpen(false)}
          onAdded={async (count) => {
            setIsDetectOpen(false);
            setSuccessMsg(`Ekstreden ${count} abonelik eklendi.`);
            await refresh();
          }}
        />
      )}

      {successMsg && <Notice kind="success" message={successMsg} onClose={() => setSuccessMsg(null)} />}
      {errorMsg && <Notice kind="error" message={errorMsg} onClose={() => setErrorMsg(null)} />}

      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Stat
          label="Aylık Sabit Gider"
          value={formatTotals(summary.monthly_totals)}
          hint="Aktif aboneliklerin aylık karşılığı"
          Icon={Wallet}
          accent="text-emerald-600 dark:text-emerald-400"
        />
        <Stat
          label="Yıllık Toplam"
          value={formatTotals(summary.yearly_totals)}
          hint={tryMonthly > 0 ? `Günde ortalama ${formatMoney(tryMonthly / 30)}` : 'Henüz aktif abonelik yok'}
          Icon={Repeat}
          accent="text-indigo-600 dark:text-indigo-400"
        />
        <Stat
          label="Aktif Abonelik"
          value={String(summary.active_count)}
          hint={`${subscriptions.length} kayıtlı abonelik`}
          Icon={CalendarClock}
          accent="text-sky-600 dark:text-sky-400"
        />
        <Stat
          label="Sıradaki Ödeme"
          value={nextUp ? nextUp.name : '—'}
          hint={
            nextUp
              ? `${relativeDays(nextUp.days_until_next)} • ${formatMoney(nextUp.amount, nextUp.currency)}`
              : 'Yaklaşan ödeme yok'
          }
          Icon={Hourglass}
          accent="text-amber-600 dark:text-amber-400"
        />
      </section>

      {(summary.trials_ending.length > 0 || summary.recent_price_increases.length > 0) && (
        <section className="space-y-2">
          {summary.trials_ending.map((s) => (
            <div
              key={`trial-${s.id}`}
              className="flex items-center gap-2.5 p-3 rounded-xl bg-sky-500/10 border border-sky-500/30 text-sky-800 dark:text-sky-300 text-sm"
            >
              <Hourglass className="w-4 h-4 shrink-0" />
              <span>
                <strong>{s.name}</strong> deneme süresi {s.trial_ends_at ? formatDateTr(s.trial_ends_at) : ''} tarihinde bitiyor.
                Devam etmeyecekseniz şimdi iptal edin, yoksa {formatMoney(s.amount, s.currency)} çekilecek.
              </span>
            </div>
          ))}
          {summary.recent_price_increases.map((s) => (
            <div
              key={`hike-${s.id}`}
              className="flex items-center gap-2.5 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 text-sm"
            >
              <TrendingUp className="w-4 h-4 shrink-0" />
              <span>
                <strong>{s.name}</strong> zam yaptı:{' '}
                {s.last_price_change && (
                  <>
                    {formatMoney(s.last_price_change.old_amount, s.currency)} →{' '}
                    {formatMoney(s.last_price_change.new_amount, s.currency)} (
                    {formatDateTr(s.last_price_change.changed_at)})
                  </>
                )}
              </span>
            </div>
          ))}
        </section>
      )}

      <section className={`${CARD_SURFACE_CLASS} overflow-hidden`}>
        <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <Repeat className="w-4 h-4 text-emerald-500" />
              Aboneliklerim
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Yenileme tarihleri ödeme günü geçince otomatik ilerler.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {reminderState === 'unsupported' ? (
              <span
                className="inline-flex items-center gap-1.5 text-[11px] text-slate-400"
                title="Yenileme hatırlatıcıları telefon uygulamasında bildirim olarak gelir"
              >
                <Bell className="w-3.5 h-3.5" /> Hatırlatıcılar mobil uygulamada
              </span>
            ) : (
              <button
                type="button"
                role="switch"
                aria-checked={reminderState === 'on'}
                onClick={() => void toggleReminders()}
                className={SECONDARY_BUTTON}
              >
                {reminderState === 'on' ? (
                  <Bell className="w-4 h-4 text-emerald-500" />
                ) : (
                  <BellOff className="w-4 h-4" />
                )}
                Hatırlatıcılar {reminderState === 'on' ? 'açık' : 'kapalı'}
              </button>
            )}
            <button type="button" className={SECONDARY_BUTTON} onClick={() => setIsDetectOpen(true)}>
              <FileSearch className="w-4 h-4" />
              Ekstreden Bul
            </button>
            <button type="button" className={PRIMARY_BUTTON} onClick={openNew}>
              <Plus className="w-4 h-4" />
              Abonelik Ekle
            </button>
          </div>
        </div>

        {subscriptions.length > 0 && (
          <div className="px-5 pt-4 flex flex-wrap gap-1.5" role="tablist" aria-label="Durum filtresi">
            {FILTERS.map((f) => {
              const count = f.id === 'all' ? subscriptions.length : subscriptions.filter((s) => s.status === f.id).length;
              if (f.id !== 'all' && count === 0) return null;
              return (
                <button
                  key={f.id}
                  type="button"
                  role="tab"
                  aria-selected={filter === f.id}
                  onClick={() => setFilter(f.id)}
                  className={`px-3 py-1 rounded-full text-xs font-semibold border transition ${
                    filter === f.id
                      ? 'bg-emerald-500/15 border-emerald-500 text-emerald-700 dark:text-emerald-300'
                      : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {f.label} ({count})
                </button>
              );
            })}
          </div>
        )}

        {isLoading && subscriptions.length === 0 ? (
          <div className="p-12 flex flex-col items-center gap-2 text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
            <span className="text-xs">Abonelikler yükleniyor...</span>
          </div>
        ) : subscriptions.length === 0 ? (
          <div className="p-10 flex flex-col items-center text-center">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 mb-3">
              <Repeat className="w-6 h-6" />
            </div>
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Henüz abonelik eklemediniz</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-md">
              Netflix, Spotify, spor salonu... Hepsini tek yerde görün, yenilenmeden önce haberiniz olsun. Ekstrenizi
              yükleyerek abonelikleri otomatik de bulabilirsiniz.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <button type="button" className={SECONDARY_BUTTON} onClick={() => setIsDetectOpen(true)}>
                <FileSearch className="w-4 h-4" />
                Ekstreden Bul
              </button>
              <button type="button" className={PRIMARY_BUTTON} onClick={openNew}>
                <Plus className="w-4 h-4" />
                İlk aboneliği ekle
              </button>
            </div>
          </div>
        ) : (
          <ul className={`p-5 grid grid-cols-1 md:grid-cols-2 gap-3 transition-opacity ${isLoading ? 'opacity-60' : ''}`}>
            {visible.map((sub) => {
              const busy = busyId === sub.id;
              const inactive = sub.status === 'paused' || sub.status === 'cancelled';
              const soon = !inactive && sub.days_until_next <= 3;
              const hike =
                sub.last_price_change && sub.last_price_change.new_amount > sub.last_price_change.old_amount
                  ? sub.last_price_change
                  : null;
              return (
                <li
                  key={sub.id}
                  className={`p-4 rounded-xl border bg-white dark:bg-slate-800/60 ${
                    soon ? 'border-amber-500/60' : 'border-slate-200 dark:border-slate-700/70'
                  } ${inactive ? 'opacity-70' : ''}`}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`w-10 h-10 rounded-xl bg-gradient-to-br ${avatarGradient(sub.name)} text-white text-sm font-bold flex items-center justify-center shrink-0`}
                      aria-hidden="true"
                    >
                      {initials(sub.name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-900 dark:text-white truncate">{sub.name}</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {sub.category} • {CYCLE_LABELS[sub.billing_cycle]}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="font-bold text-slate-900 dark:text-white">
                            {formatMoney(sub.amount, sub.currency)}
                            <span className="text-xs font-normal text-slate-500">{CYCLE_SUFFIX[sub.billing_cycle]}</span>
                          </p>
                          {sub.billing_cycle !== 'monthly' && (
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">
                              ≈ {formatMoney(sub.monthly_equivalent, sub.currency)}/ay
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                        <span className={`px-1.5 py-0.5 rounded border font-medium ${STATUS_BADGE[sub.status]}`}>
                          {STATUS_LABELS[sub.status]}
                        </span>
                        {!inactive && (
                          <span
                            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border font-medium ${
                              soon
                                ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30'
                                : 'bg-slate-500/5 text-slate-600 dark:text-slate-300 border-slate-500/20'
                            }`}
                          >
                            {soon && <AlertTriangle className="w-3 h-3" />}
                            {formatDateTr(sub.next_billing_date)} • {relativeDays(sub.days_until_next)}
                          </span>
                        )}
                        {hike && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20 font-medium">
                            <TrendingUp className="w-3 h-3" />
                            {formatMoney(hike.old_amount, sub.currency)} → {formatMoney(hike.new_amount, sub.currency)}
                          </span>
                        )}
                      </div>
                      {sub.notes && <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 line-clamp-2">{sub.notes}</p>}

                      <div className="mt-3 flex flex-wrap items-center gap-1">
                        {confirmDeleteId === sub.id ? (
                          <>
                            <span className="text-xs text-slate-500 dark:text-slate-400 mr-1">Silinsin mi?</span>
                            <button
                              type="button"
                              onClick={() => void remove(sub)}
                              className="px-2.5 py-1 rounded-lg text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500"
                            >
                              Evet, sil
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="px-2.5 py-1 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                            >
                              Vazgeç
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setEditing(sub);
                                setIsFormOpen(true);
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/10"
                            >
                              <Pencil className="w-3.5 h-3.5" /> Düzenle
                            </button>
                            {inactive ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void setStatus(sub, 'active')}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-50"
                              >
                                <Play className="w-3.5 h-3.5" /> Aktifleştir
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void setStatus(sub, 'paused')}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50"
                              >
                                <Pause className="w-3.5 h-3.5" /> Durdur
                              </button>
                            )}
                            {sub.cancel_url && /^https?:\/\//i.test(sub.cancel_url) && (
                              <a
                                href={sub.cancel_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                              >
                                <ExternalLink className="w-3.5 h-3.5" /> İptal sayfası
                              </a>
                            )}
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => setConfirmDeleteId(sub.id)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 disabled:opacity-50 ml-auto"
                            >
                              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                              Sil
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {summary.by_category.length > 0 && (
          <div className="px-5 pb-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
              Kategoriye göre aylık (₺)
            </p>
            <div className="space-y-2">
              {summary.by_category.map((c) => {
                const pct = tryMonthly > 0 ? Math.round((c.monthly_amount / tryMonthly) * 100) : 0;
                return (
                  <div key={c.category}>
                    <div className="flex justify-between text-xs text-slate-600 dark:text-slate-300 mb-1">
                      <span>
                        {c.category} <span className="text-slate-400">({c.count})</span>
                      </span>
                      <span className="font-semibold">
                        {formatMoney(c.monthly_amount)} <span className="text-slate-400 font-normal">%{pct}</span>
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.max(pct, 2)}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
