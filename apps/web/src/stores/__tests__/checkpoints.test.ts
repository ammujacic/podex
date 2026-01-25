import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useCheckpointsStore, type Checkpoint, type CheckpointFile } from '../checkpoints';

const mockFile1: CheckpointFile = {
  path: '/src/App.tsx',
  changeType: 'modify',
  linesAdded: 15,
  linesRemoved: 8,
};

const mockFile2: CheckpointFile = {
  path: '/src/utils.ts',
  changeType: 'create',
  linesAdded: 42,
  linesRemoved: 0,
};

const mockCheckpoint1: Checkpoint = {
  id: 'checkpoint-1',
  checkpointNumber: 1,
  description: 'Added authentication',
  actionType: 'code_generation',
  agentId: 'agent-1',
  status: 'active',
  createdAt: new Date(Date.now() - 10000),
  files: [mockFile1],
  fileCount: 1,
  totalLinesAdded: 15,
  totalLinesRemoved: 8,
};

const mockCheckpoint2: Checkpoint = {
  id: 'checkpoint-2',
  checkpointNumber: 2,
  description: 'Added utilities',
  actionType: 'code_generation',
  agentId: 'agent-1',
  status: 'active',
  createdAt: new Date(Date.now() - 5000),
  files: [mockFile2],
  fileCount: 1,
  totalLinesAdded: 42,
  totalLinesRemoved: 0,
};

const mockCheckpoint3: Checkpoint = {
  id: 'checkpoint-3',
  checkpointNumber: 3,
  description: 'Refactored components',
  actionType: 'refactoring',
  agentId: 'agent-2',
  status: 'active',
  createdAt: new Date(Date.now() - 3000),
  files: [mockFile1, mockFile2],
  fileCount: 2,
  totalLinesAdded: 57,
  totalLinesRemoved: 8,
};

