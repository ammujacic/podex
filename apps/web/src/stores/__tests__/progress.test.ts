import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useProgressStore, type TaskProgress, type ProgressStep } from '../progress';

const mockStep1: ProgressStep = {
  id: 'step-1',
  index: 0,
  description: 'Analyzing code',
  status: 'completed',
  startedAt: new Date(Date.now() - 5000),
  completedAt: new Date(Date.now() - 2000),
  durationMs: 3000,
  elapsedMs: 3000,
  error: null,
};

const mockStep2: ProgressStep = {
  id: 'step-2',
  index: 1,
  description: 'Running tests',
  status: 'in_progress',
  startedAt: new Date(Date.now() - 1000),
  completedAt: null,
  durationMs: null,
  elapsedMs: 1000,
  error: null,
};

const mockStep3: ProgressStep = {
  id: 'step-3',
  index: 2,
  description: 'Building project',
  status: 'pending',
  startedAt: null,
  completedAt: null,
  durationMs: null,
  elapsedMs: null,
  error: null,
};

const mockProgress: TaskProgress = {
  id: 'progress-1',
  agentId: 'agent-1',
  sessionId: 'session-1',
  title: 'Building application',
  status: 'in_progress',
  steps: [mockStep1, mockStep2, mockStep3],
  currentStepIndex: 1,
  completedSteps: 1,
  totalSteps: 3,
  progressPercent: 33,
  createdAt: new Date(Date.now() - 10000),
  completedAt: null,
  totalDurationMs: null,
};

