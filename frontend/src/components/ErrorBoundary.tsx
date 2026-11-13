import { Component, ErrorInfo, ReactNode } from 'react';
import { t } from '../i18n';

/** Beklenmedik bir hata tüm uygulamayı boş ekranda bırakmasın; kullanıcıya yeniden yükleme imkânı ver. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Cebio hata yakaladı:', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 px-6 text-center bg-slate-100 dark:bg-slate-950">
        <p className="text-base font-semibold text-slate-800 dark:text-slate-100">{t('Bir şeyler ters gitti')}</p>
        <p className="text-sm text-slate-500 dark:text-slate-400 max-w-xs">
          {t('Verilerin güvende. Uygulamayı yeniden yükleyerek devam edebilirsin.')}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="px-4 py-2 rounded-xl text-sm font-semibold bg-emerald-600 text-white"
        >
          {t('Yeniden yükle')}
        </button>
      </div>
    );
  }
}
