import { useEffect, useState } from 'react';
import { BarChart3, Crown, Landmark, Receipt as ReceiptIcon, Repeat, Sparkles, X } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { syncStatusBar } from '../lib/native';
import { storageGet, storageSet } from '../lib/storage';
import { getApiErrorMessage, getReportMonths, LIMIT_EVENT } from '../services/api';
import { AssistantMessage, AssistantView } from './AssistantView';
import { BankView } from './bank/BankView';
import { Header } from './Header';
import { MonthlyReportModal } from './MonthlyReportModal';
import { PlanModal } from './PlanModal';
import { ReceiptsView } from './ReceiptsView';
import { SubscriptionsView } from './subscriptions/SubscriptionsView';
import { Notice } from './ui';

const THEME_KEY = 'cebio.theme';
const REPORT_SEEN_KEY = 'cebio.reportSeen';
const TR_MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
// Ayın ilk bu kadar gününde "geçen ayın raporu hazır" uyarısı gösterilir
const REPORT_BANNER_DAYS = 7;

function previousMonth(now = new Date()): { key: string; label: string } {
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return {
    key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
    label: `${TR_MONTHS[d.getMonth()]} ${d.getFullYear()}`,
  };
}
const TAB_KEY = 'cebio.tab';

type Tab = 'receipts' | 'bank' | 'subscriptions' | 'assistant';
const VALID_TABS: Tab[] = ['receipts', 'bank', 'subscriptions', 'assistant'];

// short: telefonda 4 sekme yan yana sığsın diye kısa ad
const TABS: { id: Tab; label: string; short: string; Icon: typeof ReceiptIcon }[] = [
  { id: 'receipts', label: 'Fişler', short: 'Fişler', Icon: ReceiptIcon },
  { id: 'bank', label: 'Banka', short: 'Banka', Icon: Landmark },
  { id: 'subscriptions', label: 'Abonelikler', short: 'Abonelik', Icon: Repeat },
  { id: 'assistant', label: 'Asistan', short: 'Asistan', Icon: Sparkles },
];

function useDarkMode(): [boolean, () => void] {
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    const saved = storageGet(THEME_KEY);
    if (saved) return saved === 'dark';
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true;
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    storageSet(THEME_KEY, darkMode ? 'dark' : 'light');
    void syncStatusBar(darkMode);
  }, [darkMode]);

  return [darkMode, () => setDarkMode((v) => !v)];
}

