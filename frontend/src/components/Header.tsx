import { useEffect, useRef, useState } from 'react';
import { LogOut, Moon, RefreshCw, ShieldCheck, Sun, Trash2, UserRound, Wallet } from 'lucide-react';
import type { User } from '../services/api';

interface HeaderProps {
  user: User | null;
  darkMode: boolean;
  isLoading?: boolean;
  onRefresh: () => void;
  onToggleDarkMode: () => void;
  onLogout: () => void;
  onDeleteAccount: () => void;
}

const ICON_BUTTON =
  'inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-slate-100 hover:bg-slate-200/80 border border-slate-300/80 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition';

export function Header({
  user,
  darkMode,
  isLoading = false,
  onRefresh,
  onToggleDarkMode,
  onLogout,
  onDeleteAccount,
}: HeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  return (
    <header className="sticky top-0 z-30 pt-safe border-b border-slate-300/80 dark:border-slate-800 bg-white/95 dark:bg-slate-900/85 backdrop-blur-md shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/20 shrink-0">
            <Wallet className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold tracking-tight bg-gradient-to-r from-emerald-600 to-teal-500 dark:from-emerald-400 dark:to-teal-300 bg-clip-text text-transparent">
                Cebio
              </h1>
              <span className="hidden sm:inline text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20">
                AI Denetçi
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
              Otonom Fiş & Harcama Analiz Paneli
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={onRefresh} disabled={isLoading} className={ICON_BUTTON} title="Verileri Yenile">
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Yenile</span>
          </button>

          <button
            onClick={onToggleDarkMode}
            className={`${ICON_BUTTON} !p-2`}
            title={darkMode ? 'Açık Mod' : 'Karanlık Mod'}
            aria-label={darkMode ? 'Açık moda geç' : 'Karanlık moda geç'}
          >
            {darkMode ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
          </button>

          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className={`${ICON_BUTTON} !p-2`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="Hesap menüsü"
            >
              <UserRound className="w-4 h-4" />
            </button>
            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 mt-2 w-60 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg p-1.5 text-sm"
              >
                <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-800 mb-1">
                  {user?.full_name && (
                    <p className="font-semibold text-slate-900 dark:text-white truncate">{user.full_name}</p>
                  )}
                  <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{user?.email}</p>
                </div>
                <a
                  role="menuitem"
                  href="/gizlilik.html"
                  target="_blank"
                  rel="noopener"
                  onClick={() => setMenuOpen(false)}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <ShieldCheck className="w-4 h-4" /> Gizlilik ve KVKK
                </a>
                <button
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onLogout();
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <LogOut className="w-4 h-4" /> Çıkış Yap
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onDeleteAccount();
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-rose-600 dark:text-rose-400 hover:bg-rose-500/10"
                >
                  <Trash2 className="w-4 h-4" /> Hesabımı Sil
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
