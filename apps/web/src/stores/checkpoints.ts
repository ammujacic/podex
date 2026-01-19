/**
 * Checkpoints store with web-specific middleware.
 * Uses shared store logic from @podex/state.
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import {
  createCheckpointsSlice,
  type CheckpointsState,
  type Checkpoint,
  type CheckpointFile,
  type CheckpointDiff,
} from '@podex/state';

// Re-export types for backward compatibility
export type { Checkpoint, CheckpointFile, CheckpointDiff, CheckpointsState };

/**
 * Checkpoints store with devtools for debugging.
 */
export const useCheckpointsStore = create<CheckpointsState>()(
  devtools(createCheckpointsSlice, { name: 'podex-checkpoints' })
);
