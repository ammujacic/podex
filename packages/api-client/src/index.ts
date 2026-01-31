/**
 * @podex/api-client
 *
 * Platform-agnostic API client for Podex services.
 * Uses adapter pattern for HTTP, auth, and error reporting.
 * Includes Socket.IO client for real-time communication.
 *
 * @example
 * ```typescript
 * import { BaseApiClient, createSocketClient } from '@podex/api-client';
 * import { FetchHttpAdapter, ZustandAuthProvider } from './adapters';
 *
 * // REST API client
 * const client = new BaseApiClient({
 *   baseUrl: 'https://api.podex.app',
 *   httpAdapter: new FetchHttpAdapter(),
 *   authProvider: new ZustandAuthProvider(),
 * });
 *
 * // Socket.IO client for real-time events
 * const socket = createSocketClient({
 *   url: 'https://api.podex.app',
 *   getAuthToken: () => authStore.getState().tokens?.accessToken,
 * });
 *
 * socket.on('agent_message', (data) => console.log('Message:', data));
 * socket.connect();
 * ```
 */

// Core utilities
export { ApiRequestError, isAbortError, isQuotaError } from './core/errors';
export { calculateExpiry } from './core/utils';

// Adapter interfaces
export type {
  ApiClientConfig,
  AuthProvider,
  ErrorReporter,
  HttpAdapter,
  HttpRequestConfig,
  HttpResponse,
} from './adapters/types';

// Client
export { BaseApiClient } from './client/base-client';

// Socket.IO client
export { SocketClient, createSocketClient, type ConnectionListener } from './socket/index';

// Socket event types
export type {
  // Connection
  ConnectionState,
  SocketClientConfig,
  SocketEvents,
  // Agent events
  AgentMessageEvent,
  AgentStatusEvent,
  AgentConfigUpdateEvent,
  // Streaming events
  AgentStreamStartEvent,
  AgentTokenEvent,
  AgentThinkingTokenEvent,
  AgentStreamEndEvent,
  // Tool call events
  ToolCallData,
  ToolCallStartEvent,
  ToolCallEndEvent,
  // Approval events
  ApprovalRequestEvent,
  ApprovalResponseEvent,
  NativeApprovalRequestEvent,
  NativeApprovalDecisionEvent,
  // Session events
  UserJoinedEvent,
  LayoutChangeEvent,
  // Workspace events
  WorkspaceStatusEvent,
  WorkspaceBillingStandbyEvent,
  // File events
  FileChangeEvent,
  // Terminal events
  TerminalDataEvent,
  TerminalReadyEvent,
  TerminalErrorEvent,
  // Context events
  ContextUsageUpdateEvent,
  CompactionStartedEvent,
  CompactionCompletedEvent,
  // Checkpoint events
  CheckpointFile,
  CheckpointCreatedEvent,
  CheckpointRestoreStartedEvent,
  CheckpointRestoreCompletedEvent,
  // Attention events
  AgentAttentionType,
  AgentAttentionPriority,
  AgentAttentionEvent,
  AgentAttentionReadEvent,
  AgentAttentionDismissEvent,
  AgentAttentionDismissAllEvent,
  // Skill events
  SkillStartEvent,
  SkillStepEvent,
  SkillCompleteEvent,
  // Conversation events
  ConversationMessage,
  ConversationCreatedEvent,
  ConversationUpdatedEvent,
  ConversationDeletedEvent,
  ConversationAttachedEvent,
  ConversationDetachedEvent,
  ConversationMessageEvent,
  // Notification events
  NotificationCreatedEvent,
} from './socket/index';

// Types
export type { AuthResponse, TokenResponse } from './types/index';
