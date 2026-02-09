import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { usePlanningStore } from '../planning';
import type {
  GeneratedPlan,
  PlanStep,
  BackgroundPlanTask,
  PlanComparison,
  PlanStatus,
} from '../planning';

// Mock API calls
vi.mock('@/lib/api', () => ({
  api: {
    planning: {
      generatePlans: vi.fn(),
      selectPlan: vi.fn(),
      deletePlan: vi.fn(),
      comparePlans: vi.fn(),
    },
  },
}));

// Mock data fixtures
const mockPlanStep: PlanStep = {
  index: 0,
  title: 'Setup project structure',
  description: 'Create directories and initial files',
  estimatedComplexity: 'low',
  filesAffected: ['package.json', 'tsconfig.json'],
  dependencies: [],
};

const mockPlanStep2: PlanStep = {
  index: 1,
  title: 'Implement core logic',
  description: 'Add main functionality',
  estimatedComplexity: 'high',
  filesAffected: ['src/index.ts', 'src/core.ts'],
  dependencies: [0],
};

const mockGeneratedPlan: GeneratedPlan = {
  id: 'plan-1',
  sessionId: 'session-1',
  agentId: 'agent-1',
  taskDescription: 'Build a React component',
  approachName: 'Component-based approach',
  approachSummary: 'Create reusable components with TypeScript',
  steps: [mockPlanStep],
  modelUsed: 'claude-opus-4.5',
  status: 'completed',
  totalEstimatedComplexity: 'medium',
  pros: ['Reusable', 'Type-safe'],
  cons: ['More setup required'],
  createdAt: new Date('2024-01-01T00:00:00Z'),
  generationTimeMs: 2500,
  error: null,
};

const mockGeneratedPlan2: GeneratedPlan = {
  id: 'plan-2',
  sessionId: 'session-1',
  agentId: 'agent-1',
  taskDescription: 'Build a React component',
  approachName: 'Monolithic approach',
  approachSummary: 'Create a single large component',
  steps: [mockPlanStep, mockPlanStep2],
  modelUsed: 'claude-sonnet-4.5',
  status: 'completed',
  totalEstimatedComplexity: 'high',
  pros: ['Simple structure'],
  cons: ['Less maintainable', 'Hard to test'],
  createdAt: new Date('2024-01-01T00:00:00Z'),
  generationTimeMs: 1800,
  error: null,
};

const mockBackgroundTask: BackgroundPlanTask = {
  id: 'task-1',
  sessionId: 'session-1',
  agentId: 'agent-1',
  taskDescription: 'Generate multiple approaches',
  numPlans: 3,
  models: ['claude-opus-4.5', 'claude-sonnet-4.5', 'gpt-4o'],
  status: 'running',
  planIds: ['plan-1'],
  createdAt: new Date('2024-01-01T00:00:00Z'),
  startedAt: new Date('2024-01-01T00:00:05Z'),
  completedAt: null,
  error: null,
};

const mockPlanComparison: PlanComparison = {
  planIds: ['plan-1', 'plan-2'],
  complexityScores: {
    'plan-1': 5,
    'plan-2': 8,
  },
  stepCounts: {
    'plan-1': 1,
    'plan-2': 2,
  },
  filesTouched: {
    'plan-1': 2,
    'plan-2': 4,
  },
  sharedFiles: ['package.json', 'tsconfig.json'],
  uniqueApproaches: {
    'plan-1': ['Component-based'],
    'plan-2': ['Monolithic'],
  },
  recommendations: ['Plan 1 is simpler and more maintainable'],
};

