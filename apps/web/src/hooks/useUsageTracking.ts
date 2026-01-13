/**
 * React hook for tracking session usage and costs.
 * Fetches usage data from the API and updates the cost store.
 */

import { useEffect, useRef } from 'react';
import { useCostStore, type CostBreakdown } from '@/stores/cost';
import { api } from '@/lib/api';

interface UseUsageTrackingOptions {
  sessionId: string;
  enabled?: boolean;
  pollingInterval?: number; // milliseconds, default 30000 (30 seconds)
}

/**
 * Hook to fetch and track usage/cost data for a session.
 * Updates the cost store with data from the API.
 */
export function useUsageTracking({
  sessionId,
  enabled = true,
  pollingInterval = 30000,
}: UseUsageTrackingOptions) {
  const setSessionCostRef = useRef(useCostStore.getState().setSessionCost);
  const setLoadingRef = useRef(useCostStore.getState().setLoading);
  const setErrorRef = useRef(useCostStore.getState().setError);

  // Keep refs updated
  useEffect(() => {
    const unsubscribe = useCostStore.subscribe((state) => {
      setSessionCostRef.current = state.setSessionCost;
      setLoadingRef.current = state.setLoading;
      setErrorRef.current = state.setError;
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!sessionId || !enabled) return;

    const fetchUsage = async () => {
      try {
        setLoadingRef.current(true);
        setErrorRef.current(null);

        // API returns array directly (max page_size is 100)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const records = await api.get<any[]>(
          `/api/billing/usage/history?session_id=${sessionId}&page_size=100`
        );

        // Aggregate usage by model and agent
        const costBreakdown: CostBreakdown = {
          totalCost: 0,
          inputCost: 0,
          outputCost: 0,
          cachedInputCost: 0,
          totalTokens: 0,
          inputTokens: 0,
          outputTokens: 0,
          cachedInputTokens: 0,
          callCount: 0,
          byModel: {},
          byAgent: {},
        };

        // Track unique calls (not all records are API calls)
        const apiCallRecords = new Set();

        for (const record of records) {
          const quantity = record.quantity || 0;
          const cost = record.cost || 0;
          const usageType = record.usage_type;

          // Aggregate token counts by usage type
          if (usageType === 'tokens_input') {
            costBreakdown.inputTokens += quantity;
            costBreakdown.inputCost += cost;
            costBreakdown.totalTokens += quantity;
          } else if (usageType === 'tokens_output') {
            costBreakdown.outputTokens += quantity;
            costBreakdown.outputCost += cost;
            costBreakdown.totalTokens += quantity;
          } else if (usageType === 'tokens_cached') {
            costBreakdown.cachedInputTokens += quantity;
            costBreakdown.cachedInputCost += cost;
            costBreakdown.totalTokens += quantity;
          } else if (usageType.startsWith('tokens')) {
            // Other token types
            costBreakdown.totalTokens += quantity;
          }

          costBreakdown.totalCost += cost;

          // Track API calls (one call can have multiple usage records)
          if (record.id) {
            apiCallRecords.add(record.id.split('-')[0]); // Rough approximation
          }

          // Aggregate by model
          const model = record.model || 'unknown';
          if (!costBreakdown.byModel[model]) {
            costBreakdown.byModel[model] = {
              inputTokens: 0,
              outputTokens: 0,
              cost: 0,
            };
          }
          if (usageType === 'tokens_input') {
            costBreakdown.byModel[model].inputTokens += quantity;
          } else if (usageType === 'tokens_output') {
            costBreakdown.byModel[model].outputTokens += quantity;
          }
          costBreakdown.byModel[model].cost += cost;

          // Aggregate by agent
          const agentId = record.agent_id || 'unknown';
          if (!costBreakdown.byAgent[agentId]) {
            costBreakdown.byAgent[agentId] = {
              tokens: 0,
              cost: 0,
            };
          }
          costBreakdown.byAgent[agentId].tokens += quantity;
          costBreakdown.byAgent[agentId].cost += cost;
        }

        costBreakdown.callCount = apiCallRecords.size || records.length;

        setSessionCostRef.current(sessionId, costBreakdown);
      } catch (error) {
        console.error('Failed to fetch usage data:', error);
        setErrorRef.current(error instanceof Error ? error.message : 'Failed to fetch usage');
      } finally {
        setLoadingRef.current(false);
      }
    };

    // Fetch immediately
    fetchUsage();

    // Set up polling
    const interval = setInterval(fetchUsage, pollingInterval);

    return () => clearInterval(interval);
  }, [sessionId, enabled, pollingInterval]);
}
