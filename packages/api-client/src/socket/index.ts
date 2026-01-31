/**
 * Socket.IO client exports.
 */

export { SocketClient, createSocketClient, type ConnectionListener } from './client';

// Re-export all types
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
} from './types';