describe('checkpointsStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    act(() => {
      useCheckpointsStore.setState({
        sessionCheckpoints: {},
        selectedCheckpointId: null,
        restoringCheckpointId: null,
        loading: {},
      });
    });
  });

  // ========================================================================
  // Initial State
  // ========================================================================

  describe('Initial State', () => {
    it('has empty session checkpoints', () => {
      const { result } = renderHook(() => useCheckpointsStore());
      expect(result.current.sessionCheckpoints).toEqual({});
    });

    it('has no selected checkpoint', () => {
      const { result } = renderHook(() => useCheckpointsStore());
      expect(result.current.selectedCheckpointId).toBeNull();
    });

    it('has no restoring checkpoint', () => {
      const { result } = renderHook(() => useCheckpointsStore());
      expect(result.current.restoringCheckpointId).toBeNull();
    });

    it('has empty loading state', () => {
      const { result } = renderHook(() => useCheckpointsStore());
      expect(result.current.loading).toEqual({});
    });
  });

  // ========================================================================
  // Checkpoint Management
  // ========================================================================

  describe('Checkpoint Management', () => {
    describe('setCheckpoints', () => {
      it('sets checkpoints for session', () => {
        const { result } = renderHook(() => useCheckpointsStore());

        act(() => {
          result.current.setCheckpoints('session-1', [mockCheckpoint1, mockCheckpoint2]);
        });

        const checkpoints = result.current.getCheckpoints('session-1');
        expect(checkpoints).toHaveLength(2);
      });

      it('sorts checkpoints by number (highest first)', () => {
        const { result } = renderHook(() => useCheckpointsStore());

        act(() => {
          result.current.setCheckpoints('session-1', [mockCheckpoint1, mockCheckpoint2]);
        });

        const checkpoints = result.current.getCheckpoints('session-1');
        expect(checkpoints[0]?.checkpointNumber).toBe(2);
        expect(checkpoints[1]?.checkpointNumber).toBe(1);
      });

      it('replaces existing checkpoints for session', () => {
        const { result } = renderHook(() => useCheckpointsStore());

        act(() => {
          result.current.setCheckpoints('session-1', [mockCheckpoint1]);
          result.current.setCheckpoints('session-1', [mockCheckpoint2]);
        });

        const checkpoints = result.current.getCheckpoints('session-1');
        expect(checkpoints).toHaveLength(1);
        expect(checkpoints[0]?.id).toBe('checkpoint-2');
      });
    });

    describe('addCheckpoint', () => {
      it('adds checkpoint to session', () => {
        const { result } = renderHook(() => useCheckpointsStore());

        act(() => {
          result.current.addCheckpoint('session-1', mockCheckpoint1);
        });

        const checkpoints = result.current.getCheckpoints('session-1');
        expect(checkpoints).toHaveLength(1);
        expect(checkpoints[0]).toEqual(mockCheckpoint1);
      });

      it('adds to existing checkpoints', () => {
        const { result } = renderHook(() => useCheckpointsStore());

        act(() => {
          result.current.addCheckpoint('session-1', mockCheckpoint1);
          result.current.addCheckpoint('session-1', mockCheckpoint2);
        });

        const checkpoints = result.current.getCheckpoints('session-1');
        expect(checkpoints).toHaveLength(2);
      });

      it('maintains sorted order when adding', () => {
        const { result } = renderHook(() => useCheckpointsStore());

        act(() => {
          result.current.addCheckpoint('session-1', mockCheckpoint2);
          result.current.addCheckpoint('session-1', mockCheckpoint1);
        });

        const checkpoints = result.current.getCheckpoints('session-1');
        expect(checkpoints[0]?.checkpointNumber).toBe(2);
        expect(checkpoints[1]?.checkpointNumber).toBe(1);
      });

      it('handles adding to non-existent session', () => {
        const { result } = renderHook(() => useCheckpointsStore());

        expect(() => {
          act(() => {
            result.current.addCheckpoint('session-1', mockCheckpoint1);
          });
        }).not.toThrow();

        const checkpoints = result.current.getCheckpoints('session-1');
        expect(checkpoints).toHaveLength(1);
      });
    });

    describe('updateCheckpointStatus', () => {
      it('updates checkpoint status', () => {
        const { result } = renderHook(() => useCheckpointsStore());

        act(() => {
          result.current.addCheckpoint('session-1', mockCheckpoint1);
          result.current.updateCheckpointStatus('session-1', 'checkpoint-1', 'restored');
        });

        const checkpoint = result.current.getCheckpoint('session-1', 'checkpoint-1');
        expect(checkpoint?.status).toBe('restored');
      });

      it('can update to superseded status', () => {
        const { result } = renderHook(() => useCheckpointsStore());

        act(() => {
          result.current.addCheckpoint('session-1', mockCheckpoint1);
          result.current.updateCheckpointStatus('session-1', 'checkpoint-1', 'superseded');
        });

        const checkpoint = result.current.getCheckpoint('session-1', 'checkpoint-1');
        expect(checkpoint?.status).toBe('superseded');
      });

      it('handles updating non-existent checkpoint gracefully', () => {
        const { result } = renderHook(() => useCheckpointsStore());

        act(() => {
          result.current.addCheckpoint('session-1', mockCheckpoint1);
        });

        expect(() => {
          act(() => {
            result.current.updateCheckpointStatus('session-1', 'non-existent', 'restored');
          });
        }).not.toThrow();
      });

      it('handles updating in non-existent session gracefully', () => {
        const { result } = renderHook(() => useCheckpointsStore());

        expect(() => {
          act(() => {
            result.current.updateCheckpointStatus('non-existent', 'checkpoint-1', 'restored');
          });
        }).not.toThrow();
      });
    });
  });

  // ========================================================================
  // UI State
  // ========================================================================

  describe('UI State', () => {
    describe('selectCheckpoint', () => {
      it('sets selected checkpoint ID', () => {
        const { result } = renderHook(() => useCheckpointsStore());

        act(() => {
          result.current.selectCheckpoint('checkpoint-1');
        });

        expect(result.current.selectedCheckpointId).toBe('checkpoint-1');
      });

      it('can clear selection', () => {
        const { result } = renderHook(() => useCheckpointsStore());

        act(() => {
          result.current.selectCheckpoint('checkpoint-1');
          result.current.selectCheckpoint(null);
        });

        expect(result.current.selectedCheckpointId).toBeNull();
      });

      it('can switch between checkpoints', () => {
        const { result } = renderHook(() => useCheckpointsStore());

        act(() => {
          result.current.selectCheckpoint('checkpoint-1');
        });
        expect(result.current.selectedCheckpointId).toBe('checkpoint-1');

        act(() => {
          result.current.selectCheckpoint('checkpoint-2');
        });
        expect(result.current.selectedCheckpointId).toBe('checkpoint-2');
      });
    });

    describe('setRestoring', () => {
      it('sets restoring checkpoint ID', () => {
        const { result } = renderHook(() => useCheckpointsStore());

        act(() => {
          result.current.setRestoring('checkpoint-1');
        });

        expect(result.current.restoringCheckpointId).toBe('checkpoint-1');
      });

      it('can clear restoring state', () => {
        const { result } = renderHook(() => useCheckpointsStore());

        act(() => {
          result.current.setRestoring('checkpoint-1');
          result.current.setRestoring(null);
        });

        expect(result.current.restoringCheckpointId).toBeNull();
      });
    });

    describe('setLoading', () => {
      it('sets loading state for session', () => {
        const { result } = renderHook(() => useCheckpointsStore());

        act(() => {
          result.current.setLoading('session-1', true);
        });

        expect(result.current.loading['session-1']).toBe(true);
      });

      it('clears loading state for session', () => {
        const { result } = renderHook(() => useCheckpointsStore());

        act(() => {
          result.current.setLoading('session-1', true);
          result.current.setLoading('session-1', false);
        });

        expect(result.current.loading['session-1']).toBe(false);
      });

      it('can track loading for multiple sessions', () => {
        const { result } = renderHook(() => useCheckpointsStore());

        act(() => {
          result.current.setLoading('session-1', true);
          result.current.setLoading('session-2', true);
        });

        expect(result.current.loading['session-1']).toBe(true);
        expect(result.current.loading['session-2']).toBe(true);
      });
    });
  });

  // ========================================================================
  // Getters
  // ========================================================================

  describe('Getters', () => {
    describe('getCheckpoints', () => {
      it('returns empty array for non-existent session', () => {
        const { result } = renderHook(() => useCheckpointsStore());

        const checkpoints = result.current.getCheckpoints('non-existent');
        expect(checkpoints).toEqual([]);
      });

      it('returns checkpoints for session', () => {
        const { result } = renderHook(() => useCheckpointsStore());

        act(() => {
          result.current.setCheckpoints('session-1', [mockCheckpoint1, mockCheckpoint2]);
        });

        const checkpoints = result.current.getCheckpoints('session-1');
        expect(checkpoints).toHaveLength(2);
      });
    });

    describe('getCheckpoint', () => {
      it('returns checkpoint by ID', () => {
        const { result } = renderHook(() => useCheckpointsStore());

        act(() => {
          result.current.addCheckpoint('session-1', mockCheckpoint1);
        });

        const checkpoint = result.current.getCheckpoint('session-1', 'checkpoint-1');
        expect(checkpoint).toEqual(mockCheckpoint1);
      });

      it('returns undefined for non-existent checkpoint', () => {
        const { result } = renderHook(() => useCheckpointsStore());

        act(() => {
          result.current.addCheckpoint('session-1', mockCheckpoint1);
        });

        const checkpoint = result.current.getCheckpoint('session-1', 'non-existent');
        expect(checkpoint).toBeUndefined();
      });

      it('returns undefined for non-existent session', () => {
        const { result } = renderHook(() => useCheckpointsStore());

        const checkpoint = result.current.getCheckpoint('non-existent', 'checkpoint-1');
        expect(checkpoint).toBeUndefined();
      });
    });

    describe('getAgentCheckpoints', () => {
      it('returns checkpoints for specific agent', () => {
        const { result } = renderHook(() => useCheckpointsStore());

        act(() => {
          result.current.addCheckpoint('session-1', mockCheckpoint1);
          result.current.addCheckpoint('session-1', mockCheckpoint2);
          result.current.addCheckpoint('session-1', mockCheckpoint3);
        });

        const agentCheckpoints = result.current.getAgentCheckpoints('session-1', 'agent-1');
        expect(agentCheckpoints).toHaveLength(2);
        expect(agentCheckpoints.every((cp) => cp.agentId === 'agent-1')).toBe(true);
      });

      it('returns empty array when no checkpoints for agent', () => {
        const { result } = renderHook(() => useCheckpointsStore());

        act(() => {
          result.current.addCheckpoint('session-1', mockCheckpoint1);
        });

        const agentCheckpoints = result.current.getAgentCheckpoints('session-1', 'agent-999');
        expect(agentCheckpoints).toEqual([]);
      });

      it('returns empty array for non-existent session', () => {
        const { result } = renderHook(() => useCheckpointsStore());

        const agentCheckpoints = result.current.getAgentCheckpoints('non-existent', 'agent-1');
        expect(agentCheckpoints).toEqual([]);
      });
    });
  });

  // ========================================================================
  // Checkpoint Restore Workflow
  // ========================================================================

  describe('Checkpoint Restore Workflow', () => {
    it('handles checkpoint restore workflow', () => {
      const { result } = renderHook(() => useCheckpointsStore());

      // Setup checkpoints
      act(() => {
        result.current.addCheckpoint('session-1', mockCheckpoint1);
        result.current.addCheckpoint('session-1', mockCheckpoint2);
      });

      // Select checkpoint to restore
      act(() => {
        result.current.selectCheckpoint('checkpoint-1');
      });
      expect(result.current.selectedCheckpointId).toBe('checkpoint-1');

      // Start restoring
      act(() => {
        result.current.setRestoring('checkpoint-1');
        result.current.setLoading('session-1', true);
      });
      expect(result.current.restoringCheckpointId).toBe('checkpoint-1');
      expect(result.current.loading['session-1']).toBe(true);

      // Complete restore
      act(() => {
        result.current.updateCheckpointStatus('session-1', 'checkpoint-1', 'restored');
        result.current.updateCheckpointStatus('session-1', 'checkpoint-2', 'superseded');
        result.current.setRestoring(null);
        result.current.setLoading('session-1', false);
      });

      const restored = result.current.getCheckpoint('session-1', 'checkpoint-1');
      const superseded = result.current.getCheckpoint('session-1', 'checkpoint-2');
      expect(restored?.status).toBe('restored');
      expect(superseded?.status).toBe('superseded');
      expect(result.current.restoringCheckpointId).toBeNull();
    });
  });
});
