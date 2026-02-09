import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import * as api from '@/lib/api';
import type {
  LocalPod,
  CreateLocalPodRequest,
  CreateLocalPodResponse,
  UpdateLocalPodRequest,
  RegenerateTokenResponse,
} from '@/lib/api';

interface LocalPodsState {
  // Data
  pods: LocalPod[];
  selectedPodId: string | null;

  // Loading states
  isLoading: boolean;
  isCreating: boolean;
  isDeleting: Set<string>;
  isRegenerating: Set<string>;

  // Error
  error: string | null;

  // Token display (only shown once after create/regenerate)
  newToken: { podId: string; token: string } | null;

  // Actions
  loadPods: () => Promise<void>;
  createPod: (data: CreateLocalPodRequest) => Promise<CreateLocalPodResponse>;
  updatePod: (podId: string, data: UpdateLocalPodRequest) => Promise<void>;
  deletePod: (podId: string) => Promise<void>;
  regenerateToken: (podId: string) => Promise<RegenerateTokenResponse>;
  selectPod: (podId: string | null) => void;
  clearNewToken: () => void;
  clearError: () => void;
  setError: (error: string | null) => void;
}

export const useLocalPodsStore = create<LocalPodsState>()(
  devtools(
    (set, get) => ({
      // Initial state
      pods: [],
      selectedPodId: null,
      isLoading: false,
      isCreating: false,
      isDeleting: new Set(),
      isRegenerating: new Set(),
      error: null,
      newToken: null,

      loadPods: async () => {
        set({ isLoading: true, error: null });
        try {
          const pods = await api.listLocalPods();
          set({ pods, isLoading: false });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to load local pods';
          set({ error: message, isLoading: false });
        }
      },

      createPod: async (data) => {
        set({ isCreating: true, error: null });
        try {
          const response = await api.createLocalPod(data);
          if (!response.pod) {
            throw new Error('Invalid response: pod data is missing');
          }
          if (!response.token) {
            throw new Error('Invalid response: token is missing');
          }
          set((state) => ({
            pods: [...state.pods, response.pod],
            isCreating: false,
            newToken: { podId: response.pod.id, token: response.token },
          }));
          return response;
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to create local pod';
          set({ error: message, isCreating: false });
          throw err;
        }
      },

      updatePod: async (podId, data) => {
        set({ error: null });
        try {
          const updated = await api.updateLocalPod(podId, data);
          set((state) => ({
            pods: state.pods.map((p) => (p.id === podId ? updated : p)),
          }));
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to update local pod';
          set({ error: message });
          throw err;
        }
      },

      deletePod: async (podId) => {
        const { isDeleting } = get();
        const newDeleting = new Set(isDeleting);
        newDeleting.add(podId);
        set({ isDeleting: newDeleting, error: null });

        try {
          await api.deleteLocalPod(podId);
          set((state) => {
            const next = new Set(state.isDeleting);
            next.delete(podId);
            return {
              pods: state.pods.filter((p) => p.id !== podId),
              isDeleting: next,
              selectedPodId: state.selectedPodId === podId ? null : state.selectedPodId,
            };
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to delete local pod';
          set((state) => {
            const next = new Set(state.isDeleting);
            next.delete(podId);
            return { error: message, isDeleting: next };
          });
          throw err;
        }
      },

      regenerateToken: async (podId) => {
        const { isRegenerating } = get();
        const newRegenerating = new Set(isRegenerating);
        newRegenerating.add(podId);
        set({ isRegenerating: newRegenerating, error: null });

        try {
          const response = await api.regenerateLocalPodToken(podId);
          set((state) => {
            const next = new Set(state.isRegenerating);
            next.delete(podId);
            return {
              pods: state.pods.map((p) =>
                p.id === podId ? { ...p, token_prefix: response.token_prefix } : p
              ),
              isRegenerating: next,
              newToken: { podId, token: response.token },
            };
          });
          return response;
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to regenerate token';
          set((state) => {
            const next = new Set(state.isRegenerating);
            next.delete(podId);
            return { error: message, isRegenerating: next };
          });
          throw err;
        }
      },

      selectPod: (podId) => {
        set({ selectedPodId: podId });
      },

      clearNewToken: () => {
        set({ newToken: null });
      },

      clearError: () => {
        set({ error: null });
      },

      setError: (error) => {
        set({ error });
      },
    }),
    { name: 'local-pods-store' }
  )
);

// Selectors
export const selectOnlinePods = (state: LocalPodsState) =>
  state.pods.filter((p) => p.status === 'online');

export const selectPodById = (state: LocalPodsState, podId: string) =>
  state.pods.find((p) => p.id === podId);

export const selectIsDeleting = (state: LocalPodsState, podId: string) =>
  state.isDeleting.has(podId);

export const selectIsRegenerating = (state: LocalPodsState, podId: string) =>
  state.isRegenerating.has(podId);