describe('progressStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    act(() => {
      useProgressStore.setState({
        progressByAgent: {},
        expandedProgressId: null,
        loadingAgents: new Set(),
      });
    });
  });

  // ========================================================================
  // Initial State
  // ========================================================================

  describe('Initial State', () => {
    it('has empty progress by agent', () => {
      const { result } = renderHook(() => useProgressStore());
      expect(result.current.progressByAgent).toEqual({});
    });

    it('has no expanded progress', () => {
      const { result } = renderHook(() => useProgressStore());
      expect(result.current.expandedProgressId).toBeNull();
    });

    it('has no loading agents', () => {
      const { result } = renderHook(() => useProgressStore());
      expect(result.current.loadingAgents.size).toBe(0);
    });
  });

  // ========================================================================
  // Progress Management
  // ========================================================================

  describe('Progress Management', () => {
    describe('setProgress', () => {
      it('sets progress for agent', () => {
        const { result } = renderHook(() => useProgressStore());

        act(() => {
          result.current.setProgress('agent-1', [mockProgress]);
        });

        const progress = result.current.getProgress('agent-1');
        expect(progress).toHaveLength(1);
        expect(progress[0]).toEqual(mockProgress);
      });

      it('sorts progress by creation time (newest first)', () => {
        const { result } = renderHook(() => useProgressStore());
        const oldProgress: TaskProgress = {
          ...mockProgress,
          id: 'progress-old',
          createdAt: new Date(Date.now() - 20000),
        };
        const newProgress: TaskProgress = {
          ...mockProgress,
          id: 'progress-new',
          createdAt: new Date(Date.now() - 5000),
        };

        act(() => {
          result.current.setProgress('agent-1', [oldProgress, newProgress]);
        });

        const progress = result.current.getProgress('agent-1');
        expect(progress[0]?.id).toBe('progress-new');
        expect(progress[1]?.id).toBe('progress-old');
      });

      it('replaces existing progress for agent', () => {
        const { result } = renderHook(() => useProgressStore());
        const newProgress: TaskProgress = {
          ...mockProgress,
          id: 'progress-2',
        };

        act(() => {
          result.current.setProgress('agent-1', [mockProgress]);
          result.current.setProgress('agent-1', [newProgress]);
        });

        const progress = result.current.getProgress('agent-1');
        expect(progress).toHaveLength(1);
        expect(progress[0]?.id).toBe('progress-2');
      });
    });

    describe('addProgress', () => {
      it('adds progress to agent', () => {
        const { result } = renderHook(() => useProgressStore());

        act(() => {
          result.current.addProgress('agent-1', mockProgress);
        });

        const progress = result.current.getProgress('agent-1');
        expect(progress).toHaveLength(1);
        expect(progress[0]).toEqual(mockProgress);
      });

      it('adds new progress to beginning of list', () => {
        const { result } = renderHook(() => useProgressStore());
        const newProgress: TaskProgress = {
          ...mockProgress,
          id: 'progress-2',
        };

        act(() => {
          result.current.addProgress('agent-1', mockProgress);
          result.current.addProgress('agent-1', newProgress);
        });

        const progress = result.current.getProgress('agent-1');
        expect(progress[0]?.id).toBe('progress-2');
        expect(progress[1]?.id).toBe('progress-1');
      });

      it('handles adding to non-existent agent', () => {
        const { result } = renderHook(() => useProgressStore());

        expect(() => {
          act(() => {
            result.current.addProgress('agent-1', mockProgress);
          });
        }).not.toThrow();

        const progress = result.current.getProgress('agent-1');
        expect(progress).toHaveLength(1);
      });
    });

    describe('updateProgress', () => {
      it('updates progress properties', () => {
        const { result } = renderHook(() => useProgressStore());

        act(() => {
          result.current.addProgress('agent-1', mockProgress);
          result.current.updateProgress('progress-1', {
            status: 'completed',
            completedAt: new Date(),
          });
        });

        const progress = result.current.getProgressById('progress-1');
        expect(progress?.status).toBe('completed');
        expect(progress?.completedAt).not.toBeNull();
      });

      it('updates progress percent', () => {
        const { result } = renderHook(() => useProgressStore());

        act(() => {
          result.current.addProgress('agent-1', mockProgress);
          result.current.updateProgress('progress-1', {
            progressPercent: 66,
            completedSteps: 2,
          });
        });

        const progress = result.current.getProgressById('progress-1');
        expect(progress?.progressPercent).toBe(66);
        expect(progress?.completedSteps).toBe(2);
      });

      it('handles updating non-existent progress gracefully', () => {
        const { result } = renderHook(() => useProgressStore());

        expect(() => {
          act(() => {
            result.current.updateProgress('non-existent', { status: 'completed' });
          });
        }).not.toThrow();
      });
    });

    describe('removeProgress', () => {
      it('removes progress from agent', () => {
        const { result } = renderHook(() => useProgressStore());

        act(() => {
          result.current.addProgress('agent-1', mockProgress);
          result.current.removeProgress('agent-1', 'progress-1');
        });

        const progress = result.current.getProgress('agent-1');
        expect(progress).toHaveLength(0);
      });

      it('only removes specified progress', () => {
        const { result } = renderHook(() => useProgressStore());
        const progress2: TaskProgress = {
          ...mockProgress,
          id: 'progress-2',
        };

        act(() => {
          result.current.addProgress('agent-1', mockProgress);
          result.current.addProgress('agent-1', progress2);
          result.current.removeProgress('agent-1', 'progress-1');
        });

        const remaining = result.current.getProgress('agent-1');
        expect(remaining).toHaveLength(1);
        expect(remaining[0]?.id).toBe('progress-2');
      });

      it('handles removing from non-existent agent gracefully', () => {
        const { result } = renderHook(() => useProgressStore());

        expect(() => {
          act(() => {
            result.current.removeProgress('non-existent', 'progress-1');
          });
        }).not.toThrow();
      });
    });
  });

  // ========================================================================
  // Step Management
  // ========================================================================

  describe('Step Management', () => {
    describe('updateStep', () => {
      it('updates step status', () => {
        const { result } = renderHook(() => useProgressStore());

        act(() => {
          result.current.addProgress('agent-1', mockProgress);
          result.current.updateStep('progress-1', 1, {
            status: 'completed',
            completedAt: new Date(),
          });
        });

        const progress = result.current.getProgressById('progress-1');
        expect(progress?.steps[1]?.status).toBe('completed');
      });

      it('recalculates completed steps count', () => {
        const { result } = renderHook(() => useProgressStore());

        act(() => {
          result.current.addProgress('agent-1', mockProgress);
          result.current.updateStep('progress-1', 1, { status: 'completed' });
        });

        const progress = result.current.getProgressById('progress-1');
        expect(progress?.completedSteps).toBe(2); // Was 1, now 2
      });

      it('recalculates progress percent', () => {
        const { result } = renderHook(() => useProgressStore());

        act(() => {
          result.current.addProgress('agent-1', mockProgress);
          result.current.updateStep('progress-1', 1, { status: 'completed' });
        });

        const progress = result.current.getProgressById('progress-1');
        expect(progress?.progressPercent).toBe(67); // 2/3 = 66.67, rounded to 67
      });

      it('handles updating non-existent step gracefully', () => {
        const { result } = renderHook(() => useProgressStore());

        act(() => {
          result.current.addProgress('agent-1', mockProgress);
        });

        expect(() => {
          act(() => {
            result.current.updateStep('progress-1', 999, { status: 'completed' });
          });
        }).not.toThrow();
      });
    });
  });

  // ========================================================================
  // UI State
  // ========================================================================

  describe('UI State', () => {
    describe('setExpanded', () => {
      it('sets expanded progress ID', () => {
        const { result } = renderHook(() => useProgressStore());

        act(() => {
          result.current.setExpanded('progress-1');
        });

        expect(result.current.expandedProgressId).toBe('progress-1');
      });

      it('can clear expanded progress', () => {
        const { result } = renderHook(() => useProgressStore());

        act(() => {
          result.current.setExpanded('progress-1');
          result.current.setExpanded(null);
        });

        expect(result.current.expandedProgressId).toBeNull();
      });
    });

    describe('setLoading', () => {
      it('adds agent to loading set', () => {
        const { result } = renderHook(() => useProgressStore());

        act(() => {
          result.current.setLoading('agent-1', true);
        });

        expect(result.current.loadingAgents.has('agent-1')).toBe(true);
      });

      it('removes agent from loading set', () => {
        const { result } = renderHook(() => useProgressStore());

        act(() => {
          result.current.setLoading('agent-1', true);
          result.current.setLoading('agent-1', false);
        });

        expect(result.current.loadingAgents.has('agent-1')).toBe(false);
      });

      it('can track loading for multiple agents', () => {
        const { result } = renderHook(() => useProgressStore());

        act(() => {
          result.current.setLoading('agent-1', true);
          result.current.setLoading('agent-2', true);
        });

        expect(result.current.loadingAgents.has('agent-1')).toBe(true);
        expect(result.current.loadingAgents.has('agent-2')).toBe(true);
      });
    });
  });

  // ========================================================================
  // Getters
  // ========================================================================

  describe('Getters', () => {
    describe('getProgress', () => {
      it('returns empty array for non-existent agent', () => {
        const { result } = renderHook(() => useProgressStore());

        const progress = result.current.getProgress('non-existent');
        expect(progress).toEqual([]);
      });

      it('returns progress for agent', () => {
        const { result } = renderHook(() => useProgressStore());

        act(() => {
          result.current.addProgress('agent-1', mockProgress);
        });

        const progress = result.current.getProgress('agent-1');
        expect(progress).toHaveLength(1);
      });
    });

    describe('getActiveProgress', () => {
      it('returns in_progress task for agent', () => {
        const { result } = renderHook(() => useProgressStore());

        act(() => {
          result.current.addProgress('agent-1', mockProgress);
        });

        const active = result.current.getActiveProgress('agent-1');
        expect(active?.id).toBe('progress-1');
        expect(active?.status).toBe('in_progress');
      });

      it('returns null when no active progress', () => {
        const { result } = renderHook(() => useProgressStore());
        const completedProgress: TaskProgress = {
          ...mockProgress,
          status: 'completed',
        };

        act(() => {
          result.current.addProgress('agent-1', completedProgress);
        });

        const active = result.current.getActiveProgress('agent-1');
        expect(active).toBeNull();
      });

      it('returns null for non-existent agent', () => {
        const { result } = renderHook(() => useProgressStore());

        const active = result.current.getActiveProgress('non-existent');
        expect(active).toBeNull();
      });
    });

    describe('getProgressById', () => {
      it('returns progress by ID', () => {
        const { result } = renderHook(() => useProgressStore());

        act(() => {
          result.current.addProgress('agent-1', mockProgress);
        });

        const progress = result.current.getProgressById('progress-1');
        expect(progress).toEqual(mockProgress);
      });

      it('returns undefined for non-existent progress', () => {
        const { result } = renderHook(() => useProgressStore());

        const progress = result.current.getProgressById('non-existent');
        expect(progress).toBeUndefined();
      });

      it('searches across all agents', () => {
        const { result } = renderHook(() => useProgressStore());
        const progress2: TaskProgress = {
          ...mockProgress,
          id: 'progress-2',
          agentId: 'agent-2',
        };

        act(() => {
          result.current.addProgress('agent-1', mockProgress);
          result.current.addProgress('agent-2', progress2);
        });

        expect(result.current.getProgressById('progress-1')).toBeDefined();
        expect(result.current.getProgressById('progress-2')).toBeDefined();
      });
    });
  });

  // ========================================================================
  // Progress Tracking Workflow
  // ========================================================================

  describe('Progress Tracking Workflow', () => {
    it('handles complete task lifecycle', () => {
      const { result } = renderHook(() => useProgressStore());

      // Add new task
      act(() => {
        result.current.addProgress('agent-1', mockProgress);
      });
      expect(result.current.getActiveProgress('agent-1')).not.toBeNull();

      // Complete second step
      act(() => {
        result.current.updateStep('progress-1', 1, {
          status: 'completed',
          completedAt: new Date(),
        });
      });

      let progress = result.current.getProgressById('progress-1');
      expect(progress?.completedSteps).toBe(2);

      // Complete third step
      act(() => {
        result.current.updateStep('progress-1', 2, {
          status: 'completed',
          completedAt: new Date(),
        });
      });

      progress = result.current.getProgressById('progress-1');
      expect(progress?.completedSteps).toBe(3);
      expect(progress?.progressPercent).toBe(100);

      // Mark task as completed
      act(() => {
        result.current.updateProgress('progress-1', {
          status: 'completed',
          completedAt: new Date(),
        });
      });

      progress = result.current.getProgressById('progress-1');
      expect(progress?.status).toBe('completed');
    });
  });
});
