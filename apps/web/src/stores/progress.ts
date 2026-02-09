/**
 * Progress store with web-specific middleware.
 * Uses shared store logic from @podex/state.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import {
  createProgressSlice,
  type ProgressState,
  type ProgressStep,
  type StepStatus,
  type TaskProgress,
} from '@podex/state';

// Re-export types for backward compatibility
export type { ProgressState, ProgressStep, StepStatus, TaskProgress };

/**
 * Progress store with devtools for debugging.
 */
export const useProgressStore = create<ProgressState>()(
  devtools(createProgressSlice, { name: 'podex-progress' })
);
