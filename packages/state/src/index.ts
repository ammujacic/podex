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
 * import { devtools, persist } from 'zustand/middleware';
 * import { createSessionSlice, type SessionState } from '@podex/state';
 *
 * export const useSessionStore = create<SessionState>()(
 *   devtools(
 *     persist(createSessionSlice, { name: 'podex-session' }),
 *     { name: 'session' }
 *   )
 * );
 *
 * // Mobile app with SecureStore
 * import { createJSONStorage } from 'zustand/middleware';
 * import * as SecureStore from 'expo-secure-store';
 *
 * const secureStorage = createJSONStorage(() => ({
 *   getItem: SecureStore.getItemAsync,
 *   setItem: SecureStore.setItemAsync,
 *   removeItem: SecureStore.deleteItemAsync,
 * }));
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

  // Session
  createSessionSlice,
  createSessionStore,
  type SessionState,
} from './stores/index';

// Types
export type { AsyncStorageAdapter, StateStorageAdapter, SyncStorageAdapter } from './types/index';

// Session types (re-export for convenience)
export type {
  AgentCore,
  AgentMessage,
  AgentMode,
  AgentRole,
  AgentStatus,
  ConversationSession,
  SessionCore,
  StreamingMessage,
  ThinkingConfig,
  ToolCall,
  ToolResult,
  UsageStats,
  WorkspaceStatus,
} from './types/index';

export {
  deriveSessionName,
  formatRelativeTime,
  MAX_MESSAGES_PER_CONVERSATION,
} from './types/index';
