import { Loader2, WifiOff } from 'lucide-react';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { AuthScreen } from './components/AuthScreen';
import { Dashboard } from './components/Dashboard';
import { I18nProvider, t, useI18n } from './i18n';

function AppGate() {
  const { status } = useAuth();

  if (status === 'offline') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 px-6 text-center bg-slate-100 dark:bg-slate-950">
        <WifiOff className="w-8 h-8 text-slate-400" />
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{t("Sunucuya ulaşılamıyor")}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs">{t("İnternet bağlantınızı kontrol edin. Bağlantı gelince otomatik olarak devam edilecek.")}</p>
        <Loader2 className="w-4 h-4 animate-spin text-emerald-500" aria-label={t("Tekrar deneniyor")} />
      </div>
    );
  }

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100 dark:bg-slate-950">
        <Loader2 className="w-6 h-6 animate-spin text-emerald-500" aria-label={t("Yükleniyor")} />
      </div>
    );
  }

  return status === 'authenticated' ? <Dashboard /> : <AuthScreen />;
}

/** Dil değişince ekranlar yeniden kurulur; modül seviyesinde t() kullanan yardımcılar da yeni dili alır. */
function LocalizedApp() {
  const { lang } = useI18n();
  return <AppGate key={lang} />;
}

export default function App() {
  return (
    <I18nProvider>
      <AuthProvider>
        <LocalizedApp />
      </AuthProvider>
    </I18nProvider>
  );
}
