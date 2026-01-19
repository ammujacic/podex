import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

export interface PendingChange {
  id: string;
  sessionId: string;
  agentId: string;
  agentName: string;
  filePath: string;
  originalContent: string | null;
  proposedContent: string;
  description: string | null;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: Date;
}

interface PendingChangesState {
  // Pending changes per session (sessionId -> changes)
  changes: Record<string, PendingChange[]>;

  // Currently reviewing change
  activeReviewId: string | null;
  activeSessionId: string | null;

  // Actions
  addChange: (change: PendingChange) => void;
  removeChange: (sessionId: string, changeId: string) => void;
  clearSessionChanges: (sessionId: string) => void;
  updateChangeStatus: (
    sessionId: string,
    changeId: string,
    status: PendingChange['status']
  ) => void;
  openReview: (sessionId: string, changeId: string) => void;
  closeReview: () => void;

  // Selectors
  getSessionChanges: (sessionId: string) => PendingChange[];
  getPendingCount: (sessionId: string) => number;
  hasPendingChanges: (sessionId: string) => boolean;
  getActiveChange: () => PendingChange | null;
}

export const usePendingChangesStore = create<PendingChangesState>()(
  devtools(
    (set, get) => ({
      changes: {},
      activeReviewId: null,
      activeSessionId: null,

      addChange: (change) =>
        set((state) => {
          const sessionChanges = state.changes[change.sessionId] || [];
          // Avoid duplicates
          if (sessionChanges.some((c) => c.id === change.id)) {
            return state;
          }
          return {
            changes: {
              ...state.changes,
              [change.sessionId]: [...sessionChanges, change],
            },
            // Auto-open diff review for the first pending change
            activeReviewId: state.activeReviewId ?? change.id,
            activeSessionId: state.activeSessionId ?? change.sessionId,
          };
        }),

      removeChange: (sessionId, changeId) =>
        set((state) => {
          const sessionChanges = state.changes[sessionId] || [];
          const updatedChanges = sessionChanges.filter((c) => c.id !== changeId);

          // If we removed the active review, show the next pending one
          let newActiveId = state.activeReviewId;
          let newActiveSession = state.activeSessionId;
          if (state.activeReviewId === changeId) {
            const nextPending = updatedChanges.find((c) => c.status === 'pending');
            newActiveId = nextPending?.id ?? null;
            newActiveSession = nextPending ? sessionId : null;
          }

          return {
            changes: {
              ...state.changes,
              [sessionId]: updatedChanges,
            },
            activeReviewId: newActiveId,
            activeSessionId: newActiveSession,
          };
        }),

      clearSessionChanges: (sessionId) =>
        set((state) => {
          const { [sessionId]: _removed, ...remaining } = state.changes;
          return {
            changes: remaining,
            activeReviewId: state.activeSessionId === sessionId ? null : state.activeReviewId,
            activeSessionId: state.activeSessionId === sessionId ? null : state.activeSessionId,
          };
        }),

      updateChangeStatus: (sessionId, changeId, status) => {
        set((state) => {
          const sessionChanges = state.changes[sessionId] || [];
          const updatedChanges = sessionChanges.map((c) =>
            c.id === changeId ? { ...c, status } : c
          );

          // If resolved, move to next pending
          let newActiveId = state.activeReviewId;
          let newActiveSession = state.activeSessionId;
          if (status !== 'pending' && state.activeReviewId === changeId) {
            const nextPending = updatedChanges.find((c) => c.status === 'pending');
            newActiveId = nextPending?.id ?? null;
            newActiveSession = nextPending ? sessionId : null;
          }

          return {
            changes: {
              ...state.changes,
              [sessionId]: updatedChanges,
            },
            activeReviewId: newActiveId,
            activeSessionId: newActiveSession,
          };
        });

        // Auto-remove resolved changes after a delay
        if (status !== 'pending') {
          setTimeout(() => {
            const currentState = get();
            const changes = currentState.changes[sessionId] || [];
            if (changes.some((c) => c.id === changeId)) {
              currentState.removeChange(sessionId, changeId);
            }
          }, 2000);
        }
      },

      openReview: (sessionId, changeId) =>
        set({
          activeReviewId: changeId,
          activeSessionId: sessionId,
        }),

      closeReview: () =>
        set({
          activeReviewId: null,
          activeSessionId: null,
        }),

      getSessionChanges: (sessionId) => {
        return get().changes[sessionId] || [];
      },

      getPendingCount: (sessionId) => {
        const sessionChanges = get().changes[sessionId] || [];
        return sessionChanges.filter((c) => c.status === 'pending').length;
      },

      hasPendingChanges: (sessionId) => {
        return get().getPendingCount(sessionId) > 0;
      },

      getActiveChange: () => {
        const state = get();
        if (!state.activeReviewId || !state.activeSessionId) return null;
        const sessionChanges = state.changes[state.activeSessionId] || [];
        return sessionChanges.find((c) => c.id === state.activeReviewId) ?? null;
      },
    }),
    { name: 'pending-changes' }
  )
);

// Helper function to convert API response to store format
export function apiChangeToStoreChange(apiChange: {
  id: string;
  session_id: string;
  agent_id: string;
  agent_name: string;
  file_path: string;
  original_content: string | null;
  proposed_content: string;
  description: string | null;
  status: string;
  created_at: string;
}): PendingChange {
  return {
    id: apiChange.id,
    sessionId: apiChange.session_id,
    agentId: apiChange.agent_id,
    agentName: apiChange.agent_name,
    filePath: apiChange.file_path,
    originalContent: apiChange.original_content,
    proposedContent: apiChange.proposed_content,
    description: apiChange.description,
    status: apiChange.status as PendingChange['status'],
    createdAt: new Date(apiChange.created_at),
  };
}
