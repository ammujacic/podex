import { describe, it, expect, beforeEach } from 'vitest';
import { createCheckpointsStore, type Checkpoint } from '../checkpoints';

describe('Checkpoints Store', () => {
  let store: ReturnType<typeof createCheckpointsStore>;

  beforeEach(() => {
    store = createCheckpointsStore();
  });

  const createMockCheckpoint = (
    id: string,
    checkpointNumber: number,
    agentId: string
  ): Checkpoint => ({
    id,
    checkpointNumber,
    description: `Checkpoint ${checkpointNumber}`,
    actionType: 'file_edit',
    agentId,
    status: 'active',
    createdAt: new Date(),
    files: [
      {
        path: 'src/test.ts',
        changeType: 'modify',
        linesAdded: 10,
        linesRemoved: 5,
      },
    ],
    fileCount: 1,
    totalLinesAdded: 10,
    totalLinesRemoved: 5,
  });

  describe('Initial State', () => {
    it('should have empty state by default', () => {
      const state = store.getState();
      expect(state.sessionCheckpoints).toEqual({});
      expect(state.selectedCheckpointId).toBeNull();
      expect(state.restoringCheckpointId).toBeNull();
      expect(state.loading).toEqual({});
    });
  });

  describe('setCheckpoints', () => {
    it('should set checkpoints for a session', () => {
      const checkpoints = [
        createMockCheckpoint('cp1', 1, 'agent-1'),
        createMockCheckpoint('cp2', 2, 'agent-1'),
      ];

      store.getState().setCheckpoints('session-1', checkpoints);

      const result = store.getState().getCheckpoints('session-1');
      expect(result).toHaveLength(2);
    });

    it('should sort checkpoints by checkpoint number (descending)', () => {
      const checkpoints = [
        createMockCheckpoint('cp1', 1, 'agent-1'),
        createMockCheckpoint('cp2', 3, 'agent-1'),
        createMockCheckpoint('cp3', 2, 'agent-1'),
      ];

      store.getState().setCheckpoints('session-1', checkpoints);

      const result = store.getState().getCheckpoints('session-1');
      expect(result[0]?.checkpointNumber).toBe(3);
      expect(result[1]?.checkpointNumber).toBe(2);
      expect(result[2]?.checkpointNumber).toBe(1);
    });

    it('should replace existing checkpoints for the session', () => {
      store.getState().setCheckpoints('session-1', [createMockCheckpoint('cp1', 1, 'agent-1')]);
      store.getState().setCheckpoints('session-1', [createMockCheckpoint('cp2', 2, 'agent-1')]);

      const result = store.getState().getCheckpoints('session-1');
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe('cp2');
    });
  });

  describe('addCheckpoint', () => {
    it('should add a checkpoint to a session', () => {
      const checkpoint = createMockCheckpoint('cp1', 1, 'agent-1');
      store.getState().addCheckpoint('session-1', checkpoint);

      const result = store.getState().getCheckpoints('session-1');
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe('cp1');
    });

    it('should add checkpoint to existing list', () => {
      store.getState().addCheckpoint('session-1', createMockCheckpoint('cp1', 1, 'agent-1'));
      store.getState().addCheckpoint('session-1', createMockCheckpoint('cp2', 2, 'agent-1'));

      const result = store.getState().getCheckpoints('session-1');
      expect(result).toHaveLength(2);
    });

    it('should maintain sort order when adding', () => {
      store.getState().addCheckpoint('session-1', createMockCheckpoint('cp1', 1, 'agent-1'));
      store.getState().addCheckpoint('session-1', createMockCheckpoint('cp3', 3, 'agent-1'));
      store.getState().addCheckpoint('session-1', createMockCheckpoint('cp2', 2, 'agent-1'));

      const result = store.getState().getCheckpoints('session-1');
      expect(result[0]?.checkpointNumber).toBe(3);
      expect(result[1]?.checkpointNumber).toBe(2);
      expect(result[2]?.checkpointNumber).toBe(1);
    });
  });

  describe('updateCheckpointStatus', () => {
    beforeEach(() => {
      const checkpoints = [
        createMockCheckpoint('cp1', 1, 'agent-1'),
        createMockCheckpoint('cp2', 2, 'agent-1'),
      ];
      store.getState().setCheckpoints('session-1', checkpoints);
    });

    it('should update checkpoint status', () => {
      store.getState().updateCheckpointStatus('session-1', 'cp1', 'restored');

      const checkpoint = store.getState().getCheckpoint('session-1', 'cp1');
      expect(checkpoint?.status).toBe('restored');
    });

    it('should only update the specified checkpoint', () => {
      store.getState().updateCheckpointStatus('session-1', 'cp1', 'restored');

      const checkpoint1 = store.getState().getCheckpoint('session-1', 'cp1');
      const checkpoint2 = store.getState().getCheckpoint('session-1', 'cp2');

      expect(checkpoint1?.status).toBe('restored');
      expect(checkpoint2?.status).toBe('active');
    });

    it('should handle non-existent session', () => {
      store.getState().updateCheckpointStatus('non-existent', 'cp1', 'restored');

      const result = store.getState().getCheckpoints('non-existent');
      expect(result).toEqual([]);
    });

    it('should update to superseded status', () => {
      store.getState().updateCheckpointStatus('session-1', 'cp1', 'superseded');

      const checkpoint = store.getState().getCheckpoint('session-1', 'cp1');
      expect(checkpoint?.status).toBe('superseded');
    });
  });

  describe('selectCheckpoint', () => {
    it('should select a checkpoint', () => {
      store.getState().selectCheckpoint('cp1');
      expect(store.getState().selectedCheckpointId).toBe('cp1');
    });

    it('should allow deselecting checkpoint', () => {
      store.getState().selectCheckpoint('cp1');
      store.getState().selectCheckpoint(null);
      expect(store.getState().selectedCheckpointId).toBeNull();
    });
  });

  describe('setRestoring', () => {
    it('should set restoring checkpoint id', () => {
      store.getState().setRestoring('cp1');
      expect(store.getState().restoringCheckpointId).toBe('cp1');
    });

    it('should allow clearing restoring state', () => {
      store.getState().setRestoring('cp1');
      store.getState().setRestoring(null);
      expect(store.getState().restoringCheckpointId).toBeNull();
    });
  });

  describe('setLoading', () => {
    it('should set loading state for a session', () => {
      store.getState().setLoading('session-1', true);
      expect(store.getState().loading['session-1']).toBe(true);
    });

    it('should update loading state', () => {
      store.getState().setLoading('session-1', true);
      store.getState().setLoading('session-1', false);
      expect(store.getState().loading['session-1']).toBe(false);
    });

    it('should handle multiple sessions loading states', () => {
      store.getState().setLoading('session-1', true);
      store.getState().setLoading('session-2', false);

      expect(store.getState().loading['session-1']).toBe(true);
      expect(store.getState().loading['session-2']).toBe(false);
    });
  });

  describe('getCheckpoints', () => {
    it('should return empty array for unknown session', () => {
      const result = store.getState().getCheckpoints('unknown');
      expect(result).toEqual([]);
    });

    it('should return checkpoints for a session', () => {
      const checkpoints = [createMockCheckpoint('cp1', 1, 'agent-1')];
      store.getState().setCheckpoints('session-1', checkpoints);

      const result = store.getState().getCheckpoints('session-1');
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe('cp1');
    });
  });

  describe('getCheckpoint', () => {
    beforeEach(() => {
      const checkpoints = [
        createMockCheckpoint('cp1', 1, 'agent-1'),
        createMockCheckpoint('cp2', 2, 'agent-1'),
      ];
      store.getState().setCheckpoints('session-1', checkpoints);
    });

    it('should return specific checkpoint', () => {
      const result = store.getState().getCheckpoint('session-1', 'cp1');
      expect(result?.id).toBe('cp1');
      expect(result?.checkpointNumber).toBe(1);
    });

    it('should return undefined for non-existent checkpoint', () => {
      const result = store.getState().getCheckpoint('session-1', 'non-existent');
      expect(result).toBeUndefined();
    });

    it('should return undefined for non-existent session', () => {
      const result = store.getState().getCheckpoint('non-existent', 'cp1');
      expect(result).toBeUndefined();
    });
  });

  describe('getAgentCheckpoints', () => {
    beforeEach(() => {
      const checkpoints = [
        createMockCheckpoint('cp1', 1, 'agent-1'),
        createMockCheckpoint('cp2', 2, 'agent-1'),
        createMockCheckpoint('cp3', 3, 'agent-2'),
        createMockCheckpoint('cp4', 4, 'agent-2'),
      ];
      store.getState().setCheckpoints('session-1', checkpoints);
    });

    it('should filter checkpoints by agent', () => {
      const result = store.getState().getAgentCheckpoints('session-1', 'agent-1');
      expect(result).toHaveLength(2);
      expect(result.every((cp) => cp.agentId === 'agent-1')).toBe(true);
    });

    it('should return empty array for non-existent agent', () => {
      const result = store.getState().getAgentCheckpoints('session-1', 'non-existent');
      expect(result).toEqual([]);
    });

    it('should return empty array for non-existent session', () => {
      const result = store.getState().getAgentCheckpoints('non-existent', 'agent-1');
      expect(result).toEqual([]);
    });

    it('should filter different agents correctly', () => {
      const agent1Result = store.getState().getAgentCheckpoints('session-1', 'agent-1');
      const agent2Result = store.getState().getAgentCheckpoints('session-1', 'agent-2');

      expect(agent1Result).toHaveLength(2);
      expect(agent2Result).toHaveLength(2);
      expect(agent1Result[0]?.agentId).toBe('agent-1');
      expect(agent2Result[0]?.agentId).toBe('agent-2');
    });
  });

  describe('Multiple Sessions', () => {
    it('should handle checkpoints from different sessions independently', () => {
      const session1Checkpoints = [createMockCheckpoint('cp1', 1, 'agent-1')];
      const session2Checkpoints = [createMockCheckpoint('cp2', 2, 'agent-2')];

      store.getState().setCheckpoints('session-1', session1Checkpoints);
      store.getState().setCheckpoints('session-2', session2Checkpoints);

      const result1 = store.getState().getCheckpoints('session-1');
      const result2 = store.getState().getCheckpoints('session-2');

      expect(result1).toHaveLength(1);
      expect(result1[0]?.id).toBe('cp1');
      expect(result2).toHaveLength(1);
      expect(result2[0]?.id).toBe('cp2');
    });
  });
});
