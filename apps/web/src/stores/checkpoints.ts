import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

export interface CheckpointFile {
  path: string;
  changeType: 'create' | 'modify' | 'delete';
  linesAdded: number;
  linesRemoved: number;
}

export interface Checkpoint {
  id: string;
  checkpointNumber: number;
  description: string | null;
  actionType: string;
  agentId: string;
  status: 'active' | 'restored' | 'superseded';
  createdAt: Date;
  files: CheckpointFile[];
  fileCount: number;
  totalLinesAdded: number;
  totalLinesRemoved: number;
}

export interface CheckpointDiff {
  id: string;
  description: string | null;
  files: Array<{
    path: string;
    changeType: string;
    contentBefore: string | null;
    contentAfter: string | null;
    linesAdded: number;
    linesRemoved: number;
  }>;
}

interface CheckpointsState {
  // Per-session checkpoints
  sessionCheckpoints: Record<string, Checkpoint[]>;

  // Currently selected checkpoint for viewing
  selectedCheckpointId: string | null;

  // Checkpoint being restored
  restoringCheckpointId: string | null;

  // Loading states
  loading: Record<string, boolean>;

  // Actions
  setCheckpoints: (sessionId: string, checkpoints: Checkpoint[]) => void;
  addCheckpoint: (sessionId: string, checkpoint: Checkpoint) => void;
  updateCheckpointStatus: (
    sessionId: string,
    checkpointId: string,
    status: Checkpoint['status']
  ) => void;
  selectCheckpoint: (checkpointId: string | null) => void;
  setRestoring: (checkpointId: string | null) => void;
  setLoading: (sessionId: string, loading: boolean) => void;

  // Getters
  getCheckpoints: (sessionId: string) => Checkpoint[];
  getCheckpoint: (sessionId: string, checkpointId: string) => Checkpoint | undefined;
  getAgentCheckpoints: (sessionId: string, agentId: string) => Checkpoint[];
}

export const useCheckpointsStore = create<CheckpointsState>()(
  devtools(
    (set, get) => ({
      sessionCheckpoints: {},
      selectedCheckpointId: null,
      restoringCheckpointId: null,
      loading: {},

      setCheckpoints: (sessionId, checkpoints) =>
        set((state) => ({
          sessionCheckpoints: {
            ...state.sessionCheckpoints,
            [sessionId]: checkpoints.sort((a, b) => b.checkpointNumber - a.checkpointNumber),
          },
        })),

      addCheckpoint: (sessionId, checkpoint) =>
        set((state) => {
          const existing = state.sessionCheckpoints[sessionId] || [];
          // Insert at correct position based on checkpoint number
          const newList = [...existing, checkpoint].sort(
            (a, b) => b.checkpointNumber - a.checkpointNumber
          );
          return {
            sessionCheckpoints: {
              ...state.sessionCheckpoints,
              [sessionId]: newList,
            },
          };
        }),

      updateCheckpointStatus: (sessionId, checkpointId, status) =>
        set((state) => {
          const checkpoints = state.sessionCheckpoints[sessionId];
          if (!checkpoints) return state;

          return {
            sessionCheckpoints: {
              ...state.sessionCheckpoints,
              [sessionId]: checkpoints.map((cp) =>
                cp.id === checkpointId ? { ...cp, status } : cp
              ),
            },
          };
        }),

      selectCheckpoint: (checkpointId) => set({ selectedCheckpointId: checkpointId }),

      setRestoring: (checkpointId) => set({ restoringCheckpointId: checkpointId }),

      setLoading: (sessionId, loading) =>
        set((state) => ({
          loading: {
            ...state.loading,
            [sessionId]: loading,
          },
        })),

      getCheckpoints: (sessionId) => {
        const state = get();
        return state.sessionCheckpoints[sessionId] || [];
      },

      getCheckpoint: (sessionId, checkpointId) => {
        const state = get();
        const checkpoints = state.sessionCheckpoints[sessionId];
        return checkpoints?.find((cp) => cp.id === checkpointId);
      },

      getAgentCheckpoints: (sessionId, agentId) => {
        const state = get();
        const checkpoints = state.sessionCheckpoints[sessionId] || [];
        return checkpoints.filter((cp) => cp.agentId === agentId);
      },
    }),
    { name: 'podex-checkpoints' }
  )
);
