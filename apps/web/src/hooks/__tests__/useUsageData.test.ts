/**
 * Comprehensive tests for useUsageData hook
 * Tests data fetching, auto-refresh, error handling, and state management
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useUsageData } from '../useUsageData';
import type { UsageSummary, Quota, UsageRecordResponse } from '@/lib/api';

// Mock the API module
vi.mock('@/lib/api', () => ({
  getUsageSummary: vi.fn(),
  getQuotas: vi.fn(),
  getBillingUsageHistory: vi.fn(),
}));

import * as api from '@/lib/api';

describe('useUsageData', () => {
  const mockSummary: UsageSummary = {
    period: 'current',
    total_cost: 125.5,
    total_tokens: 500000,
    total_input_tokens: 300000,
    total_output_tokens: 200000,
    total_sessions: 25,
    total_agents: 50,
    breakdown_by_model: [
      { model: 'claude-opus-4-5-20251101', cost: 100, tokens: 400000 },
      { model: 'claude-sonnet-4-5-20250514', cost: 25.5, tokens: 100000 },
    ],
    breakdown_by_agent: [
      { agent_id: 'agent-1', agent_name: 'Architect', cost: 75, tokens: 300000 },
      { agent_id: 'agent-2', agent_name: 'Coder', cost: 50.5, tokens: 200000 },
    ],
  };

  const mockQuotas: Quota[] = [
    {
      id: 'quota-1',
      name: 'monthly_tokens',
      limit: 1000000,
      current: 500000,
      reset_at: '2024-02-01T00:00:00Z',
    },
    {
      id: 'quota-2',
      name: 'monthly_cost',
      limit: 500,
      current: 125.5,
      reset_at: '2024-02-01T00:00:00Z',
    },
  ];

  const mockHistory: UsageRecordResponse[] = [
    {
      id: 'usage-1',
      session_id: 'session-1',
      agent_id: 'agent-1',
      model: 'claude-opus-4-5-20251101',
      input_tokens: 1000,
      output_tokens: 500,
      cost: 0.05,
      created_at: '2024-01-15T10:00:00Z',
    },
    {
      id: 'usage-2',
      session_id: 'session-1',
      agent_id: 'agent-2',
      model: 'claude-sonnet-4-5-20250514',
      input_tokens: 2000,
      output_tokens: 1000,
      cost: 0.03,
      created_at: '2024-01-15T11:00:00Z',
    },
  ];

  // Helper to flush promises with fake timers (runs only pending timers to avoid infinite loops)
  const flushPromises = async () => {
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Default successful mock implementations
    vi.mocked(api.getUsageSummary).mockResolvedValue(mockSummary);
    vi.mocked(api.getQuotas).mockResolvedValue(mockQuotas);
    vi.mocked(api.getBillingUsageHistory).mockResolvedValue(mockHistory);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ========================================
  // Initialization Tests
  // ========================================

  describe('Initialization', () => {
    it('should initialize with loading state', () => {
      const { result } = renderHook(() => useUsageData());

      expect(result.current.loading).toBe(true);
      expect(result.current.summary).toBeNull();
      expect(result.current.quotas).toEqual([]);
      expect(result.current.history).toEqual([]);
      expect(result.current.error).toBeNull();
    });

    it('should provide refetch function', () => {
      const { result } = renderHook(() => useUsageData());

      expect(typeof result.current.refetch).toBe('function');
    });
  });

  // ========================================
  // Data Fetching Tests
  // ========================================

  describe('Data Fetching', () => {
    it('should fetch all data on mount', async () => {
      const { result } = renderHook(() => useUsageData());

      await flushPromises();

      expect(result.current.loading).toBe(false);
      expect(api.getUsageSummary).toHaveBeenCalledWith('current');
      expect(api.getQuotas).toHaveBeenCalled();
      expect(api.getBillingUsageHistory).toHaveBeenCalledWith(1, 100, undefined, undefined);
    });

    it('should populate all data correctly', async () => {
      const { result } = renderHook(() => useUsageData());

      await flushPromises();

      expect(result.current.loading).toBe(false);
      expect(result.current.summary).toEqual(mockSummary);
      expect(result.current.quotas).toEqual(mockQuotas);
      expect(result.current.history).toEqual(mockHistory);
    });

    it('should use provided period option', async () => {
      renderHook(() => useUsageData({ period: 'last_month' }));

      await flushPromises();

      expect(api.getUsageSummary).toHaveBeenCalledWith('last_month');
    });

    it('should use provided sessionId option', async () => {
      renderHook(() => useUsageData({ sessionId: 'session-123' }));

      await flushPromises();

      expect(api.getBillingUsageHistory).toHaveBeenCalledWith(1, 100, undefined, 'session-123');
    });

    it('should use all_time period option', async () => {
      renderHook(() => useUsageData({ period: 'all_time' }));

      await flushPromises();

      expect(api.getUsageSummary).toHaveBeenCalledWith('all_time');
    });

    it('should refetch data when called', async () => {
      const { result } = renderHook(() => useUsageData());

      await flushPromises();

      vi.mocked(api.getUsageSummary).mockClear();
      vi.mocked(api.getQuotas).mockClear();
      vi.mocked(api.getBillingUsageHistory).mockClear();

      await act(async () => {
        await result.current.refetch();
      });

      expect(api.getUsageSummary).toHaveBeenCalled();
      expect(api.getQuotas).toHaveBeenCalled();
      expect(api.getBillingUsageHistory).toHaveBeenCalled();
    });
  });

  // ========================================
  // Error Handling Tests
  // ========================================

  describe('Error Handling', () => {
    it('should handle summary fetch error gracefully', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(api.getUsageSummary).mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useUsageData());

      await flushPromises();

      // Summary should be null but other data should still be present
      expect(result.current.summary).toBeNull();
      expect(result.current.quotas).toEqual(mockQuotas);
      expect(result.current.history).toEqual(mockHistory);
      expect(result.current.error).toBeNull(); // Individual errors don't set error state

      consoleError.mockRestore();
    });

    it('should handle quotas fetch error gracefully', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(api.getQuotas).mockRejectedValue(new Error('Quota error'));

      const { result } = renderHook(() => useUsageData());

      await flushPromises();

      expect(result.current.summary).toEqual(mockSummary);
      expect(result.current.quotas).toEqual([]); // Falls back to empty array
      expect(result.current.history).toEqual(mockHistory);

      consoleError.mockRestore();
    });

    it('should handle history fetch error gracefully', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(api.getBillingUsageHistory).mockRejectedValue(new Error('History error'));

      const { result } = renderHook(() => useUsageData());

      await flushPromises();

      expect(result.current.summary).toEqual(mockSummary);
      expect(result.current.quotas).toEqual(mockQuotas);
      expect(result.current.history).toEqual([]); // Falls back to empty array

      consoleError.mockRestore();
    });

    it('should handle all fetches failing', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(api.getUsageSummary).mockRejectedValue(new Error('Error 1'));
      vi.mocked(api.getQuotas).mockRejectedValue(new Error('Error 2'));
      vi.mocked(api.getBillingUsageHistory).mockRejectedValue(new Error('Error 3'));

      const { result } = renderHook(() => useUsageData());

      await flushPromises();

      expect(result.current.summary).toBeNull();
      expect(result.current.quotas).toEqual([]);
      expect(result.current.history).toEqual([]);

      consoleError.mockRestore();
    });

    it('should handle non-array history response', async () => {
      vi.mocked(api.getBillingUsageHistory).mockResolvedValue(
        {} as unknown as UsageRecordResponse[]
      );

      const { result } = renderHook(() => useUsageData());

      await flushPromises();

      expect(result.current.history).toEqual([]);
    });

    it('should set loading to true during refetch', async () => {
      const { result } = renderHook(() => useUsageData());

      await flushPromises();

      expect(result.current.loading).toBe(false);

      // Create a promise we can control
      let resolvePromise: (value: UsageSummary) => void;
      const pendingPromise = new Promise<UsageSummary>((resolve) => {
        resolvePromise = resolve;
      });

      vi.mocked(api.getUsageSummary).mockReturnValue(pendingPromise);

      act(() => {
        result.current.refetch();
      });

      expect(result.current.loading).toBe(true);

      // Resolve the promise
      await act(async () => {
        resolvePromise!(mockSummary);
        await vi.runAllTimersAsync();
      });

      expect(result.current.loading).toBe(false);
    });

    it('should clear error on successful refetch', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      // First call fails
      vi.mocked(api.getUsageSummary).mockRejectedValueOnce(new Error('Network error'));

      const { result } = renderHook(() => useUsageData());

      await flushPromises();

      // Reset mock for successful call
      vi.mocked(api.getUsageSummary).mockResolvedValue(mockSummary);

      await act(async () => {
        await result.current.refetch();
      });

      expect(result.current.error).toBeNull();
      expect(result.current.summary).toEqual(mockSummary);

      consoleError.mockRestore();
    });
  });

  // ========================================
  // Auto-Refresh Tests
  // ========================================

  describe('Auto-Refresh', () => {
    it('should not auto-refresh by default', async () => {
      renderHook(() => useUsageData());

      await flushPromises();

      vi.mocked(api.getUsageSummary).mockClear();

      // Advance time
      await act(async () => {
        vi.advanceTimersByTime(60000);
      });

      expect(api.getUsageSummary).not.toHaveBeenCalled();
    });

    it('should auto-refresh when enabled', async () => {
      renderHook(() =>
        useUsageData({
          autoRefresh: true,
          refreshInterval: 30000,
        })
      );

      await flushPromises();

      vi.mocked(api.getUsageSummary).mockClear();

      // Advance time past refresh interval
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30000);
      });

      expect(api.getUsageSummary).toHaveBeenCalled();
    });

    it('should use default refresh interval of 30000ms', async () => {
      renderHook(() =>
        useUsageData({
          autoRefresh: true,
        })
      );

      await flushPromises();

      vi.mocked(api.getUsageSummary).mockClear();

      // Advance time less than default interval
      await act(async () => {
        await vi.advanceTimersByTimeAsync(25000);
      });

      expect(api.getUsageSummary).not.toHaveBeenCalled();

      // Advance to complete the interval
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });

      expect(api.getUsageSummary).toHaveBeenCalled();
    });

    it('should clear interval on unmount', async () => {
      const { unmount } = renderHook(() =>
        useUsageData({
          autoRefresh: true,
          refreshInterval: 30000,
        })
      );

      await flushPromises();

      vi.mocked(api.getUsageSummary).mockClear();

      unmount();

      // Advance time past refresh interval
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60000);
      });

      // Should not have been called after unmount
      expect(api.getUsageSummary).not.toHaveBeenCalled();
    });

    it('should refresh multiple times when auto-refresh is enabled', async () => {
      renderHook(() =>
        useUsageData({
          autoRefresh: true,
          refreshInterval: 10000,
        })
      );

      await flushPromises();

      vi.mocked(api.getUsageSummary).mockClear();

      // First interval
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10000);
      });

      expect(api.getUsageSummary).toHaveBeenCalledTimes(1);

      // Second interval
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10000);
      });

      expect(api.getUsageSummary).toHaveBeenCalledTimes(2);

      // Third interval
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10000);
      });

      expect(api.getUsageSummary).toHaveBeenCalledTimes(3);
    });

    it('should use custom refresh interval', async () => {
      const customInterval = 5000;

      renderHook(() =>
        useUsageData({
          autoRefresh: true,
          refreshInterval: customInterval,
        })
      );

      await flushPromises();

      vi.mocked(api.getUsageSummary).mockClear();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(customInterval);
      });

      expect(api.getUsageSummary).toHaveBeenCalled();
    });
  });

  // ========================================
  // Options Change Tests
  // ========================================

  describe('Options Changes', () => {
    it('should refetch when period changes', async () => {
      const { rerender } = renderHook(({ period }) => useUsageData({ period }), {
        initialProps: { period: 'current' as const },
      });

      await flushPromises();

      vi.mocked(api.getUsageSummary).mockClear();

      rerender({ period: 'last_month' as const });

      await flushPromises();

      expect(api.getUsageSummary).toHaveBeenCalledWith('last_month');
    });

    it('should refetch when sessionId changes', async () => {
      const { rerender } = renderHook(({ sessionId }) => useUsageData({ sessionId }), {
        initialProps: { sessionId: 'session-1' },
      });

      await flushPromises();

      vi.mocked(api.getBillingUsageHistory).mockClear();

      rerender({ sessionId: 'session-2' });

      await flushPromises();

      expect(api.getBillingUsageHistory).toHaveBeenCalledWith(1, 100, undefined, 'session-2');
    });
  });

  // ========================================
  // Edge Cases
  // ========================================

  describe('Edge Cases', () => {
    it('should handle empty summary response', async () => {
      vi.mocked(api.getUsageSummary).mockResolvedValue(null as unknown as UsageSummary);

      const { result } = renderHook(() => useUsageData());

      await flushPromises();

      expect(result.current.summary).toBeNull();
    });

    it('should handle empty quotas array', async () => {
      vi.mocked(api.getQuotas).mockResolvedValue([]);

      const { result } = renderHook(() => useUsageData());

      await flushPromises();

      expect(result.current.quotas).toEqual([]);
    });

    it('should handle empty history array', async () => {
      vi.mocked(api.getBillingUsageHistory).mockResolvedValue([]);

      const { result } = renderHook(() => useUsageData());

      await flushPromises();

      expect(result.current.history).toEqual([]);
    });

    it('should handle undefined options', async () => {
      renderHook(() => useUsageData(undefined));

      await flushPromises();

      expect(api.getUsageSummary).toHaveBeenCalledWith('current');
    });

    it('should handle concurrent refetch calls', async () => {
      const { result } = renderHook(() => useUsageData());

      await flushPromises();

      vi.mocked(api.getUsageSummary).mockClear();

      // Multiple concurrent calls
      await act(async () => {
        result.current.refetch();
        result.current.refetch();
        result.current.refetch();
        await vi.runAllTimersAsync();
      });

      expect(result.current.loading).toBe(false);
    });

    it('should handle very large data sets', async () => {
      const largeHistory: UsageRecordResponse[] = Array.from({ length: 100 }, (_, i) => ({
        id: `usage-${i}`,
        session_id: `session-${i % 10}`,
        agent_id: `agent-${i % 5}`,
        model: 'claude-opus-4-5-20251101',
        input_tokens: 1000 * i,
        output_tokens: 500 * i,
        cost: 0.05 * i,
        created_at: new Date(Date.now() - i * 3600000).toISOString(),
      }));

      vi.mocked(api.getBillingUsageHistory).mockResolvedValue(largeHistory);

      const { result } = renderHook(() => useUsageData());

      await flushPromises();

      expect(result.current.history).toHaveLength(100);
    });
  });
});