export function Dashboard() {
  const { user, logout, deleteAccount } = useAuth();
  const [darkMode, toggleDarkMode] = useDarkMode();
  const [tab, setTab] = useState<Tab>(() => {
    const saved = storageGet(TAB_KEY) as Tab | null;
    return saved && VALID_TABS.includes(saved) ? saved : 'receipts';
  });
  // Sohbet, sekmeler arasında geçişte kaybolmasın diye burada tutulur (yalnızca bellekte).
  const [chat, setChat] = useState<AssistantMessage[]>([]);
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [isPlanOpen, setIsPlanOpen] = useState(false);
  const [reportMonth, setReportMonth] = useState<string | null | undefined>(null); // null: kapalı, undefined: son ay
  const [reportBanner, setReportBanner] = useState<{ key: string; label: string } | null>(null);

  // Ayın ilk haftasında, geçen ay harcama varsa ve rapor henüz görülmediyse uyarı göster
  useEffect(() => {
    if (new Date().getDate() > REPORT_BANNER_DAYS) return;
    const prev = previousMonth();
    if (storageGet(REPORT_SEEN_KEY) === prev.key) return;
    let cancelled = false;
    getReportMonths()
      .then((months) => {
        if (!cancelled && months.includes(prev.key)) setReportBanner(prev);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const openReport = (month?: string) => {
    setReportMonth(month);
    if (reportBanner && (month === undefined || month === reportBanner.key)) {
      storageSet(REPORT_SEEN_KEY, reportBanner.key);
      setReportBanner(null);
    }
  };
  // Herhangi bir ekranda plan limiti dolunca (HTTP 402) gösterilen uyarı
  const [limitMessage, setLimitMessage] = useState<string | null>(null);

  useEffect(() => {
    const onLimit = (e: Event) => {
      const detail = (e as CustomEvent<string | undefined>).detail;
      setLimitMessage(detail || 'Bu ayki kullanım limitinize ulaştınız.');
    };
    window.addEventListener(LIMIT_EVENT, onLimit);
    return () => window.removeEventListener(LIMIT_EVENT, onLimit);
  }, []);

  useEffect(() => {
    storageSet(TAB_KEY, tab);
  }, [tab]);

  const handleDeleteAccount = async () => {
    const ok = window.confirm(
      'Hesabınız, tüm fiş ve abonelik kayıtlarınız kalıcı olarak silinecek. Bu işlem geri alınamaz. Devam edilsin mi?'
    );
    if (!ok) return;
    try {
      await deleteAccount();
    } catch (err) {
      setAccountError(getApiErrorMessage(err, 'Hesap silinirken bir hata oluştu.'));
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors duration-200">
      <Header
        user={user}
        darkMode={darkMode}
        onRefresh={() => setRefreshSignal((n) => n + 1)}
        onToggleDarkMode={toggleDarkMode}
        onLogout={logout}
        onDeleteAccount={() => void handleDeleteAccount()}
        onOpenPlan={() => setIsPlanOpen(true)}
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-safe space-y-6">
        <nav
          role="tablist"
          aria-label="Bölümler"
          className="inline-grid grid-cols-4 gap-1 p-1 rounded-xl bg-white dark:bg-slate-900 border border-slate-300/80 dark:border-slate-800 shadow-sm w-full sm:w-auto"
        >
          {TABS.map(({ id, label, short, Icon }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                role="tab"
                type="button"
                aria-selected={active}
                onClick={() => setTab(id)}
                className={`inline-flex items-center justify-center gap-1.5 sm:gap-2 px-2 sm:px-5 py-2 rounded-lg text-xs sm:text-sm font-semibold transition ${
                  active
                    ? 'bg-emerald-600 text-white dark:bg-emerald-500 dark:text-slate-950 shadow-sm'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <Icon className="w-4 h-4 hidden sm:block" />
                <span className="sm:hidden">{short}</span>
                <span className="hidden sm:inline">{label}</span>
              </button>
            );
          })}
        </nav>

        {isPlanOpen && <PlanModal onClose={() => setIsPlanOpen(false)} />}
        {reportMonth !== null && <MonthlyReportModal initialMonth={reportMonth} onClose={() => setReportMonth(null)} />}

        {reportBanner && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-xl border border-indigo-500/30 bg-indigo-500/10 text-indigo-900 dark:text-indigo-200 text-sm">
            <BarChart3 className="w-5 h-5 text-indigo-500 shrink-0" />
            <span className="flex-1">
              <strong>{reportBanner.label}</strong> raporun hazır: ne kadar harcadın, ne değişti, nerede tasarruf edebilirsin?
            </span>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => openReport(reportBanner.key)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white"
              >
                Raporu gör
              </button>
              <button
                type="button"
                aria-label="Rapor uyarısını kapat"
                onClick={() => {
                  storageSet(REPORT_SEEN_KEY, reportBanner.key);
                  setReportBanner(null);
                }}
                className="p-1 rounded-lg hover:bg-indigo-500/20"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {limitMessage && (
          <div
            role="alert"
            className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200 text-sm"
          >
            <Crown className="w-5 h-5 text-amber-500 shrink-0" />
            <span className="flex-1">{limitMessage}</span>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setIsPlanOpen(true);
                  setLimitMessage(null);
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950"
              >
                Planımı gör
              </button>
              <button
                type="button"
                onClick={() => setLimitMessage(null)}
                aria-label="Uyarıyı kapat"
                className="p-1 rounded-lg hover:bg-amber-500/20"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {accountError && <Notice kind="error" message={accountError} onClose={() => setAccountError(null)} />}

        {tab === 'receipts' && (
          <ReceiptsView darkMode={darkMode} refreshSignal={refreshSignal} onOpenReport={() => openReport(undefined)} />
        )}
        {tab === 'bank' && <BankView refreshSignal={refreshSignal} />}
        {tab === 'subscriptions' && <SubscriptionsView refreshSignal={refreshSignal} />}
        {tab === 'assistant' && <AssistantView messages={chat} setMessages={setChat} />}
      </main>
    </div>
  );
}
