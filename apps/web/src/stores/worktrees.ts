import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

export interface Worktree {
  id: string;
  agentId: string;
  sessionId: string;
  worktreePath: string;
  branchName: string;
  status:
    | 'creating'
    | 'active'
    | 'merging'
    | 'merged'
    | 'conflict'
    | 'cleanup'
    | 'deleted'
    | 'failed';
  createdAt: Date;
  mergedAt: Date | null;
}

interface WorktreesState {
  // Per-session worktrees
  sessionWorktrees: Record<string, Worktree[]>;

  // Currently selected worktree for viewing
  selectedWorktreeId: string | null;

  // Worktree being operated on (merge/delete)
  operatingWorktreeId: string | null;

  // Loading states
  loading: Record<string, boolean>;

  // Actions
  setWorktrees: (sessionId: string, worktrees: Worktree[]) => void;
  addWorktree: (sessionId: string, worktree: Worktree) => void;
  updateWorktreeStatus: (sessionId: string, worktreeId: string, status: Worktree['status']) => void;
  removeWorktree: (sessionId: string, worktreeId: string) => void;
  selectWorktree: (worktreeId: string | null) => void;
  setOperating: (worktreeId: string | null) => void;
  setLoading: (sessionId: string, loading: boolean) => void;

  // Getters
  getWorktrees: (sessionId: string) => Worktree[];
  getWorktree: (sessionId: string, worktreeId: string) => Worktree | undefined;
  getAgentWorktree: (sessionId: string, agentId: string) => Worktree | undefined;
}

export const useWorktreesStore = create<WorktreesState>()(
  devtools(
    (set, get) => ({
      sessionWorktrees: {},
      selectedWorktreeId: null,
      operatingWorktreeId: null,
      loading: {},

      setWorktrees: (sessionId, worktrees) =>
        set((state) => ({
          sessionWorktrees: {
            ...state.sessionWorktrees,
            [sessionId]: worktrees.sort(
              (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
            ),
          },
        })),

      addWorktree: (sessionId, worktree) =>
        set((state) => {
          const existing = state.sessionWorktrees[sessionId] || [];
          const newList = [...existing, worktree].sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          );
          return {
            sessionWorktrees: {
              ...state.sessionWorktrees,
              [sessionId]: newList,
            },
          };
        }),

      updateWorktreeStatus: (sessionId, worktreeId, status) =>
        set((state) => {
          const worktrees = state.sessionWorktrees[sessionId];
          if (!worktrees) return state;

          return {
            sessionWorktrees: {
              ...state.sessionWorktrees,
              [sessionId]: worktrees.map((wt) => (wt.id === worktreeId ? { ...wt, status } : wt)),
            },
          };
        }),

      removeWorktree: (sessionId, worktreeId) =>
        set((state) => {
          const worktrees = state.sessionWorktrees[sessionId];
          if (!worktrees) return state;

          return {
            sessionWorktrees: {
              ...state.sessionWorktrees,
              [sessionId]: worktrees.filter((wt) => wt.id !== worktreeId),
            },
          };
        }),

      selectWorktree: (worktreeId) => set({ selectedWorktreeId: worktreeId }),

      setOperating: (worktreeId) => set({ operatingWorktreeId: worktreeId }),

      setLoading: (sessionId, loading) =>
        set((state) => ({
          loading: {
            ...state.loading,
            [sessionId]: loading,
          },
        })),

      getWorktrees: (sessionId) => {
        const state = get();
        return state.sessionWorktrees[sessionId] || [];
      },

      getWorktree: (sessionId, worktreeId) => {
        const state = get();
        const worktrees = state.sessionWorktrees[sessionId];
        return worktrees?.find((wt) => wt.id === worktreeId);
      },

      getAgentWorktree: (sessionId, agentId) => {
        const state = get();
        const worktrees = state.sessionWorktrees[sessionId] || [];
        return worktrees.find((wt) => wt.agentId === agentId);
      },
    }),
    { name: 'podex-worktrees' }
  )
);
