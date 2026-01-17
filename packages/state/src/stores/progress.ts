/**
 * Progress store for task progress tracking.
 * Platform-agnostic - can be used in web and React Native.
 */

import { createStore, type StateCreator } from 'zustand/vanilla';

// ============================================================================
// Types
// ============================================================================

export type StepStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';

export interface ProgressStep {
  id: string;
  index: number;
  description: string;
  status: StepStatus;
  startedAt: Date | null;
  completedAt: Date | null;
  durationMs: number | null;
  elapsedMs: number | null;
  error: string | null;
}

export interface TaskProgress {
  id: string;
  agentId: string;
  sessionId: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  steps: ProgressStep[];
  currentStepIndex: number | null;
  completedSteps: number;
  totalSteps: number;
  progressPercent: number;
  createdAt: Date;
  completedAt: Date | null;
  totalDurationMs: number | null;
}

// ============================================================================
// State Interface
// ============================================================================

export interface ProgressState {
  // Per-agent progress: { agentId: TaskProgress[] }
  progressByAgent: Record<string, TaskProgress[]>;

  // Currently expanded progress for detail view
  expandedProgressId: string | null;

  // Loading states
  loadingAgents: Set<string>;

  // Actions
  setProgress: (agentId: string, progress: TaskProgress[]) => void;
  addProgress: (agentId: string, progress: TaskProgress) => void;
  updateProgress: (progressId: string, updates: Partial<TaskProgress>) => void;
  updateStep: (progressId: string, stepIndex: number, updates: Partial<ProgressStep>) => void;
  removeProgress: (agentId: string, progressId: string) => void;
  setExpanded: (progressId: string | null) => void;
  setLoading: (agentId: string, loading: boolean) => void;

  // Getters
  getProgress: (agentId: string) => TaskProgress[];
  getActiveProgress: (agentId: string) => TaskProgress | null;
  getProgressById: (progressId: string) => TaskProgress | undefined;
}

// ============================================================================
// Store Creator
// ============================================================================

/**
 * Creates the progress store logic.
 * Use this with `create` from zustand to add platform-specific middleware.
 */
export const createProgressSlice: StateCreator<ProgressState> = (set, get) => ({
  progressByAgent: {},
  expandedProgressId: null,
  loadingAgents: new Set(),

  setProgress: (agentId, progress) =>
    set((state) => ({
      progressByAgent: {
        ...state.progressByAgent,
        [agentId]: progress.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
      },
    })),

  addProgress: (agentId, progress) =>
    set((state) => {
      const existing = state.progressByAgent[agentId] || [];
      return {
        progressByAgent: {
          ...state.progressByAgent,
          [agentId]: [progress, ...existing],
        },
      };
    }),

  updateProgress: (progressId, updates) =>
    set((state) => {
      const newState = { ...state.progressByAgent };

      for (const [agentId, progressList] of Object.entries(newState)) {
        const idx = progressList.findIndex((p) => p.id === progressId);
        if (idx !== -1) {
          const existing = progressList[idx];
          if (existing) {
            newState[agentId] = [
              ...progressList.slice(0, idx),
              { ...existing, ...updates },
              ...progressList.slice(idx + 1),
            ];
          }
          break;
        }
      }

      return { progressByAgent: newState };
    }),

  updateStep: (progressId, stepIndex, updates) =>
    set((state) => {
      const newState = { ...state.progressByAgent };

      for (const [agentId, progressList] of Object.entries(newState)) {
        const idx = progressList.findIndex((p) => p.id === progressId);
        if (idx !== -1) {
          const progress = progressList[idx];
          if (!progress) continue;

          const newSteps = [...progress.steps];
          const existingStep = newSteps[stepIndex];
          if (existingStep) {
            newSteps[stepIndex] = { ...existingStep, ...updates };
          }

          // Recalculate completed steps
          const completedSteps = newSteps.filter((s) => s.status === 'completed').length;

          newState[agentId] = [
            ...progressList.slice(0, idx),
            {
              ...progress,
              steps: newSteps,
              completedSteps,
              progressPercent: Math.round((completedSteps / newSteps.length) * 100),
            },
            ...progressList.slice(idx + 1),
          ];
          break;
        }
      }

      return { progressByAgent: newState };
    }),

  removeProgress: (agentId, progressId) =>
    set((state) => {
      const existing = state.progressByAgent[agentId] || [];
      return {
        progressByAgent: {
          ...state.progressByAgent,
          [agentId]: existing.filter((p) => p.id !== progressId),
        },
      };
    }),

  setExpanded: (progressId) => set({ expandedProgressId: progressId }),

  setLoading: (agentId, loading) =>
    set((state) => {
      const newSet = new Set(state.loadingAgents);
      if (loading) {
        newSet.add(agentId);
      } else {
        newSet.delete(agentId);
      }
      return { loadingAgents: newSet };
    }),

  getProgress: (agentId) => {
    const state = get();
    return state.progressByAgent[agentId] || [];
  },

  getActiveProgress: (agentId) => {
    const state = get();
    const progressList = state.progressByAgent[agentId] || [];
    return progressList.find((p) => p.status === 'in_progress') || null;
  },

  getProgressById: (progressId) => {
    const state = get();
    for (const progressList of Object.values(state.progressByAgent)) {
      const found = progressList.find((p) => p.id === progressId);
      if (found) return found;
    }
    return undefined;
  },
});

/**
 * Create a vanilla (non-React) progress store.
 */
export function createProgressStore() {
  return createStore<ProgressState>()(createProgressSlice);
}
