import { useState, useEffect, useCallback } from 'react';
import {
  getUsageSummary,
  getQuotas,
  getBillingUsageHistory,
  type UsageSummary,
  type Quota,
  type UsageRecordResponse,
} from '@/lib/api';

interface UseUsageDataOptions {
  period?: 'current' | 'last_month' | 'all_time';
  sessionId?: string;
  autoRefresh?: boolean;
  refreshInterval?: number;
}

interface UseUsageDataReturn {
  summary: UsageSummary | null;
  quotas: Quota[];
  history: UsageRecordResponse[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useUsageData(options: UseUsageDataOptions = {}): UseUsageDataReturn {
  const { period = 'current', sessionId, autoRefresh = false, refreshInterval = 30000 } = options;

  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [quotas, setQuotas] = useState<Quota[]>([]);
  const [history, setHistory] = useState<UsageRecordResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [summaryData, quotasData, historyData] = await Promise.all([
        getUsageSummary(period).catch((err) => {
          console.error('Failed to fetch usage summary:', err);
          return null;
        }),
        getQuotas().catch((err) => {
          console.error('Failed to fetch quotas:', err);
          return [];
        }),
        getBillingUsageHistory(1, 100, undefined, sessionId).catch((err) => {
          console.error('Failed to fetch usage history:', err);
          return [];
        }),
      ]);

      setSummary(summaryData);
      setQuotas(quotasData);
      setHistory(Array.isArray(historyData) ? historyData : []);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load usage data';
      setError(message);
      console.error('Error loading usage data:', err);
    } finally {
      setLoading(false);
    }
  }, [period, sessionId]);

  useEffect(() => {
    fetchData();

    if (autoRefresh) {
      const interval = setInterval(fetchData, refreshInterval);
      return () => clearInterval(interval);
    }
    return undefined;
  }, [fetchData, autoRefresh, refreshInterval]);

  return {
    summary,
    quotas,
    history,
    loading,
    error,
    refetch: fetchData,
  };
}
