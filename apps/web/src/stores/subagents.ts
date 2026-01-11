import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

export interface Subagent {
  id: string;
  parentAgentId: string;
  sessionId: string;
  name: string;
  type: string;
  task: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  background: boolean;
  createdAt: Date;
  completedAt: Date | null;
  resultSummary: string | null;
  error: string | null;
  contextTokens: number;
}

interface SubagentsState {
  // Per-agent subagents: { agentId: Subagent[] }
  subagentsByAgent: Record<string, Subagent[]>;

  // Currently expanded subagent for detail view
  expandedSubagentId: string | null;

  // Loading states
  loadingAgents: Set<string>;

  // Actions
  setSubagents: (agentId: string, subagents: Subagent[]) => void;
  addSubagent: (agentId: string, subagent: Subagent) => void;
  updateSubagent: (subagentId: string, updates: Partial<Subagent>) => void;
  removeSubagent: (agentId: string, subagentId: string) => void;
  setExpanded: (subagentId: string | null) => void;
  setLoading: (agentId: string, loading: boolean) => void;

  // Getters
  getSubagents: (agentId: string) => Subagent[];
  getActiveSubagents: (agentId: string) => Subagent[];
  getSubagent: (subagentId: string) => Subagent | undefined;
}

export const useSubagentsStore = create<SubagentsState>()(
  devtools(
    (set, get) => ({
      subagentsByAgent: {},
      expandedSubagentId: null,
      loadingAgents: new Set(),

      setSubagents: (agentId, subagents) =>
        set((state) => ({
          subagentsByAgent: {
            ...state.subagentsByAgent,
            [agentId]: subagents.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
          },
        })),

      addSubagent: (agentId, subagent) =>
        set((state) => {
          const existing = state.subagentsByAgent[agentId] || [];
          return {
            subagentsByAgent: {
              ...state.subagentsByAgent,
              [agentId]: [subagent, ...existing],
            },
          };
        }),

      updateSubagent: (subagentId, updates) =>
        set((state) => {
          const newState = { ...state.subagentsByAgent };

          for (const [agentId, subagents] of Object.entries(newState)) {
            const idx = subagents.findIndex((s) => s.id === subagentId);
            if (idx !== -1) {
              newState[agentId] = [
                ...subagents.slice(0, idx),
                { ...subagents[idx], ...updates } as Subagent,
                ...subagents.slice(idx + 1),
              ];
              break;
            }
          }

          return { subagentsByAgent: newState };
        }),

      removeSubagent: (agentId, subagentId) =>
        set((state) => {
          const existing = state.subagentsByAgent[agentId] || [];
          return {
            subagentsByAgent: {
              ...state.subagentsByAgent,
              [agentId]: existing.filter((s) => s.id !== subagentId),
            },
          };
        }),

      setExpanded: (subagentId) => set({ expandedSubagentId: subagentId }),

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

      getSubagents: (agentId) => {
        const state = get();
        return state.subagentsByAgent[agentId] || [];
      },

      getActiveSubagents: (agentId) => {
        const state = get();
        const subagents = state.subagentsByAgent[agentId] || [];
        return subagents.filter((s) => s.status === 'pending' || s.status === 'running');
      },

      getSubagent: (subagentId) => {
        const state = get();
        for (const subagents of Object.values(state.subagentsByAgent)) {
          const found = subagents.find((s) => s.id === subagentId);
          if (found) return found;
        }
        return undefined;
      },
    }),
    { name: 'podex-subagents' }
  )
);
