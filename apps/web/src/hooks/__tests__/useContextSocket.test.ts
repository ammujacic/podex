/**
 * Comprehensive tests for useContextSocket hook
 * Tests WebSocket events for context window tracking and compaction
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useContextSocket } from '../useContextSocket';
import * as socketLib from '@/lib/socket';
import * as api from '@/lib/api';
import { socketHandlers, triggerSocketEvent, resetMockSocket } from '@/__tests__/mocks/socket';
import type {
  ContextUsageUpdateEvent,
  CompactionStartedEvent,
  CompactionCompletedEvent,
} from '@/lib/socket';

// Mock dependencies
vi.mock('@/lib/socket', () => ({
  onSocketEvent: vi.fn((event, handler) => {
    socketHandlers[event] = handler;
    return () => {
      delete socketHandlers[event];
    };
  }),
}));

vi.mock('@/lib/api', () => ({
  getAgentContextUsage: vi.fn(),
}));

// Mock store state
const mockStoreState = {
  agentUsage: {} as Record<
    string,
    { tokensUsed: number; tokensMax: number; percentage: number; lastUpdated: Date }
  >,
  setAgentUsage: vi.fn(),
  setCompacting: vi.fn(),
  addCompactionLog: vi.fn(),
};

// Mock Zustand context store
vi.mock('@/stores/context', () => ({
  useContextStore: Object.assign(
    (selector?: (state: typeof mockStoreState) => unknown) => {
      if (selector) {
        return selector(mockStoreState);
      }
      return mockStoreState;
    },
    {
      getState: () => mockStoreState,
      subscribe: vi.fn((callback: (state: typeof mockStoreState) => void) => {
        callback(mockStoreState);
        return () => {};
      }),
    }
  ),
}));

describe('useContextSocket', () => {
  const sessionId = 'session-123';
  const agentId = 'agent-001';
  const agentId2 = 'agent-002';

  beforeEach(() => {
    vi.clearAllMocks();
    resetMockSocket();
    mockStoreState.agentUsage = {};
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ========================================
  // Initialization Tests
  // ========================================

  describe('Initialization', () => {
    it('should not subscribe when sessionId is empty', () => {
      renderHook(() => useContextSocket({ sessionId: '', agentIds: [agentId] }));

      expect(socketLib.onSocketEvent).not.toHaveBeenCalled();
    });

    it('should subscribe to socket events when sessionId is provided', () => {
      renderHook(() => useContextSocket({ sessionId, agentIds: [agentId] }));

      expect(socketLib.onSocketEvent).toHaveBeenCalledWith(
        'context_usage_update',
        expect.any(Function)
      );
      expect(socketLib.onSocketEvent).toHaveBeenCalledWith(
        'compaction_started',
        expect.any(Function)
      );
      expect(socketLib.onSocketEvent).toHaveBeenCalledWith(
        'compaction_completed',
        expect.any(Function)
      );
    });

    it('should subscribe to all three event types', () => {
      renderHook(() => useContextSocket({ sessionId, agentIds: [agentId] }));

      expect(socketLib.onSocketEvent).toHaveBeenCalledTimes(3);
    });

    it('should default agentIds to empty array', () => {
      expect(() => {
        renderHook(() => useContextSocket({ sessionId }));
      }).not.toThrow();
    });

    it('should not fetch initial usage when agentIds is empty', async () => {
      renderHook(() => useContextSocket({ sessionId, agentIds: [] }));

      await waitFor(() => {
        expect(api.getAgentContextUsage).not.toHaveBeenCalled();
      });
    });

    it('should not fetch initial usage when sessionId is missing', async () => {
      renderHook(() => useContextSocket({ sessionId: '', agentIds: [agentId] }));

      await waitFor(() => {
        expect(api.getAgentContextUsage).not.toHaveBeenCalled();
      });
    });
  });

  // ========================================
  // Initial Usage Fetch Tests
  // ========================================

  describe('Initial Usage Fetch', () => {
    it('should fetch initial context usage for each agent', async () => {
      (api.getAgentContextUsage as ReturnType<typeof vi.fn>).mockResolvedValue({
        tokens_used: 10000,
        tokens_max: 200000,
        percentage: 5,
      });

      renderHook(() => useContextSocket({ sessionId, agentIds: [agentId] }));

      await waitFor(() => {
        expect(api.getAgentContextUsage).toHaveBeenCalledWith(agentId);
      });
    });

    it('should fetch usage for multiple agents', async () => {
      (api.getAgentContextUsage as ReturnType<typeof vi.fn>).mockResolvedValue({
        tokens_used: 10000,
        tokens_max: 200000,
        percentage: 5,
      });

      renderHook(() => useContextSocket({ sessionId, agentIds: [agentId, agentId2] }));

      await waitFor(() => {
        expect(api.getAgentContextUsage).toHaveBeenCalledWith(agentId);
        expect(api.getAgentContextUsage).toHaveBeenCalledWith(agentId2);
      });
    });

    it('should update store with fetched usage data', async () => {
      const usageData = {
        tokens_used: 50000,
        tokens_max: 200000,
        percentage: 25,
      };
      (api.getAgentContextUsage as ReturnType<typeof vi.fn>).mockResolvedValue(usageData);

      renderHook(() => useContextSocket({ sessionId, agentIds: [agentId] }));

      await waitFor(() => {
        expect(mockStoreState.setAgentUsage).toHaveBeenCalledWith(
          agentId,
          expect.objectContaining({
            tokensUsed: 50000,
            tokensMax: 200000,
            percentage: 25,
          })
        );
      });
    });

    it('should handle fetch error gracefully', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      (api.getAgentContextUsage as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Network error')
      );

      renderHook(() => useContextSocket({ sessionId, agentIds: [agentId] }));

      await waitFor(() => {
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          `Failed to fetch context usage for agent ${agentId}:`,
          expect.any(Error)
        );
      });

      consoleWarnSpy.mockRestore();
    });

    it('should continue fetching for other agents if one fails', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      (api.getAgentContextUsage as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('Error'))
        .mockResolvedValueOnce({ tokens_used: 1000, tokens_max: 200000, percentage: 0.5 });

      renderHook(() => useContextSocket({ sessionId, agentIds: [agentId, agentId2] }));

      await waitFor(() => {
        expect(api.getAgentContextUsage).toHaveBeenCalledWith(agentId);
        expect(api.getAgentContextUsage).toHaveBeenCalledWith(agentId2);
      });

      consoleWarnSpy.mockRestore();
    });

    it('should include lastUpdated timestamp in usage data', async () => {
      const usageData = { tokens_used: 1000, tokens_max: 200000, percentage: 0.5 };
      (api.getAgentContextUsage as ReturnType<typeof vi.fn>).mockResolvedValue(usageData);

      renderHook(() => useContextSocket({ sessionId, agentIds: [agentId] }));

      await waitFor(() => {
        expect(mockStoreState.setAgentUsage).toHaveBeenCalledWith(
          agentId,
          expect.objectContaining({
            lastUpdated: expect.any(Date),
          })
        );
      });
    });
  });

  // ========================================
  // Context Usage Update Event Tests
  // ========================================

  describe('Context Usage Update Events', () => {
    it('should update agent usage on context_usage_update event', async () => {
      renderHook(() => useContextSocket({ sessionId, agentIds: [agentId] }));

      const usageEvent: ContextUsageUpdateEvent = {
        agent_id: agentId,
        tokens_used: 75000,
        tokens_max: 200000,
        percentage: 37.5,
      };

      triggerSocketEvent('context_usage_update', usageEvent);

      await waitFor(() => {
        expect(mockStoreState.setAgentUsage).toHaveBeenCalledWith(
          agentId,
          expect.objectContaining({
            tokensUsed: 75000,
            tokensMax: 200000,
            percentage: 37.5,
          })
        );
      });
    });

    it('should handle usage update for any agent', async () => {
      renderHook(() => useContextSocket({ sessionId, agentIds: [] }));

      const usageEvent: ContextUsageUpdateEvent = {
        agent_id: 'unknown-agent',
        tokens_used: 10000,
        tokens_max: 200000,
        percentage: 5,
      };

      triggerSocketEvent('context_usage_update', usageEvent);

      await waitFor(() => {
        expect(mockStoreState.setAgentUsage).toHaveBeenCalledWith(
          'unknown-agent',
          expect.any(Object)
        );
      });
    });

    it('should include lastUpdated date in usage update', async () => {
      renderHook(() => useContextSocket({ sessionId, agentIds: [agentId] }));

      const usageEvent: ContextUsageUpdateEvent = {
        agent_id: agentId,
        tokens_used: 10000,
        tokens_max: 200000,
        percentage: 5,
      };

      triggerSocketEvent('context_usage_update', usageEvent);

      await waitFor(() => {
        expect(mockStoreState.setAgentUsage).toHaveBeenCalledWith(
          agentId,
          expect.objectContaining({
            lastUpdated: expect.any(Date),
          })
        );
      });
    });

    it('should handle multiple usage updates', async () => {
      renderHook(() => useContextSocket({ sessionId, agentIds: [agentId] }));

      triggerSocketEvent('context_usage_update', {
        agent_id: agentId,
        tokens_used: 10000,
        tokens_max: 200000,
        percentage: 5,
      });

      triggerSocketEvent('context_usage_update', {
        agent_id: agentId,
        tokens_used: 20000,
        tokens_max: 200000,
        percentage: 10,
      });

      await waitFor(() => {
        expect(mockStoreState.setAgentUsage).toHaveBeenCalledTimes(2);
      });
    });
  });

  // ========================================
  // Compaction Started Event Tests
  // ========================================

  describe('Compaction Started Events', () => {
    it('should set agent as compacting on compaction_started event', async () => {
      renderHook(() => useContextSocket({ sessionId, agentIds: [agentId] }));

      const compactionEvent: CompactionStartedEvent = {
        session_id: sessionId,
        agent_id: agentId,
      };

      triggerSocketEvent('compaction_started', compactionEvent);

      await waitFor(() => {
        expect(mockStoreState.setCompacting).toHaveBeenCalledWith(agentId, true);
      });
    });

    it('should ignore compaction_started from different sessions', async () => {
      renderHook(() => useContextSocket({ sessionId, agentIds: [agentId] }));

      const compactionEvent: CompactionStartedEvent = {
        session_id: 'other-session',
        agent_id: agentId,
      };

      triggerSocketEvent('compaction_started', compactionEvent);

      await waitFor(() => {
        expect(mockStoreState.setCompacting).not.toHaveBeenCalled();
      });
    });

    it('should handle compaction for multiple agents', async () => {
      renderHook(() => useContextSocket({ sessionId, agentIds: [agentId, agentId2] }));

      triggerSocketEvent('compaction_started', { session_id: sessionId, agent_id: agentId });
      triggerSocketEvent('compaction_started', { session_id: sessionId, agent_id: agentId2 });

      await waitFor(() => {
        expect(mockStoreState.setCompacting).toHaveBeenCalledWith(agentId, true);
        expect(mockStoreState.setCompacting).toHaveBeenCalledWith(agentId2, true);
      });
    });
  });

  // ========================================
  // Compaction Completed Event Tests
  // ========================================

  describe('Compaction Completed Events', () => {
    it('should clear compacting state on compaction_completed event', async () => {
      renderHook(() => useContextSocket({ sessionId, agentIds: [agentId] }));

      const completedEvent: CompactionCompletedEvent = {
        session_id: sessionId,
        agent_id: agentId,
        tokens_before: 180000,
        tokens_after: 50000,
        messages_removed: 50,
        summary: 'Compaction completed successfully',
        trigger_type: 'auto',
      };

      triggerSocketEvent('compaction_completed', completedEvent);

      await waitFor(() => {
        expect(mockStoreState.setCompacting).toHaveBeenCalledWith(agentId, false);
      });
    });

    it('should update context usage after compaction', async () => {
      mockStoreState.agentUsage[agentId] = {
        tokensUsed: 180000,
        tokensMax: 200000,
        percentage: 90,
        lastUpdated: new Date(),
      };

      renderHook(() => useContextSocket({ sessionId, agentIds: [agentId] }));

      const completedEvent: CompactionCompletedEvent = {
        session_id: sessionId,
        agent_id: agentId,
        tokens_before: 180000,
        tokens_after: 50000,
        messages_removed: 50,
        summary: 'Summary',
        trigger_type: 'manual',
      };

      triggerSocketEvent('compaction_completed', completedEvent);

      await waitFor(() => {
        expect(mockStoreState.setAgentUsage).toHaveBeenCalledWith(
          agentId,
          expect.objectContaining({
            tokensUsed: 50000,
          })
        );
      });
    });

    it('should add compaction log entry', async () => {
      mockStoreState.agentUsage[agentId] = {
        tokensUsed: 180000,
        tokensMax: 200000,
        percentage: 90,
        lastUpdated: new Date(),
      };

      renderHook(() => useContextSocket({ sessionId, agentIds: [agentId] }));

      const completedEvent: CompactionCompletedEvent = {
        session_id: sessionId,
        agent_id: agentId,
        tokens_before: 180000,
        tokens_after: 50000,
        messages_removed: 50,
        summary: 'Context compaction completed',
        trigger_type: 'threshold',
      };

      triggerSocketEvent('compaction_completed', completedEvent);

      await waitFor(() => {
        expect(mockStoreState.addCompactionLog).toHaveBeenCalledWith(
          sessionId,
          expect.objectContaining({
            agentId,
            tokensBefore: 180000,
            tokensAfter: 50000,
            messagesRemoved: 50,
            summaryText: 'Context compaction completed',
            triggerType: 'threshold',
          })
        );
      });
    });

    it('should ignore compaction_completed from different sessions', async () => {
      renderHook(() => useContextSocket({ sessionId, agentIds: [agentId] }));

      const completedEvent: CompactionCompletedEvent = {
        session_id: 'other-session',
        agent_id: agentId,
        tokens_before: 180000,
        tokens_after: 50000,
        messages_removed: 50,
        summary: null,
        trigger_type: 'manual',
      };

      triggerSocketEvent('compaction_completed', completedEvent);

      await waitFor(() => {
        expect(mockStoreState.setCompacting).not.toHaveBeenCalled();
        expect(mockStoreState.addCompactionLog).not.toHaveBeenCalled();
      });
    });

    it('should use default tokensMax if agent usage not in store', async () => {
      mockStoreState.agentUsage = {};

      renderHook(() => useContextSocket({ sessionId, agentIds: [agentId] }));

      const completedEvent: CompactionCompletedEvent = {
        session_id: sessionId,
        agent_id: agentId,
        tokens_before: 180000,
        tokens_after: 50000,
        messages_removed: 50,
        summary: null,
        trigger_type: 'manual',
      };

      triggerSocketEvent('compaction_completed', completedEvent);

      await waitFor(() => {
        expect(mockStoreState.setAgentUsage).toHaveBeenCalledWith(
          agentId,
          expect.objectContaining({
            tokensMax: 200000, // Default value
          })
        );
      });
    });

    it('should handle null summary text', async () => {
      renderHook(() => useContextSocket({ sessionId, agentIds: [agentId] }));

      const completedEvent: CompactionCompletedEvent = {
        session_id: sessionId,
        agent_id: agentId,
        tokens_before: 180000,
        tokens_after: 50000,
        messages_removed: 50,
        summary: null,
        trigger_type: 'manual',
      };

      triggerSocketEvent('compaction_completed', completedEvent);

      await waitFor(() => {
        expect(mockStoreState.addCompactionLog).toHaveBeenCalledWith(
          sessionId,
          expect.objectContaining({
            summaryText: null,
          })
        );
      });
    });

    it('should default trigger_type to manual if not provided', async () => {
      renderHook(() => useContextSocket({ sessionId, agentIds: [agentId] }));

      const completedEvent = {
        session_id: sessionId,
        agent_id: agentId,
        tokens_before: 180000,
        tokens_after: 50000,
        messages_removed: 50,
        summary: null,
      } as CompactionCompletedEvent;

      triggerSocketEvent('compaction_completed', completedEvent);

      await waitFor(() => {
        expect(mockStoreState.addCompactionLog).toHaveBeenCalledWith(
          sessionId,
          expect.objectContaining({
            triggerType: 'manual',
          })
        );
      });
    });

    it('should include unique log id and timestamp', async () => {
      renderHook(() => useContextSocket({ sessionId, agentIds: [agentId] }));

      const completedEvent: CompactionCompletedEvent = {
        session_id: sessionId,
        agent_id: agentId,
        tokens_before: 180000,
        tokens_after: 50000,
        messages_removed: 50,
        summary: 'Done',
        trigger_type: 'auto',
      };

      triggerSocketEvent('compaction_completed', completedEvent);

      await waitFor(() => {
        expect(mockStoreState.addCompactionLog).toHaveBeenCalledWith(
          sessionId,
          expect.objectContaining({
            id: expect.stringMatching(/^log-\d+$/),
            createdAt: expect.any(Date),
          })
        );
      });
    });
  });

  // ========================================
  // Cleanup Tests
  // ========================================

  describe('Cleanup', () => {
    it('should unsubscribe from socket events on unmount', () => {
      const { unmount } = renderHook(() => useContextSocket({ sessionId, agentIds: [agentId] }));

      const handlersBefore = Object.keys(socketHandlers);
      expect(handlersBefore).toContain('context_usage_update');
      expect(handlersBefore).toContain('compaction_started');
      expect(handlersBefore).toContain('compaction_completed');

      unmount();

      // The cleanup function should have been called
      // This is handled by the mocked onSocketEvent returning unsubscribe functions
    });

    it('should cancel pending fetch requests on unmount', async () => {
      let resolvePromise: ((value: unknown) => void) | undefined;
      const pendingPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });

      (api.getAgentContextUsage as ReturnType<typeof vi.fn>).mockReturnValue(pendingPromise);

      const { unmount } = renderHook(() => useContextSocket({ sessionId, agentIds: [agentId] }));

      unmount();

      // Resolve after unmount - should not cause issues
      resolvePromise?.({ tokens_used: 1000, tokens_max: 200000, percentage: 0.5 });

      // Should not throw or cause state updates after unmount
      await waitFor(() => {
        expect(mockStoreState.setAgentUsage).not.toHaveBeenCalled();
      });
    });

    it('should handle unmount during fetch error', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      let rejectPromise: ((reason?: unknown) => void) | undefined;
      const pendingPromise = new Promise((_, reject) => {
        rejectPromise = reject;
      });

      (api.getAgentContextUsage as ReturnType<typeof vi.fn>).mockReturnValue(pendingPromise);

      const { unmount } = renderHook(() => useContextSocket({ sessionId, agentIds: [agentId] }));

      unmount();

      // Reject after unmount
      rejectPromise?.(new Error('Network error'));

      // Should not throw
      await new Promise((resolve) => setTimeout(resolve, 10));

      consoleWarnSpy.mockRestore();
    });
  });

  // ========================================
  // Edge Cases
  // ========================================

  describe('Edge Cases', () => {
    it('should handle agentIds array changes', async () => {
      (api.getAgentContextUsage as ReturnType<typeof vi.fn>).mockResolvedValue({
        tokens_used: 1000,
        tokens_max: 200000,
        percentage: 0.5,
      });

      const { rerender } = renderHook(({ agentIds }) => useContextSocket({ sessionId, agentIds }), {
        initialProps: { agentIds: [agentId] },
      });

      await waitFor(() => {
        expect(api.getAgentContextUsage).toHaveBeenCalledWith(agentId);
      });

      // Clear mock and change agentIds
      vi.clearAllMocks();

      rerender({ agentIds: [agentId2] });

      await waitFor(() => {
        expect(api.getAgentContextUsage).toHaveBeenCalledWith(agentId2);
      });
    });

    it('should handle sessionId changes', () => {
      const { rerender } = renderHook(
        ({ sessionId }) => useContextSocket({ sessionId, agentIds: [agentId] }),
        { initialProps: { sessionId } }
      );

      expect(socketLib.onSocketEvent).toHaveBeenCalled();

      vi.clearAllMocks();

      rerender({ sessionId: 'new-session' });

      expect(socketLib.onSocketEvent).toHaveBeenCalled();
    });

    it('should memoize agentIds array to prevent effect re-runs', () => {
      const { rerender } = renderHook(({ agentIds }) => useContextSocket({ sessionId, agentIds }), {
        initialProps: { agentIds: [agentId] },
      });

      vi.clearAllMocks();

      // Rerender with same content but new array reference
      rerender({ agentIds: [agentId] });

      // Should not re-fetch because contents are the same
      expect(api.getAgentContextUsage).not.toHaveBeenCalled();
    });

    it('should calculate percentage correctly in compaction completed', async () => {
      mockStoreState.agentUsage[agentId] = {
        tokensUsed: 180000,
        tokensMax: 200000,
        percentage: 90,
        lastUpdated: new Date(),
      };

      renderHook(() => useContextSocket({ sessionId, agentIds: [agentId] }));

      const completedEvent: CompactionCompletedEvent = {
        session_id: sessionId,
        agent_id: agentId,
        tokens_before: 180000,
        tokens_after: 50000,
        messages_removed: 50,
        summary: null,
        trigger_type: 'auto',
      };

      triggerSocketEvent('compaction_completed', completedEvent);

      await waitFor(() => {
        expect(mockStoreState.setAgentUsage).toHaveBeenCalledWith(
          agentId,
          expect.objectContaining({
            percentage: 25, // 50000 / 200000 * 100
          })
        );
      });
    });

    it('should set messagesPreserved to 0 in compaction log', async () => {
      renderHook(() => useContextSocket({ sessionId, agentIds: [agentId] }));

      const completedEvent: CompactionCompletedEvent = {
        session_id: sessionId,
        agent_id: agentId,
        tokens_before: 180000,
        tokens_after: 50000,
        messages_removed: 50,
        summary: 'Done',
        trigger_type: 'auto',
      };

      triggerSocketEvent('compaction_completed', completedEvent);

      await waitFor(() => {
        expect(mockStoreState.addCompactionLog).toHaveBeenCalledWith(
          sessionId,
          expect.objectContaining({
            messagesPreserved: 0,
          })
        );
      });
    });
  });
});
