import { DragEvent, useRef, useState } from 'react';
import { Camera, FolderOpen, PencilLine, Sparkles, UploadCloud } from 'lucide-react';
import { CARD_SURFACE_CLASS } from './ui';

import { t } from '../i18n';
const VALID_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const VALID_EXTS = ['.jpg', '.jpeg', '.png', '.webp'];
export const MAX_UPLOAD_MB = 10;

/** Dosya geçerliyse null, değilse kullanıcıya gösterilecek hata mesajı döner. */
export function validateReceiptFile(file: File): string | null {
  const type = file.type.toLowerCase();
  const dot = file.name.lastIndexOf('.');
  const ext = dot !== -1 ? file.name.toLowerCase().slice(dot) : '';
  if (!VALID_TYPES.includes(type) && !VALID_EXTS.includes(ext)) {
    return t("Lütfen geçerli bir fiş görseli (.jpg, .jpeg, .png, .webp) seçin.");
  }
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
    return t("Dosya çok büyük. En fazla {0} MB yükleyebilirsiniz.", { 0: MAX_UPLOAD_MB });
  }
  return null;
}

interface UploadCardProps {
  isUploading: boolean;
  onFile: (file: File) => void;
  /** Yapay zeka kullanmadan elle fiş ekle */
  onManual: () => void;
}

export function UploadCard({ isUploading, onFile, onManual }: UploadCardProps) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);

  const pick = (input: HTMLInputElement | null) => {
    const file = input?.files?.[0];
    if (file) onFile(file);
    // Aynı dosya tekrar seçilebilsin
    if (input) input.value = '';
  };

  const stop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div className={`lg:col-span-5 ${CARD_SURFACE_CLASS} p-6 flex flex-col justify-between`}>
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-emerald-500" />
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">{t("Hızlı Fiş Yükleme")}</h2>
          </div>
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{t("JPEG • PNG • WEBP •")}{' '}{MAX_UPLOAD_MB}{' '}{t("MB")}</span>
        </div>
        <p className="text-xs text-slate-600 dark:text-slate-400 mb-4 leading-relaxed">{t("Fiş veya fatura fotoğrafını sürükleyip bırakın. Yapay zeka (Google Gemini) mağaza adını, tarihi ve tüm ürünleri adetleriyle birlikte otomatik olarak ayrıştırır.")}</p>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
        className="hidden"
        onChange={() => pick(fileInputRef.current)}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={() => pick(cameraInputRef.current)}
      />

      <div
        role="button"
        tabIndex={0}
        aria-label={t("Fiş görseli seç veya sürükle bırak")}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !isUploading) fileInputRef.current?.click();
        }}
        onDragOver={(e) => {
          stop(e);
          if (!isUploading) setIsDragging(true);
        }}
        onDragLeave={(e) => {
          stop(e);
          setIsDragging(false);
        }}
        onDrop={(e) => {
          stop(e);
          setIsDragging(false);
          const dropped = e.dataTransfer.files?.[0];
          if (dropped && !isUploading) onFile(dropped);
        }}
        onClick={() => {
          if (!isUploading) fileInputRef.current?.click();
        }}
        className={`relative flex-1 min-h-[190px] rounded-xl border-2 border-dashed transition-all cursor-pointer flex flex-col items-center justify-center p-5 text-center focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
          isUploading
            ? 'border-emerald-500/50 bg-emerald-50/40 dark:bg-emerald-500/5 cursor-wait'
            : isDragging
            ? 'border-emerald-500 bg-emerald-50/70 dark:bg-emerald-500/10 scale-[0.99]'
            : 'bg-slate-50 dark:bg-slate-800/30 border-slate-300 dark:border-slate-700 hover:border-emerald-500 hover:bg-emerald-50/40 dark:hover:border-emerald-500/80 dark:hover:bg-slate-800/50'
        }`}
      >
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm flex items-center justify-center text-emerald-600 dark:text-emerald-500">
            <UploadCloud className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{t("Fiş fotoğrafını buraya sürükleyin")}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">{t("Maksimum netlik için fişin tamamının görünür olduğundan emin olun")}</p>
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          type="button"
          disabled={isUploading}
          onClick={() => fileInputRef.current?.click()}
          className="py-2.5 px-4 rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-2 bg-slate-100 hover:bg-slate-200/80 text-slate-800 border border-slate-300/80 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-100 dark:border-slate-700 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          <FolderOpen className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span>{t("Dosya Seçin")}</span>
        </button>
        <button
          type="button"
          disabled={isUploading}
          onClick={() => cameraInputRef.current?.click()}
          className="py-2.5 px-4 rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white border border-emerald-600 dark:bg-emerald-500 dark:hover:bg-emerald-400 dark:text-slate-950 shadow-sm shadow-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          <Camera className="w-4 h-4 shrink-0" />
          <span>{t("Kamerayla Çek")}</span>
        </button>
      </div>
      <button
        type="button"
        onClick={onManual}
        disabled={isUploading}
        className="mt-3 inline-flex items-center justify-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-emerald-700 dark:hover:text-emerald-400 disabled:opacity-50"
      >
        <PencilLine className="w-3.5 h-3.5" />
        {t('Yapay zeka olmadan elle ekle')}
      </button>
    </div>
  );
}
