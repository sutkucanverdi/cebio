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
