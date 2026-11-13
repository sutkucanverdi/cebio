/**
 * Uygulama içi abonelik (Premium) — App Store / Google Play faturalandırması, RevenueCat üzerinden.
 *
 * Mağaza kuralları (Apple 3.1.1, Google Play Ödemeler politikası) dijital abonelikler için
 * mağazanın kendi ödeme sistemini zorunlu kılar; bu yüzden satın alma yalnızca telefonda yapılır.
 *
 * Etkinleştirmek için (YAYIN.md > "Uygulama içi satın alma"):
 *   VITE_REVENUECAT_APPLE_KEY=appl_...    VITE_REVENUECAT_GOOGLE_KEY=goog_...
 * Anahtar yoksa satın alma ekranı gizlenir (yarım kalmış bir satın alma butonu inceleme reddine yol açar).
 *
 * Kullanıcı RevenueCat'e kendi ID'mizle tanıtılır; backend webhook'u (billing.py) bu ID ile premium'u açar.
 */
import { Capacitor } from '@capacitor/core';

export const PREMIUM_ENTITLEMENT = 'premium';

const KEYS: Record<string, string | undefined> = {
  ios: import.meta.env.VITE_REVENUECAT_APPLE_KEY,
  android: import.meta.env.VITE_REVENUECAT_GOOGLE_KEY,
};

export const MANAGE_SUBSCRIPTIONS_URL: Record<string, string> = {
  ios: 'https://apps.apple.com/account/subscriptions',
  android: 'https://play.google.com/store/account/subscriptions?package=io.github.sutkucanverdi.cebio',
};

export function purchasesAvailable(): boolean {
  const platform = Capacitor.getPlatform();
  return Capacitor.isNativePlatform() && Boolean(KEYS[platform]);
}

export function manageSubscriptionsUrl(): string | null {
  return MANAGE_SUBSCRIPTIONS_URL[Capacitor.getPlatform()] ?? null;
}

async function sdk() {
  const { Purchases } = await import('@revenuecat/purchases-capacitor');
  return Purchases;
}

let configuredUser: string | null = null;
let configured = false;

/** Oturum açılınca çağrılır; aynı kullanıcı için tekrar yapılandırmaz. */
export async function initPurchases(userId: number): Promise<void> {
  if (!purchasesAvailable()) return;
  const id = String(userId);
  if (configuredUser === id) return;
  const Purchases = await sdk();
  if (!configured) {
    await Purchases.configure({ apiKey: KEYS[Capacitor.getPlatform()]!, appUserID: id });
    configured = true;
  } else {
    await Purchases.logIn({ appUserID: id });
  }
  configuredUser = id;
}

export async function logoutPurchases(): Promise<void> {
  if (!configured || !configuredUser) return;
  try {
    const Purchases = await sdk();
    await Purchases.logOut();
  } catch {
    /* anonim kullanıcıda logOut hata verebilir */
  }
  configuredUser = null;
}

export type Period = 'monthly' | 'yearly' | 'other';

export interface PremiumPackage {
  id: string;
  title: string;
  priceString: string;
  period: Period;
  /** Ücretsiz deneme / indirimli giriş fiyatı açıklaması (mağaza verisinden) */
  intro: string | null;
  raw: unknown;
}

function periodOf(iso: string | null | undefined, packageType: string): Period {
  if (packageType === 'ANNUAL' || iso === 'P1Y') return 'yearly';
  if (packageType === 'MONTHLY' || iso === 'P1M') return 'monthly';
  return 'other';
}

export async function getPremiumPackages(): Promise<PremiumPackage[]> {
  const Purchases = await sdk();
  const offerings = await Purchases.getOfferings();
  const pkgs = offerings.current?.availablePackages ?? [];
  return pkgs.map((p) => ({
    id: p.identifier,
    title: p.product.title,
    priceString: p.product.priceString,
    period: periodOf(p.product.subscriptionPeriod, String(p.packageType)),
    intro: p.product.introPrice ? `${p.product.introPrice.priceString} / ${p.product.introPrice.period}` : null,
    raw: p,
  }));
}

/** true: satın alındı ve premium aktif; false: kullanıcı vazgeçti. Diğer hatalar fırlatılır. */
export async function buyPackage(pkg: PremiumPackage): Promise<boolean> {
  const Purchases = await sdk();
  try {
    const result = await Purchases.purchasePackage({ aPackage: pkg.raw as never });
    return Boolean(result.customerInfo.entitlements.active[PREMIUM_ENTITLEMENT]);
  } catch (err) {
    if ((err as { userCancelled?: boolean })?.userCancelled) return false;
    throw err;
  }
}

/** Satın alımları geri yükler (Apple zorunlu tutar); premium aktifse true. */
export async function restorePurchases(): Promise<boolean> {
  const Purchases = await sdk();
  const { customerInfo } = await Purchases.restorePurchases();
  return Boolean(customerInfo.entitlements.active[PREMIUM_ENTITLEMENT]);
}
