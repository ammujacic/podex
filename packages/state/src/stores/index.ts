/**
 * Platform-agnostic store creators.
 * These can be wrapped with platform-specific middleware (devtools, persist, etc.).
 */

// Checkpoints
export {
  createCheckpointsSlice,
  createCheckpointsStore,
  type Checkpoint,
  type CheckpointDiff,
  type CheckpointFile,
  type CheckpointsState,
} from './checkpoints';

// Progress
export {
  createProgressSlice,
  createProgressStore,
  type ProgressState,
  type ProgressStep,
  type StepStatus,
  type TaskProgress,
} from './progress';

// Session
export { createSessionSlice, createSessionStore, type SessionState } from './session';
