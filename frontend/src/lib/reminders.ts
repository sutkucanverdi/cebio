/**
 * Abonelik hatırlatıcıları: telefonda yerel bildirim olarak planlanır.
 * Sunucu veya Firebase gerektirmez; uygulama her açıldığında/abonelikler değiştiğinde yeniden planlanır.
 */
import { LocalNotifications, LocalNotificationSchema } from '@capacitor/local-notifications';
import type { Subscription } from '../services/api';
import { isNative } from './native';
import { storageGet, storageSet } from './storage';
import { formatMoney } from './subscriptions';

const PREF_KEY = 'cebio.reminders';
const REMIND_HOUR = 10; // bildirim saati (yerel saat)
const HORIZON_DAYS = 60; // en fazla bu kadar ilerisi planlanır (Android/iOS planlı bildirim sınırları)
const MAX_NOTIFICATIONS = 60; // iOS en fazla 64 bekleyen bildirime izin verir

export type ReminderState = 'unsupported' | 'off' | 'on' | 'denied';

export function remindersPreference(): boolean {
  return storageGet(PREF_KEY) === 'on';
}

/** "2026-11-20" -> o günün yerel saatiyle Date */
function atLocal(isoDate: string, hour: number, dayOffset = 0): Date {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y, m - 1, d + dayOffset, hour, 0, 0, 0);
}

/** Saf fonksiyon: hangi bildirimlerin planlanacağını hesaplar (test edilebilir). */
export function buildReminders(subs: Subscription[], now: Date = new Date()): LocalNotificationSchema[] {
  const horizon = new Date(now.getTime() + HORIZON_DAYS * 86_400_000);
  const result: LocalNotificationSchema[] = [];

  for (const sub of subs) {
    if (sub.status !== 'active' && sub.status !== 'trial') continue;
    const price = formatMoney(sub.amount, sub.currency);

    // 1) Yenilemeden bir gün önce; o an geçtiyse ödeme günü sabahı
    let when = atLocal(sub.next_billing_date, REMIND_HOUR, -1);
    let body = `${sub.name} yarın yenileniyor: ${price}.`;
    if (when <= now) {
      when = atLocal(sub.next_billing_date, REMIND_HOUR);
      body = `${sub.name} bugün yenileniyor: ${price}.`;
    }
    if (when > now && when <= horizon && sub.status === 'active') {
      result.push({
        id: sub.id * 10 + 1,
        title: 'Abonelik yenileniyor',
        body,
        schedule: { at: when, allowWhileIdle: true },
        extra: { kind: 'renewal', subscriptionId: sub.id },
      });
    }

    // 2) Deneme süresi bitmeden iki gün önce
    if (sub.status === 'trial' && sub.trial_ends_at) {
      const trialAt = atLocal(sub.trial_ends_at, REMIND_HOUR, -2);
      if (trialAt > now && trialAt <= horizon) {
        result.push({
          id: sub.id * 10 + 2,
          title: 'Deneme süresi bitiyor',
          body: `${sub.name} denemesi 2 gün sonra bitiyor. Devam etmeyecekseniz şimdi iptal edin, yoksa ${price} çekilecek.`,
          schedule: { at: trialAt, allowWhileIdle: true },
          extra: { kind: 'trial', subscriptionId: sub.id },
        });
      }
    }
  }

  return result
    .sort((a, b) => (a.schedule!.at as Date).getTime() - (b.schedule!.at as Date).getTime())
    .slice(0, MAX_NOTIFICATIONS);
}

/** Her ayın 1'i saat 10:00'da "geçen ayın raporu hazır" bildirimi (bir sonraki ay başı için). */
export const MONTHLY_REPORT_NOTIFICATION_ID = 900_001;
const TR_MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

export function buildMonthlyReportReminder(now: Date = new Date()): LocalNotificationSchema {
  const at = new Date(now.getFullYear(), now.getMonth() + 1, 1, REMIND_HOUR, 0, 0, 0);
  const reportMonth = new Date(at.getFullYear(), at.getMonth() - 1, 1);
  const label = `${TR_MONTHS[reportMonth.getMonth()]} ${reportMonth.getFullYear()}`;
  return {
    id: MONTHLY_REPORT_NOTIFICATION_ID,
    title: `${label} raporun hazır`,
    body: 'Geçen ay ne kadar harcadın, en çok nereye gitti, hangi abonelikler zamlandı? Hemen bak.',
    schedule: { at, allowWhileIdle: true },
    extra: { kind: 'monthly-report' },
  };
}

async function cancelAllPending(): Promise<void> {
  const pending = await LocalNotifications.getPending();
  if (pending.notifications.length) {
    await LocalNotifications.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
  }
}

/** Kullanıcı tercihine göre bildirimleri yeniden planlar. Web'de hiçbir şey yapmaz. */
export async function syncReminders(subs: Subscription[]): Promise<ReminderState> {
  if (!isNative()) return 'unsupported';
  try {
    if (!remindersPreference()) {
      await cancelAllPending();
      return 'off';
    }
    const perm = await LocalNotifications.checkPermissions();
    if (perm.display !== 'granted') return 'denied';
    await cancelAllPending();
    const notifications = [...buildReminders(subs), buildMonthlyReportReminder()];
    if (notifications.length) await LocalNotifications.schedule({ notifications });
    return 'on';
  } catch {
    return 'off';
  }
}

/** Hatırlatıcıları açar/kapatır; açarken bildirim izni ister. */
export async function setRemindersEnabled(enabled: boolean, subs: Subscription[]): Promise<ReminderState> {
  if (!isNative()) return 'unsupported';
  if (enabled) {
    let perm = await LocalNotifications.checkPermissions();
    if (perm.display !== 'granted') perm = await LocalNotifications.requestPermissions();
    if (perm.display !== 'granted') {
      storageSet(PREF_KEY, 'off');
      return 'denied';
    }
  }
  storageSet(PREF_KEY, enabled ? 'on' : 'off');
  return syncReminders(subs);
}
