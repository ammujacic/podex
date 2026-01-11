import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

export interface CostBreakdown {
  totalCost: number;
  inputCost: number;
  outputCost: number;
  cachedInputCost: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  callCount: number;
  byModel: Record<string, ModelCost>;
  byAgent: Record<string, AgentCost>;
}

export interface ModelCost {
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

export interface AgentCost {
  tokens: number;
  cost: number;
}

export interface Budget {
  id: string;
  userId: string;
  sessionId: string | null;
  amount: number;
  period: 'session' | 'daily' | 'weekly' | 'monthly';
  warningThreshold: number;
  hardLimit: boolean;
  createdAt: Date;
  expiresAt: Date | null;
}

export interface BudgetStatus {
  budget: Budget;
  spent: number;
  remaining: number;
  percentageUsed: number;
  periodStart: Date | null;
}

export type AlertType =
  | 'threshold_warning'
  | 'budget_exceeded'
  | 'daily_limit'
  | 'unusual_spike'
  | 'session_limit';

export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface BudgetAlert {
  id: string;
  alertType: AlertType;
  severity: AlertSeverity;
  message: string;
  currentSpent: number;
  budgetAmount: number;
  percentageUsed: number;
  createdAt: Date;
  acknowledged: boolean;
}

export interface UsageEntry {
  callId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cost: number;
  timestamp: Date;
  agentId: string | null;
}

export interface DailyUsage {
  date: string;
  totalCost: number;
  totalTokens: number;
  callCount: number;
}

interface CostState {
  // Session costs
  sessionCosts: Record<string, CostBreakdown>;
  currentSessionId: string | null;

  // Budgets
  budgets: Budget[];
  budgetStatuses: BudgetStatus[];

  // Alerts
  alerts: BudgetAlert[];
  unreadAlertCount: number;

  // Usage history
  usageHistory: UsageEntry[];
  dailyUsage: DailyUsage[];

  // UI state
  showBudgetDialog: boolean;
  showAlertDialog: boolean;
  selectedAlert: BudgetAlert | null;

  // Loading states
  loading: boolean;
  error: string | null;

