import axios, { AxiosError } from 'axios';
import { getLang, t } from '../i18n';
import { storageGet, storageSet } from '../lib/storage';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8010';
const TOKEN_KEY = 'cebio.token';

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 90_000, // Fiş analizi birkaç saniye sürebilir
});

// --- Token yönetimi ---

let unauthorizedHandler: (() => void) | null = null;

export function getStoredToken(): string | null {
  return storageGet(TOKEN_KEY);
}

export function setStoredToken(token: string | null): void {
  storageSet(TOKEN_KEY, token);
}

/** Oturum düştüğünde (401) çağrılacak fonksiyonu kaydeder (AuthContext kullanır). */
export function onUnauthorized(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

apiClient.interceptors.request.use((config) => {
  const token = getStoredToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  // Sunucu hata mesajlarını, raporları ve asistan cevaplarını bu dilde üretir
  config.headers['Accept-Language'] = getLang();
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    const isAuthCall = error.config?.url?.startsWith('/api/v1/auth/login') ||
      error.config?.url?.startsWith('/api/v1/auth/register');
    if (error.response?.status === 401 && !isAuthCall) {
      setStoredToken(null);
      unauthorizedHandler?.();
    }
    if (error.response?.status === 403 && error.response.headers?.['x-cebio-consent'] === 'ai') {
      window.dispatchEvent(new CustomEvent(AI_CONSENT_EVENT));
    }
    if (error.response?.status === 402) {
      const detail = (error.response.data as { detail?: string } | undefined)?.detail;
      window.dispatchEvent(new CustomEvent(LIMIT_EVENT, { detail }));
    }
    return Promise.reject(error);
  }
);

/** API hatasından kullanıcıya gösterilebilir Türkçe mesaj çıkarır. */
export function getApiErrorMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const detail = err.response?.data?.detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail) && detail.length > 0) {
      // FastAPI/Pydantic doğrulama hataları İngilizce gelir; alana göre Türkçe mesaj gösterilir.
      const field = String(detail[0]?.loc?.[detail[0].loc.length - 1] ?? '');
      const fieldMessages: Record<string, string> = {
        email: t('Lütfen geçerli bir e-posta adresi girin.'),
        password: t('Şifre en az 8 karakter olmalı (en fazla 72 bayt).'),
        new_password: t('Şifre en az 8 karakter olmalı (en fazla 72 bayt).'),
        code: t('Kod 6 haneli olmalı.'),
        full_name: t('Ad soyad çok uzun.'),
        start_date: t('Başlangıç tarihi geçersiz.'),
        end_date: t('Bitiş tarihi geçersiz.'),
        merchant: t('Mağaza adı geçersiz.'),
        total_amount: t('Tutar geçersiz.'),
        price: t('Tutar geçersiz.'),
      };
      return fieldMessages[field] ?? t('Girilen bilgiler geçersiz. Lütfen kontrol edip tekrar deneyin.');
    }
    if (err.code === 'ECONNABORTED') return t('İstek zaman aşımına uğradı. Lütfen tekrar deneyin.');
    if (!err.response) return t('Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edin.');
  }
  return fallback;
}

// --- Tipler ---

export interface User {
  id: number;
  email: string;
  full_name: string | null;
  created_at: string;
  terms_version?: string | null;
  /** Yapay zeka aktarımına açık rıza zamanı; null ise yapay zeka özellikleri kapalı */
  ai_consent_at?: string | null;
  locale?: 'tr' | 'en';
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  user: User;
}

export interface ReceiptItem {
  id: number;
  receipt_id: number;
  name: string;
  price: number;
  quantity: number;
  unit_price: number | null;
  category: string;
}

export interface Receipt {
  id: number;
  merchant: string;
  date: string;
  total_amount: number;
  created_at: string;
  items: ReceiptItem[];
}

export interface ReceiptItemUpdatePayload {
  name: string;
  price: number;
  quantity: number;
  unit_price: number | null;
  category: string;
}

