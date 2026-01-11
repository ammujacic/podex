import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

export type PlanStatus =
  | 'pending'
  | 'generating'
  | 'completed'
  | 'failed'
  | 'selected'
  | 'rejected';

export interface PlanStep {
  index: number;
  title: string;
  description: string;
  estimatedComplexity: 'low' | 'medium' | 'high';
  filesAffected: string[];
  dependencies: number[];
}

export interface GeneratedPlan {
  id: string;
  sessionId: string;
  agentId: string;
  taskDescription: string;
  approachName: string;
  approachSummary: string;
  steps: PlanStep[];
  modelUsed: string;
  status: PlanStatus;
  totalEstimatedComplexity: 'low' | 'medium' | 'high';
  pros: string[];
  cons: string[];
  createdAt: Date;
  generationTimeMs: number;
  error: string | null;
}

export interface PlanComparison {
  planIds: string[];
  complexityScores: Record<string, number>;
  stepCounts: Record<string, number>;
  filesTouched: Record<string, number>;
  sharedFiles: string[];
  uniqueApproaches: Record<string, string[]>;
  recommendations: string[];
}

export interface BackgroundPlanTask {
  id: string;
  sessionId: string;
  agentId: string;
  taskDescription: string;
  numPlans: number;
  models: string[];
  status: 'queued' | 'running' | 'completed' | 'cancelled' | 'failed';
  planIds: string[];
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  error: string | null;
}

export interface PlanningSettings {
  planningModel: string;
  executionModel: string;
  parallelPlans: number;
  backgroundPlanning: boolean;
  autoSelectSimplest: boolean;
}

interface PlanningState {
  // Plans by session
  plansBySession: Record<string, GeneratedPlan[]>;
  // Currently selected plan per session
  selectedPlanId: Record<string, string | null>;
  // Background tasks
  backgroundTasks: BackgroundPlanTask[];
  // Comparison data
  comparison: PlanComparison | null;
  // UI state
  isGenerating: boolean;
  showComparisonView: boolean;
  comparisonPlanIds: string[];
  // Settings
  settings: PlanningSettings;

  // Actions
  setPlans: (sessionId: string, plans: GeneratedPlan[]) => void;
  addPlan: (plan: GeneratedPlan) => void;
  updatePlan: (planId: string, updates: Partial<GeneratedPlan>) => void;
  selectPlan: (sessionId: string, planId: string) => void;
  setIsGenerating: (isGenerating: boolean) => void;
  setComparison: (comparison: PlanComparison | null) => void;
  setShowComparisonView: (show: boolean) => void;
  setComparisonPlanIds: (planIds: string[]) => void;
  addBackgroundTask: (task: BackgroundPlanTask) => void;
  updateBackgroundTask: (taskId: string, updates: Partial<BackgroundPlanTask>) => void;
  updateSettings: (updates: Partial<PlanningSettings>) => void;

  // Computed
  getSessionPlans: (sessionId: string) => GeneratedPlan[];
  getSelectedPlan: (sessionId: string) => GeneratedPlan | null;
  getPendingTasks: (sessionId: string) => BackgroundPlanTask[];
}

