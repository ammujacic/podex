import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { useConfigStore } from '@/stores/config';

export interface ContextUsage {
  tokensUsed: number;
  tokensMax: number;
  percentage: number;
  lastUpdated: Date;
}

export interface CompactionSettings {
  autoCompactEnabled: boolean;
  autoCompactThresholdPercent: number;
  customCompactionInstructions: string | null;
  preserveRecentMessages: number;
}

export interface CompactionLog {
  id: string;
  agentId: string;
  tokensBefore: number;
  tokensAfter: number;
  messagesRemoved: number;
  messagesPreserved: number;
  summaryText: string | null;
  triggerType: 'auto' | 'manual' | 'threshold';
  createdAt: Date;
}

interface ContextState {
  // Per-agent context usage tracking
  agentUsage: Record<string, ContextUsage>;

  // Per-session settings
  sessionSettings: Record<string, CompactionSettings>;

  // Compaction history per session
  compactionHistory: Record<string, CompactionLog[]>;

  // Compaction in progress
  compactingAgents: Set<string>;

  // Actions
  updateAgentUsage: (agentId: string, usage: Partial<ContextUsage>) => void;
  setAgentUsage: (agentId: string, usage: ContextUsage) => void;
  clearAgentUsage: (agentId: string) => void;

  updateSessionSettings: (sessionId: string, settings: Partial<CompactionSettings>) => void;
  getSessionSettings: (sessionId: string) => CompactionSettings;

  addCompactionLog: (sessionId: string, log: CompactionLog) => void;
  getCompactionHistory: (sessionId: string) => CompactionLog[];

  setCompacting: (agentId: string, isCompacting: boolean) => void;
  isCompacting: (agentId: string) => boolean;

  // Computed helpers
  getUsageLevel: (agentId: string) => 'normal' | 'warning' | 'critical';
  shouldAutoCompact: (agentId: string, sessionId: string) => boolean;
}

// Helper to get defaults from ConfigStore (config is guaranteed to be loaded by ConfigGate)
function getDefaultSettings(): CompactionSettings {
  const configDefaults = useConfigStore.getState().getContextCompactionDefaults();
  if (!configDefaults) {
    throw new Error('ConfigStore not initialized - context_compaction_defaults not available');
  }
  return {
    autoCompactEnabled: configDefaults.autoCompactEnabled,
    autoCompactThresholdPercent: configDefaults.autoCompactThresholdPercent,
    customCompactionInstructions: configDefaults.customCompactionInstructions,
    preserveRecentMessages: configDefaults.preserveRecentMessages,
  };
}

function getDefaultUsage(): ContextUsage {
  const configDefaults = useConfigStore.getState().getContextUsageDefaults();
  if (!configDefaults) {
    throw new Error('ConfigStore not initialized - context_usage_defaults not available');
  }
  return {
    tokensUsed: configDefaults.tokensUsed,
    tokensMax: configDefaults.tokensMax,
    percentage: configDefaults.percentage,
    lastUpdated: new Date(),
  };
}

export const useContextStore = create<ContextState>()(
  devtools(
    persist(
      (set, get) => ({
        agentUsage: {},
        sessionSettings: {},
        compactionHistory: {},
        compactingAgents: new Set(),

        updateAgentUsage: (agentId, usage) =>
          set((state) => {
            const current = state.agentUsage[agentId] || getDefaultUsage();
            const updated = {
              ...current,
              ...usage,
              lastUpdated: new Date(),
            };
            // Recalculate percentage
            updated.percentage = Math.round((updated.tokensUsed / updated.tokensMax) * 100);
            return {
              agentUsage: {
                ...state.agentUsage,
                [agentId]: updated,
              },
            };
          }),

        setAgentUsage: (agentId, usage) =>
          set((state) => ({
            agentUsage: {
              ...state.agentUsage,
              [agentId]: {
                ...usage,
                percentage: Math.round((usage.tokensUsed / usage.tokensMax) * 100),
              },
            },
          })),

        clearAgentUsage: (agentId) =>
          set((state) => {
            const { [agentId]: _removed, ...remaining } = state.agentUsage;
            return { agentUsage: remaining };
          }),

        updateSessionSettings: (sessionId, settings) =>
          set((state) => ({
            sessionSettings: {
              ...state.sessionSettings,
              [sessionId]: {
                ...getDefaultSettings(),
                ...state.sessionSettings[sessionId],
                ...settings,
              },
            },
          })),

        getSessionSettings: (sessionId) => {
          const state = get();
          return state.sessionSettings[sessionId] || getDefaultSettings();
        },

        addCompactionLog: (sessionId, log) =>
          set((state) => {
            const history = state.compactionHistory[sessionId] || [];
            return {
              compactionHistory: {
                ...state.compactionHistory,
                [sessionId]: [...history, log].slice(-50), // Keep last 50
              },
            };
          }),

        getCompactionHistory: (sessionId) => {
          const state = get();
          return state.compactionHistory[sessionId] || [];
        },

        setCompacting: (agentId, isCompacting) =>
          set((state) => {
            const newSet = new Set(state.compactingAgents);
            if (isCompacting) {
              newSet.add(agentId);
            } else {
              newSet.delete(agentId);
            }
            return { compactingAgents: newSet };
          }),

        isCompacting: (agentId) => {
          const state = get();
          return state.compactingAgents.has(agentId);
        },

        getUsageLevel: (agentId) => {
          const state = get();
          const usage = state.agentUsage[agentId];
          if (!usage) return 'normal';
          if (usage.percentage >= 90) return 'critical';
          if (usage.percentage >= 70) return 'warning';
          return 'normal';
        },

        shouldAutoCompact: (agentId, sessionId) => {
          const state = get();
          const usage = state.agentUsage[agentId];
          const settings = state.sessionSettings[sessionId] || getDefaultSettings();

          if (!usage || !settings.autoCompactEnabled) return false;
          return usage.percentage >= settings.autoCompactThresholdPercent;
        },
      }),
      {
        name: 'podex-context',
        partialize: (state) => ({
          sessionSettings: state.sessionSettings,
          // Don't persist usage or history - they're session-specific
        }),
      }
    )
  )
);
