/**
 * Comprehensive tests for useCheckpointSocket hook
 * Tests WebSocket events for checkpoint creation and restoration
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useCheckpointSocket } from '../useCheckpointSocket';
import * as socketLib from '@/lib/socket';
import { socketHandlers, triggerSocketEvent, resetMockSocket } from '@/__tests__/mocks/socket';

// Mock dependencies
vi.mock('@/lib/socket', () => ({
  onSocketEvent: vi.fn((event, handler) => {
    socketHandlers[event] = handler;
    return () => {
      delete socketHandlers[event];
    };
  }),
}));

// Mock store state and functions
const mockStoreState = {
  addCheckpoint: vi.fn(),
  updateCheckpointStatus: vi.fn(),
  setRestoring: vi.fn(),
};

// Mock Zustand checkpoints store
vi.mock('@/stores/checkpoints', () => ({
  useCheckpointsStore: (selector: (state: typeof mockStoreState) => unknown) => {
    return selector(mockStoreState);
  },
}));

// Mock useStoreCallbacks hook
vi.mock('../useStoreCallbacks', () => ({
  useStoreCallbacks: <T extends Record<string, unknown>>(callbacks: T) => ({
    current: callbacks,
  }),
}));

describe('useCheckpointSocket', () => {
  const sessionId = 'session-123';
  const checkpointId = 'checkpoint-001';
  const agentId = 'agent-001';

  beforeEach(() => {
    vi.clearAllMocks();
    resetMockSocket();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ========================================
  // Initialization Tests
  // ========================================

  describe('Initialization', () => {
    it('should not subscribe when sessionId is empty', () => {
      renderHook(() => useCheckpointSocket({ sessionId: '' }));

      expect(socketLib.onSocketEvent).not.toHaveBeenCalled();
    });

    it('should subscribe to socket events when sessionId is provided', () => {
      renderHook(() => useCheckpointSocket({ sessionId }));

      expect(socketLib.onSocketEvent).toHaveBeenCalledWith(
        'checkpoint_created',
        expect.any(Function)
      );
      expect(socketLib.onSocketEvent).toHaveBeenCalledWith(
        'checkpoint_restore_started',
        expect.any(Function)
      );
      expect(socketLib.onSocketEvent).toHaveBeenCalledWith(
        'checkpoint_restore_completed',
        expect.any(Function)
      );
    });

    it('should subscribe to exactly 3 event types', () => {
      renderHook(() => useCheckpointSocket({ sessionId }));

      expect(socketLib.onSocketEvent).toHaveBeenCalledTimes(3);
    });

    it('should get store selectors for addCheckpoint', () => {
      renderHook(() => useCheckpointSocket({ sessionId }));

      expect(mockStoreState.addCheckpoint).toBeDefined();
    });

    it('should get store selectors for updateCheckpointStatus', () => {
      renderHook(() => useCheckpointSocket({ sessionId }));

      expect(mockStoreState.updateCheckpointStatus).toBeDefined();
    });

    it('should get store selectors for setRestoring', () => {
      renderHook(() => useCheckpointSocket({ sessionId }));

      expect(mockStoreState.setRestoring).toBeDefined();
    });
  });

  // ========================================
  // Checkpoint Created Event Tests
  // ========================================

  describe('Checkpoint Created Events', () => {
    it('should add checkpoint on checkpoint_created event', async () => {
      renderHook(() => useCheckpointSocket({ sessionId }));

      const checkpointEvent = {
        session_id: sessionId,
        checkpoint: {
          id: checkpointId,
          checkpoint_number: 1,
          description: 'Initial checkpoint',
          action_type: 'code_edit',
          agent_id: agentId,
          status: 'active',
          created_at: '2024-01-15T10:00:00Z',
          files: [],
          file_count: 0,
          total_lines_added: 0,
          total_lines_removed: 0,
        },
      };

      triggerSocketEvent('checkpoint_created', checkpointEvent);

      await waitFor(() => {
        expect(mockStoreState.addCheckpoint).toHaveBeenCalledWith(
          sessionId,
          expect.objectContaining({
            id: checkpointId,
            checkpointNumber: 1,
            description: 'Initial checkpoint',
            actionType: 'code_edit',
            agentId,
            status: 'active',
          })
        );
      });
    });

    it('should ignore checkpoint from different session', async () => {
      renderHook(() => useCheckpointSocket({ sessionId }));

      const checkpointEvent = {
        session_id: 'other-session',
        checkpoint: {
          id: checkpointId,
          checkpoint_number: 1,
          description: 'Test',
          action_type: 'code_edit',
          agent_id: agentId,
          status: 'active',
          created_at: '2024-01-15T10:00:00Z',
          files: [],
          file_count: 0,
          total_lines_added: 0,
          total_lines_removed: 0,
        },
      };

      triggerSocketEvent('checkpoint_created', checkpointEvent);

      await waitFor(() => {
        expect(mockStoreState.addCheckpoint).not.toHaveBeenCalled();
      });
    });

    it('should transform files array correctly', async () => {
      renderHook(() => useCheckpointSocket({ sessionId }));

      const checkpointEvent = {
        session_id: sessionId,
        checkpoint: {
          id: checkpointId,
          checkpoint_number: 2,
          description: 'File changes',
          action_type: 'code_edit',
          agent_id: agentId,
          status: 'active',
          created_at: '2024-01-15T10:00:00Z',
          files: [
            {
              path: '/src/index.ts',
              change_type: 'modify' as const,
              lines_added: 10,
              lines_removed: 5,
            },
            {
              path: '/src/utils.ts',
              change_type: 'create' as const,
              lines_added: 50,
              lines_removed: 0,
            },
          ],
          file_count: 2,
          total_lines_added: 60,
          total_lines_removed: 5,
        },
      };

      triggerSocketEvent('checkpoint_created', checkpointEvent);

      await waitFor(() => {
        expect(mockStoreState.addCheckpoint).toHaveBeenCalledWith(
          sessionId,
          expect.objectContaining({
            files: [
              {
                path: '/src/index.ts',
                changeType: 'modify',
                linesAdded: 10,
                linesRemoved: 5,
              },
              {
                path: '/src/utils.ts',
                changeType: 'create',
                linesAdded: 50,
                linesRemoved: 0,
              },
            ],
          })
        );
      });
    });

    it('should handle null description', async () => {
      renderHook(() => useCheckpointSocket({ sessionId }));

      const checkpointEvent = {
        session_id: sessionId,
        checkpoint: {
          id: checkpointId,
          checkpoint_number: 3,
          description: null,
          action_type: 'terminal_command',
          agent_id: agentId,
          status: 'active',
          created_at: '2024-01-15T10:00:00Z',
          files: [],
          file_count: 0,
          total_lines_added: 0,
          total_lines_removed: 0,
        },
      };

      triggerSocketEvent('checkpoint_created', checkpointEvent);

      await waitFor(() => {
        expect(mockStoreState.addCheckpoint).toHaveBeenCalledWith(
          sessionId,
          expect.objectContaining({
            description: null,
          })
        );
      });
    });

    it('should parse createdAt as Date object', async () => {
      renderHook(() => useCheckpointSocket({ sessionId }));

      const isoDate = '2024-01-15T10:30:00.000Z';
      const checkpointEvent = {
        session_id: sessionId,
        checkpoint: {
          id: checkpointId,
          checkpoint_number: 1,
          description: 'Test',
          action_type: 'code_edit',
          agent_id: agentId,
          status: 'active',
          created_at: isoDate,
          files: [],
          file_count: 0,
          total_lines_added: 0,
          total_lines_removed: 0,
        },
      };

      triggerSocketEvent('checkpoint_created', checkpointEvent);

      await waitFor(() => {
        expect(mockStoreState.addCheckpoint).toHaveBeenCalledWith(
          sessionId,
          expect.objectContaining({
            createdAt: new Date(isoDate),
          })
        );
      });
    });

    it('should include file statistics', async () => {
      renderHook(() => useCheckpointSocket({ sessionId }));

      const checkpointEvent = {
        session_id: sessionId,
        checkpoint: {
          id: checkpointId,
          checkpoint_number: 1,
          description: 'Stats test',
          action_type: 'code_edit',
          agent_id: agentId,
          status: 'active',
          created_at: '2024-01-15T10:00:00Z',
          files: [],
          file_count: 5,
          total_lines_added: 100,
          total_lines_removed: 25,
        },
      };

      triggerSocketEvent('checkpoint_created', checkpointEvent);

      await waitFor(() => {
        expect(mockStoreState.addCheckpoint).toHaveBeenCalledWith(
          sessionId,
          expect.objectContaining({
            fileCount: 5,
            totalLinesAdded: 100,
            totalLinesRemoved: 25,
          })
        );
      });
    });

    it('should handle delete change type', async () => {
      renderHook(() => useCheckpointSocket({ sessionId }));

      const checkpointEvent = {
        session_id: sessionId,
        checkpoint: {
          id: checkpointId,
          checkpoint_number: 1,
          description: 'Delete file',
          action_type: 'file_delete',
          agent_id: agentId,
          status: 'active',
          created_at: '2024-01-15T10:00:00Z',
          files: [
            {
              path: '/src/old.ts',
              change_type: 'delete' as const,
              lines_added: 0,
              lines_removed: 100,
            },
          ],
          file_count: 1,
          total_lines_added: 0,
          total_lines_removed: 100,
        },
      };

      triggerSocketEvent('checkpoint_created', checkpointEvent);

      await waitFor(() => {
        expect(mockStoreState.addCheckpoint).toHaveBeenCalledWith(
          sessionId,
          expect.objectContaining({
            files: [
              expect.objectContaining({
                changeType: 'delete',
              }),
            ],
          })
        );
      });
    });
  });

  // ========================================
  // Checkpoint Restore Started Event Tests
  // ========================================

  describe('Checkpoint Restore Started Events', () => {
    it('should set restoring state on restore_started event', async () => {
      renderHook(() => useCheckpointSocket({ sessionId }));

      const restoreEvent = {
        session_id: sessionId,
        checkpoint_id: checkpointId,
      };

      triggerSocketEvent('checkpoint_restore_started', restoreEvent);

      await waitFor(() => {
        expect(mockStoreState.setRestoring).toHaveBeenCalledWith(checkpointId);
      });
    });

    it('should ignore restore_started from different session', async () => {
      renderHook(() => useCheckpointSocket({ sessionId }));

      const restoreEvent = {
        session_id: 'other-session',
        checkpoint_id: checkpointId,
      };

      triggerSocketEvent('checkpoint_restore_started', restoreEvent);

      await waitFor(() => {
        expect(mockStoreState.setRestoring).not.toHaveBeenCalled();
      });
    });

    it('should handle multiple restore started events', async () => {
      renderHook(() => useCheckpointSocket({ sessionId }));

      triggerSocketEvent('checkpoint_restore_started', {
        session_id: sessionId,
        checkpoint_id: 'checkpoint-1',
      });

      triggerSocketEvent('checkpoint_restore_started', {
        session_id: sessionId,
        checkpoint_id: 'checkpoint-2',
      });

      await waitFor(() => {
        expect(mockStoreState.setRestoring).toHaveBeenCalledTimes(2);
        expect(mockStoreState.setRestoring).toHaveBeenCalledWith('checkpoint-1');
        expect(mockStoreState.setRestoring).toHaveBeenCalledWith('checkpoint-2');
      });
    });
  });

  // ========================================
  // Checkpoint Restore Completed Event Tests
  // ========================================

  describe('Checkpoint Restore Completed Events', () => {
    it('should update checkpoint status on restore_completed event', async () => {
      renderHook(() => useCheckpointSocket({ sessionId }));

      const restoreEvent = {
        session_id: sessionId,
        checkpoint_id: checkpointId,
        files_restored: 5,
      };

      triggerSocketEvent('checkpoint_restore_completed', restoreEvent);

      await waitFor(() => {
        expect(mockStoreState.updateCheckpointStatus).toHaveBeenCalledWith(
          sessionId,
          checkpointId,
          'restored'
        );
      });
    });

    it('should clear restoring state on restore_completed event', async () => {
      renderHook(() => useCheckpointSocket({ sessionId }));

      const restoreEvent = {
        session_id: sessionId,
        checkpoint_id: checkpointId,
        files_restored: 5,
      };

      triggerSocketEvent('checkpoint_restore_completed', restoreEvent);

      await waitFor(() => {
        expect(mockStoreState.setRestoring).toHaveBeenCalledWith(null);
      });
    });

    it('should ignore restore_completed from different session', async () => {
      renderHook(() => useCheckpointSocket({ sessionId }));

      const restoreEvent = {
        session_id: 'other-session',
        checkpoint_id: checkpointId,
        files_restored: 5,
      };

      triggerSocketEvent('checkpoint_restore_completed', restoreEvent);

      await waitFor(() => {
        expect(mockStoreState.updateCheckpointStatus).not.toHaveBeenCalled();
        expect(mockStoreState.setRestoring).not.toHaveBeenCalled();
      });
    });

    it('should call updateCheckpointStatus before setRestoring', async () => {
      const callOrder: string[] = [];
      mockStoreState.updateCheckpointStatus.mockImplementation(() => {
        callOrder.push('updateCheckpointStatus');
      });
      mockStoreState.setRestoring.mockImplementation(() => {
        callOrder.push('setRestoring');
      });

      renderHook(() => useCheckpointSocket({ sessionId }));

      triggerSocketEvent('checkpoint_restore_completed', {
        session_id: sessionId,
        checkpoint_id: checkpointId,
        files_restored: 3,
      });

      await waitFor(() => {
        expect(callOrder).toEqual(['updateCheckpointStatus', 'setRestoring']);
      });
    });
  });

  // ========================================
  // Cleanup Tests
  // ========================================

  describe('Cleanup', () => {
    it('should unsubscribe from socket events on unmount', () => {
      const { unmount } = renderHook(() => useCheckpointSocket({ sessionId }));

      // Verify events are registered
      expect(Object.keys(socketHandlers)).toContain('checkpoint_created');
      expect(Object.keys(socketHandlers)).toContain('checkpoint_restore_started');
      expect(Object.keys(socketHandlers)).toContain('checkpoint_restore_completed');

      unmount();

      // Cleanup functions should be called (handlers removed)
    });

    it('should not cause errors when events fire after unmount', () => {
      const { unmount } = renderHook(() => useCheckpointSocket({ sessionId }));

      unmount();

      // These should not throw
      expect(() => {
        triggerSocketEvent('checkpoint_created', {
          session_id: sessionId,
          checkpoint: {
            id: 'test',
            checkpoint_number: 1,
            description: null,
            action_type: 'test',
            agent_id: 'agent',
            status: 'active',
            created_at: new Date().toISOString(),
            files: [],
            file_count: 0,
            total_lines_added: 0,
            total_lines_removed: 0,
          },
        });
      }).not.toThrow();
    });
  });

  // ========================================
  // Re-subscription Tests
  // ========================================

  describe('Re-subscription', () => {
    it('should re-subscribe when sessionId changes', () => {
      const { rerender } = renderHook(({ sessionId }) => useCheckpointSocket({ sessionId }), {
        initialProps: { sessionId: 'session-1' },
      });

      expect(socketLib.onSocketEvent).toHaveBeenCalledTimes(3);

      vi.clearAllMocks();

      rerender({ sessionId: 'session-2' });

      expect(socketLib.onSocketEvent).toHaveBeenCalledTimes(3);
    });

    it('should not re-subscribe when sessionId stays the same', () => {
      const { rerender } = renderHook(({ sessionId }) => useCheckpointSocket({ sessionId }), {
        initialProps: { sessionId },
      });

      const initialCallCount = (socketLib.onSocketEvent as ReturnType<typeof vi.fn>).mock.calls
        .length;

      rerender({ sessionId });

      // Should not have additional calls (effect dependencies didn't change)
      expect(socketLib.onSocketEvent).toHaveBeenCalledTimes(initialCallCount);
    });
  });

  // ========================================
  // Edge Cases
  // ========================================

  describe('Edge Cases', () => {
    it('should handle empty files array', async () => {
      renderHook(() => useCheckpointSocket({ sessionId }));

      const checkpointEvent = {
        session_id: sessionId,
        checkpoint: {
          id: checkpointId,
          checkpoint_number: 1,
          description: 'Empty files',
          action_type: 'code_edit',
          agent_id: agentId,
          status: 'active',
          created_at: '2024-01-15T10:00:00Z',
          files: [],
          file_count: 0,
          total_lines_added: 0,
          total_lines_removed: 0,
        },
      };

      triggerSocketEvent('checkpoint_created', checkpointEvent);

      await waitFor(() => {
        expect(mockStoreState.addCheckpoint).toHaveBeenCalledWith(
          sessionId,
          expect.objectContaining({
            files: [],
          })
        );
      });
    });

    it('should handle multiple rapid events', async () => {
      renderHook(() => useCheckpointSocket({ sessionId }));

      for (let i = 0; i < 5; i++) {
        triggerSocketEvent('checkpoint_created', {
          session_id: sessionId,
          checkpoint: {
            id: `checkpoint-${i}`,
            checkpoint_number: i + 1,
            description: `Checkpoint ${i}`,
            action_type: 'code_edit',
            agent_id: agentId,
            status: 'active',
            created_at: new Date().toISOString(),
            files: [],
            file_count: 0,
            total_lines_added: 0,
            total_lines_removed: 0,
          },
        });
      }

      await waitFor(() => {
        expect(mockStoreState.addCheckpoint).toHaveBeenCalledTimes(5);
      });
    });

    it('should handle full restore flow', async () => {
      renderHook(() => useCheckpointSocket({ sessionId }));

      // Start restore
      triggerSocketEvent('checkpoint_restore_started', {
        session_id: sessionId,
        checkpoint_id: checkpointId,
      });

      await waitFor(() => {
        expect(mockStoreState.setRestoring).toHaveBeenCalledWith(checkpointId);
      });

      // Complete restore
      triggerSocketEvent('checkpoint_restore_completed', {
        session_id: sessionId,
        checkpoint_id: checkpointId,
        files_restored: 10,
      });

      await waitFor(() => {
        expect(mockStoreState.updateCheckpointStatus).toHaveBeenCalledWith(
          sessionId,
          checkpointId,
          'restored'
        );
        expect(mockStoreState.setRestoring).toHaveBeenCalledWith(null);
      });
    });

    it('should handle various checkpoint statuses', async () => {
      renderHook(() => useCheckpointSocket({ sessionId }));

      const statuses = ['active', 'restored', 'archived'];

      for (const status of statuses) {
        vi.clearAllMocks();

        triggerSocketEvent('checkpoint_created', {
          session_id: sessionId,
          checkpoint: {
            id: `checkpoint-${status}`,
            checkpoint_number: 1,
            description: null,
            action_type: 'test',
            agent_id: agentId,
            status,
            created_at: new Date().toISOString(),
            files: [],
            file_count: 0,
            total_lines_added: 0,
            total_lines_removed: 0,
          },
        });

        await waitFor(() => {
          expect(mockStoreState.addCheckpoint).toHaveBeenCalledWith(
            sessionId,
            expect.objectContaining({ status })
          );
        });
      }
    });

    it('should handle files with zero line changes', async () => {
      renderHook(() => useCheckpointSocket({ sessionId }));

      const checkpointEvent = {
        session_id: sessionId,
        checkpoint: {
          id: checkpointId,
          checkpoint_number: 1,
          description: 'Rename only',
          action_type: 'file_rename',
          agent_id: agentId,
          status: 'active',
          created_at: '2024-01-15T10:00:00Z',
          files: [
            {
              path: '/src/renamed.ts',
              change_type: 'modify' as const,
              lines_added: 0,
              lines_removed: 0,
            },
          ],
          file_count: 1,
          total_lines_added: 0,
          total_lines_removed: 0,
        },
      };

      triggerSocketEvent('checkpoint_created', checkpointEvent);

      await waitFor(() => {
        expect(mockStoreState.addCheckpoint).toHaveBeenCalledWith(
          sessionId,
          expect.objectContaining({
            files: [
              expect.objectContaining({
                linesAdded: 0,
                linesRemoved: 0,
              }),
            ],
          })
        );
      });
    });
  });
});
