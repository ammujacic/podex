import { describe, it, expect, beforeEach } from 'vitest';
import {
  createProgressStore,
  type TaskProgress,
  type ProgressStep as _ProgressStep,
} from '../progress';

describe('Progress Store', () => {
  let store: ReturnType<typeof createProgressStore>;

  beforeEach(() => {
    store = createProgressStore();
  });

  const createMockProgress = (id: string, agentId: string): TaskProgress => ({
    id,
    agentId,
    sessionId: 'session-1',
    title: 'Test Task',
    status: 'pending',
    steps: [
      {
        id: 'step-1',
        index: 0,
        description: 'Step 1',
        status: 'pending',
        startedAt: null,
        completedAt: null,
        durationMs: null,
        elapsedMs: null,
        error: null,
      },
      {
        id: 'step-2',
        index: 1,
        description: 'Step 2',
        status: 'pending',
        startedAt: null,
        completedAt: null,
        durationMs: null,
        elapsedMs: null,
        error: null,
      },
    ],
    currentStepIndex: null,
    completedSteps: 0,
    totalSteps: 2,
    progressPercent: 0,
    createdAt: new Date(),
    completedAt: null,
    totalDurationMs: null,
  });

  describe('Initial State', () => {
    it('should have empty progress by default', () => {
      const state = store.getState();
      expect(state.progressByAgent).toEqual({});
      expect(state.expandedProgressId).toBeNull();
      expect(state.loadingAgents.size).toBe(0);
    });
  });

  describe('setProgress', () => {
    it('should set progress for an agent', () => {
      const progress = createMockProgress('p1', 'agent-1');
      store.getState().setProgress('agent-1', [progress]);

      const result = store.getState().getProgress('agent-1');
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe('p1');
    });

    it('should sort progress by creation date (newest first)', () => {
      const oldProgress = createMockProgress('p1', 'agent-1');
      oldProgress.createdAt = new Date('2024-01-01');

      const newProgress = createMockProgress('p2', 'agent-1');
      newProgress.createdAt = new Date('2024-01-02');

      store.getState().setProgress('agent-1', [oldProgress, newProgress]);

      const result = store.getState().getProgress('agent-1');
      expect(result[0]?.id).toBe('p2');
      expect(result[1]?.id).toBe('p1');
    });
  });

  describe('addProgress', () => {
    it('should add progress to an agent', () => {
      const progress = createMockProgress('p1', 'agent-1');
      store.getState().addProgress('agent-1', progress);

      const result = store.getState().getProgress('agent-1');
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe('p1');
    });

    it('should add new progress at the beginning', () => {
      const progress1 = createMockProgress('p1', 'agent-1');
      const progress2 = createMockProgress('p2', 'agent-1');

      store.getState().addProgress('agent-1', progress1);
      store.getState().addProgress('agent-1', progress2);

      const result = store.getState().getProgress('agent-1');
      expect(result[0]?.id).toBe('p2');
      expect(result[1]?.id).toBe('p1');
    });
  });

  describe('updateProgress', () => {
    it('should update existing progress', () => {
      const progress = createMockProgress('p1', 'agent-1');
      store.getState().addProgress('agent-1', progress);

      store.getState().updateProgress('p1', { status: 'in_progress', currentStepIndex: 0 });

      const result = store.getState().getProgressById('p1');
      expect(result?.status).toBe('in_progress');
      expect(result?.currentStepIndex).toBe(0);
    });

    it('should not affect other progress items', () => {
      const progress1 = createMockProgress('p1', 'agent-1');
      const progress2 = createMockProgress('p2', 'agent-1');

      store.getState().addProgress('agent-1', progress1);
      store.getState().addProgress('agent-1', progress2);

      store.getState().updateProgress('p1', { status: 'completed' });

      const result1 = store.getState().getProgressById('p1');
      const result2 = store.getState().getProgressById('p2');

      expect(result1?.status).toBe('completed');
      expect(result2?.status).toBe('pending');
    });
  });

  describe('updateStep', () => {
    it('should update a specific step', () => {
      const progress = createMockProgress('p1', 'agent-1');
      store.getState().addProgress('agent-1', progress);

      store.getState().updateStep('p1', 0, { status: 'completed' });

      const result = store.getState().getProgressById('p1');
      expect(result?.steps[0]?.status).toBe('completed');
    });

    it('should recalculate completed steps count', () => {
      const progress = createMockProgress('p1', 'agent-1');
      store.getState().addProgress('agent-1', progress);

      store.getState().updateStep('p1', 0, { status: 'completed' });

      const result = store.getState().getProgressById('p1');
      expect(result?.completedSteps).toBe(1);
    });

    it('should recalculate progress percentage', () => {
      const progress = createMockProgress('p1', 'agent-1');
      store.getState().addProgress('agent-1', progress);

      store.getState().updateStep('p1', 0, { status: 'completed' });

      const result = store.getState().getProgressById('p1');
      expect(result?.progressPercent).toBe(50); // 1 of 2 steps
    });

    it('should update multiple steps independently', () => {
      const progress = createMockProgress('p1', 'agent-1');
      store.getState().addProgress('agent-1', progress);

      store.getState().updateStep('p1', 0, { status: 'completed' });
      store.getState().updateStep('p1', 1, { status: 'in_progress' });

      const result = store.getState().getProgressById('p1');
      expect(result?.steps[0]?.status).toBe('completed');
      expect(result?.steps[1]?.status).toBe('in_progress');
      expect(result?.completedSteps).toBe(1);
    });
  });

  describe('removeProgress', () => {
    it('should remove progress by id', () => {
      const progress1 = createMockProgress('p1', 'agent-1');
      const progress2 = createMockProgress('p2', 'agent-1');

      store.getState().addProgress('agent-1', progress1);
      store.getState().addProgress('agent-1', progress2);

      store.getState().removeProgress('agent-1', 'p1');

      const result = store.getState().getProgress('agent-1');
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe('p2');
    });

    it('should handle removing non-existent progress', () => {
      const progress = createMockProgress('p1', 'agent-1');
      store.getState().addProgress('agent-1', progress);

      store.getState().removeProgress('agent-1', 'non-existent');

      const result = store.getState().getProgress('agent-1');
      expect(result).toHaveLength(1);
    });
  });

  describe('setExpanded', () => {
    it('should set expanded progress id', () => {
      store.getState().setExpanded('p1');
      expect(store.getState().expandedProgressId).toBe('p1');
    });

    it('should allow setting to null', () => {
      store.getState().setExpanded('p1');
      store.getState().setExpanded(null);
      expect(store.getState().expandedProgressId).toBeNull();
    });
  });

  describe('setLoading', () => {
    it('should add agent to loading set', () => {
      store.getState().setLoading('agent-1', true);
      expect(store.getState().loadingAgents.has('agent-1')).toBe(true);
    });

    it('should remove agent from loading set', () => {
      store.getState().setLoading('agent-1', true);
      store.getState().setLoading('agent-1', false);
      expect(store.getState().loadingAgents.has('agent-1')).toBe(false);
    });

    it('should handle multiple loading agents', () => {
      store.getState().setLoading('agent-1', true);
      store.getState().setLoading('agent-2', true);

      expect(store.getState().loadingAgents.has('agent-1')).toBe(true);
      expect(store.getState().loadingAgents.has('agent-2')).toBe(true);
    });
  });

  describe('getProgress', () => {
    it('should return empty array for unknown agent', () => {
      const result = store.getState().getProgress('unknown');
      expect(result).toEqual([]);
    });

    it('should return progress for specific agent', () => {
      const progress = createMockProgress('p1', 'agent-1');
      store.getState().addProgress('agent-1', progress);

      const result = store.getState().getProgress('agent-1');
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe('p1');
    });
  });

  describe('getActiveProgress', () => {
    it('should return null when no active progress', () => {
      const progress = createMockProgress('p1', 'agent-1');
      store.getState().addProgress('agent-1', progress);

      const result = store.getState().getActiveProgress('agent-1');
      expect(result).toBeNull();
    });

    it('should return in_progress task', () => {
      const progress = createMockProgress('p1', 'agent-1');
      progress.status = 'in_progress';
      store.getState().addProgress('agent-1', progress);

      const result = store.getState().getActiveProgress('agent-1');
      expect(result?.id).toBe('p1');
    });

    it('should return first in_progress task when multiple exist', () => {
      const progress1 = createMockProgress('p1', 'agent-1');
      progress1.status = 'in_progress';

      const progress2 = createMockProgress('p2', 'agent-1');
      progress2.status = 'in_progress';

      store.getState().addProgress('agent-1', progress1);
      store.getState().addProgress('agent-1', progress2);

      const result = store.getState().getActiveProgress('agent-1');
      expect(result?.id).toBe('p2');
    });
  });

  describe('getProgressById', () => {
    it('should return undefined for unknown id', () => {
      const result = store.getState().getProgressById('unknown');
      expect(result).toBeUndefined();
    });

    it('should find progress across agents', () => {
      const progress1 = createMockProgress('p1', 'agent-1');
      const progress2 = createMockProgress('p2', 'agent-2');

      store.getState().addProgress('agent-1', progress1);
      store.getState().addProgress('agent-2', progress2);

      const result1 = store.getState().getProgressById('p1');
      const result2 = store.getState().getProgressById('p2');

      expect(result1?.id).toBe('p1');
      expect(result1?.agentId).toBe('agent-1');
      expect(result2?.id).toBe('p2');
      expect(result2?.agentId).toBe('agent-2');
    });
  });
});