export interface ReceiptUpdatePayload {
  merchant: string;
  date: string;
  total_amount: number;
  items: ReceiptItemUpdatePayload[];
}

export interface CategoryBreakdown {
  category: string;
  total_amount: number;
  item_count: number;
}

export interface ReceiptSummary {
  total_receipts: number;
  total_amount: number;
  category_breakdown: CategoryBreakdown[];
}

export interface ReceiptFilters {
  merchant?: string;
  category?: string;
  start_date?: string;
  end_date?: string;
}

function cleanParams(params: ReceiptFilters | undefined, keys: (keyof ReceiptFilters)[]) {
  const out: Record<string, string> = {};
  for (const key of keys) {
    const value = params?.[key]?.trim();
    if (value) out[key] = value;
  }
  return out;
}

// --- Auth uç noktaları ---

export async function register(
  email: string,
  password: string,
  fullName?: string,
  aiConsent = false
): Promise<TokenResponse> {
  const res = await apiClient.post<TokenResponse>('/api/v1/auth/register', {
    email,
    password,
    full_name: fullName || null,
    // Kayıt ekranındaki zorunlu onay kutusu işaretlenmeden bu fonksiyon çağrılmaz.
    accept_terms: true,
    // Yapay zeka aktarımı için AYRI ve isteğe bağlı açık rıza
    ai_consent: aiConsent,
    locale: getLang(),
  });
  return res.data;
}

export interface PreferencesPayload {
  locale?: 'tr' | 'en';
  ai_consent?: boolean;
  full_name?: string | null;
}

export async function updateMe(payload: PreferencesPayload): Promise<User> {
  return (await apiClient.patch<User>('/api/v1/auth/me', payload)).data;
}

export async function login(email: string, password: string): Promise<TokenResponse> {
  const res = await apiClient.post<TokenResponse>('/api/v1/auth/login', { email, password });
  return res.data;
}

export async function requestPasswordReset(email: string): Promise<void> {
  await apiClient.post('/api/v1/auth/forgot-password', { email });
}

export async function resetPassword(email: string, code: string, newPassword: string): Promise<void> {
  await apiClient.post('/api/v1/auth/reset-password', { email, code, new_password: newPassword });
}

export async function getMe(): Promise<User> {
  const res = await apiClient.get<User>('/api/v1/auth/me', { timeout: 10_000 });
  return res.data;
}

export async function deleteAccount(): Promise<void> {
  await apiClient.delete('/api/v1/auth/me');
}

// --- Fiş uç noktaları ---

/** POST /api/v1/receipts/upload — fiş görselini yükler ve Gemini ile ayrıştırır. */
export async function uploadReceipt(file: File): Promise<Receipt> {
  const formData = new FormData();
  formData.append('file', file);
  const response = await apiClient.post<Receipt>('/api/v1/receipts/upload', formData);
  return response.data;
}

/** GET /api/v1/receipts — fişleri opsiyonel filtrelerle listeler. */
export async function getReceipts(params?: ReceiptFilters): Promise<Receipt[]> {
  const response = await apiClient.get<Receipt[]>('/api/v1/receipts', {
    params: cleanParams(params, ['merchant', 'category', 'start_date', 'end_date']),
  });
  return response.data;
}

/** GET /api/v1/receipts/summary — filtrelere uyan fişlerin toplamı ve kategori kırılımı. */
export async function getSummary(params?: ReceiptFilters): Promise<ReceiptSummary> {
  const response = await apiClient.get<ReceiptSummary>('/api/v1/receipts/summary', {
    params: cleanParams(params, ['merchant', 'start_date', 'end_date']),
  });
  return response.data;
}

/** PUT /api/v1/receipts/{id} */
export async function updateReceipt(id: number, payload: ReceiptUpdatePayload): Promise<Receipt> {
  const response = await apiClient.put<Receipt>(`/api/v1/receipts/${id}`, payload);
  return response.data;
}

