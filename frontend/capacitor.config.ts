import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Yerel geliştirme: emülatörden bilgisayardaki API'ye (http://10.0.2.2:8000) bağlanmak için
 *   CAP_DEV_CLEARTEXT=1 npx cap sync android
 * Mağaza derlemelerinde bu değişkeni KULLANMAYIN; API her zaman HTTPS olmalı.
 */
const devCleartext = process.env.CAP_DEV_CLEARTEXT === '1';

const config: CapacitorConfig = {
  // Mağazaya ilk yüklemeden sonra DEĞİŞTİRİLEMEZ.
  appId: 'io.github.sutkucanverdi.cebio',
  appName: 'Cebio',
  webDir: 'dist',
  backgroundColor: '#0f172a',
  server: devCleartext ? { androidScheme: 'http', cleartext: true } : { androidScheme: 'https' },
  android: {
    allowMixedContent: devCleartext,
  },
  plugins: {
    SystemBars: {
      // Güvenli alan boşluklarını --safe-area-inset-* CSS değişkenleri olarak ver (index.css kullanır)
      insetsHandling: 'css',
      initialViewportFitValueHint: 'cover',
    },
    SplashScreen: {
      launchShowDuration: 600,
      launchAutoHide: true,
      backgroundColor: '#0f172a',
      showSpinner: false,
    },
    LocalNotifications: {
      iconColor: '#10b981',
    },
  },
};

export default config;
