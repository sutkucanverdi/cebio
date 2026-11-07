import { ReactNode, useEffect } from 'react';
import { AlertCircle, CheckCircle2, X } from 'lucide-react';

export const CARD_SURFACE_CLASS =
  'rounded-2xl bg-white dark:bg-slate-900 border border-slate-300/80 dark:border-slate-800 shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)] hover:shadow-md transition-shadow';

export const CHART_COLORS = [
  '#10b981', // emerald-500
  '#6366f1', // indigo-500
  '#f59e0b', // amber-500
  '#ec4899', // pink-500
  '#06b6d4', // cyan-500
  '#8b5cf6', // violet-500
  '#f97316', // orange-500
  '#14b8a6', // teal-500
];

interface NoticeProps {
  kind: 'success' | 'error';
  message: string;
  onClose: () => void;
}

export function Notice({ kind, message, onClose }: NoticeProps) {
  const isSuccess = kind === 'success';
  const Icon = isSuccess ? CheckCircle2 : AlertCircle;
  return (
    <div
      role={isSuccess ? 'status' : 'alert'}
      className={`flex items-center justify-between gap-3 p-4 rounded-xl border text-sm shadow-sm ${
        isSuccess
          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-800 dark:text-emerald-300'
          : 'bg-rose-500/10 border-rose-500/30 text-rose-800 dark:text-rose-300'
      }`}
    >
      <div className="flex items-center gap-2.5">
        <Icon className={`w-5 h-5 shrink-0 ${isSuccess ? 'text-emerald-500' : 'text-rose-500'}`} />
        <span>{message}</span>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Bildirimi kapat"
        className={`p-1 rounded-lg transition ${isSuccess ? 'hover:bg-emerald-500/20' : 'hover:bg-rose-500/20'}`}
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

export const INPUT_CLASS =
  'w-full px-3 py-2 rounded-lg text-sm bg-slate-50 dark:bg-slate-800 border border-slate-300/80 dark:border-slate-700 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20';

export const PRIMARY_BUTTON =
  'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white dark:bg-emerald-500 dark:hover:bg-emerald-400 dark:text-slate-950 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition';

export const SECONDARY_BUTTON =
  'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-slate-100 hover:bg-slate-200/80 text-slate-800 border border-slate-300/80 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-100 dark:border-slate-700 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}

export function Modal({ title, onClose, children, footer, wide = false }: ModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 backdrop-blur-sm sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`w-full ${wide ? 'sm:max-w-2xl' : 'sm:max-w-lg'} max-h-[92vh] flex flex-col rounded-t-2xl sm:rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl`}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Kapat"
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 py-4 overflow-y-auto">{children}</div>
        {footer && (
          <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-800 flex flex-wrap justify-end gap-2">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