/** DELETE /api/v1/receipts/{id} */
export async function deleteReceipt(id: number): Promise<void> {
  await apiClient.delete(`/api/v1/receipts/${id}`);
}

/** POST /api/v1/receipts — fişi elle ekle (yapay zeka kullanmaz). */
export async function createReceipt(payload: ReceiptUpdatePayload): Promise<Receipt> {
  return (await apiClient.post<Receipt>('/api/v1/receipts', payload)).data;
}

// --- Kişisel enflasyon / fiyat takibi ---

export interface PriceWatchItem {
  name: string;
  purchases: number;
  first_date: string;
  first_price: number;
  last_date: string;
  last_price: number;
  change_pct: number;
  total_spent: number;
}

export interface PriceWatch {
  since: string;
  tracked_items: number;
  basket_change_pct: number | null;
  items: PriceWatchItem[];
}

export interface PricePoint {
  date: string;
  merchant: string;
  name: string;
  unit_price: number;
}

export interface PriceHistory {
  query: string;
  points: PricePoint[];
  first_price: number | null;
  last_price: number | null;
  change_pct: number | null;
}

export async function getPriceWatch(months = 12): Promise<PriceWatch> {
  return (await apiClient.get<PriceWatch>('/api/v1/receipts/price-watch', { params: { months } })).data;
}

export async function getPriceHistory(q: string): Promise<PriceHistory> {
  return (await apiClient.get<PriceHistory>('/api/v1/receipts/price-history', { params: { q } })).data;
}

// --- Abonelikler ---

export type BillingCycle = 'weekly' | 'monthly' | 'quarterly' | 'yearly';
export type SubscriptionStatus = 'active' | 'trial' | 'paused' | 'cancelled';

export interface PriceChange {
  old_amount: number;
  new_amount: number;
  changed_at: string;
}

export interface Subscription {
  id: number;
  name: string;
  amount: number;
  currency: string;
  billing_cycle: BillingCycle;
  next_billing_date: string;
  category: string;
  status: SubscriptionStatus;
  trial_ends_at: string | null;
  cancel_url: string | null;
  notes: string | null;
  created_at: string;
  monthly_equivalent: number;
  days_until_next: number;
  last_price_change: PriceChange | null;
}

export interface SubscriptionPayload {
  name: string;
  amount: number;
  currency: string;
  billing_cycle: BillingCycle;
  next_billing_date: string;
  category: string;
  status: SubscriptionStatus;
  trial_ends_at: string | null;
  cancel_url: string | null;
  notes: string | null;
}

export interface CurrencyTotal {
  currency: string;
  amount: number;
}

export interface SubscriptionSummary {
  active_count: number;
  monthly_totals: CurrencyTotal[];
  yearly_totals: CurrencyTotal[];
  by_category: { category: string; monthly_amount: number; count: number }[];
  upcoming: Subscription[];
  trials_ending: Subscription[];
  recent_price_increases: Subscription[];
}

export interface CatalogEntry {
  key: string;
  name: string;
  category: string;
  default_cycle: BillingCycle;
  cancel_url: string | null;
}

export interface SubscriptionCandidate {
  name: string;
  amount: number;
  currency: string;
  billing_cycle: BillingCycle;
  category: string;
  last_charge_date: string;
  next_billing_date: string;
  occurrences: number;
  confidence: 'high' | 'medium' | 'low';
  previous_amount: number | null;
  cancel_url: string | null;
  already_tracked: boolean;
  matched_descriptions: string[];
}

export interface DetectionResult {
  transactions_found: number;
  candidates: SubscriptionCandidate[];
}

export async function getSubscriptions(): Promise<Subscription[]> {
  return (await apiClient.get<Subscription[]>('/api/v1/subscriptions')).data;
}

export async function getSubscriptionSummary(): Promise<SubscriptionSummary> {
  return (await apiClient.get<SubscriptionSummary>('/api/v1/subscriptions/summary')).data;
}