describe('planningStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    act(() => {
      usePlanningStore.setState({
        plansBySession: {},
        selectedPlanId: {},
        backgroundTasks: [],
        comparison: null,
        isGenerating: false,
        showComparisonView: false,
        comparisonPlanIds: [],
        settings: {
          planningModel: 'claude-opus-4.5',
          executionModel: 'claude-sonnet-4.5',
          parallelPlans: 3,
          backgroundPlanning: true,
          autoSelectSimplest: false,
        },
      });
    });
  });

  // ========================================================================
  // Initial State
  // ========================================================================

  describe('Initial State', () => {
    it('has empty plans by session', () => {
      const { result } = renderHook(() => usePlanningStore());
      expect(result.current.plansBySession).toEqual({});
    });

    it('has no selected plan IDs', () => {
      const { result } = renderHook(() => usePlanningStore());
      expect(result.current.selectedPlanId).toEqual({});
    });

    it('has empty background tasks', () => {
      const { result } = renderHook(() => usePlanningStore());
      expect(result.current.backgroundTasks).toEqual([]);
    });

    it('has no comparison data', () => {
      const { result } = renderHook(() => usePlanningStore());
      expect(result.current.comparison).toBeNull();
    });

    it('is not generating by default', () => {
      const { result } = renderHook(() => usePlanningStore());
      expect(result.current.isGenerating).toBe(false);
    });

    it('has default settings configured', () => {
      const { result } = renderHook(() => usePlanningStore());
      expect(result.current.settings.planningModel).toBe('claude-opus-4.5');
      expect(result.current.settings.executionModel).toBe('claude-sonnet-4.5');
      expect(result.current.settings.parallelPlans).toBe(3);
      expect(result.current.settings.backgroundPlanning).toBe(true);
      expect(result.current.settings.autoSelectSimplest).toBe(false);
    });

    it('comparison view is hidden by default', () => {
      const { result } = renderHook(() => usePlanningStore());
      expect(result.current.showComparisonView).toBe(false);
    });
  });

  // ========================================================================
  // Plan Management
  // ========================================================================

  describe('Plan Management', () => {
    describe('setPlans', () => {
      it('sets plans for a session', () => {
        const { result } = renderHook(() => usePlanningStore());

        act(() => {
          result.current.setPlans('session-1', [mockGeneratedPlan]);
        });

        expect(result.current.plansBySession['session-1']).toHaveLength(1);
        expect(result.current.plansBySession['session-1'][0]).toEqual(mockGeneratedPlan);
      });

      it('replaces existing plans for the session', () => {
        const { result } = renderHook(() => usePlanningStore());

        act(() => {
          result.current.setPlans('session-1', [mockGeneratedPlan]);
          result.current.setPlans('session-1', [mockGeneratedPlan2]);
        });

        expect(result.current.plansBySession['session-1']).toHaveLength(1);
        expect(result.current.plansBySession['session-1'][0].id).toBe('plan-2');
      });

      it('does not affect plans for other sessions', () => {
        const { result } = renderHook(() => usePlanningStore());

        act(() => {
          result.current.setPlans('session-1', [mockGeneratedPlan]);
          result.current.setPlans('session-2', [mockGeneratedPlan2]);
        });

        expect(result.current.plansBySession['session-1']).toHaveLength(1);
        expect(result.current.plansBySession['session-2']).toHaveLength(1);
        expect(result.current.plansBySession['session-1'][0].id).toBe('plan-1');
        expect(result.current.plansBySession['session-2'][0].id).toBe('plan-2');
      });

      it('can set empty plan array', () => {
        const { result } = renderHook(() => usePlanningStore());

        act(() => {
          result.current.setPlans('session-1', [mockGeneratedPlan]);
          result.current.setPlans('session-1', []);
        });

        expect(result.current.plansBySession['session-1']).toEqual([]);
      });
    });

    describe('addPlan', () => {
      it('adds a plan to session', () => {
        const { result } = renderHook(() => usePlanningStore());

        act(() => {
          result.current.addPlan(mockGeneratedPlan);
        });

        expect(result.current.plansBySession['session-1']).toHaveLength(1);
        expect(result.current.plansBySession['session-1'][0]).toEqual(mockGeneratedPlan);
      });

      it('appends to existing plans', () => {
        const { result } = renderHook(() => usePlanningStore());

        act(() => {
          result.current.addPlan(mockGeneratedPlan);
          result.current.addPlan(mockGeneratedPlan2);
        });

        expect(result.current.plansBySession['session-1']).toHaveLength(2);
        expect(result.current.plansBySession['session-1'][0].id).toBe('plan-1');
        expect(result.current.plansBySession['session-1'][1].id).toBe('plan-2');
      });

      it('creates session array if not exists', () => {
        const { result } = renderHook(() => usePlanningStore());

        act(() => {
          result.current.addPlan(mockGeneratedPlan);
        });

        expect(result.current.plansBySession['session-1']).toBeDefined();
        expect(result.current.plansBySession['session-1']).toHaveLength(1);
      });

      it('can add plans for multiple sessions', () => {
        const { result } = renderHook(() => usePlanningStore());
        const plan2 = { ...mockGeneratedPlan, id: 'plan-3', sessionId: 'session-2' };

        act(() => {
          result.current.addPlan(mockGeneratedPlan);
          result.current.addPlan(plan2);
        });

        expect(result.current.plansBySession['session-1']).toHaveLength(1);
        expect(result.current.plansBySession['session-2']).toHaveLength(1);
      });
    });

    describe('updatePlan', () => {
      beforeEach(() => {
        const { result } = renderHook(() => usePlanningStore());
        act(() => {
          result.current.addPlan(mockGeneratedPlan);
        });
      });

      it('updates plan status', () => {
        const { result } = renderHook(() => usePlanningStore());

        act(() => {
          result.current.updatePlan('plan-1', { status: 'selected' });
        });

        expect(result.current.plansBySession['session-1'][0].status).toBe('selected');
      });

      it('updates multiple plan properties', () => {
        const { result } = renderHook(() => usePlanningStore());

        act(() => {
          result.current.updatePlan('plan-1', {
            status: 'failed',
            error: 'Generation failed',
          });
        });

        const plan = result.current.plansBySession['session-1'][0];
        expect(plan.status).toBe('failed');
        expect(plan.error).toBe('Generation failed');
      });

      it('updates only the specified plan', () => {
        const { result } = renderHook(() => usePlanningStore());

        act(() => {
          result.current.addPlan(mockGeneratedPlan2);
          result.current.updatePlan('plan-1', { status: 'selected' });
        });

        expect(result.current.plansBySession['session-1'][0].status).toBe('selected');
        expect(result.current.plansBySession['session-1'][1].status).toBe('completed');
      });

      it('updates plan across all sessions', () => {
        const { result } = renderHook(() => usePlanningStore());
        const plan2 = { ...mockGeneratedPlan, sessionId: 'session-2' };

        act(() => {
          result.current.addPlan(plan2);
          result.current.updatePlan('plan-1', { status: 'rejected' });
        });

        expect(result.current.plansBySession['session-1'][0].status).toBe('rejected');
        expect(result.current.plansBySession['session-2'][0].status).toBe('rejected');
      });

      it('handles updating non-existent plan gracefully', () => {
        const { result } = renderHook(() => usePlanningStore());

        expect(() => {
          act(() => {
            result.current.updatePlan('non-existent', { status: 'selected' });
          });
        }).not.toThrow();
      });
    });

    describe('Plan Status Management', () => {
      it('supports pending status', () => {
        const { result } = renderHook(() => usePlanningStore());
        const pendingPlan: GeneratedPlan = {
          ...mockGeneratedPlan,
          status: 'pending',
        };

        act(() => {
          result.current.addPlan(pendingPlan);
        });

        expect(result.current.plansBySession['session-1'][0].status).toBe('pending');
      });

      it('supports generating status', () => {
        const { result } = renderHook(() => usePlanningStore());
        const generatingPlan: GeneratedPlan = {
          ...mockGeneratedPlan,
          status: 'generating',
        };

        act(() => {
          result.current.addPlan(generatingPlan);
        });

        expect(result.current.plansBySession['session-1'][0].status).toBe('generating');
      });

      it('supports completed status', () => {
        const { result } = renderHook(() => usePlanningStore());

        act(() => {
          result.current.addPlan(mockGeneratedPlan);
        });

        expect(result.current.plansBySession['session-1'][0].status).toBe('completed');
      });

      it('supports failed status', () => {
        const { result } = renderHook(() => usePlanningStore());
        const failedPlan: GeneratedPlan = {
          ...mockGeneratedPlan,
          status: 'failed',
          error: 'API error',
        };

        act(() => {
          result.current.addPlan(failedPlan);
        });

        expect(result.current.plansBySession['session-1'][0].status).toBe('failed');
        expect(result.current.plansBySession['session-1'][0].error).toBe('API error');
      });

      it('supports selected status', () => {
        const { result } = renderHook(() => usePlanningStore());

        act(() => {
          result.current.addPlan(mockGeneratedPlan);
          result.current.selectPlan('session-1', 'plan-1');
        });

        expect(result.current.plansBySession['session-1'][0].status).toBe('selected');
      });

      it('supports rejected status', () => {
        const { result } = renderHook(() => usePlanningStore());

        act(() => {
          result.current.addPlan(mockGeneratedPlan);
          result.current.addPlan(mockGeneratedPlan2);
          result.current.selectPlan('session-1', 'plan-1');
        });

        expect(result.current.plansBySession['session-1'][1].status).toBe('rejected');
      });
    });

    describe('selectPlan', () => {
      beforeEach(() => {
        const { result } = renderHook(() => usePlanningStore());
        act(() => {
          result.current.addPlan(mockGeneratedPlan);
          result.current.addPlan(mockGeneratedPlan2);
        });
      });

      it('sets the selected plan ID for session', () => {
        const { result } = renderHook(() => usePlanningStore());

        act(() => {
          result.current.selectPlan('session-1', 'plan-1');
        });

        expect(result.current.selectedPlanId['session-1']).toBe('plan-1');
      });

      it('marks selected plan as selected', () => {
        const { result } = renderHook(() => usePlanningStore());

        act(() => {
          result.current.selectPlan('session-1', 'plan-1');
        });

        expect(result.current.plansBySession['session-1'][0].status).toBe('selected');
      });

      it('marks other completed plans as rejected', () => {
        const { result } = renderHook(() => usePlanningStore());

        act(() => {
          result.current.selectPlan('session-1', 'plan-1');
        });

        expect(result.current.plansBySession['session-1'][1].status).toBe('rejected');
      });

      it('does not change status of non-completed plans', () => {
        const { result } = renderHook(() => usePlanningStore());
        const generatingPlan: GeneratedPlan = {
          ...mockGeneratedPlan,
          id: 'plan-3',
          status: 'generating',
        };

        act(() => {
          result.current.addPlan(generatingPlan);
          result.current.selectPlan('session-1', 'plan-1');
        });

        expect(result.current.plansBySession['session-1'][2].status).toBe('generating');
      });

      it('can switch selected plan', () => {
        const { result } = renderHook(() => usePlanningStore());

        act(() => {
          result.current.selectPlan('session-1', 'plan-1');
          result.current.selectPlan('session-1', 'plan-2');
        });

        expect(result.current.selectedPlanId['session-1']).toBe('plan-2');
        expect(result.current.plansBySession['session-1'][1].status).toBe('selected');
      });
    });

    describe('Plan Complexity', () => {
      it('stores low complexity plans', () => {
        const { result } = renderHook(() => usePlanningStore());
        const lowPlan: GeneratedPlan = {
          ...mockGeneratedPlan,
          totalEstimatedComplexity: 'low',
        };

        act(() => {
          result.current.addPlan(lowPlan);
        });

        expect(result.current.plansBySession['session-1'][0].totalEstimatedComplexity).toBe('low');
      });

      it('stores medium complexity plans', () => {
        const { result } = renderHook(() => usePlanningStore());

        act(() => {
          result.current.addPlan(mockGeneratedPlan);
        });

        expect(result.current.plansBySession['session-1'][0].totalEstimatedComplexity).toBe(
          'medium'
        );
      });

      it('stores high complexity plans', () => {
        const { result } = renderHook(() => usePlanningStore());

        act(() => {
          result.current.addPlan(mockGeneratedPlan2);
        });

        expect(result.current.plansBySession['session-1'][0].totalEstimatedComplexity).toBe('high');
      });
    });
  });

  // ========================================================================
  // Step Management
  // ========================================================================

  describe('Step Management', () => {
    describe('Plan Steps', () => {
      it('stores plan with single step', () => {
        const { result } = renderHook(() => usePlanningStore());

        act(() => {
          result.current.addPlan(mockGeneratedPlan);
        });

        expect(result.current.plansBySession['session-1'][0].steps).toHaveLength(1);
        expect(result.current.plansBySession['session-1'][0].steps[0]).toEqual(mockPlanStep);
      });

      it('stores plan with multiple steps', () => {
        const { result } = renderHook(() => usePlanningStore());

        act(() => {
          result.current.addPlan(mockGeneratedPlan2);
        });

        expect(result.current.plansBySession['session-1'][0].steps).toHaveLength(2);
      });

      it('maintains step ordering by index', () => {
        const { result } = renderHook(() => usePlanningStore());

        act(() => {
          result.current.addPlan(mockGeneratedPlan2);
        });

        const steps = result.current.plansBySession['session-1'][0].steps;
        expect(steps[0].index).toBe(0);
        expect(steps[1].index).toBe(1);
      });

      it('stores step complexity levels', () => {
        const { result } = renderHook(() => usePlanningStore());

        act(() => {
          result.current.addPlan(mockGeneratedPlan2);
        });

        const steps = result.current.plansBySession['session-1'][0].steps;
        expect(steps[0].estimatedComplexity).toBe('low');
        expect(steps[1].estimatedComplexity).toBe('high');
      });

      it('stores files affected by each step', () => {
        const { result } = renderHook(() => usePlanningStore());

        act(() => {
          result.current.addPlan(mockGeneratedPlan);
        });

        const step = result.current.plansBySession['session-1'][0].steps[0];
        expect(step.filesAffected).toEqual(['package.json', 'tsconfig.json']);
      });
    });

    describe('Step Dependencies', () => {
      it('stores step with no dependencies', () => {
        const { result } = renderHook(() => usePlanningStore());

        act(() => {
          result.current.addPlan(mockGeneratedPlan);
        });

        const step = result.current.plansBySession['session-1'][0].steps[0];
        expect(step.dependencies).toEqual([]);
      });

      it('stores step with dependencies', () => {
        const { result } = renderHook(() => usePlanningStore());

        act(() => {
          result.current.addPlan(mockGeneratedPlan2);
        });

        const step = result.current.plansBySession['session-1'][0].steps[1];
        expect(step.dependencies).toEqual([0]);
      });

      it('maintains dependency references across steps', () => {
        const { result } = renderHook(() => usePlanningStore());
        const step3: PlanStep = {
          index: 2,
          title: 'Add tests',
          description: 'Write unit tests',
          estimatedComplexity: 'medium',
          filesAffected: ['src/index.test.ts'],
          dependencies: [0, 1],
        };
        const complexPlan: GeneratedPlan = {
          ...mockGeneratedPlan,
          steps: [mockPlanStep, mockPlanStep2, step3],
        };

        act(() => {
          result.current.addPlan(complexPlan);
        });

        const steps = result.current.plansBySession['session-1'][0].steps;
        expect(steps[2].dependencies).toEqual([0, 1]);
      });
    });

    describe('Step Updates', () => {
      it('can update step information via plan update', () => {
        const { result } = renderHook(() => usePlanningStore());

        act(() => {
          result.current.addPlan(mockGeneratedPlan);
          const updatedSteps = [
            {
              ...mockPlanStep,
              title: 'Updated title',
            },
          ];
          result.current.updatePlan('plan-1', { steps: updatedSteps });
        });

        expect(result.current.plansBySession['session-1'][0].steps[0].title).toBe('Updated title');
      });

      it('preserves other plan properties when updating steps', () => {
        const { result } = renderHook(() => usePlanningStore());

        act(() => {
          result.current.addPlan(mockGeneratedPlan);
          const updatedSteps = [
            {
              ...mockPlanStep,
              description: 'New description',
            },
          ];
          result.current.updatePlan('plan-1', { steps: updatedSteps });
        });

        const plan = result.current.plansBySession['session-1'][0];
        expect(plan.approachName).toBe('Component-based approach');
        expect(plan.status).toBe('completed');
      });
    });
  });

  // ========================================================================
  // Background Tasks
  // ========================================================================

  describe('Background Tasks', () => {
    describe('addBackgroundTask', () => {
      it('adds background task', () => {
        const { result } = renderHook(() => usePlanningStore());

        act(() => {
          result.current.addBackgroundTask(mockBackgroundTask);
        });

        expect(result.current.backgroundTasks).toHaveLength(1);
        expect(result.current.backgroundTasks[0]).toEqual(mockBackgroundTask);
      });

      it('appends to existing tasks', () => {
        const { result } = renderHook(() => usePlanningStore());
        const task2: BackgroundPlanTask = {
          ...mockBackgroundTask,
          id: 'task-2',
        };

        act(() => {
          result.current.addBackgroundTask(mockBackgroundTask);
          result.current.addBackgroundTask(task2);
        });

        expect(result.current.backgroundTasks).toHaveLength(2);
      });

      it('tracks queued tasks', () => {
        const { result } = renderHook(() => usePlanningStore());
        const queuedTask: BackgroundPlanTask = {
          ...mockBackgroundTask,
          status: 'queued',
          startedAt: null,
        };

        act(() => {
          result.current.addBackgroundTask(queuedTask);
        });

        expect(result.current.backgroundTasks[0].status).toBe('queued');
      });

      it('tracks running tasks', () => {
        const { result } = renderHook(() => usePlanningStore());

        act(() => {
          result.current.addBackgroundTask(mockBackgroundTask);
        });

        expect(result.current.backgroundTasks[0].status).toBe('running');
        expect(result.current.backgroundTasks[0].startedAt).not.toBeNull();
      });
    });

    describe('updateBackgroundTask', () => {
      beforeEach(() => {
        const { result } = renderHook(() => usePlanningStore());
        act(() => {
          result.current.addBackgroundTask(mockBackgroundTask);
        });
      });

      it('updates task status', () => {
        const { result } = renderHook(() => usePlanningStore());

        act(() => {
          result.current.updateBackgroundTask('task-1', { status: 'completed' });
        });

        expect(result.current.backgroundTasks[0].status).toBe('completed');
      });

      it('updates task completion time', () => {
        const { result } = renderHook(() => usePlanningStore());
        const completedAt = new Date('2024-01-01T00:01:00Z');

        act(() => {
          result.current.updateBackgroundTask('task-1', {
            status: 'completed',
            completedAt,
          });
        });

        expect(result.current.backgroundTasks[0].completedAt).toEqual(completedAt);
      });

      it('updates generated plan IDs', () => {
        const { result } = renderHook(() => usePlanningStore());

        act(() => {
          result.current.updateBackgroundTask('task-1', {
            planIds: ['plan-1', 'plan-2', 'plan-3'],
          });
        });

        expect(result.current.backgroundTasks[0].planIds).toEqual(['plan-1', 'plan-2', 'plan-3']);
      });

      it('updates task error', () => {
        const { result } = renderHook(() => usePlanningStore());

        act(() => {
          result.current.updateBackgroundTask('task-1', {
            status: 'failed',
            error: 'Network timeout',
          });
        });

        expect(result.current.backgroundTasks[0].status).toBe('failed');
        expect(result.current.backgroundTasks[0].error).toBe('Network timeout');
      });

      it('updates only specified task', () => {
        const { result } = renderHook(() => usePlanningStore());
        const task2: BackgroundPlanTask = {
          ...mockBackgroundTask,
          id: 'task-2',
        };

        act(() => {
          result.current.addBackgroundTask(task2);
          result.current.updateBackgroundTask('task-1', { status: 'completed' });
        });

        expect(result.current.backgroundTasks[0].status).toBe('completed');
        expect(result.current.backgroundTasks[1].status).toBe('running');
      });

      it('handles updating non-existent task gracefully', () => {
        const { result } = renderHook(() => usePlanningStore());

        expect(() => {
          act(() => {
            result.current.updateBackgroundTask('non-existent', { status: 'completed' });
          });
        }).not.toThrow();
      });
    });

    describe('getPendingTasks', () => {
      it('returns queued and running tasks for session', () => {
        const { result } = renderHook(() => usePlanningStore());
        const queuedTask: BackgroundPlanTask = {
          ...mockBackgroundTask,
          id: 'task-2',
          status: 'queued',
        };

        act(() => {
          result.current.addBackgroundTask(mockBackgroundTask);
          result.current.addBackgroundTask(queuedTask);
        });

        const pending = result.current.getPendingTasks('session-1');
        expect(pending).toHaveLength(2);
      });

      it('excludes completed tasks', () => {
        const { result } = renderHook(() => usePlanningStore());
        const completedTask: BackgroundPlanTask = {
          ...mockBackgroundTask,
          id: 'task-2',
          status: 'completed',
        };

        act(() => {
          result.current.addBackgroundTask(mockBackgroundTask);
          result.current.addBackgroundTask(completedTask);
        });

        const pending = result.current.getPendingTasks('session-1');
        expect(pending).toHaveLength(1);
        expect(pending[0].status).toBe('running');
      });

      it('excludes failed tasks', () => {
        const { result } = renderHook(() => usePlanningStore());
        const failedTask: BackgroundPlanTask = {
          ...mockBackgroundTask,
          id: 'task-2',
          status: 'failed',
        };

        act(() => {
          result.current.addBackgroundTask(mockBackgroundTask);
          result.current.addBackgroundTask(failedTask);
        });

        const pending = result.current.getPendingTasks('session-1');
        expect(pending).toHaveLength(1);
      });

      it('excludes cancelled tasks', () => {
        const { result } = renderHook(() => usePlanningStore());
        const cancelledTask: BackgroundPlanTask = {
          ...mockBackgroundTask,
          id: 'task-2',
          status: 'cancelled',
        };

        act(() => {
          result.current.addBackgroundTask(mockBackgroundTask);
          result.current.addBackgroundTask(cancelledTask);
        });

        const pending = result.current.getPendingTasks('session-1');
        expect(pending).toHaveLength(1);
      });

      it('filters by session ID', () => {
        const { result } = renderHook(() => usePlanningStore());
        const task2: BackgroundPlanTask = {
          ...mockBackgroundTask,
          id: 'task-2',
          sessionId: 'session-2',
        };

        act(() => {
          result.current.addBackgroundTask(mockBackgroundTask);
          result.current.addBackgroundTask(task2);
        });

        const pending = result.current.getPendingTasks('session-1');
        expect(pending).toHaveLength(1);
        expect(pending[0].sessionId).toBe('session-1');
      });

      it('returns empty array for session with no tasks', () => {
        const { result } = renderHook(() => usePlanningStore());

        act(() => {
          result.current.addBackgroundTask(mockBackgroundTask);
        });

        const pending = result.current.getPendingTasks('session-2');
        expect(pending).toEqual([]);
      });
    });
  });

  // ========================================================================
  // Comparison
  // ========================================================================

  describe('Plan Comparison', () => {
    describe('setComparison', () => {
      it('sets comparison data', () => {
        const { result } = renderHook(() => usePlanningStore());

        act(() => {
          result.current.setComparison(mockPlanComparison);
        });

        expect(result.current.comparison).toEqual(mockPlanComparison);
      });

      it('clears comparison data', () => {
        const { result } = renderHook(() => usePlanningStore());

        act(() => {
          result.current.setComparison(mockPlanComparison);
          result.current.setComparison(null);
        });

        expect(result.current.comparison).toBeNull();
      });

      it('replaces existing comparison', () => {
        const { result } = renderHook(() => usePlanningStore());
        const newComparison: PlanComparison = {
          ...mockPlanComparison,
          planIds: ['plan-3', 'plan-4'],
        };

        act(() => {
          result.current.setComparison(mockPlanComparison);
          result.current.setComparison(newComparison);
        });

        expect(result.current.comparison?.planIds).toEqual(['plan-3', 'plan-4']);
      });
    });

    describe('setShowComparisonView', () => {
      it('shows comparison view', () => {
        const { result } = renderHook(() => usePlanningStore());

        act(() => {
          result.current.setShowComparisonView(true);
        });

        expect(result.current.showComparisonView).toBe(true);
      });

      it('hides comparison view', () => {
        const { result } = renderHook(() => usePlanningStore());

        act(() => {
          result.current.setShowComparisonView(true);
          result.current.setShowComparisonView(false);
        });

        expect(result.current.showComparisonView).toBe(false);
      });
    });

    describe('setComparisonPlanIds', () => {
      it('sets plan IDs for comparison', () => {
        const { result } = renderHook(() => usePlanningStore());

        act(() => {
          result.current.setComparisonPlanIds(['plan-1', 'plan-2']);
        });

        expect(result.current.comparisonPlanIds).toEqual(['plan-1', 'plan-2']);
      });

      it('replaces existing comparison plan IDs', () => {
        const { result } = renderHook(() => usePlanningStore());

        act(() => {
          result.current.setComparisonPlanIds(['plan-1', 'plan-2']);
          result.current.setComparisonPlanIds(['plan-3', 'plan-4', 'plan-5']);
        });

        expect(result.current.comparisonPlanIds).toEqual(['plan-3', 'plan-4', 'plan-5']);
      });

      it('can set empty array', () => {
        const { result } = renderHook(() => usePlanningStore());

        act(() => {
          result.current.setComparisonPlanIds(['plan-1', 'plan-2']);
          result.current.setComparisonPlanIds([]);
        });

        expect(result.current.comparisonPlanIds).toEqual([]);
      });
    });
  });

  // ========================================================================
  // UI State
  // ========================================================================

  describe('UI State', () => {
    describe('setIsGenerating', () => {
      it('sets generating state to true', () => {
        const { result } = renderHook(() => usePlanningStore());

        act(() => {
          result.current.setIsGenerating(true);
        });

        expect(result.current.isGenerating).toBe(true);
      });

      it('sets generating state to false', () => {
        const { result } = renderHook(() => usePlanningStore());

        act(() => {
          result.current.setIsGenerating(true);
          result.current.setIsGenerating(false);
        });

        expect(result.current.isGenerating).toBe(false);
      });

      it('can toggle generating state', () => {
        const { result } = renderHook(() => usePlanningStore());

        act(() => {
          result.current.setIsGenerating(true);
        });
        expect(result.current.isGenerating).toBe(true);

        act(() => {
          result.current.setIsGenerating(false);
        });
        expect(result.current.isGenerating).toBe(false);

        act(() => {
          result.current.setIsGenerating(true);
        });
        expect(result.current.isGenerating).toBe(true);
      });
    });
  });

  // ========================================================================
  // Settings
  // ========================================================================

  describe('Settings', () => {
    describe('updateSettings', () => {
      it('updates planning model', () => {
        const { result } = renderHook(() => usePlanningStore());

        act(() => {
          result.current.updateSettings({ planningModel: 'gpt-4o' });
        });

        expect(result.current.settings.planningModel).toBe('gpt-4o');
      });

      it('updates execution model', () => {
        const { result } = renderHook(() => usePlanningStore());

        act(() => {
          result.current.updateSettings({ executionModel: 'claude-opus-4.5' });
        });

        expect(result.current.settings.executionModel).toBe('claude-opus-4.5');
      });

      it('updates parallel plans count', () => {
        const { result } = renderHook(() => usePlanningStore());

        act(() => {
          result.current.updateSettings({ parallelPlans: 5 });
        });

        expect(result.current.settings.parallelPlans).toBe(5);
      });

      it('updates background planning flag', () => {
        const { result } = renderHook(() => usePlanningStore());

        act(() => {
          result.current.updateSettings({ backgroundPlanning: false });
        });

        expect(result.current.settings.backgroundPlanning).toBe(false);
      });

      it('updates auto select simplest flag', () => {
        const { result } = renderHook(() => usePlanningStore());

        act(() => {
          result.current.updateSettings({ autoSelectSimplest: true });
        });

        expect(result.current.settings.autoSelectSimplest).toBe(true);
      });

      it('updates multiple settings at once', () => {
        const { result } = renderHook(() => usePlanningStore());

        act(() => {
          result.current.updateSettings({
            planningModel: 'gpt-4o',
            parallelPlans: 5,
            autoSelectSimplest: true,
          });
        });

        expect(result.current.settings.planningModel).toBe('gpt-4o');
        expect(result.current.settings.parallelPlans).toBe(5);
        expect(result.current.settings.autoSelectSimplest).toBe(true);
      });

      it('preserves unchanged settings', () => {
        const { result } = renderHook(() => usePlanningStore());

        act(() => {
          result.current.updateSettings({ planningModel: 'gpt-4o' });
        });

        expect(result.current.settings.executionModel).toBe('claude-sonnet-4.5');
        expect(result.current.settings.parallelPlans).toBe(3);
      });
    });
  });

  // ========================================================================
  // Computed Getters
  // ========================================================================

  describe('Computed Getters', () => {
    describe('getSessionPlans', () => {
      it('returns plans for session', () => {
        const { result } = renderHook(() => usePlanningStore());

        act(() => {
          result.current.addPlan(mockGeneratedPlan);
          result.current.addPlan(mockGeneratedPlan2);
        });

        const plans = result.current.getSessionPlans('session-1');
        expect(plans).toHaveLength(2);
      });

      it('returns empty array for session with no plans', () => {
        const { result } = renderHook(() => usePlanningStore());

        const plans = result.current.getSessionPlans('session-1');
        expect(plans).toEqual([]);
      });

      it('returns only plans for specified session', () => {
        const { result } = renderHook(() => usePlanningStore());
        const plan2 = { ...mockGeneratedPlan, id: 'plan-3', sessionId: 'session-2' };

        act(() => {
          result.current.addPlan(mockGeneratedPlan);
          result.current.addPlan(plan2);
        });

        const plans = result.current.getSessionPlans('session-1');
        expect(plans).toHaveLength(1);
        expect(plans[0].sessionId).toBe('session-1');
      });
    });

    describe('getSelectedPlan', () => {
      beforeEach(() => {
        const { result } = renderHook(() => usePlanningStore());
        act(() => {
          result.current.addPlan(mockGeneratedPlan);
          result.current.addPlan(mockGeneratedPlan2);
        });
      });

      it('returns selected plan for session', () => {
        const { result } = renderHook(() => usePlanningStore());

        act(() => {
          result.current.selectPlan('session-1', 'plan-1');
        });

        const selectedPlan = result.current.getSelectedPlan('session-1');
        expect(selectedPlan).not.toBeNull();
        expect(selectedPlan?.id).toBe('plan-1');
      });

      it('returns null when no plan is selected', () => {
        const { result } = renderHook(() => usePlanningStore());

        const selectedPlan = result.current.getSelectedPlan('session-1');
        expect(selectedPlan).toBeNull();
      });

      it('returns null for session with no plans', () => {
        const { result } = renderHook(() => usePlanningStore());

        const selectedPlan = result.current.getSelectedPlan('session-2');
        expect(selectedPlan).toBeNull();
      });

      it('returns updated plan after selection changes', () => {
        const { result } = renderHook(() => usePlanningStore());

        act(() => {
          result.current.selectPlan('session-1', 'plan-1');
        });
        expect(result.current.getSelectedPlan('session-1')?.id).toBe('plan-1');

        act(() => {
          result.current.selectPlan('session-1', 'plan-2');
        });
        expect(result.current.getSelectedPlan('session-1')?.id).toBe('plan-2');
      });

      it('returns null when selected plan ID does not exist in plans', () => {
        const { result } = renderHook(() => usePlanningStore());

        act(() => {
          usePlanningStore.setState({
            selectedPlanId: { 'session-1': 'non-existent-plan' },
          });
        });

        const selectedPlan = result.current.getSelectedPlan('session-1');
        expect(selectedPlan).toBeNull();
      });
    });
  });
});
