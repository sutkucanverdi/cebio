import axios, { AxiosError } from 'axios';
import { storageGet, storageSet } from '../lib/storage';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
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
        email: 'Lütfen geçerli bir e-posta adresi girin.',
        password: 'Şifre en az 8 karakter olmalı (en fazla 72 bayt).',
        full_name: 'Ad soyad çok uzun.',
        start_date: 'Başlangıç tarihi geçersiz.',
        end_date: 'Bitiş tarihi geçersiz.',
      };
      return fieldMessages[field] ?? 'Girilen bilgiler geçersiz. Lütfen kontrol edip tekrar deneyin.';
    }
    if (err.code === 'ECONNABORTED') return 'İstek zaman aşımına uğradı. Lütfen tekrar deneyin.';
    if (!err.response) return 'Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edin.';
  }
  return fallback;
}

// --- Tipler ---

export interface User {
  id: number;
  email: string;
  full_name: string | null;
  created_at: string;
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

export async function register(email: string, password: string, fullName?: string): Promise<TokenResponse> {
  const res = await apiClient.post<TokenResponse>('/api/v1/auth/register', {
    email,
    password,
    full_name: fullName || null,
  });
  return res.data;
}

export async function login(email: string, password: string): Promise<TokenResponse> {
  const res = await apiClient.post<TokenResponse>('/api/v1/auth/login', { email, password });
  return res.data;
}

export async function getMe(): Promise<User> {
  const res = await apiClient.get<User>('/api/v1/auth/me');
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