export async function getSubscriptionCatalog(): Promise<CatalogEntry[]> {
  return (await apiClient.get<CatalogEntry[]>('/api/v1/subscriptions/catalog')).data;
}

export async function createSubscription(payload: SubscriptionPayload): Promise<Subscription> {
  return (await apiClient.post<Subscription>('/api/v1/subscriptions', payload)).data;
}

export async function updateSubscription(id: number, payload: SubscriptionPayload): Promise<Subscription> {
  return (await apiClient.put<Subscription>(`/api/v1/subscriptions/${id}`, payload)).data;
}

export async function deleteSubscription(id: number): Promise<void> {
  await apiClient.delete(`/api/v1/subscriptions/${id}`);
}

/** Ekstreyi (PDF/CSV/görsel) analiz edip abonelik adaylarını döner; hiçbir şey kaydetmez. */
export async function detectSubscriptions(file: File): Promise<DetectionResult> {
  const formData = new FormData();
  formData.append('file', file);
  return (await apiClient.post<DetectionResult>('/api/v1/subscriptions/detect', formData)).data;
}

// --- Analiz, bütçeler ve asistan ---

export interface TrendPoint {
  month: string;
  label: string;
  total: number;
  receipts_total: number;
  bank_total: number;
  receipt_count: number;
}

export type BudgetState = 'ok' | 'warning' | 'exceeded';

export interface BudgetStatus {
  id: number;
  category: string | null;
  monthly_limit: number;
  spent: number;
  remaining: number;
  percent: number;
  projected: number;
  state: BudgetState;
  month: string;
}

export interface BudgetStatusResponse {
  month: string;
  label: string;
  budgets: BudgetStatus[];
}

export async function getTrend(months = 6): Promise<TrendPoint[]> {
  return (await apiClient.get<TrendPoint[]>('/api/v1/analytics/trend', { params: { months } })).data;
}

export async function getBudgets(): Promise<BudgetStatusResponse> {
  return (await apiClient.get<BudgetStatusResponse>('/api/v1/budgets')).data;
}

export async function createBudget(category: string | null, monthlyLimit: number): Promise<BudgetStatusResponse> {
  return (
    await apiClient.post<BudgetStatusResponse>('/api/v1/budgets', { category, monthly_limit: monthlyLimit })
  ).data;
}

export async function updateBudget(id: number, monthlyLimit: number): Promise<BudgetStatusResponse> {
  return (await apiClient.put<BudgetStatusResponse>(`/api/v1/budgets/${id}`, { monthly_limit: monthlyLimit })).data;
}

