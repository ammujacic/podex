/**
 * Comprehensive tests for useSkillSocket hook
 * Tests WebSocket-based skill execution event handling
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSkillSocket } from '../useSkillSocket';
import type { SkillExecution } from '@/stores/skills';

// Track socket event handlers for simulating events
type EventHandler = (data: unknown) => void;
const socketHandlers: Record<string, EventHandler> = {};

// Track unsubscribe calls
let unsubscribeCalls = 0;

// Mock onSocketEvent to capture handlers
vi.mock('@/lib/socket', () => ({
  onSocketEvent: vi.fn((event: string, handler: EventHandler) => {
    socketHandlers[event] = handler;
    // Return unsubscribe function
    return () => {
      delete socketHandlers[event];
      unsubscribeCalls++;
    };
  }),
}));

// Mock skills store
const mockStartExecution = vi.fn();
const mockUpdateExecutionStep = vi.fn();
const mockCompleteExecution = vi.fn();

vi.mock('@/stores/skills', () => ({
  useSkillsStore: vi.fn((selector: (state: unknown) => unknown) => {
    const state = {
      startExecution: mockStartExecution,
      updateExecutionStep: mockUpdateExecutionStep,
      completeExecution: mockCompleteExecution,
    };
    return selector(state);
  }),
}));

describe('useSkillSocket', () => {
  const sessionId = 'session-123';

  beforeEach(() => {
    vi.clearAllMocks();
    // Clear socket handlers
    Object.keys(socketHandlers).forEach((key) => delete socketHandlers[key]);
    unsubscribeCalls = 0;
  });

  afterEach(() => {
    // Don't use restoreAllMocks as it undoes our vi.mock setup
  });

  // ========================================================================
  // Initialization Tests
  // ========================================================================

  describe('Initialization', () => {
    it('should register skill event listeners on mount', async () => {
      const { onSocketEvent } = await import('@/lib/socket');

      renderHook(() => useSkillSocket({ sessionId }));

      expect(onSocketEvent).toHaveBeenCalledWith('skill_start', expect.any(Function));
      expect(onSocketEvent).toHaveBeenCalledWith('skill_step', expect.any(Function));
      expect(onSocketEvent).toHaveBeenCalledWith('skill_complete', expect.any(Function));
    });

    it('should unregister listeners on unmount', () => {
      const { unmount } = renderHook(() => useSkillSocket({ sessionId }));

      unmount();

      // Each event subscription should be cleaned up
      expect(unsubscribeCalls).toBe(3);
    });

    it('should not subscribe when sessionId is empty', async () => {
      const { onSocketEvent } = await import('@/lib/socket');

      renderHook(() => useSkillSocket({ sessionId: '' }));

      expect(onSocketEvent).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // skill_start Event Tests
  // ========================================================================

  describe('skill_start Event', () => {
    it('should update store when skill starts', () => {
      renderHook(() => useSkillSocket({ sessionId }));

      act(() => {
        socketHandlers['skill_start']?.({
          session_id: sessionId,
          agent_id: 'agent-456',
          message_id: 'msg-123',
          skill_name: 'Code Review',
          skill_slug: 'code-review',
          total_steps: 3,
        });
      });

      expect(mockStartExecution).toHaveBeenCalledWith(
        expect.objectContaining({
          skillSlug: 'code-review',
          skillName: 'Code Review',
          sessionId: sessionId,
          agentId: 'agent-456',
          status: 'running',
          totalSteps: 3,
        })
      );
    });

    it('should create execution with generated ID', () => {
      renderHook(() => useSkillSocket({ sessionId }));

      act(() => {
        socketHandlers['skill_start']?.({
          session_id: sessionId,
          agent_id: 'agent-456',
          message_id: 'msg-123',
          skill_name: 'Test Skill',
          skill_slug: 'test-skill',
          total_steps: 2,
        });
      });

      expect(mockStartExecution).toHaveBeenCalledWith(
        expect.objectContaining({
          id: expect.stringContaining('exec-test-skill-'),
        })
      );
    });

    it('should ignore events from different session', () => {
      renderHook(() => useSkillSocket({ sessionId }));

      act(() => {
        socketHandlers['skill_start']?.({
          session_id: 'different-session',
          agent_id: 'agent-456',
          message_id: 'msg-123',
          skill_name: 'Code Review',
          skill_slug: 'code-review',
          total_steps: 3,
        });
      });

      expect(mockStartExecution).not.toHaveBeenCalled();
    });

    it('should initialize execution with correct structure', () => {
      renderHook(() => useSkillSocket({ sessionId }));

      act(() => {
        socketHandlers['skill_start']?.({
          session_id: sessionId,
          agent_id: 'agent-456',
          message_id: 'msg-123',
          skill_name: 'Test Skill',
          skill_slug: 'test-skill',
          total_steps: 5,
        });
      });

      expect(mockStartExecution).toHaveBeenCalledWith(
        expect.objectContaining({
          currentStepIndex: 0,
          currentStepName: '',
          stepsCompleted: 0,
          results: [],
          startedAt: expect.any(Date),
        })
      );
    });
  });

  // ========================================================================
  // skill_step Event Tests
  // ========================================================================

  describe('skill_step Event', () => {
    it('should update store when step completes', () => {
      renderHook(() => useSkillSocket({ sessionId }));

      // First start a skill to establish the message_id mapping
      act(() => {
        socketHandlers['skill_start']?.({
          session_id: sessionId,
          agent_id: 'agent-456',
          message_id: 'msg-123',
          skill_name: 'Test Skill',
          skill_slug: 'test-skill',
          total_steps: 3,
        });
      });

      // Get the execution ID from the startExecution call
      const startCall = mockStartExecution.mock.calls[0];
      const executionId = startCall?.[0]?.id;

      act(() => {
        socketHandlers['skill_step']?.({
          session_id: sessionId,
          agent_id: 'agent-456',
          message_id: 'msg-123',
          step_name: 'analyze',
          step_index: 0,
          step_status: 'success',
        });
      });

      expect(mockUpdateExecutionStep).toHaveBeenCalledWith(
        sessionId,
        executionId,
        'analyze',
        0,
        'success'
      );
    });

    it('should ignore events from different session', () => {
      renderHook(() => useSkillSocket({ sessionId }));

      act(() => {
        socketHandlers['skill_step']?.({
          session_id: 'different-session',
          agent_id: 'agent-456',
          message_id: 'msg-123',
          step_name: 'analyze',
          step_index: 0,
          step_status: 'success',
        });
      });

      expect(mockUpdateExecutionStep).not.toHaveBeenCalled();
    });

    it('should ignore step events without prior skill_start', () => {
      renderHook(() => useSkillSocket({ sessionId }));

      act(() => {
        socketHandlers['skill_step']?.({
          session_id: sessionId,
          agent_id: 'agent-456',
          message_id: 'unknown-msg',
          step_name: 'analyze',
          step_index: 0,
          step_status: 'success',
        });
      });

      expect(mockUpdateExecutionStep).not.toHaveBeenCalled();
    });

    it('should handle failed step status', () => {
      renderHook(() => useSkillSocket({ sessionId }));

      act(() => {
        socketHandlers['skill_start']?.({
          session_id: sessionId,
          agent_id: 'agent-456',
          message_id: 'msg-123',
          skill_name: 'Test',
          skill_slug: 'test',
          total_steps: 2,
        });
      });

      const executionId = mockStartExecution.mock.calls[0]?.[0]?.id;

      act(() => {
        socketHandlers['skill_step']?.({
          session_id: sessionId,
          agent_id: 'agent-456',
          message_id: 'msg-123',
          step_name: 'build',
          step_index: 1,
          step_status: 'failed',
        });
      });

      expect(mockUpdateExecutionStep).toHaveBeenCalledWith(
        sessionId,
        executionId,
        'build',
        1,
        'failed'
      );
    });

    it('should handle skipped step status', () => {
      renderHook(() => useSkillSocket({ sessionId }));

      act(() => {
        socketHandlers['skill_start']?.({
          session_id: sessionId,
          agent_id: 'agent-456',
          message_id: 'msg-123',
          skill_name: 'Test',
          skill_slug: 'test',
          total_steps: 3,
        });
      });

      const executionId = mockStartExecution.mock.calls[0]?.[0]?.id;

      act(() => {
        socketHandlers['skill_step']?.({
          session_id: sessionId,
          agent_id: 'agent-456',
          message_id: 'msg-123',
          step_name: 'optional-lint',
          step_index: 2,
          step_status: 'skipped',
        });
      });

      expect(mockUpdateExecutionStep).toHaveBeenCalledWith(
        sessionId,
        executionId,
        'optional-lint',
        2,
        'skipped'
      );
    });

    it('should handle running step status', () => {
      renderHook(() => useSkillSocket({ sessionId }));

      act(() => {
        socketHandlers['skill_start']?.({
          session_id: sessionId,
          agent_id: 'agent-456',
          message_id: 'msg-123',
          skill_name: 'Test',
          skill_slug: 'test',
          total_steps: 2,
        });
      });

      const executionId = mockStartExecution.mock.calls[0]?.[0]?.id;

      act(() => {
        socketHandlers['skill_step']?.({
          session_id: sessionId,
          agent_id: 'agent-456',
          message_id: 'msg-123',
          step_name: 'processing',
          step_index: 0,
          step_status: 'running',
        });
      });

      expect(mockUpdateExecutionStep).toHaveBeenCalledWith(
        sessionId,
        executionId,
        'processing',
        0,
        'running'
      );
    });

    it('should handle error step status', () => {
      renderHook(() => useSkillSocket({ sessionId }));

      act(() => {
        socketHandlers['skill_start']?.({
          session_id: sessionId,
          agent_id: 'agent-456',
          message_id: 'msg-123',
          skill_name: 'Test',
          skill_slug: 'test',
          total_steps: 2,
        });
      });

      const executionId = mockStartExecution.mock.calls[0]?.[0]?.id;

      act(() => {
        socketHandlers['skill_step']?.({
          session_id: sessionId,
          agent_id: 'agent-456',
          message_id: 'msg-123',
          step_name: 'deploy',
          step_index: 1,
          step_status: 'error',
        });
      });

      expect(mockUpdateExecutionStep).toHaveBeenCalledWith(
        sessionId,
        executionId,
        'deploy',
        1,
        'error'
      );
    });
  });

  // ========================================================================
  // skill_complete Event Tests
  // ========================================================================

  describe('skill_complete Event', () => {
    it('should update store when skill completes successfully', () => {
      vi.useFakeTimers();

      renderHook(() => useSkillSocket({ sessionId }));

      act(() => {
        socketHandlers['skill_start']?.({
          session_id: sessionId,
          agent_id: 'agent-456',
          message_id: 'msg-123',
          skill_name: 'Test Skill',
          skill_slug: 'test-skill',
          total_steps: 2,
        });
      });

      const executionId = mockStartExecution.mock.calls[0]?.[0]?.id;

      act(() => {
        socketHandlers['skill_complete']?.({
          session_id: sessionId,
          agent_id: 'agent-456',
          message_id: 'msg-123',
          skill_name: 'Test Skill',
          skill_slug: 'test-skill',
          success: true,
          duration_ms: 5000,
        });
      });

      expect(mockCompleteExecution).toHaveBeenCalledWith(sessionId, executionId, true, 5000);

      vi.useRealTimers();
    });

    it('should update store when skill fails', () => {
      vi.useFakeTimers();

      renderHook(() => useSkillSocket({ sessionId }));

      act(() => {
        socketHandlers['skill_start']?.({
          session_id: sessionId,
          agent_id: 'agent-456',
          message_id: 'msg-123',
          skill_name: 'Test Skill',
          skill_slug: 'test-skill',
          total_steps: 2,
        });
      });

      const executionId = mockStartExecution.mock.calls[0]?.[0]?.id;

      act(() => {
        socketHandlers['skill_complete']?.({
          session_id: sessionId,
          agent_id: 'agent-456',
          message_id: 'msg-123',
          skill_name: 'Test Skill',
          skill_slug: 'test-skill',
          success: false,
          duration_ms: 3000,
        });
      });

      expect(mockCompleteExecution).toHaveBeenCalledWith(sessionId, executionId, false, 3000);

      vi.useRealTimers();
    });

    it('should ignore events from different session', () => {
      renderHook(() => useSkillSocket({ sessionId }));

      act(() => {
        socketHandlers['skill_complete']?.({
          session_id: 'different-session',
          agent_id: 'agent-456',
          message_id: 'msg-123',
          skill_name: 'Test',
          skill_slug: 'test',
          success: true,
          duration_ms: 1000,
        });
      });

      expect(mockCompleteExecution).not.toHaveBeenCalled();
    });

    it('should ignore complete events without prior skill_start', () => {
      renderHook(() => useSkillSocket({ sessionId }));

      act(() => {
        socketHandlers['skill_complete']?.({
          session_id: sessionId,
          agent_id: 'agent-456',
          message_id: 'unknown-msg',
          skill_name: 'Test',
          skill_slug: 'test',
          success: true,
          duration_ms: 1000,
        });
      });

      expect(mockCompleteExecution).not.toHaveBeenCalled();
    });

    it('should clean up message mapping after completion', () => {
      vi.useFakeTimers();

      renderHook(() => useSkillSocket({ sessionId }));

      // Start skill
      act(() => {
        socketHandlers['skill_start']?.({
          session_id: sessionId,
          agent_id: 'agent-456',
          message_id: 'msg-123',
          skill_name: 'Test',
          skill_slug: 'test',
          total_steps: 1,
        });
      });

      // Complete skill
      act(() => {
        socketHandlers['skill_complete']?.({
          session_id: sessionId,
          agent_id: 'agent-456',
          message_id: 'msg-123',
          skill_name: 'Test',
          skill_slug: 'test',
          success: true,
          duration_ms: 1000,
        });
      });

      // Advance timers past the cleanup delay (5000ms)
      act(() => {
        vi.advanceTimersByTime(6000);
      });

      // Reset mock
      mockCompleteExecution.mockClear();

      // Try to complete again with same message_id - should be ignored
      act(() => {
        socketHandlers['skill_complete']?.({
          session_id: sessionId,
          agent_id: 'agent-456',
          message_id: 'msg-123',
          skill_name: 'Test',
          skill_slug: 'test',
          success: true,
          duration_ms: 2000,
        });
      });

      expect(mockCompleteExecution).not.toHaveBeenCalled();

      vi.useRealTimers();
    });
  });

  // ========================================================================
  // Session Changes Tests
  // ========================================================================

  describe('Session Changes', () => {
    it('should re-register listeners when sessionId changes', async () => {
      const { onSocketEvent } = await import('@/lib/socket');

      const { rerender } = renderHook(({ sid }) => useSkillSocket({ sessionId: sid }), {
        initialProps: { sid: 'session-1' },
      });

      // Initial subscriptions
      expect(onSocketEvent).toHaveBeenCalledTimes(3);

      rerender({ sid: 'session-2' });

      // Should have unregistered old and registered new
      expect(unsubscribeCalls).toBe(3);
      expect(onSocketEvent).toHaveBeenCalledTimes(6);
    });

    it('should process events with new sessionId after change', () => {
      const { rerender } = renderHook(({ sid }) => useSkillSocket({ sessionId: sid }), {
        initialProps: { sid: 'session-1' },
      });

      // Change session
      rerender({ sid: 'session-2' });

      // Event for new session should be processed
      act(() => {
        socketHandlers['skill_start']?.({
          session_id: 'session-2',
          agent_id: 'agent-456',
          message_id: 'msg-123',
          skill_name: 'Test',
          skill_slug: 'test',
          total_steps: 1,
        });
      });

      expect(mockStartExecution).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'session-2',
        })
      );
    });
  });

  // ========================================================================
  // Full Workflow Tests
  // ========================================================================

  describe('Full Workflow', () => {
    it('should handle complete skill execution flow', () => {
      vi.useFakeTimers();

      renderHook(() => useSkillSocket({ sessionId }));

      // 1. Start skill
      act(() => {
        socketHandlers['skill_start']?.({
          session_id: sessionId,
          agent_id: 'agent-456',
          message_id: 'msg-123',
          skill_name: 'Code Review',
          skill_slug: 'code-review',
          total_steps: 3,
        });
      });

      expect(mockStartExecution).toHaveBeenCalledTimes(1);
      const executionId = mockStartExecution.mock.calls[0]?.[0]?.id;

      // 2. First step completes
      act(() => {
        socketHandlers['skill_step']?.({
          session_id: sessionId,
          agent_id: 'agent-456',
          message_id: 'msg-123',
          step_name: 'analyze',
          step_index: 0,
          step_status: 'success',
        });
      });

      expect(mockUpdateExecutionStep).toHaveBeenCalledWith(
        sessionId,
        executionId,
        'analyze',
        0,
        'success'
      );

      // 3. Second step completes
      act(() => {
        socketHandlers['skill_step']?.({
          session_id: sessionId,
          agent_id: 'agent-456',
          message_id: 'msg-123',
          step_name: 'generate-report',
          step_index: 1,
          step_status: 'success',
        });
      });

      expect(mockUpdateExecutionStep).toHaveBeenCalledWith(
        sessionId,
        executionId,
        'generate-report',
        1,
        'success'
      );

      // 4. Third step completes
      act(() => {
        socketHandlers['skill_step']?.({
          session_id: sessionId,
          agent_id: 'agent-456',
          message_id: 'msg-123',
          step_name: 'save-results',
          step_index: 2,
          step_status: 'success',
        });
      });

      // 5. Skill completes
      act(() => {
        socketHandlers['skill_complete']?.({
          session_id: sessionId,
          agent_id: 'agent-456',
          message_id: 'msg-123',
          skill_name: 'Code Review',
          skill_slug: 'code-review',
          success: true,
          duration_ms: 10000,
        });
      });

      expect(mockCompleteExecution).toHaveBeenCalledWith(sessionId, executionId, true, 10000);

      vi.useRealTimers();
    });

    it('should handle multiple concurrent skill executions', () => {
      vi.useFakeTimers();

      renderHook(() => useSkillSocket({ sessionId }));

      // Start first skill
      act(() => {
        socketHandlers['skill_start']?.({
          session_id: sessionId,
          agent_id: 'agent-456',
          message_id: 'msg-1',
          skill_name: 'Skill One',
          skill_slug: 'skill-one',
          total_steps: 2,
        });
      });

      const executionId1 = mockStartExecution.mock.calls[0]?.[0]?.id;

      // Start second skill
      act(() => {
        socketHandlers['skill_start']?.({
          session_id: sessionId,
          agent_id: 'agent-789',
          message_id: 'msg-2',
          skill_name: 'Skill Two',
          skill_slug: 'skill-two',
          total_steps: 1,
        });
      });

      const executionId2 = mockStartExecution.mock.calls[1]?.[0]?.id;

      // Step for first skill
      act(() => {
        socketHandlers['skill_step']?.({
          session_id: sessionId,
          agent_id: 'agent-456',
          message_id: 'msg-1',
          step_name: 'step-1',
          step_index: 0,
          step_status: 'success',
        });
      });

      expect(mockUpdateExecutionStep).toHaveBeenCalledWith(
        sessionId,
        executionId1,
        'step-1',
        0,
        'success'
      );

      // Complete second skill
      act(() => {
        socketHandlers['skill_complete']?.({
          session_id: sessionId,
          agent_id: 'agent-789',
          message_id: 'msg-2',
          skill_name: 'Skill Two',
          skill_slug: 'skill-two',
          success: true,
          duration_ms: 500,
        });
      });

      expect(mockCompleteExecution).toHaveBeenCalledWith(sessionId, executionId2, true, 500);

      // Complete first skill
      act(() => {
        socketHandlers['skill_complete']?.({
          session_id: sessionId,
          agent_id: 'agent-456',
          message_id: 'msg-1',
          skill_name: 'Skill One',
          skill_slug: 'skill-one',
          success: true,
          duration_ms: 2000,
        });
      });

      expect(mockCompleteExecution).toHaveBeenCalledWith(sessionId, executionId1, true, 2000);

      vi.useRealTimers();
    });

    it('should handle skill failure mid-execution', () => {
      vi.useFakeTimers();

      renderHook(() => useSkillSocket({ sessionId }));

      // Start skill
      act(() => {
        socketHandlers['skill_start']?.({
          session_id: sessionId,
          agent_id: 'agent-456',
          message_id: 'msg-123',
          skill_name: 'Build',
          skill_slug: 'build',
          total_steps: 3,
        });
      });

      const executionId = mockStartExecution.mock.calls[0]?.[0]?.id;

      // First step succeeds
      act(() => {
        socketHandlers['skill_step']?.({
          session_id: sessionId,
          agent_id: 'agent-456',
          message_id: 'msg-123',
          step_name: 'compile',
          step_index: 0,
          step_status: 'success',
        });
      });

      // Second step fails
      act(() => {
        socketHandlers['skill_step']?.({
          session_id: sessionId,
          agent_id: 'agent-456',
          message_id: 'msg-123',
          step_name: 'test',
          step_index: 1,
          step_status: 'failed',
        });
      });

      expect(mockUpdateExecutionStep).toHaveBeenCalledWith(
        sessionId,
        executionId,
        'test',
        1,
        'failed'
      );

      // Skill completes with failure
      act(() => {
        socketHandlers['skill_complete']?.({
          session_id: sessionId,
          agent_id: 'agent-456',
          message_id: 'msg-123',
          skill_name: 'Build',
          skill_slug: 'build',
          success: false,
          duration_ms: 3000,
        });
      });

      expect(mockCompleteExecution).toHaveBeenCalledWith(sessionId, executionId, false, 3000);

      vi.useRealTimers();
    });
  });

  // ========================================================================
  // Edge Cases Tests
  // ========================================================================

  describe('Edge Cases', () => {
    it('should handle missing fields in event data gracefully', () => {
      renderHook(() => useSkillSocket({ sessionId }));

      // Start with minimal data
      act(() => {
        socketHandlers['skill_start']?.({
          session_id: sessionId,
          agent_id: 'agent-456',
          message_id: 'msg-123',
          skill_name: 'Test',
          skill_slug: 'test',
          total_steps: 1,
        });
      });

      expect(mockStartExecution).toHaveBeenCalled();
    });

    it('should handle events in wrong order gracefully', () => {
      vi.useFakeTimers();

      renderHook(() => useSkillSocket({ sessionId }));

      // Complete before start - should be ignored
      act(() => {
        socketHandlers['skill_complete']?.({
          session_id: sessionId,
          agent_id: 'agent-456',
          message_id: 'msg-123',
          skill_name: 'Test',
          skill_slug: 'test',
          success: true,
          duration_ms: 1000,
        });
      });

      expect(mockCompleteExecution).not.toHaveBeenCalled();

      // Step before start - should be ignored
      act(() => {
        socketHandlers['skill_step']?.({
          session_id: sessionId,
          agent_id: 'agent-456',
          message_id: 'msg-123',
          step_name: 'step-1',
          step_index: 0,
          step_status: 'success',
        });
      });

      expect(mockUpdateExecutionStep).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('should handle rapid successive events', () => {
      vi.useFakeTimers();

      renderHook(() => useSkillSocket({ sessionId }));

      // Rapid fire events
      for (let i = 0; i < 10; i++) {
        act(() => {
          socketHandlers['skill_start']?.({
            session_id: sessionId,
            agent_id: `agent-${i}`,
            message_id: `msg-${i}`,
            skill_name: `Skill ${i}`,
            skill_slug: `skill-${i}`,
            total_steps: 1,
          });
        });
      }

      expect(mockStartExecution).toHaveBeenCalledTimes(10);

      vi.useRealTimers();
    });
  });

  // ========================================================================
  // Cleanup Tests
  // ========================================================================

  describe('Cleanup', () => {
    it('should remove all listeners on unmount', () => {
      const { unmount } = renderHook(() => useSkillSocket({ sessionId }));

      unmount();

      // All 3 event subscriptions should be cleaned up
      expect(unsubscribeCalls).toBe(3);
    });

    it('should clear handlers after unmount', () => {
      const { unmount } = renderHook(() => useSkillSocket({ sessionId }));

      // Handlers are registered
      expect(socketHandlers['skill_start']).toBeDefined();
      expect(socketHandlers['skill_step']).toBeDefined();
      expect(socketHandlers['skill_complete']).toBeDefined();

      unmount();

      // Handlers should be cleared after unmount
      expect(socketHandlers['skill_start']).toBeUndefined();
      expect(socketHandlers['skill_step']).toBeUndefined();
      expect(socketHandlers['skill_complete']).toBeUndefined();
    });
  });
});
