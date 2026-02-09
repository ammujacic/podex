/**
 * CLI UI state store.
 * Manages transient UI state like input history and current mode.
 */

import { createStore, type StateCreator } from 'zustand/vanilla';

export type CliMode = 'interactive' | 'run' | 'auth' | 'sessions' | 'config';

export interface CliUiState {
  // Current mode
  mode: CliMode;

  // Input history for command recall
  inputHistory: string[];
  historyIndex: number;

  // Current input value
  currentInput: string;

  // Loading states
  isLoading: boolean;
  loadingMessage: string | null;

  // Error display
  error: string | null;

  // Approval queue
  pendingApprovalId: string | null;

  // Actions
  setMode: (mode: CliMode) => void;
  addToHistory: (input: string) => void;
  navigateHistory: (direction: 'up' | 'down') => string;
  setCurrentInput: (input: string) => void;
  setLoading: (loading: boolean, message?: string) => void;
  setError: (error: string | null) => void;
  setPendingApproval: (approvalId: string | null) => void;
  clearHistory: () => void;
}

const MAX_HISTORY = 100;

const createCliUiSlice: StateCreator<CliUiState> = (set, get) => ({
  mode: 'interactive',
  inputHistory: [],
  historyIndex: -1,
  currentInput: '',
  isLoading: false,
  loadingMessage: null,
  error: null,
  pendingApprovalId: null,

  setMode: (mode) => set({ mode }),

  addToHistory: (input) => {
    const trimmed = input.trim();
    if (!trimmed) return;

    set((state) => {
      // Don't add duplicates of the last entry
      if (state.inputHistory[0] === trimmed) {
        return { historyIndex: -1 };
      }

      const newHistory = [trimmed, ...state.inputHistory].slice(0, MAX_HISTORY);
      return {
        inputHistory: newHistory,
        historyIndex: -1,
      };
    });
  },

  navigateHistory: (direction) => {
    const state = get();
    const { inputHistory, historyIndex } = state;

    if (inputHistory.length === 0) {
      return state.currentInput;
    }

    let newIndex: number;
    if (direction === 'up') {
      newIndex = Math.min(historyIndex + 1, inputHistory.length - 1);
    } else {
      newIndex = Math.max(historyIndex - 1, -1);
    }

    set({ historyIndex: newIndex });

    if (newIndex === -1) {
      return '';
    }
    return inputHistory[newIndex] || '';
  },

  setCurrentInput: (input) => set({ currentInput: input }),

  setLoading: (loading, message) =>
    set({
      isLoading: loading,
      loadingMessage: loading ? (message ?? null) : null,
    }),

  setError: (error) => set({ error }),

  setPendingApproval: (approvalId) => set({ pendingApprovalId: approvalId }),

  clearHistory: () => set({ inputHistory: [], historyIndex: -1 }),
});

/**
 * Create the CLI UI store.
 */
export function createCliUiStore() {
  return createStore<CliUiState>(createCliUiSlice);
}

// Singleton instance
let uiStoreInstance: ReturnType<typeof createCliUiStore> | null = null;

/**
 * Get the singleton UI store instance.
 */
export function getCliUiStore(): ReturnType<typeof createCliUiStore> {
  if (!uiStoreInstance) {
    uiStoreInstance = createCliUiStore();
  }
  return uiStoreInstance;
}