export async function deleteBudget(id: number): Promise<void> {
  await apiClient.delete(`/api/v1/budgets/${id}`);
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatResponse {
  reply: string;
  tools_used: string[];
}

export async function sendChat(messages: ChatMessage[]): Promise<ChatResponse> {
  return (await apiClient.post<ChatResponse>('/api/v1/assistant/chat', { messages })).data;
}

export type AIReportReason = 'offensive' | 'wrong' | 'harmful' | 'other';

/** Uygunsuz/yanlış yapay zeka cevabını bildir (Google Play Yapay Zeka İçeriği politikası). */
export async function reportAiReply(reason: AIReportReason, content: string, note?: string): Promise<string> {
  const res = await apiClient.post<{ message: string }>('/api/v1/assistant/report', {
    reason,
    content: content.slice(0, 4000),
    note: note?.trim() || null,
  });
  return res.data.message;
}

// --- Banka / kart ekstresi içe aktarma ---

export interface StatementRow {
  date: string;
  description: string;
  amount: number;
  currency: string;
  category: string;
}

export interface PreviewRow extends StatementRow {
  merchant: string;
  already_imported: boolean;
  matched_receipt: { id: number; merchant: string; date: string } | null;
}

export interface StatementPreview {
  transactions_found: number;
  new_count: number;
  rows: PreviewRow[];
  subscription_candidates: SubscriptionCandidate[];
}

export interface ImportResult {
  import_id: number | null;
  imported: number;
  skipped_duplicates: number;
  matched_receipts: number;
}

export interface StatementImport {
  id: number;
  filename: string;
  period_start: string | null;
  period_end: string | null;
  created_at: string;
  transaction_count: number;
  total: number;
}

export interface BankTransaction {
  id: number;
  import_id: number;
  date: string;
  description: string;
  merchant: string;
  amount: number;
  currency: string;
  category: string;
  matched_receipt_id: number | null;
}

export async function previewStatement(file: File): Promise<StatementPreview> {
  const formData = new FormData();
  formData.append('file', file);
  return (await apiClient.post<StatementPreview>('/api/v1/statements/preview', formData)).data;
}

export async function importStatement(filename: string, rows: StatementRow[]): Promise<ImportResult> {
  return (await apiClient.post<ImportResult>('/api/v1/statements/import', { filename, rows })).data;
}

export async function getStatementImports(): Promise<StatementImport[]> {
  return (await apiClient.get<StatementImport[]>('/api/v1/statements')).data;
}

export async function deleteStatementImport(id: number): Promise<void> {
  await apiClient.delete(`/api/v1/statements/${id}`);
}

export async function getTransactions(): Promise<BankTransaction[]> {
  return (await apiClient.get<BankTransaction[]>('/api/v1/transactions', { params: { limit: 2000 } })).data;
}

export async function updateTransactionCategory(id: number, category: string): Promise<BankTransaction> {
  return (await apiClient.patch<BankTransaction>(`/api/v1/transactions/${id}`, { category })).data;
}

export async function deleteTransaction(id: number): Promise<void> {
  await apiClient.delete(`/api/v1/transactions/${id}`);
}

// --- Plan / kullanım limitleri ---

export interface FeatureUsage {
  feature: 'receipt_scan' | 'statement_scan' | 'assistant';
  label: string;
  used: number;
  limit: number;
}

export interface PlanStatus {
  plan: 'free' | 'premium';
  premium_until: string | null;
  plan_source: string | null;
  period: string;
  resets_on: string;
  features: FeatureUsage[];
}

export async function getPlanStatus(): Promise<PlanStatus> {
  return (await apiClient.get<PlanStatus>('/api/v1/billing/status')).data;
}

/** Plan limiti dolunca (HTTP 402) uygulamanın her yerinden "Planımı gör" uyarısı gösterebilmek için olay. */
export const LIMIT_EVENT = 'cebio:limit-reached';
/** Yapay zeka özelliği rıza olmadan çağrıldığında (403) yayınlanır; rıza penceresi açılır. */
export const AI_CONSENT_EVENT = 'cebio:ai-consent-required';

// --- Aylık rapor ---

export interface MonthlyReport {
  month: string;
  label: string;
  is_complete: boolean;
  total: number;
  receipts_total: number;
  bank_total: number;
  previous_month: string;
  previous_label: string;
  previous_total: number;
  change_pct: number | null;
  daily_average: number;
  receipt_count: number;
  bank_transaction_count: number;
  by_category: { category: string; total: number; previous_total: number; change_pct: number | null }[];
  top_merchants: { merchant: string; total: number; count: number }[];
  top_expenses: { date: string; merchant: string; amount: number; source: 'receipt' | 'bank' }[];
  subscriptions: {
    active_count: number;
    monthly_fixed_try: number;
    price_increases: { name: string; old_amount: number; new_amount: number; changed_at: string }[];
    new_subscriptions: string[];
  };
  budgets: BudgetStatus[];
  insights: string[];
}

export async function getMonthlyReport(month?: string): Promise<MonthlyReport> {
  return (await apiClient.get<MonthlyReport>('/api/v1/reports/monthly', { params: month ? { month } : {} })).data;
}

export async function getReportMonths(): Promise<string[]> {
  return (await apiClient.get<string[]>('/api/v1/reports/months')).data;
}
