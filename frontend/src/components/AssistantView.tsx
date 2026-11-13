import { FormEvent, KeyboardEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowUp, Check, Flag, Loader2, RotateCcw, Sparkles, UserRound } from 'lucide-react';
import { AIReportReason, ChatMessage, getApiErrorMessage, reportAiReply, sendChat } from '../services/api';
import { Modal, PRIMARY_BUTTON, SECONDARY_BUTTON, CARD_SURFACE_CLASS, INPUT_CLASS } from './ui';
import { t } from '../i18n';
import { useAiConsent } from './AiConsent';
export interface AssistantMessage extends ChatMessage {
  toolsUsed?: string[];
  isError?: boolean;
  reported?: boolean;
}

const REPORT_REASONS: { id: AIReportReason; label: string }[] = [
  { id: 'wrong', label: 'Yanlış veya yanıltıcı bilgi' },
  { id: 'offensive', label: 'Saldırgan veya uygunsuz içerik' },
  { id: 'harmful', label: 'Zararlı yönlendirme' },
  { id: 'other', label: 'Diğer' },
];

/** Google Play Yapay Zeka İçeriği politikası: yapay zeka cevabını uygulamadan çıkmadan bildirme. */
function ReportDialog({ content, onClose, onDone }: { content: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState<AIReportReason>('wrong');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setSending(true);
    setError(null);
    try {
      await reportAiReply(reason, content, note);
      onDone();
    } catch (err) {
      setError(getApiErrorMessage(err, t('Bildirim gönderilemedi.')));
      setSending(false);
    }
  };
  return (
    <Modal
      title={t('Cevabı bildir')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={SECONDARY_BUTTON} onClick={onClose}>
            {t('Vazgeç')}
          </button>
          <button type="button" className={PRIMARY_BUTTON} disabled={sending} onClick={() => void submit()}>
            {sending && <Loader2 className="w-4 h-4 animate-spin" />}
            {t('Bildir')}
          </button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {t('Bildirdiğin cevap incelenir ve asistanı iyileştirmek için kullanılır.')}
        </p>
        <div className="space-y-1.5" role="radiogroup">
          {REPORT_REASONS.map((r) => (
            <label key={r.id} className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
              <input
                type="radio"
                name="report-reason"
                checked={reason === r.id}
                onChange={() => setReason(r.id)}
                className="accent-emerald-600"
              />
              {t(r.label)}
            </label>
          ))}
        </div>
        <textarea
          rows={2}
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t('Açıklama (isteğe bağlı)')}
          className={INPUT_CLASS}
        />
        {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
      </div>
    </Modal>
  );
}

const MAX_CHARS = 2000;
const MAX_HISTORY = 20;

const SUGGESTIONS = [
  'Bu ay ne kadar harcadım?',
  'Geçen aya göre harcamam arttı mı?',
  'Bu ay markete ne kadar harcadım?',
  'Kahveye ne kadar para veriyorum?',
  'En pahalı aboneliğim hangisi?',
  'Bütçemi aşıyor muyum?',
  'Ekstreme göre en çok nereye harcadım?',
  'Geçen ayın raporunu özetle',
];

const TOOL_LABELS: Record<string, string> = {
  get_spending_summary: 'Harcama özeti',
  get_monthly_trend: 'Aylık trend',
  search_purchased_items: 'Ürün araması',
  list_recent_receipts: 'Fiş listesi',
  get_subscriptions: 'Abonelikler',
  get_budget_status: 'Bütçeler',
  search_bank_transactions: 'Banka işlemleri',
  get_monthly_report: 'Aylık rapor',
};

/** **kalın** işaretlerini <strong>'a çevirir; HTML enjekte etmeden güvenli render. */
function renderInline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4 ? (
      <strong key={i} className="font-semibold text-slate-900 dark:text-white">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

function FormattedText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length) {
      blocks.push(
        <ul key={`ul-${blocks.length}`} className="list-disc pl-5 space-y-0.5">
          {bullets.map((b, i) => (
            <li key={i}>{renderInline(b)}</li>
          ))}
        </ul>
      );
      bullets = [];
    }
  };
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    if (bullet) {
      bullets.push(bullet[1]);
      continue;
    }
    flush();
    if (line.trim()) blocks.push(<p key={`p-${blocks.length}`}>{renderInline(line)}</p>);
  }
  flush();
  return <div className="space-y-1.5">{blocks}</div>;
}

