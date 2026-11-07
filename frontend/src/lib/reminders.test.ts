import { describe, expect, it } from 'vitest';
import type { Subscription } from '../services/api';
import { buildReminders } from './reminders';

function sub(overrides: Partial<Subscription>): Subscription {
  return {
    id: 1,
    name: 'Netflix',
    amount: 249.99,
    currency: 'TRY',
    billing_cycle: 'monthly',
    next_billing_date: '2026-11-20',
    category: 'Dizi & Film',
    status: 'active',
    trial_ends_at: null,
    cancel_url: null,
    notes: null,
    created_at: '2026-11-01T00:00:00Z',
    monthly_equivalent: 249.99,
    days_until_next: 13,
    last_price_change: null,
    ...overrides,
  };
}

// 7 Kasım 2026, 15:00 yerel saat
const NOW = new Date(2026, 10, 7, 15, 0, 0);

describe('buildReminders', () => {
  it('yenilemeden bir gün önce saat 10:00 için hatırlatır', () => {
    const [n] = buildReminders([sub({})], NOW);
    expect(n.id).toBe(11);
    expect(n.schedule?.at).toEqual(new Date(2026, 10, 19, 10, 0, 0));
    expect(n.body).toContain('Netflix yarın yenileniyor');
    expect(n.body).toContain('249,99');
  });

  it('bir gün öncesi geçmişse ödeme günü sabahı hatırlatır, ikisi de geçmişse atlar', () => {
    const tomorrow = buildReminders([sub({ next_billing_date: '2026-11-08' })], NOW);
    expect(tomorrow[0].schedule?.at).toEqual(new Date(2026, 10, 8, 10, 0, 0));
    expect(tomorrow[0].body).toContain('bugün yenileniyor');

    expect(buildReminders([sub({ next_billing_date: '2026-11-07' })], NOW)).toEqual([]);
  });

  it('durdurulan/iptal edilen abonelikler ve 60 günden uzak tarihler için bildirim yok', () => {
    expect(buildReminders([sub({ status: 'paused' }), sub({ id: 2, status: 'cancelled' })], NOW)).toEqual([]);
    expect(buildReminders([sub({ next_billing_date: '2027-03-01' })], NOW)).toEqual([]);
  });

  it('deneme süresi bitmeden iki gün önce uyarır', () => {
    const notes = buildReminders(
      [sub({ id: 3, name: 'Disney+', status: 'trial', trial_ends_at: '2026-11-15', next_billing_date: '2026-11-15' })],
      NOW
    );
    expect(notes).toHaveLength(1); // deneme sürecinde "yenileniyor" bildirimi gönderilmez
    expect(notes[0].id).toBe(32);
    expect(notes[0].schedule?.at).toEqual(new Date(2026, 10, 13, 10, 0, 0));
    expect(notes[0].body).toContain('Disney+ denemesi 2 gün sonra bitiyor');
  });

  it('tarihe göre sıralar ve 60 bildirim sınırını aşmaz', () => {
    const many = Array.from({ length: 80 }, (_, i) =>
      sub({ id: i + 1, next_billing_date: `2026-12-${String((i % 28) + 1).padStart(2, '0')}` })
    );
    const notes = buildReminders(many, NOW);
    expect(notes).toHaveLength(60);
    const times = notes.map((n) => (n.schedule!.at as Date).getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('yabancı para birimini doğru biçimler', () => {
    const [n] = buildReminders([sub({ name: 'ChatGPT Plus', amount: 20, currency: 'USD' })], NOW);
    expect(n.body).toMatch(/\$20,00/);
  });
});
