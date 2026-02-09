/**
 * Comprehensive tests for useWorktreeSocket hook
 * Tests WebSocket event handling for worktree operations
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useWorktreeSocket } from '../useWorktreeSocket';
import * as socketLib from '@/lib/socket';
import { useWorktreesStore, type Worktree } from '@/stores/worktrees';

// Track socket event handlers
const socketHandlers: Record<string, (event: unknown) => void> = {};

// Mock socket library
vi.mock('@/lib/socket', () => ({
  onSocketEvent: vi.fn((event: string, handler: (data: unknown) => void) => {
    socketHandlers[event] = handler;
    return () => {
      delete socketHandlers[event];
    };
  }),
}));

// Create mock store functions
const mockAddWorktree = vi.fn();
const mockUpdateWorktreeStatus = vi.fn();
const mockRemoveWorktree = vi.fn();
const mockSetOperating = vi.fn();

vi.mock('@/stores/worktrees', () => ({
  useWorktreesStore: vi.fn((selector) => {
    const mockState = {
      addWorktree: mockAddWorktree,
      updateWorktreeStatus: mockUpdateWorktreeStatus,
      removeWorktree: mockRemoveWorktree,
      setOperating: mockSetOperating,
    };
    if (typeof selector === 'function') {
      return selector(mockState);
    }
    return mockState;
  }),
}));

// Mock useStoreCallbacks
vi.mock('../useStoreCallbacks', () => ({
  useStoreCallbacks: vi.fn((callbacks) => ({
    current: callbacks,
  })),
}));

// Helper to trigger socket events
const triggerSocketEvent = (event: string, data: unknown) => {
  if (socketHandlers[event]) {
    socketHandlers[event](data);
  }
};

// Helper to clear socket handlers
const clearSocketHandlers = () => {
  Object.keys(socketHandlers).forEach((key) => delete socketHandlers[key]);
};

describe('useWorktreeSocket', () => {
  const sessionId = 'session-123';

  beforeEach(() => {
    vi.clearAllMocks();
    clearSocketHandlers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ========================================
  // Initialization Tests
  // ========================================

  describe('Initialization', () => {
    it('should not subscribe to events when sessionId is empty', () => {
      renderHook(() => useWorktreeSocket({ sessionId: '' }));

      expect(socketLib.onSocketEvent).not.toHaveBeenCalled();
    });

    it('should subscribe to worktree_created event', () => {
      renderHook(() => useWorktreeSocket({ sessionId }));

      expect(socketLib.onSocketEvent).toHaveBeenCalledWith(
        'worktree_created',
        expect.any(Function)
      );
    });

    it('should subscribe to worktree_status_changed event', () => {
      renderHook(() => useWorktreeSocket({ sessionId }));

      expect(socketLib.onSocketEvent).toHaveBeenCalledWith(
        'worktree_status_changed',
        expect.any(Function)
      );
    });

    it('should subscribe to worktree_conflict_detected event', () => {
      renderHook(() => useWorktreeSocket({ sessionId }));

      expect(socketLib.onSocketEvent).toHaveBeenCalledWith(
        'worktree_conflict_detected',
        expect.any(Function)
      );
    });

    it('should subscribe to worktree_merged event', () => {
      renderHook(() => useWorktreeSocket({ sessionId }));

      expect(socketLib.onSocketEvent).toHaveBeenCalledWith('worktree_merged', expect.any(Function));
    });

    it('should subscribe to worktree_deleted event', () => {
      renderHook(() => useWorktreeSocket({ sessionId }));

      expect(socketLib.onSocketEvent).toHaveBeenCalledWith(
        'worktree_deleted',
        expect.any(Function)
      );
    });

    it('should subscribe to all 5 worktree events', () => {
      renderHook(() => useWorktreeSocket({ sessionId }));

      expect(socketLib.onSocketEvent).toHaveBeenCalledTimes(5);
    });
  });

  // ========================================
  // Worktree Created Event Tests
  // ========================================

  describe('worktree_created Event', () => {
    it('should add worktree to store on creation event', () => {
      renderHook(() => useWorktreeSocket({ sessionId }));

      const event = {
        session_id: sessionId,
        worktree: {
          id: 'wt-1',
          agent_id: 'agent-1',
          session_id: sessionId,
          worktree_path: '/workspaces/feature-branch',
          branch_name: 'feature/test',
          status: 'active',
          created_at: '2024-01-15T10:00:00Z',
        },
      };

      triggerSocketEvent('worktree_created', event);

      expect(mockAddWorktree).toHaveBeenCalledWith(
        sessionId,
        expect.objectContaining({
          id: 'wt-1',
          agentId: 'agent-1',
          sessionId: sessionId,
          worktreePath: '/workspaces/feature-branch',
          branchName: 'feature/test',
          status: 'active',
          mergedAt: null,
        })
      );
    });

    it('should convert created_at to Date object', () => {
      renderHook(() => useWorktreeSocket({ sessionId }));

      const event = {
        session_id: sessionId,
        worktree: {
          id: 'wt-1',
          agent_id: 'agent-1',
          session_id: sessionId,
          worktree_path: '/path',
          branch_name: 'branch',
          status: 'active',
          created_at: '2024-01-15T10:00:00Z',
        },
      };

      triggerSocketEvent('worktree_created', event);

      expect(mockAddWorktree).toHaveBeenCalledWith(
        sessionId,
        expect.objectContaining({
          createdAt: expect.any(Date),
        })
      );
    });

    it('should ignore worktree_created from different session', () => {
      renderHook(() => useWorktreeSocket({ sessionId }));

      const event = {
        session_id: 'different-session',
        worktree: {
          id: 'wt-1',
          agent_id: 'agent-1',
          session_id: 'different-session',
          worktree_path: '/path',
          branch_name: 'branch',
          status: 'active',
          created_at: '2024-01-15T10:00:00Z',
        },
      };

      triggerSocketEvent('worktree_created', event);

      expect(mockAddWorktree).not.toHaveBeenCalled();
    });

    it('should handle various worktree statuses on creation', () => {
      renderHook(() => useWorktreeSocket({ sessionId }));

      const statuses = ['creating', 'active', 'merging'];

      statuses.forEach((status, index) => {
        const event = {
          session_id: sessionId,
          worktree: {
            id: `wt-${index}`,
            agent_id: 'agent-1',
            session_id: sessionId,
            worktree_path: '/path',
            branch_name: 'branch',
            status,
            created_at: '2024-01-15T10:00:00Z',
          },
        };

        triggerSocketEvent('worktree_created', event);
      });

      expect(mockAddWorktree).toHaveBeenCalledTimes(3);
    });
  });

  // ========================================
  // Worktree Status Changed Event Tests
  // ========================================

  describe('worktree_status_changed Event', () => {
    it('should update worktree status', () => {
      renderHook(() => useWorktreeSocket({ sessionId }));

      const event = {
        session_id: sessionId,
        worktree_id: 'wt-1',
        agent_id: 'agent-1',
        old_status: 'creating',
        new_status: 'active',
      };

      triggerSocketEvent('worktree_status_changed', event);

      expect(mockUpdateWorktreeStatus).toHaveBeenCalledWith(sessionId, 'wt-1', 'active');
    });

    it('should ignore status change from different session', () => {
      renderHook(() => useWorktreeSocket({ sessionId }));

      const event = {
        session_id: 'different-session',
        worktree_id: 'wt-1',
        agent_id: 'agent-1',
        old_status: 'active',
        new_status: 'merging',
      };

      triggerSocketEvent('worktree_status_changed', event);

      expect(mockUpdateWorktreeStatus).not.toHaveBeenCalled();
    });

    it('should handle all valid status transitions', () => {
      renderHook(() => useWorktreeSocket({ sessionId }));

      const statusTransitions = [
        { old_status: 'creating', new_status: 'active' },
        { old_status: 'active', new_status: 'merging' },
        { old_status: 'merging', new_status: 'merged' },
        { old_status: 'active', new_status: 'conflict' },
        { old_status: 'conflict', new_status: 'cleanup' },
      ];

      statusTransitions.forEach(({ old_status, new_status }, index) => {
        const event = {
          session_id: sessionId,
          worktree_id: `wt-${index}`,
          agent_id: 'agent-1',
          old_status,
          new_status,
        };

        triggerSocketEvent('worktree_status_changed', event);
      });

      expect(mockUpdateWorktreeStatus).toHaveBeenCalledTimes(5);
    });
  });

  // ========================================
  // Worktree Conflict Detected Event Tests
  // ========================================

  describe('worktree_conflict_detected Event', () => {
    it('should update worktree status to conflict', () => {
      renderHook(() => useWorktreeSocket({ sessionId }));

      const event = {
        session_id: sessionId,
        worktree_id: 'wt-1',
        agent_id: 'agent-1',
        conflicting_files: ['file1.ts', 'file2.ts'],
      };

      triggerSocketEvent('worktree_conflict_detected', event);

      expect(mockUpdateWorktreeStatus).toHaveBeenCalledWith(sessionId, 'wt-1', 'conflict');
    });

    it('should ignore conflict from different session', () => {
      renderHook(() => useWorktreeSocket({ sessionId }));

      const event = {
        session_id: 'different-session',
        worktree_id: 'wt-1',
        agent_id: 'agent-1',
        conflicting_files: ['file1.ts'],
      };

      triggerSocketEvent('worktree_conflict_detected', event);

      expect(mockUpdateWorktreeStatus).not.toHaveBeenCalled();
    });

    it('should handle empty conflicting files array', () => {
      renderHook(() => useWorktreeSocket({ sessionId }));

      const event = {
        session_id: sessionId,
        worktree_id: 'wt-1',
        agent_id: 'agent-1',
        conflicting_files: [],
      };

      triggerSocketEvent('worktree_conflict_detected', event);

      expect(mockUpdateWorktreeStatus).toHaveBeenCalledWith(sessionId, 'wt-1', 'conflict');
    });

    it('should handle many conflicting files', () => {
      renderHook(() => useWorktreeSocket({ sessionId }));

      const conflictingFiles = Array.from({ length: 100 }, (_, i) => `file${i}.ts`);

      const event = {
        session_id: sessionId,
        worktree_id: 'wt-1',
        agent_id: 'agent-1',
        conflicting_files: conflictingFiles,
      };

      triggerSocketEvent('worktree_conflict_detected', event);

      expect(mockUpdateWorktreeStatus).toHaveBeenCalledWith(sessionId, 'wt-1', 'conflict');
    });
  });

  // ========================================
  // Worktree Merged Event Tests
  // ========================================

  describe('worktree_merged Event', () => {
    it('should update worktree status to merged on success', () => {
      renderHook(() => useWorktreeSocket({ sessionId }));

      const event = {
        session_id: sessionId,
        worktree_id: 'wt-1',
        agent_id: 'agent-1',
        merge_result: {
          success: true,
          message: 'Merge successful',
        },
      };

      triggerSocketEvent('worktree_merged', event);

      expect(mockUpdateWorktreeStatus).toHaveBeenCalledWith(sessionId, 'wt-1', 'merged');
    });

    it('should update worktree status to failed on merge failure', () => {
      renderHook(() => useWorktreeSocket({ sessionId }));

      const event = {
        session_id: sessionId,
        worktree_id: 'wt-1',
        agent_id: 'agent-1',
        merge_result: {
          success: false,
          message: 'Merge conflict',
        },
      };

      triggerSocketEvent('worktree_merged', event);

      expect(mockUpdateWorktreeStatus).toHaveBeenCalledWith(sessionId, 'wt-1', 'failed');
    });

    it('should clear operating state after merge', () => {
      renderHook(() => useWorktreeSocket({ sessionId }));

      const event = {
        session_id: sessionId,
        worktree_id: 'wt-1',
        agent_id: 'agent-1',
        merge_result: {
          success: true,
          message: 'Done',
        },
      };

      triggerSocketEvent('worktree_merged', event);

      expect(mockSetOperating).toHaveBeenCalledWith(null);
    });

    it('should clear operating state on merge failure too', () => {
      renderHook(() => useWorktreeSocket({ sessionId }));

      const event = {
        session_id: sessionId,
        worktree_id: 'wt-1',
        agent_id: 'agent-1',
        merge_result: {
          success: false,
          message: 'Failed',
        },
      };

      triggerSocketEvent('worktree_merged', event);

      expect(mockSetOperating).toHaveBeenCalledWith(null);
    });

    it('should ignore merge from different session', () => {
      renderHook(() => useWorktreeSocket({ sessionId }));

      const event = {
        session_id: 'different-session',
        worktree_id: 'wt-1',
        agent_id: 'agent-1',
        merge_result: {
          success: true,
          message: 'Done',
        },
      };

      triggerSocketEvent('worktree_merged', event);

      expect(mockUpdateWorktreeStatus).not.toHaveBeenCalled();
      expect(mockSetOperating).not.toHaveBeenCalled();
    });
  });

  // ========================================
  // Worktree Deleted Event Tests
  // ========================================

  describe('worktree_deleted Event', () => {
    it('should remove worktree from store', () => {
      renderHook(() => useWorktreeSocket({ sessionId }));

      const event = {
        session_id: sessionId,
        worktree_id: 'wt-1',
        agent_id: 'agent-1',
      };

      triggerSocketEvent('worktree_deleted', event);

      expect(mockRemoveWorktree).toHaveBeenCalledWith(sessionId, 'wt-1');
    });

    it('should ignore delete from different session', () => {
      renderHook(() => useWorktreeSocket({ sessionId }));

      const event = {
        session_id: 'different-session',
        worktree_id: 'wt-1',
        agent_id: 'agent-1',
      };

      triggerSocketEvent('worktree_deleted', event);

      expect(mockRemoveWorktree).not.toHaveBeenCalled();
    });
  });

  // ========================================
  // Session Change Tests
  // ========================================

  describe('Session Changes', () => {
    it('should resubscribe when sessionId changes', () => {
      const { rerender } = renderHook(({ sessionId }) => useWorktreeSocket({ sessionId }), {
        initialProps: { sessionId: 'session-1' },
      });

      expect(socketLib.onSocketEvent).toHaveBeenCalledTimes(5);

      // Change session
      rerender({ sessionId: 'session-2' });

      // Should have subscribed again
      expect(socketLib.onSocketEvent).toHaveBeenCalledTimes(10);
    });

    it('should filter events by new sessionId after change', () => {
      const { rerender } = renderHook(({ sessionId }) => useWorktreeSocket({ sessionId }), {
        initialProps: { sessionId: 'session-1' },
      });

      // Change session
      rerender({ sessionId: 'session-2' });

      // Event for old session should be ignored
      const event = {
        session_id: 'session-1',
        worktree_id: 'wt-1',
        agent_id: 'agent-1',
      };

      triggerSocketEvent('worktree_deleted', event);

      expect(mockRemoveWorktree).not.toHaveBeenCalled();
    });
  });

  // ========================================
  // Cleanup Tests
  // ========================================

  describe('Cleanup', () => {
    it('should unsubscribe all handlers on unmount', () => {
      const { unmount } = renderHook(() => useWorktreeSocket({ sessionId }));

      // Verify handlers are registered
      expect(socketHandlers['worktree_created']).toBeDefined();
      expect(socketHandlers['worktree_status_changed']).toBeDefined();
      expect(socketHandlers['worktree_conflict_detected']).toBeDefined();
      expect(socketHandlers['worktree_merged']).toBeDefined();
      expect(socketHandlers['worktree_deleted']).toBeDefined();

      unmount();

      // Verify handlers are cleaned up
      expect(socketHandlers['worktree_created']).toBeUndefined();
      expect(socketHandlers['worktree_status_changed']).toBeUndefined();
      expect(socketHandlers['worktree_conflict_detected']).toBeUndefined();
      expect(socketHandlers['worktree_merged']).toBeUndefined();
      expect(socketHandlers['worktree_deleted']).toBeUndefined();
    });

    it('should not process events after unmount', () => {
      const { unmount } = renderHook(() => useWorktreeSocket({ sessionId }));

      unmount();

      // These should not throw or call store methods
      expect(() => {
        triggerSocketEvent('worktree_created', {
          session_id: sessionId,
          worktree: {
            id: 'wt-1',
            agent_id: 'agent-1',
            session_id: sessionId,
            worktree_path: '/path',
            branch_name: 'branch',
            status: 'active',
            created_at: '2024-01-15T10:00:00Z',
          },
        });
      }).not.toThrow();

      expect(mockAddWorktree).not.toHaveBeenCalled();
    });
  });

  // ========================================
  // Multiple Events Tests
  // ========================================

  describe('Multiple Events', () => {
    it('should handle rapid sequential events', () => {
      renderHook(() => useWorktreeSocket({ sessionId }));

      // Create
      triggerSocketEvent('worktree_created', {
        session_id: sessionId,
        worktree: {
          id: 'wt-1',
          agent_id: 'agent-1',
          session_id: sessionId,
          worktree_path: '/path',
          branch_name: 'branch',
          status: 'creating',
          created_at: '2024-01-15T10:00:00Z',
        },
      });

      // Status change
      triggerSocketEvent('worktree_status_changed', {
        session_id: sessionId,
        worktree_id: 'wt-1',
        agent_id: 'agent-1',
        old_status: 'creating',
        new_status: 'active',
      });

      // Merge
      triggerSocketEvent('worktree_merged', {
        session_id: sessionId,
        worktree_id: 'wt-1',
        agent_id: 'agent-1',
        merge_result: { success: true, message: 'Done' },
      });

      // Delete
      triggerSocketEvent('worktree_deleted', {
        session_id: sessionId,
        worktree_id: 'wt-1',
        agent_id: 'agent-1',
      });

      expect(mockAddWorktree).toHaveBeenCalledTimes(1);
      expect(mockUpdateWorktreeStatus).toHaveBeenCalledTimes(2); // status change + merge
      expect(mockSetOperating).toHaveBeenCalledTimes(1);
      expect(mockRemoveWorktree).toHaveBeenCalledTimes(1);
    });

    it('should handle events for multiple worktrees', () => {
      renderHook(() => useWorktreeSocket({ sessionId }));

      // Create multiple worktrees
      for (let i = 0; i < 5; i++) {
        triggerSocketEvent('worktree_created', {
          session_id: sessionId,
          worktree: {
            id: `wt-${i}`,
            agent_id: `agent-${i}`,
            session_id: sessionId,
            worktree_path: `/path/${i}`,
            branch_name: `branch-${i}`,
            status: 'active',
            created_at: '2024-01-15T10:00:00Z',
          },
        });
      }

      expect(mockAddWorktree).toHaveBeenCalledTimes(5);
    });
  });

  // ========================================
  // Edge Cases
  // ========================================

  describe('Edge Cases', () => {
    it('should handle event with minimal data', () => {
      renderHook(() => useWorktreeSocket({ sessionId }));

      const event = {
        session_id: sessionId,
        worktree: {
          id: 'wt-1',
          agent_id: 'agent-1',
          session_id: sessionId,
          worktree_path: '',
          branch_name: '',
          status: 'creating',
          created_at: '2024-01-15T10:00:00Z',
        },
      };

      triggerSocketEvent('worktree_created', event);

      expect(mockAddWorktree).toHaveBeenCalled();
    });

    it('should handle status with special characters', () => {
      renderHook(() => useWorktreeSocket({ sessionId }));

      const event = {
        session_id: sessionId,
        worktree_id: 'wt-1',
        agent_id: 'agent-1',
        old_status: 'active',
        new_status: 'conflict',
      };

      triggerSocketEvent('worktree_status_changed', event);

      expect(mockUpdateWorktreeStatus).toHaveBeenCalledWith(sessionId, 'wt-1', 'conflict');
    });

    it('should handle long path names', () => {
      renderHook(() => useWorktreeSocket({ sessionId }));

      const longPath = '/workspaces/' + 'a'.repeat(500);

      const event = {
        session_id: sessionId,
        worktree: {
          id: 'wt-1',
          agent_id: 'agent-1',
          session_id: sessionId,
          worktree_path: longPath,
          branch_name: 'feature/very-long-branch-name-that-exceeds-normal-limits',
          status: 'active',
          created_at: '2024-01-15T10:00:00Z',
        },
      };

      triggerSocketEvent('worktree_created', event);

      expect(mockAddWorktree).toHaveBeenCalledWith(
        sessionId,
        expect.objectContaining({
          worktreePath: longPath,
        })
      );
    });

    it('should handle unicode characters in branch names', () => {
      renderHook(() => useWorktreeSocket({ sessionId }));

      const event = {
        session_id: sessionId,
        worktree: {
          id: 'wt-1',
          agent_id: 'agent-1',
          session_id: sessionId,
          worktree_path: '/path',
          branch_name: 'feature/test-\u{1F600}-emoji',
          status: 'active',
          created_at: '2024-01-15T10:00:00Z',
        },
      };

      triggerSocketEvent('worktree_created', event);

      expect(mockAddWorktree).toHaveBeenCalledWith(
        sessionId,
        expect.objectContaining({
          branchName: 'feature/test-\u{1F600}-emoji',
        })
      );
    });
  });
});