  // Actions
  setSessionCost: (sessionId: string, cost: CostBreakdown) => void;
  updateSessionCost: (sessionId: string, update: Partial<CostBreakdown>) => void;
  setCurrentSession: (sessionId: string | null) => void;
  setBudgets: (budgets: Budget[]) => void;
  addBudget: (budget: Budget) => void;
  removeBudget: (budgetId: string) => void;
  setBudgetStatuses: (statuses: BudgetStatus[]) => void;
  setAlerts: (alerts: BudgetAlert[]) => void;
  addAlert: (alert: BudgetAlert) => void;
  acknowledgeAlert: (alertId: string) => void;
  setUsageHistory: (history: UsageEntry[]) => void;
  setDailyUsage: (daily: DailyUsage[]) => void;
  setShowBudgetDialog: (show: boolean) => void;
  setShowAlertDialog: (show: boolean) => void;
  setSelectedAlert: (alert: BudgetAlert | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  getCurrentCost: () => CostBreakdown | null;
  getActiveBudgetStatus: () => BudgetStatus | null;
}

const emptyCostBreakdown: CostBreakdown = {
  totalCost: 0,
  inputCost: 0,
  outputCost: 0,
  cachedInputCost: 0,
  totalTokens: 0,
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
  callCount: 0,
  byModel: {},
  byAgent: {},
};

export const useCostStore = create<CostState>()(
  devtools(
    (set, get) => ({
      // Initial state
      sessionCosts: {},
      currentSessionId: null,
      budgets: [],
      budgetStatuses: [],
      alerts: [],
      unreadAlertCount: 0,
      usageHistory: [],
      dailyUsage: [],
      showBudgetDialog: false,
      showAlertDialog: false,
      selectedAlert: null,
      loading: false,
      error: null,

      // Actions
      setSessionCost: (sessionId, cost) =>
        set((state) => ({
          sessionCosts: {
            ...state.sessionCosts,
            [sessionId]: cost,
          },
        })),

      updateSessionCost: (sessionId, update) =>
        set((state) => {
          const current = state.sessionCosts[sessionId] || { ...emptyCostBreakdown };
          return {
            sessionCosts: {
              ...state.sessionCosts,
              [sessionId]: { ...current, ...update },
            },
          };
        }),

      setCurrentSession: (sessionId) => set({ currentSessionId: sessionId }),

      setBudgets: (budgets) => set({ budgets }),

      addBudget: (budget) =>
        set((state) => ({
          budgets: [...state.budgets, budget],
        })),

      removeBudget: (budgetId) =>
        set((state) => ({
          budgets: state.budgets.filter((b) => b.id !== budgetId),
        })),

      setBudgetStatuses: (statuses) => set({ budgetStatuses: statuses }),

      setAlerts: (alerts) =>
        set({
          alerts,
          unreadAlertCount: alerts.filter((a) => !a.acknowledged).length,
        }),

      addAlert: (alert) =>
        set((state) => ({
          alerts: [alert, ...state.alerts],
          unreadAlertCount: state.unreadAlertCount + (alert.acknowledged ? 0 : 1),
        })),

      acknowledgeAlert: (alertId) =>
        set((state) => ({
          alerts: state.alerts.map((a) => (a.id === alertId ? { ...a, acknowledged: true } : a)),
          unreadAlertCount: Math.max(0, state.unreadAlertCount - 1),
        })),

      setUsageHistory: (history) => set({ usageHistory: history }),

      setDailyUsage: (daily) => set({ dailyUsage: daily }),

      setShowBudgetDialog: (show) => set({ showBudgetDialog: show }),

      setShowAlertDialog: (show) => set({ showAlertDialog: show }),

      setSelectedAlert: (alert) => set({ selectedAlert: alert, showAlertDialog: !!alert }),

      setLoading: (loading) => set({ loading }),

      setError: (error) => set({ error }),

      getCurrentCost: () => {
        const state = get();
        if (!state.currentSessionId) return null;
        return state.sessionCosts[state.currentSessionId] || null;
      },

      getActiveBudgetStatus: () => {
        const state = get();
        if (!state.currentSessionId) return null;

        // First check for session-specific budget
        const sessionBudget = state.budgetStatuses.find(
          (s) => s.budget.sessionId === state.currentSessionId
        );
        if (sessionBudget) return sessionBudget;

        // Then check for user-level budgets (prefer monthly)
        return state.budgetStatuses.find((s) => !s.budget.sessionId) || null;
      },
    }),
    { name: 'cost-store' }
  )
);

// Utility functions
export function formatCost(cost: number): string {
  if (cost < 0.01) {
    return `$${cost.toFixed(4)}`;
  }
  return `$${cost.toFixed(2)}`;
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1000000) {
    return `${(tokens / 1000000).toFixed(1)}M`;
  }
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}K`;
  }
  return tokens.toString();
}

export function getAlertColor(alert: BudgetAlert): string {
  switch (alert.severity) {
    case 'critical':
      return 'text-red-500';
    case 'warning':
      return 'text-yellow-500';
    default:
      return 'text-blue-500';
  }
}

export function getAlertIcon(alert: BudgetAlert): string {
  switch (alert.alertType) {
    case 'budget_exceeded':
      return 'AlertOctagon';
    case 'threshold_warning':
      return 'AlertTriangle';
    case 'unusual_spike':
      return 'TrendingUp';
    default:
      return 'Bell';
  }
}

// Transform API response to store types
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function transformCostBreakdown(data: any): CostBreakdown {
  return {
    totalCost: data.total_cost ?? data.totalCost ?? 0,
    inputCost: data.input_cost ?? data.inputCost ?? 0,
    outputCost: data.output_cost ?? data.outputCost ?? 0,
    cachedInputCost: data.cached_input_cost ?? data.cachedInputCost ?? 0,
    totalTokens: data.total_tokens ?? data.totalTokens ?? 0,
    inputTokens: data.input_tokens ?? data.inputTokens ?? 0,
    outputTokens: data.output_tokens ?? data.outputTokens ?? 0,
    cachedInputTokens: data.cached_input_tokens ?? data.cachedInputTokens ?? 0,
    callCount: data.call_count ?? data.callCount ?? 0,
    byModel: data.by_model ?? data.byModel ?? {},
    byAgent: data.by_agent ?? data.byAgent ?? {},
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function transformBudget(data: any): Budget {
  return {
    id: data.id,
    userId: data.user_id ?? data.userId,
    sessionId: data.session_id ?? data.sessionId ?? null,
    amount: data.amount,
    period: data.period,
    warningThreshold: data.warning_threshold ?? data.warningThreshold ?? 0.8,
    hardLimit: data.hard_limit ?? data.hardLimit ?? false,
    createdAt: new Date(data.created_at ?? data.createdAt),
    expiresAt:
      (data.expires_at ?? data.expiresAt) ? new Date(data.expires_at ?? data.expiresAt) : null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function transformAlert(data: any): BudgetAlert {
  return {
    id: data.id,
    alertType: data.alert_type ?? data.alertType,
    severity: data.severity,
    message: data.message,
    currentSpent: data.current_spent ?? data.currentSpent,
    budgetAmount: data.budget_amount ?? data.budgetAmount,
    percentageUsed: data.percentage_used ?? data.percentageUsed,
    createdAt: new Date(data.created_at ?? data.createdAt),
    acknowledged: data.acknowledged ?? false,
  };
}

export default useCostStore;
