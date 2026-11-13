/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  /** RevenueCat genel (public) SDK anahtarları; boşsa uygulama içi satın alma gizlenir */
  readonly VITE_REVENUECAT_APPLE_KEY?: string;
  readonly VITE_REVENUECAT_GOOGLE_KEY?: string;
  /** Destek e-postası (Ayarlar > Destek ve mağaza sayfaları) */
  readonly VITE_SUPPORT_EMAIL?: string;
  /** Yasal sayfaların yayınlandığı web adresi (ör. https://cebio.app); boşsa uygulamaya gömülü kopyalar açılır */
  readonly VITE_PUBLIC_SITE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
