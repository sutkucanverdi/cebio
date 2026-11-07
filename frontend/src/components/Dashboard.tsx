import { useEffect, useState } from 'react';
import { Receipt as ReceiptIcon, Repeat } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { storageGet, storageSet } from '../lib/storage';
import { getApiErrorMessage } from '../services/api';
import { Header } from './Header';
import { ReceiptsView } from './ReceiptsView';
import { SubscriptionsView } from './subscriptions/SubscriptionsView';
import { Notice } from './ui';

const THEME_KEY = 'cebio.theme';
const TAB_KEY = 'cebio.tab';

type Tab = 'receipts' | 'subscriptions';

const TABS: { id: Tab; label: string; Icon: typeof ReceiptIcon }[] = [
  { id: 'receipts', label: 'Fişler', Icon: ReceiptIcon },
  { id: 'subscriptions', label: 'Abonelikler', Icon: Repeat },
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
  }, [darkMode]);

  return [darkMode, () => setDarkMode((v) => !v)];
}

export function Dashboard() {
  const { user, logout, deleteAccount } = useAuth();
  const [darkMode, toggleDarkMode] = useDarkMode();
  const [tab, setTab] = useState<Tab>(() =>
    storageGet(TAB_KEY) === 'subscriptions' ? 'subscriptions' : 'receipts'
  );
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [accountError, setAccountError] = useState<string | null>(null);

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
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        <nav
          role="tablist"
          aria-label="Bölümler"
          className="inline-grid grid-cols-2 gap-1 p-1 rounded-xl bg-white dark:bg-slate-900 border border-slate-300/80 dark:border-slate-800 shadow-sm w-full sm:w-auto"
        >
          {TABS.map(({ id, label, Icon }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                role="tab"
                type="button"
                aria-selected={active}
                onClick={() => setTab(id)}
                className={`inline-flex items-center justify-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold transition ${
                  active
                    ? 'bg-emerald-600 text-white dark:bg-emerald-500 dark:text-slate-950 shadow-sm'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            );
          })}
        </nav>

        {accountError && <Notice kind="error" message={accountError} onClose={() => setAccountError(null)} />}

        {tab === 'receipts' ? (
          <ReceiptsView darkMode={darkMode} refreshSignal={refreshSignal} />
        ) : (
          <SubscriptionsView refreshSignal={refreshSignal} />
        )}
      </main>
    </div>
  );
}
