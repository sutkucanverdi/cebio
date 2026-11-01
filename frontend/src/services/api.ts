import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
});

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

export interface GetReceiptsParams {
  merchant?: string;
  start_date?: string;
  end_date?: string;
}

/**
 * Fiş görselini yükler ve Gemini AI ile ayrıştırılan kaydı döner.
 * POST /api/v1/receipts/upload
 */
export async function uploadReceipt(file: File): Promise<Receipt> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await apiClient.post<Receipt>('/api/v1/receipts/upload', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
  return response.data;
}

/**
 * Kaydedilen fişleri opsiyonel filtrelerle listeler.
 * GET /api/v1/receipts
 */
export async function getReceipts(params?: GetReceiptsParams): Promise<Receipt[]> {
  const cleanParams: Record<string, string> = {};
  if (params?.merchant?.trim()) cleanParams.merchant = params.merchant.trim();
  if (params?.start_date?.trim()) cleanParams.start_date = params.start_date.trim();
  if (params?.end_date?.trim()) cleanParams.end_date = params.end_date.trim();

  const response = await apiClient.get<Receipt[]>('/api/v1/receipts', {
    params: cleanParams,
  });
  return response.data;
}

/**
 * Genel harcama özetini ve kategori bazlı kırılımı getirir.
 * GET /api/v1/receipts/summary
 */
export async function getSummary(): Promise<ReceiptSummary> {
  const response = await apiClient.get<ReceiptSummary>('/api/v1/receipts/summary');
  return response.data;
}

/**
 * Belirtilen ID'ye sahip fişi ve bağlı ürünlerini siler.
 * DELETE /api/v1/receipts/{id}
 */
export async function deleteReceipt(id: number): Promise<void> {
  await apiClient.delete(`/api/v1/receipts/${id}`);
}
