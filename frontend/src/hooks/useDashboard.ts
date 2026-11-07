import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getApiErrorMessage,
  getReceipts,
  getSummary,
  Receipt,
  ReceiptFilters,
  ReceiptSummary,
} from '../services/api';

const EMPTY_SUMMARY: ReceiptSummary = { total_receipts: 0, total_amount: 0, category_breakdown: [] };

export interface DashboardFilters {
  merchant: string;
  category: string;
  startDate: string;
  endDate: string;
}

export const EMPTY_FILTERS: DashboardFilters = { merchant: '', category: '', startDate: '', endDate: '' };

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

/** Fiş listesi + özet verisini filtrelere göre çeker; geç gelen eski yanıtları yok sayar. */
export function useDashboard(filters: DashboardFilters) {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [summary, setSummary] = useState<ReceiptSummary>(EMPTY_SUMMARY);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  // Mağaza araması her tuşta istek atmasın
  const merchant = useDebounced(filters.merchant, 300);
  const { category, startDate, endDate } = filters;

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    const params: ReceiptFilters = { merchant, category, start_date: startDate, end_date: endDate };
    setIsLoading(true);
    try {
      const [receiptsData, summaryData] = await Promise.all([getReceipts(params), getSummary(params)]);
      if (requestId !== requestIdRef.current) return;
      setReceipts(receiptsData);
      setSummary(summaryData);
      setError(null);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(getApiErrorMessage(err, 'Veriler alınırken bir hata oluştu.'));
    } finally {
      if (requestId === requestIdRef.current) setIsLoading(false);
    }
  }, [merchant, category, startDate, endDate]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { receipts, summary, isLoading, error, refresh };
}
