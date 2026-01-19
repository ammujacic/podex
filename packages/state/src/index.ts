/**
 * @podex/state
 *
 * Platform-agnostic Zustand stores for Podex.
 * Use these store creators with platform-specific middleware.
 *
 * @example
 * ```typescript
 * // In your web app
 * import { create } from 'zustand';
 * import { devtools } from 'zustand/middleware';
 * import { createCheckpointsSlice, type CheckpointsState } from '@podex/state';
 *
 * export const useCheckpointsStore = create<CheckpointsState>()(
 *   devtools(createCheckpointsSlice, { name: 'podex-checkpoints' })
 * );
 * ```
 */

// Store creators and types
export {
  // Checkpoints
  createCheckpointsSlice,
  createCheckpointsStore,
  type Checkpoint,
  type CheckpointDiff,
  type CheckpointFile,
  type CheckpointsState,

  // Progress
  createProgressSlice,
  createProgressStore,
  type ProgressState,
  type ProgressStep,
  type StepStatus,
  type TaskProgress,
} from './stores/index';

// Types
export type { AsyncStorageAdapter, StateStorageAdapter, SyncStorageAdapter } from './types/index';
