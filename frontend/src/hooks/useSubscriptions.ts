import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CatalogEntry,
  getApiErrorMessage,
  getSubscriptionCatalog,
  getSubscriptions,
  getSubscriptionSummary,
  Subscription,
  SubscriptionSummary,
} from '../services/api';

import { t } from '../i18n';
const EMPTY_SUMMARY: SubscriptionSummary = {
  active_count: 0,
  monthly_totals: [],
  yearly_totals: [],
  by_category: [],
  upcoming: [],
  trials_ending: [],
  recent_price_increases: [],
};

export function useSubscriptions() {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [summary, setSummary] = useState<SubscriptionSummary>(EMPTY_SUMMARY);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    try {
      const [list, sum] = await Promise.all([getSubscriptions(), getSubscriptionSummary()]);
      if (requestId !== requestIdRef.current) return;
      setSubscriptions(list);
      setSummary(sum);
      setError(null);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(getApiErrorMessage(err, t("Abonelikler alınırken bir hata oluştu.")));
    } finally {
      if (requestId === requestIdRef.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    getSubscriptionCatalog()
      .then(setCatalog)
      .catch(() => setCatalog([]));
  }, [refresh]);

  return { subscriptions, summary, catalog, isLoading, error, refresh };
}
