import { FormEvent, KeyboardEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowUp, Loader2, RotateCcw, Sparkles, UserRound } from 'lucide-react';
import { ChatMessage, getApiErrorMessage, sendChat } from '../services/api';
import { CARD_SURFACE_CLASS } from './ui';

export interface AssistantMessage extends ChatMessage {
  toolsUsed?: string[];
  isError?: boolean;
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
];

const TOOL_LABELS: Record<string, string> = {
  get_spending_summary: 'Harcama özeti',
  get_monthly_trend: 'Aylık trend',
  search_purchased_items: 'Ürün araması',
  list_recent_receipts: 'Fiş listesi',
  get_subscriptions: 'Abonelikler',
  get_budget_status: 'Bütçeler',
  search_bank_transactions: 'Banka işlemleri',
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

  const send = async (text: string) => {
    const content = text.trim().slice(0, MAX_CHARS);
    if (!content || isSending) return;

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
          content: getApiErrorMessage(err, 'Asistana şu anda ulaşılamıyor. Lütfen tekrar deneyin.'),
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
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Cebio Asistan</h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Fişlerine, banka harcamalarına, aboneliklerine ve bütçelerine bakarak cevaplar
            </p>
          </div>
        </div>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={() => setMessages(() => [])}
            disabled={isSending}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Yeni sohbet
          </button>
        )}
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto px-4 sm:px-5 py-5 space-y-4" aria-live="polite">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 flex items-center justify-center">
              <Sparkles className="w-6 h-6 text-emerald-500" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Harcamaların hakkında bir şey sor</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm">
                Cevaplar senin gerçek verinden hesaplanır. Yatırım tavsiyesi vermez.
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2 max-w-xl">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void send(s)}
                  className="px-3 py-1.5 rounded-full text-xs font-medium bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-emerald-500 hover:text-emerald-700 dark:hover:text-emerald-300 transition"
                >
                  {s}
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
                      {[...new Set(m.toolsUsed)].map((t) => (
                        <span
                          key={t}
                          className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"
                        >
                          {TOOL_LABELS[t] ?? t}
                        </span>
                      ))}
                    </div>
                  )}
                  {m.isError && i === messages.length - 1 && lastUser && (
                    <button
                      type="button"
                      onClick={() => {
                        setMessages((prev) => prev.slice(0, -2));
                        void send(lastUser.content);
                      }}
                      className="text-xs font-medium text-rose-600 dark:text-rose-400 hover:underline"
                    >
                      Tekrar dene
                    </button>
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
            <div className="px-3.5 py-2.5 rounded-2xl rounded-bl-md bg-slate-100 dark:bg-slate-800 text-sm text-slate-500 dark:text-slate-400">
              Verilerine bakıyorum...
            </div>
          </div>
        )}
      </div>

      <form onSubmit={onSubmit} className="p-3 border-t border-slate-200 dark:border-slate-800">
        <div className="flex items-end gap-2 rounded-2xl border border-slate-300/80 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-500/20">
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            maxLength={MAX_CHARS}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={lastIsError ? 'Tekrar deneyin veya yeni bir soru yazın...' : 'Bir soru yazın...'}
            aria-label="Asistana mesaj"
            className="flex-1 resize-none bg-transparent text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none max-h-32 py-1"
          />
          <button
            type="submit"
            disabled={!input.trim() || isSending}
            aria-label="Gönder"
            className="w-8 h-8 rounded-xl flex items-center justify-center bg-emerald-600 hover:bg-emerald-500 text-white dark:bg-emerald-500 dark:text-slate-950 disabled:opacity-40 transition shrink-0"
          >
            <ArrowUp className="w-4 h-4" />
          </button>
        </div>
        <p className="mt-1.5 px-1 text-[10px] text-slate-400">
          Sorular cevaplanmak için Google Gemini'ye gönderilir. Enter: gönder • Shift+Enter: yeni satır
        </p>
      </form>
    </section>
  );
}