export const usePlanningStore = create<PlanningState>()(
  devtools(
    (set, get) => ({
      plansBySession: {},
      selectedPlanId: {},
      backgroundTasks: [],
      comparison: null,
      isGenerating: false,
      showComparisonView: false,
      comparisonPlanIds: [],
      settings: {
        planningModel: 'claude-opus-4-20250514',
        executionModel: 'claude-sonnet-4-20250514',
        parallelPlans: 3,
        backgroundPlanning: true,
        autoSelectSimplest: false,
      },

      setPlans: (sessionId, plans) =>
        set((state) => ({
          plansBySession: {
            ...state.plansBySession,
            [sessionId]: plans,
          },
        })),

      addPlan: (plan) =>
        set((state) => {
          const sessionPlans = state.plansBySession[plan.sessionId] || [];
          return {
            plansBySession: {
              ...state.plansBySession,
              [plan.sessionId]: [...sessionPlans, plan],
            },
          };
        }),

      updatePlan: (planId, updates) =>
        set((state) => {
          const newPlansBySession = { ...state.plansBySession };
          for (const sessionId in newPlansBySession) {
            newPlansBySession[sessionId] = (newPlansBySession[sessionId] ?? []).map((p) =>
              p.id === planId ? { ...p, ...updates } : p
            );
          }
          return { plansBySession: newPlansBySession };
        }),

      selectPlan: (sessionId, planId) =>
        set((state) => {
          // Update status of all plans in session
          const sessionPlans = state.plansBySession[sessionId] || [];
          const updatedPlans = sessionPlans.map((p) => ({
            ...p,
            status:
              p.id === planId
                ? ('selected' as const)
                : p.status === 'completed'
                  ? ('rejected' as const)
                  : p.status,
          }));

          return {
            selectedPlanId: {
              ...state.selectedPlanId,
              [sessionId]: planId,
            },
            plansBySession: {
              ...state.plansBySession,
              [sessionId]: updatedPlans,
            },
          };
        }),

      setIsGenerating: (isGenerating) => set({ isGenerating }),

      setComparison: (comparison) => set({ comparison }),

      setShowComparisonView: (show) => set({ showComparisonView: show }),

      setComparisonPlanIds: (planIds) => set({ comparisonPlanIds: planIds }),

      addBackgroundTask: (task) =>
        set((state) => ({
          backgroundTasks: [...state.backgroundTasks, task],
        })),

      updateBackgroundTask: (taskId, updates) =>
        set((state) => ({
          backgroundTasks: state.backgroundTasks.map((t) =>
            t.id === taskId ? { ...t, ...updates } : t
          ),
        })),

      updateSettings: (updates) =>
        set((state) => ({
          settings: { ...state.settings, ...updates },
        })),

      getSessionPlans: (sessionId) => {
        return get().plansBySession[sessionId] || [];
      },

      getSelectedPlan: (sessionId) => {
        const { plansBySession, selectedPlanId } = get();
        const planId = selectedPlanId[sessionId];
        if (!planId) return null;
        return plansBySession[sessionId]?.find((p) => p.id === planId) || null;
      },

      getPendingTasks: (sessionId) => {
        return get().backgroundTasks.filter(
          (t) => t.sessionId === sessionId && (t.status === 'queued' || t.status === 'running')
        );
      },
    }),
    { name: 'planning-store' }
  )
);

// Transform API response to store format
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function transformPlan(data: any): GeneratedPlan {
  return {
    id: data.id,
    sessionId: data.session_id,
    agentId: data.agent_id,
    taskDescription: data.task_description,
    approachName: data.approach_name,
    approachSummary: data.approach_summary,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    steps: (data.steps || []).map((s: any) => ({
      index: s.index,
      title: s.title,
      description: s.description,
      estimatedComplexity: s.estimated_complexity,
      filesAffected: s.files_affected || [],
      dependencies: s.dependencies || [],
    })),
    modelUsed: data.model_used,
    status: data.status as PlanStatus,
    totalEstimatedComplexity: data.total_estimated_complexity || 'medium',
    pros: data.pros || [],
    cons: data.cons || [],
    createdAt: new Date(data.created_at),
    generationTimeMs: data.generation_time_ms || 0,
    error: data.error,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function transformBackgroundTask(data: any): BackgroundPlanTask {
  return {
    id: data.id,
    sessionId: data.session_id,
    agentId: data.agent_id,
    taskDescription: data.task_description,
    numPlans: data.num_plans,
    models: data.models,
    status: data.status,
    planIds: data.plan_ids || [],
    createdAt: new Date(data.created_at),
    startedAt: data.started_at ? new Date(data.started_at) : null,
    completedAt: data.completed_at ? new Date(data.completed_at) : null,
    error: data.error,
  };
}

// Available models for planning
export const AVAILABLE_MODELS = [
  { id: 'claude-opus-4-20250514', name: 'Claude Opus 4', tier: 'premium' },
  { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', tier: 'standard' },
  { id: 'gpt-4o', name: 'GPT-4o', tier: 'premium' },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', tier: 'standard' },
] as const;
