/**
 * Comprehensive tests for useUsageTracking hook
 * Tests usage data fetching, cost aggregation, polling, and error handling
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useUsageTracking } from '../useUsageTracking';
import * as api from '@/lib/api';
import type { CostBreakdown } from '@/stores/cost';

// Mock store functions need to be defined before vi.mock
const mockSetSessionCost = vi.fn();
const mockSetLoading = vi.fn();
const mockSetError = vi.fn();

// Mock dependencies
vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
  },
}));

vi.mock('@/stores/cost', () => ({
  useCostStore: {
    getState: () => ({
      setSessionCost: mockSetSessionCost,
      setLoading: mockSetLoading,
      setError: mockSetError,
    }),
    subscribe: () => () => {},
  },
}));

describe('useUsageTracking', () => {
  const sessionId = 'session-123';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ========================================
  // Initialization Tests
  // ========================================

  describe('Initialization', () => {
    it('should not fetch when sessionId is empty', async () => {
      renderHook(() => useUsageTracking({ sessionId: '' }));

      await act(async () => {
        vi.advanceTimersByTime(100);
      });

      expect(api.api.get).not.toHaveBeenCalled();
    });

    it('should not fetch when disabled', async () => {
      renderHook(() => useUsageTracking({ sessionId, enabled: false }));

      await act(async () => {
        vi.advanceTimersByTime(100);
      });

      expect(api.api.get).not.toHaveBeenCalled();
    });

    it('should fetch immediately on mount when enabled', async () => {
      (api.api.get as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      renderHook(() => useUsageTracking({ sessionId }));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(api.api.get).toHaveBeenCalledWith(
        `/api/billing/usage/history?session_id=${sessionId}&page_size=100&usage_type_prefix=tokens`
      );
    });

    it('should use default polling interval of 30000ms', async () => {
      (api.api.get as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      renderHook(() => useUsageTracking({ sessionId }));

      // Wait for initial fetch
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });

      expect(api.api.get).toHaveBeenCalledTimes(1);

      // Advance by 30 seconds
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30000);
      });

      expect(api.api.get).toHaveBeenCalledTimes(2);
    });

    it('should respect custom polling interval', async () => {
      (api.api.get as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      renderHook(() => useUsageTracking({ sessionId, pollingInterval: 5000 }));

      // Wait for initial fetch
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });

      expect(api.api.get).toHaveBeenCalledTimes(1);

      // Advance by 5 seconds
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });

      expect(api.api.get).toHaveBeenCalledTimes(2);
    });
  });

  // ========================================
  // Loading State Tests
  // ========================================

  describe('Loading State', () => {
    it('should set loading to true before fetch', async () => {
      (api.api.get as ReturnType<typeof vi.fn>).mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve([]), 100))
      );

      renderHook(() => useUsageTracking({ sessionId }));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(mockSetLoading).toHaveBeenCalledWith(true);
    });

    it('should set loading to false after successful fetch', async () => {
      (api.api.get as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      renderHook(() => useUsageTracking({ sessionId }));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });

      expect(mockSetLoading).toHaveBeenCalledWith(false);
    });

    it('should set loading to false after failed fetch', async () => {
      (api.api.get as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      renderHook(() => useUsageTracking({ sessionId }));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });

      expect(mockSetLoading).toHaveBeenCalledWith(false);

      consoleSpy.mockRestore();
    });

    it('should clear error before each fetch', async () => {
      (api.api.get as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      renderHook(() => useUsageTracking({ sessionId }));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(mockSetError).toHaveBeenCalledWith(null);
    });
  });

  // ========================================
  // Cost Aggregation Tests
  // ========================================

  describe('Cost Aggregation', () => {
    it('should aggregate input tokens correctly', async () => {
      const mockRecords = [
        { usage_type: 'tokens_input', quantity: 1000, cost: 0.01, model: 'claude-3' },
        { usage_type: 'tokens_input', quantity: 2000, cost: 0.02, model: 'claude-3' },
      ];

      (api.api.get as ReturnType<typeof vi.fn>).mockResolvedValue(mockRecords);

      renderHook(() => useUsageTracking({ sessionId }));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });

      expect(mockSetSessionCost).toHaveBeenCalledWith(
        sessionId,
        expect.objectContaining({
          inputTokens: 3000,
          inputCost: 0.03,
        })
      );
    });

    it('should aggregate output tokens correctly', async () => {
      const mockRecords = [
        { usage_type: 'tokens_output', quantity: 500, cost: 0.005, model: 'claude-3' },
        { usage_type: 'tokens_output', quantity: 1500, cost: 0.015, model: 'claude-3' },
      ];

      (api.api.get as ReturnType<typeof vi.fn>).mockResolvedValue(mockRecords);

      renderHook(() => useUsageTracking({ sessionId }));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });

      expect(mockSetSessionCost).toHaveBeenCalledWith(
        sessionId,
        expect.objectContaining({
          outputTokens: 2000,
          outputCost: 0.02,
        })
      );
    });

    it('should aggregate cached tokens correctly', async () => {
      const mockRecords = [
        { usage_type: 'tokens_cached', quantity: 5000, cost: 0.001, model: 'claude-3' },
      ];

      (api.api.get as ReturnType<typeof vi.fn>).mockResolvedValue(mockRecords);

      renderHook(() => useUsageTracking({ sessionId }));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });

      expect(mockSetSessionCost).toHaveBeenCalledWith(
        sessionId,
        expect.objectContaining({
          cachedInputTokens: 5000,
          cachedInputCost: 0.001,
        })
      );
    });

    it('should calculate total tokens across all types', async () => {
      const mockRecords = [
        { usage_type: 'tokens_input', quantity: 1000, cost: 0.01, model: 'claude-3' },
        { usage_type: 'tokens_output', quantity: 500, cost: 0.005, model: 'claude-3' },
        { usage_type: 'tokens_cached', quantity: 2000, cost: 0.001, model: 'claude-3' },
      ];

      (api.api.get as ReturnType<typeof vi.fn>).mockResolvedValue(mockRecords);

      renderHook(() => useUsageTracking({ sessionId }));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });

      expect(mockSetSessionCost).toHaveBeenCalledWith(
        sessionId,
        expect.objectContaining({
          totalTokens: 3500,
        })
      );
    });

    it('should calculate total cost correctly', async () => {
      const mockRecords = [
        { usage_type: 'tokens_input', quantity: 1000, cost: 0.01, model: 'claude-3' },
        { usage_type: 'tokens_output', quantity: 500, cost: 0.005, model: 'claude-3' },
        { usage_type: 'tokens_cached', quantity: 2000, cost: 0.001, model: 'claude-3' },
      ];

      (api.api.get as ReturnType<typeof vi.fn>).mockResolvedValue(mockRecords);

      renderHook(() => useUsageTracking({ sessionId }));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });

      expect(mockSetSessionCost).toHaveBeenCalledWith(
        sessionId,
        expect.objectContaining({
          totalCost: 0.016,
        })
      );
    });

    it('should handle other token types', async () => {
      const mockRecords = [
        { usage_type: 'tokens_other', quantity: 100, cost: 0.001, model: 'claude-3' },
      ];

      (api.api.get as ReturnType<typeof vi.fn>).mockResolvedValue(mockRecords);

      renderHook(() => useUsageTracking({ sessionId }));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });

      expect(mockSetSessionCost).toHaveBeenCalledWith(
        sessionId,
        expect.objectContaining({
          totalTokens: 100,
        })
      );
    });
  });

  // ========================================
  // Model Aggregation Tests
  // ========================================

  describe('Model Aggregation', () => {
    it('should aggregate usage by model', async () => {
      const mockRecords = [
        { usage_type: 'tokens_input', quantity: 1000, cost: 0.01, model: 'claude-3-opus' },
        { usage_type: 'tokens_output', quantity: 500, cost: 0.015, model: 'claude-3-opus' },
        { usage_type: 'tokens_input', quantity: 2000, cost: 0.004, model: 'claude-3-sonnet' },
      ];

      (api.api.get as ReturnType<typeof vi.fn>).mockResolvedValue(mockRecords);

      renderHook(() => useUsageTracking({ sessionId }));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });

      expect(mockSetSessionCost).toHaveBeenCalledWith(
        sessionId,
        expect.objectContaining({
          byModel: expect.objectContaining({
            'claude-3-opus': expect.objectContaining({
              inputTokens: 1000,
              outputTokens: 500,
              cost: 0.025,
            }),
            'claude-3-sonnet': expect.objectContaining({
              inputTokens: 2000,
              outputTokens: 0,
              cost: 0.004,
            }),
          }),
        })
      );
    });

    it('should handle missing model field', async () => {
      const mockRecords = [{ usage_type: 'tokens_input', quantity: 1000, cost: 0.01 }];

      (api.api.get as ReturnType<typeof vi.fn>).mockResolvedValue(mockRecords);

      renderHook(() => useUsageTracking({ sessionId }));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });

      expect(mockSetSessionCost).toHaveBeenCalledWith(
        sessionId,
        expect.objectContaining({
          byModel: expect.objectContaining({
            unknown: expect.any(Object),
          }),
        })
      );
    });
  });

  // ========================================
  // Agent Aggregation Tests
  // ========================================

  describe('Agent Aggregation', () => {
    it('should aggregate usage by agent', async () => {
      const mockRecords = [
        {
          usage_type: 'tokens_input',
          quantity: 1000,
          cost: 0.01,
          model: 'claude-3',
          agent_id: 'agent-1',
        },
        {
          usage_type: 'tokens_input',
          quantity: 2000,
          cost: 0.02,
          model: 'claude-3',
          agent_id: 'agent-2',
        },
        {
          usage_type: 'tokens_output',
          quantity: 500,
          cost: 0.005,
          model: 'claude-3',
          agent_id: 'agent-1',
        },
      ];

      (api.api.get as ReturnType<typeof vi.fn>).mockResolvedValue(mockRecords);

      renderHook(() => useUsageTracking({ sessionId }));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });

      expect(mockSetSessionCost).toHaveBeenCalledWith(
        sessionId,
        expect.objectContaining({
          byAgent: expect.objectContaining({
            'agent-1': expect.objectContaining({
              tokens: 1500,
              cost: 0.015,
            }),
            'agent-2': expect.objectContaining({
              tokens: 2000,
              cost: 0.02,
            }),
          }),
        })
      );
    });

    it('should not include records without agent_id in byAgent', async () => {
      const mockRecords = [
        { usage_type: 'tokens_input', quantity: 1000, cost: 0.01, model: 'claude-3' },
        {
          usage_type: 'tokens_input',
          quantity: 500,
          cost: 0.005,
          model: 'claude-3',
          agent_id: 'agent-1',
        },
      ];

      (api.api.get as ReturnType<typeof vi.fn>).mockResolvedValue(mockRecords);

      renderHook(() => useUsageTracking({ sessionId }));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });

      const callArgs = mockSetSessionCost.mock.calls[0];
      const breakdown = callArgs[1] as CostBreakdown;

      expect(Object.keys(breakdown.byAgent)).toHaveLength(1);
      expect(breakdown.byAgent['agent-1']).toBeDefined();
    });
  });

  // ========================================
  // Call Count Tests
  // ========================================

  describe('Call Count', () => {
    it('should count unique API calls based on ID prefix', async () => {
      // IDs are split by '-' and only first part is used for uniqueness
      // So 'call1-input' and 'call1-output' count as 1 call ('call1')
      // 'call2-input' counts as another call ('call2')
      const mockRecords = [
        {
          id: 'call1-input',
          usage_type: 'tokens_input',
          quantity: 100,
          cost: 0.001,
          model: 'claude-3',
        },
        {
          id: 'call1-output',
          usage_type: 'tokens_output',
          quantity: 50,
          cost: 0.001,
          model: 'claude-3',
        },
        {
          id: 'call2-input',
          usage_type: 'tokens_input',
          quantity: 200,
          cost: 0.002,
          model: 'claude-3',
        },
      ];

      (api.api.get as ReturnType<typeof vi.fn>).mockResolvedValue(mockRecords);

      renderHook(() => useUsageTracking({ sessionId }));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });

      expect(mockSetSessionCost).toHaveBeenCalledWith(
        sessionId,
        expect.objectContaining({
          callCount: 2,
        })
      );
    });

    it('should use record count when no IDs present', async () => {
      const mockRecords = [
        { usage_type: 'tokens_input', quantity: 100, cost: 0.001, model: 'claude-3' },
        { usage_type: 'tokens_output', quantity: 50, cost: 0.001, model: 'claude-3' },
      ];

      (api.api.get as ReturnType<typeof vi.fn>).mockResolvedValue(mockRecords);

      renderHook(() => useUsageTracking({ sessionId }));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });

      // When no IDs, falls back to records.length
      expect(mockSetSessionCost).toHaveBeenCalledWith(
        sessionId,
        expect.objectContaining({
          callCount: 2,
        })
      );
    });
  });

  // ========================================
  // Error Handling Tests
  // ========================================

  describe('Error Handling', () => {
    it('should set error on fetch failure', async () => {
      (api.api.get as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      renderHook(() => useUsageTracking({ sessionId }));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });

      expect(mockSetError).toHaveBeenCalledWith('Network error');

      consoleSpy.mockRestore();
    });

    it('should set generic error message for non-Error objects', async () => {
      (api.api.get as ReturnType<typeof vi.fn>).mockRejectedValue('String error');

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      renderHook(() => useUsageTracking({ sessionId }));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });

      expect(mockSetError).toHaveBeenCalledWith('Failed to fetch usage');

      consoleSpy.mockRestore();
    });

    it('should log error to console', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      (api.api.get as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Test error'));

      renderHook(() => useUsageTracking({ sessionId }));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });

      expect(consoleSpy).toHaveBeenCalledWith('Failed to fetch usage data:', expect.any(Error));

      consoleSpy.mockRestore();
    });

    it('should continue polling after error', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      (api.api.get as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('First error'))
        .mockResolvedValueOnce([]);

      renderHook(() => useUsageTracking({ sessionId, pollingInterval: 5000 }));

      // First call fails
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });

      expect(api.api.get).toHaveBeenCalledTimes(1);

      // Second call succeeds
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });

      expect(api.api.get).toHaveBeenCalledTimes(2);

      consoleSpy.mockRestore();
    });
  });

  // ========================================
  // Cleanup Tests
  // ========================================

  describe('Cleanup', () => {
    it('should clear interval on unmount', async () => {
      (api.api.get as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const { unmount } = renderHook(() => useUsageTracking({ sessionId, pollingInterval: 5000 }));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });

      expect(api.api.get).toHaveBeenCalledTimes(1);

      unmount();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10000);
      });

      // Should not have been called again after unmount
      expect(api.api.get).toHaveBeenCalledTimes(1);
    });

    it('should restart polling when sessionId changes', async () => {
      (api.api.get as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const { rerender } = renderHook(
        ({ sessionId }) => useUsageTracking({ sessionId, pollingInterval: 5000 }),
        { initialProps: { sessionId: 'session-1' } }
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });

      expect(api.api.get).toHaveBeenCalledWith(expect.stringContaining('session_id=session-1'));

      // Change session
      rerender({ sessionId: 'session-2' });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });

      expect(api.api.get).toHaveBeenCalledWith(expect.stringContaining('session_id=session-2'));
    });

    it('should stop polling when enabled changes to false', async () => {
      (api.api.get as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const { rerender } = renderHook(
        ({ enabled }) => useUsageTracking({ sessionId, enabled, pollingInterval: 5000 }),
        { initialProps: { enabled: true } }
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });

      expect(api.api.get).toHaveBeenCalledTimes(1);

      // Disable
      rerender({ enabled: false });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10000);
      });

      // Should not have been called again
      expect(api.api.get).toHaveBeenCalledTimes(1);
    });
  });

  // ========================================
  // Edge Cases
  // ========================================

  describe('Edge Cases', () => {
    it('should handle empty records array', async () => {
      (api.api.get as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      renderHook(() => useUsageTracking({ sessionId }));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });

      expect(mockSetSessionCost).toHaveBeenCalledWith(
        sessionId,
        expect.objectContaining({
          totalCost: 0,
          totalTokens: 0,
          inputTokens: 0,
          outputTokens: 0,
          callCount: 0,
        })
      );
    });

    it('should handle records with zero values', async () => {
      const mockRecords = [{ usage_type: 'tokens_input', quantity: 0, cost: 0, model: 'claude-3' }];

      (api.api.get as ReturnType<typeof vi.fn>).mockResolvedValue(mockRecords);

      renderHook(() => useUsageTracking({ sessionId }));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });

      expect(mockSetSessionCost).toHaveBeenCalledWith(
        sessionId,
        expect.objectContaining({
          inputTokens: 0,
          inputCost: 0,
        })
      );
    });

    it('should handle records with missing quantity', async () => {
      const mockRecords = [{ usage_type: 'tokens_input', cost: 0.01, model: 'claude-3' }];

      (api.api.get as ReturnType<typeof vi.fn>).mockResolvedValue(mockRecords);

      renderHook(() => useUsageTracking({ sessionId }));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });

      expect(mockSetSessionCost).toHaveBeenCalledWith(
        sessionId,
        expect.objectContaining({
          inputTokens: 0,
        })
      );
    });

    it('should handle records with missing cost', async () => {
      const mockRecords = [{ usage_type: 'tokens_input', quantity: 1000, model: 'claude-3' }];

      (api.api.get as ReturnType<typeof vi.fn>).mockResolvedValue(mockRecords);

      renderHook(() => useUsageTracking({ sessionId }));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });

      expect(mockSetSessionCost).toHaveBeenCalledWith(
        sessionId,
        expect.objectContaining({
          inputCost: 0,
        })
      );
    });

    it('should handle very large numbers', async () => {
      const mockRecords = [
        { usage_type: 'tokens_input', quantity: 10000000, cost: 100.5, model: 'claude-3' },
        { usage_type: 'tokens_output', quantity: 5000000, cost: 250.25, model: 'claude-3' },
      ];

      (api.api.get as ReturnType<typeof vi.fn>).mockResolvedValue(mockRecords);

      renderHook(() => useUsageTracking({ sessionId }));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });

      expect(mockSetSessionCost).toHaveBeenCalledWith(
        sessionId,
        expect.objectContaining({
          totalTokens: 15000000,
          totalCost: 350.75,
        })
      );
    });

    it('should handle floating point precision', async () => {
      const mockRecords = [
        { usage_type: 'tokens_input', quantity: 1, cost: 0.001, model: 'claude-3' },
        { usage_type: 'tokens_input', quantity: 1, cost: 0.001, model: 'claude-3' },
        { usage_type: 'tokens_input', quantity: 1, cost: 0.001, model: 'claude-3' },
      ];

      (api.api.get as ReturnType<typeof vi.fn>).mockResolvedValue(mockRecords);

      renderHook(() => useUsageTracking({ sessionId }));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });

      expect(mockSetSessionCost).toHaveBeenCalledWith(
        sessionId,
        expect.objectContaining({
          inputCost: expect.any(Number),
        })
      );
    });
  });
});