interface AssistantViewProps {
  messages: AssistantMessage[];
  setMessages: (updater: (prev: AssistantMessage[]) => AssistantMessage[]) => void;
}

export function AssistantView({ messages, setMessages }: AssistantViewProps) {
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, isSending]);

  const ensureAiConsent = useAiConsent();
  const [reportIndex, setReportIndex] = useState<number | null>(null);

  const send = async (text: string) => {
    const content = text.trim().slice(0, MAX_CHARS);
    if (!content || isSending) return;
    // Soru Google Gemini'ye gönderilmeden önce açık rıza (App Store 5.1.2(i), KVKK)
    if (!(await ensureAiConsent())) return;

    const userMsg: AssistantMessage = { role: 'user', content };
    // Hata baloncukları modele gönderilmez
    const history = [...messages.filter((m) => !m.isError), userMsg]
      .slice(-MAX_HISTORY)
      .map(({ role, content: c }) => ({ role, content: c }));

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsSending(true);
    try {
      const res = await sendChat(history);
      setMessages((prev) => [...prev, { role: 'assistant', content: res.reply, toolsUsed: res.tools_used }]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: getApiErrorMessage(err, t("Asistana şu anda ulaşılamıyor. Lütfen tekrar deneyin.")),
          isError: true,
        },
      ]);
    } finally {
      setIsSending(false);
      inputRef.current?.focus();
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send(input);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send(input);
    }
  };

  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const lastIsError = messages[messages.length - 1]?.isError;

  return (
    <section className={`${CARD_SURFACE_CLASS} flex flex-col h-[calc(100dvh-12rem)] min-h-[420px] overflow-hidden`}>
      <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">{t("Cebio Asistan")}</h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">{t("Fişlerine, banka harcamalarına, aboneliklerine ve bütçelerine bakarak cevaplar")}</p>
          </div>
        </div>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={() => setMessages(() => [])}
            disabled={isSending}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
          >
            <RotateCcw className="w-3.5 h-3.5" />{' '}{t("Yeni sohbet")}</button>
        )}
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto px-4 sm:px-5 py-5 space-y-4" aria-live="polite">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 flex items-center justify-center">
              <Sparkles className="w-6 h-6 text-emerald-500" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{t("Harcamaların hakkında bir şey sor")}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm">{t("Cevaplar yapay zekayla senin verinden üretilir ve hata içerebilir; önemli kararlarda kontrol et. Yatırım veya finansal danışmanlık değildir.")}</p>
            </div>
            <div className="flex flex-wrap justify-center gap-2 max-w-xl">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void send(t(s))}
                  className="px-3 py-1.5 rounded-full text-xs font-medium bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-emerald-500 hover:text-emerald-700 dark:hover:text-emerald-300 transition"
                >
                  {t(s)}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => {
            const isUser = m.role === 'user';
            return (
              <div key={i} className={`flex gap-2.5 ${isUser ? 'justify-end' : 'justify-start'}`}>
                {!isUser && (
                  <div
                    className={`w-7 h-7 rounded-lg shrink-0 flex items-center justify-center ${
                      m.isError ? 'bg-rose-500/10' : 'bg-emerald-500/10'
                    }`}
                  >
                    {m.isError ? (
                      <AlertCircle className="w-4 h-4 text-rose-500" />
                    ) : (
                      <Sparkles className="w-4 h-4 text-emerald-500" />
                    )}
                  </div>
                )}
                <div className={`max-w-[85%] sm:max-w-[75%] ${isUser ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
                  <div
                    className={`px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words ${
                      isUser
                        ? 'bg-emerald-600 text-white dark:bg-emerald-500 dark:text-slate-950 rounded-br-md'
                        : m.isError
                        ? 'bg-rose-500/10 text-rose-800 dark:text-rose-300 border border-rose-500/20 rounded-bl-md'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-bl-md'
                    }`}
                  >
                    {isUser || m.isError ? m.content : <FormattedText text={m.content} />}
                  </div>
                  {m.toolsUsed && m.toolsUsed.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {[...new Set(m.toolsUsed)].map((tool) => (
                        <span
                          key={tool}
                          className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"
                        >
                          {TOOL_LABELS[tool] ? t(TOOL_LABELS[tool]) : tool}
                        </span>
                      ))}
                    </div>
                  )}
                  {!isUser && !m.isError && (
                    <button
                      type="button"
                      disabled={m.reported}
                      onClick={() => setReportIndex(i)}
                      className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-rose-500 disabled:hover:text-slate-400"
                      aria-label={t('Bu cevabı bildir')}
                    >
                      {m.reported ? <Check className="w-3 h-3" /> : <Flag className="w-3 h-3" />}
                      {m.reported ? t('Bildirildi') : t('Bildir')}
                    </button>
                  )}
                  {m.isError && i === messages.length - 1 && lastUser && (
                    <button
                      type="button"
                      onClick={() => {
                        setMessages((prev) => prev.slice(0, -2));
                        void send(lastUser.content);
                      }}
                      className="text-xs font-medium text-rose-600 dark:text-rose-400 hover:underline"
                    >{t("Tekrar dene")}</button>
                  )}
                </div>
                {isUser && (
                  <div className="w-7 h-7 rounded-lg shrink-0 flex items-center justify-center bg-slate-100 dark:bg-slate-800">
                    <UserRound className="w-4 h-4 text-slate-500" />
                  </div>
                )}
              </div>
            );
          })
        )}

        {isSending && (
          <div className="flex gap-2.5">
            <div className="w-7 h-7 rounded-lg shrink-0 flex items-center justify-center bg-emerald-500/10">
              <Loader2 className="w-4 h-4 text-emerald-500 animate-spin" />
            </div>
            <div className="px-3.5 py-2.5 rounded-2xl rounded-bl-md bg-slate-100 dark:bg-slate-800 text-sm text-slate-500 dark:text-slate-400">{t("Verilerine bakıyorum...")}</div>
          </div>
        )}
      </div>

      {reportIndex !== null && messages[reportIndex] && (
        <ReportDialog
          content={messages[reportIndex].content}
          onClose={() => setReportIndex(null)}
          onDone={() => {
            const idx = reportIndex;
            setMessages((prev) => prev.map((msg, j) => (j === idx ? { ...msg, reported: true } : msg)));
            setReportIndex(null);
          }}
        />
      )}

      <form onSubmit={onSubmit} className="p-3 border-t border-slate-200 dark:border-slate-800">
        <div className="flex items-end gap-2 rounded-2xl border border-slate-300/80 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-500/20">
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            maxLength={MAX_CHARS}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={lastIsError ? t("Tekrar deneyin veya yeni bir soru yazın...") : t("Bir soru yazın...")}
            aria-label={t("Asistana mesaj")}
            className="flex-1 resize-none bg-transparent text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none max-h-32 py-1"
          />
          <button
            type="submit"
            disabled={!input.trim() || isSending}
            aria-label={t("Gönder")}
            className="w-8 h-8 rounded-xl flex items-center justify-center bg-emerald-600 hover:bg-emerald-500 text-white dark:bg-emerald-500 dark:text-slate-950 disabled:opacity-40 transition shrink-0"
          >
            <ArrowUp className="w-4 h-4" />
          </button>
        </div>
        <p className="mt-1.5 px-1 text-[10px] text-slate-400">{t("Sorular cevaplanmak için Google Gemini'ye gönderilir. Enter: gönder • Shift+Enter: yeni satır")}</p>
      </form>
    </section>
  );
}
