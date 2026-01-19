import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

export interface SkillStep {
  name: string;
  description: string;
  tool?: string;
  skill?: string; // For chained skills
  parameters: Record<string, unknown>;
  condition?: string;
  onSuccess?: string;
  onFailure?: string;
  parallelWith?: string[];
  required: boolean;
}

export interface Skill {
  id: string;
  name: string;
  slug: string;
  description: string;
  version: string;
  author: string;
  skillType: 'system' | 'user';
  tags: string[];
  triggers: string[];
  requiredTools: string[];
  requiredContext: string[];
  steps: SkillStep[];
  systemPrompt?: string;
  examples?: { input: string; output: string }[];
  metadata?: {
    category?: string;
    estimatedDuration?: number;
    requiresApproval?: boolean;
  };
  isActive: boolean;
  isDefault: boolean;
}

export interface SkillExecution {
  id: string;
  skillSlug: string;
  skillName: string;
  sessionId: string;
  agentId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  currentStepIndex: number;
  currentStepName: string;
  totalSteps: number;
  stepsCompleted: number;
  startedAt: Date;
  completedAt?: Date;
  durationMs?: number;
  error?: string;
  results: {
    step: string;
    status: 'success' | 'failed' | 'skipped' | 'error' | 'running';
    tool?: string;
    skill?: string;
    result?: unknown;
    error?: string;
  }[];
}

interface SkillsState {
  // Available skills (system + user)
  skills: Skill[];
  skillsLoading: boolean;
  skillsError: string | null;

  // Active skill executions by session
  executionsBySession: Record<string, SkillExecution[]>;

  // Expanded execution for detail view
  expandedExecutionId: string | null;

  // Filter state
  tagFilter: string | null;
  typeFilter: 'all' | 'system' | 'user';
  searchQuery: string;

  // Actions
  setSkills: (skills: Skill[]) => void;
  setSkillsLoading: (loading: boolean) => void;
  setSkillsError: (error: string | null) => void;

  // Execution actions
  startExecution: (execution: SkillExecution) => void;
  updateExecutionStep: (
    sessionId: string,
    executionId: string,
    stepName: string,
    stepIndex: number,
    status: 'running' | 'success' | 'failed' | 'skipped' | 'error'
  ) => void;
  completeExecution: (
    sessionId: string,
    executionId: string,
    success: boolean,
    durationMs: number
  ) => void;
  clearSessionExecutions: (sessionId: string) => void;

  // Filter actions
  setTagFilter: (tag: string | null) => void;
  setTypeFilter: (type: 'all' | 'system' | 'user') => void;
  setSearchQuery: (query: string) => void;
  setExpandedExecution: (id: string | null) => void;

  // Getters
  getSkillBySlug: (slug: string) => Skill | undefined;
  getFilteredSkills: () => Skill[];
  getActiveExecutions: (sessionId: string) => SkillExecution[];
  getExecution: (sessionId: string, executionId: string) => SkillExecution | undefined;
}

export const useSkillsStore = create<SkillsState>()(
  devtools(
    (set, get) => ({
      skills: [],
      skillsLoading: false,
      skillsError: null,
      executionsBySession: {},
      expandedExecutionId: null,
      tagFilter: null,
      typeFilter: 'all',
      searchQuery: '',

      setSkills: (skills) => set({ skills, skillsError: null }),
      setSkillsLoading: (loading) => set({ skillsLoading: loading }),
      setSkillsError: (error) => set({ skillsError: error }),

      startExecution: (execution) =>
        set((state) => {
          const sessionExecutions = state.executionsBySession[execution.sessionId] || [];
          return {
            executionsBySession: {
              ...state.executionsBySession,
              [execution.sessionId]: [execution, ...sessionExecutions],
            },
          };
        }),

      updateExecutionStep: (sessionId, executionId, stepName, stepIndex, status) =>
        set((state) => {
          const sessionExecutions = state.executionsBySession[sessionId];
          if (!sessionExecutions) return state;

          const idx = sessionExecutions.findIndex((e) => e.id === executionId);
          if (idx === -1) return state;

          const execution = sessionExecutions[idx];
          if (!execution) return state;

          const updatedResults = [...execution.results];

          // Update or add step result
          const stepResultIdx = updatedResults.findIndex((r) => r.step === stepName);
          if (stepResultIdx !== -1) {
            const existingResult = updatedResults[stepResultIdx];
            if (existingResult) {
              updatedResults[stepResultIdx] = {
                ...existingResult,
                status,
              };
            }
          } else {
            updatedResults.push({ step: stepName, status });
          }

          const updatedExecution: SkillExecution = {
            ...execution,
            currentStepIndex: stepIndex,
            currentStepName: stepName,
            stepsCompleted:
              status === 'success'
                ? Math.max(execution.stepsCompleted, stepIndex + 1)
                : execution.stepsCompleted,
            results: updatedResults,
          };

          return {
            executionsBySession: {
              ...state.executionsBySession,
              [sessionId]: [
                ...sessionExecutions.slice(0, idx),
                updatedExecution,
                ...sessionExecutions.slice(idx + 1),
              ],
            },
          };
        }),

      completeExecution: (sessionId, executionId, success, durationMs) =>
        set((state) => {
          const sessionExecutions = state.executionsBySession[sessionId];
          if (!sessionExecutions) return state;

          const idx = sessionExecutions.findIndex((e) => e.id === executionId);
          if (idx === -1) return state;

          const execution = sessionExecutions[idx];
          if (!execution) return state;

          const updatedExecution: SkillExecution = {
            ...execution,
            status: success ? 'completed' : 'failed',
            completedAt: new Date(),
            durationMs,
          };

          return {
            executionsBySession: {
              ...state.executionsBySession,
              [sessionId]: [
                ...sessionExecutions.slice(0, idx),
                updatedExecution,
                ...sessionExecutions.slice(idx + 1),
              ],
            },
          };
        }),

      clearSessionExecutions: (sessionId) =>
        set((state) => {
          const newExecutions = { ...state.executionsBySession };
          delete newExecutions[sessionId];
          return { executionsBySession: newExecutions };
        }),

      setTagFilter: (tag) => set({ tagFilter: tag }),
      setTypeFilter: (type) => set({ typeFilter: type }),
      setSearchQuery: (query) => set({ searchQuery: query }),
      setExpandedExecution: (id) => set({ expandedExecutionId: id }),

      getSkillBySlug: (slug) => {
        const state = get();
        return state.skills.find((s) => s.slug === slug);
      },

      getFilteredSkills: () => {
        const state = get();
        let filtered = state.skills;

        // Filter by type
        if (state.typeFilter !== 'all') {
          filtered = filtered.filter((s) => s.skillType === state.typeFilter);
        }

        // Filter by tag
        if (state.tagFilter) {
          filtered = filtered.filter((s) => s.tags.includes(state.tagFilter!));
        }

        // Filter by search query
        if (state.searchQuery) {
          const query = state.searchQuery.toLowerCase();
          filtered = filtered.filter(
            (s) =>
              s.name.toLowerCase().includes(query) ||
              s.description.toLowerCase().includes(query) ||
              s.tags.some((t) => t.toLowerCase().includes(query))
          );
        }

        return filtered;
      },

      getActiveExecutions: (sessionId) => {
        const state = get();
        const executions = state.executionsBySession[sessionId] || [];
        return executions.filter((e) => e.status === 'pending' || e.status === 'running');
      },

      getExecution: (sessionId, executionId) => {
        const state = get();
        const executions = state.executionsBySession[sessionId] || [];
        return executions.find((e) => e.id === executionId);
      },
    }),
    { name: 'podex-skills' }
  )
);
