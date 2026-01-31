/**
 * Socket.IO event types for real-time communication.
 * Platform-agnostic type definitions used by web, mobile, CLI, and VSCode.
 */

// ============================================================================
// Connection State
// ============================================================================

export interface ConnectionState {
  connected: boolean;
  reconnecting: boolean;
  reconnectAttempt: number;
  error: string | null;
  disconnectReason?: string;
}

// ============================================================================
// Agent Events
// ============================================================================

export interface AgentMessageEvent {
  id: string;
  agent_id: string;
  agent_name: string;
  role: 'user' | 'assistant';
  content: string;
  session_id: string;
  created_at: string;
  auto_play?: boolean;
  tts_summary?: string | null;
  tool_calls?: ToolCallData[] | null;
}

export interface AgentStatusEvent {
  agent_id: string;
  status: 'idle' | 'active' | 'error';
  session_id: string;
  error?: string;
}

export interface AgentConfigUpdateEvent {
  session_id: string;
  agent_id: string;
  updates: {
    model?: string;
    mode?: string;
    thinking_enabled?: boolean;
    thinking_budget?: number;
    context_compacted?: boolean;
  };
  source: 'agent' | 'user' | 'system';
  timestamp: string;
}

// ============================================================================
// Streaming Events
// ============================================================================

export interface AgentStreamStartEvent {
  session_id: string;
  agent_id: string;
  message_id: string;
  timestamp: string;
}

export interface AgentTokenEvent {
  session_id: string;
  agent_id: string;
  token: string;
  message_id: string;
  timestamp: string;
}

export interface AgentThinkingTokenEvent {
  session_id: string;
  agent_id: string;
  thinking: string;
  message_id: string;
  timestamp: string;
}

export interface AgentStreamEndEvent {
  session_id: string;
  agent_id: string;
  message_id: string;
  full_content: string | null;
  tool_calls?: ToolCallData[] | null;
  timestamp: string;
}

// ============================================================================
// Tool Call Events
// ============================================================================

export interface ToolCallData {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: string;
  status: 'pending' | 'running' | 'completed' | 'error';
}

export interface ToolCallStartEvent {
  session_id: string;
  agent_id: string;
  tool_call_id: string;
  tool_name: string;
  tool_args?: Record<string, unknown>;
  status: 'running';
  timestamp: string;
}

export interface ToolCallEndEvent {
  session_id: string;
  agent_id: string;
  tool_call_id: string;
  tool_name: string;
  result?: unknown;
  error?: string;
  status: 'completed' | 'error';
  duration_ms?: number;
  timestamp: string;
}

// ============================================================================
// Approval Events
// ============================================================================

export interface ApprovalRequestEvent {
  id: string;
  session_id: string;
  agent_id: string;
  agent_name: string;
  action_type: 'file_write' | 'command_execute';
  action_details: {
    tool_name?: string;
    file_path?: string;
    command?: string;
    arguments?: Record<string, unknown>;
  };
  expires_at: string;
  created_at: string;
}

export interface ApprovalResponseEvent {
  session_id: string;
  agent_id: string;
  approval_id: string;
  approved: boolean;
  added_to_allowlist: boolean;
}

export interface NativeApprovalRequestEvent {
  approval_id: string;
  session_id: string;
  agent_id: string;
  agent_name: string;
  action_type: 'file_write' | 'command_execute' | 'other';
  action_details: {
    tool_name?: string;
    file_path?: string;
    command?: string;
    arguments?: Record<string, unknown>;
  };
  can_add_to_allowlist: boolean;
  expires_at: string;
}

export interface NativeApprovalDecisionEvent {
  session_id: string;
  agent_id: string;
  approval_id: string;
  approved: boolean;
  add_to_allowlist: boolean;
}

// ============================================================================
// Session Events
// ============================================================================

export interface UserJoinedEvent {
  user_id: string;
  session_id: string;
}

export interface LayoutChangeEvent {
  session_id: string;
  sender_id: string;
  sender_device: string;
  type:
    | 'view_mode'
    | 'active_agent'
    | 'agent_layout'
    | 'file_preview_layout'
    | 'editor_layout'
    | 'sidebar'
    | 'full_sync';
  payload: Record<string, unknown>;
  timestamp: string;
}

// ============================================================================
// Workspace Events
// ============================================================================

export interface WorkspaceStatusEvent {
  workspace_id: string;
  status: 'pending' | 'running' | 'stopped' | 'error' | 'offline';
  error?: string;
}

export interface WorkspaceBillingStandbyEvent {
  workspace_id: string;
  status: 'stopped';
  reason: 'credit_exhaustion';
  message: string;
  upgrade_url: string;
  add_credits_url: string;
}

// ============================================================================
// File Events
// ============================================================================

export interface FileChangeEvent {
  session_id: string;
  file_path: string;
  change_type: 'created' | 'modified' | 'deleted';
  changed_by: string;
}

// ============================================================================
// Terminal Events
// ============================================================================

export interface TerminalDataEvent {
  workspace_id: string;
  data: string;
}

export interface TerminalReadyEvent {
  workspace_id: string;
  cwd: string;
}

export interface TerminalErrorEvent {
  error: string;
}

// ============================================================================
// Context Window Events
// ============================================================================

export interface ContextUsageUpdateEvent {
  agent_id: string;
  tokens_used: number;
  tokens_max: number;
  percentage: number;
}

export interface CompactionStartedEvent {
  agent_id: string;
  session_id: string;
  trigger_type?: 'manual' | 'auto';
}

export interface CompactionCompletedEvent {
  agent_id: string;
  session_id: string;
  tokens_before: number;
  tokens_after: number;
  messages_removed: number;
  summary: string | null;
  trigger_type?: 'manual' | 'auto';
}

// ============================================================================
// Checkpoint Events
// ============================================================================

export interface CheckpointFile {
  path: string;
  change_type: 'create' | 'modify' | 'delete';
  lines_added: number;
  lines_removed: number;
}

export interface CheckpointCreatedEvent {
  session_id: string;
  checkpoint: {
    id: string;
    checkpoint_number: number;
    description: string | null;
    action_type: string;
    agent_id: string;
    status: string;
    created_at: string;
    files: CheckpointFile[];
    file_count: number;
    total_lines_added: number;
    total_lines_removed: number;
  };
}

export interface CheckpointRestoreStartedEvent {
  session_id: string;
  checkpoint_id: string;
}

export interface CheckpointRestoreCompletedEvent {
  session_id: string;
  checkpoint_id: string;
  files_restored: number;
}

// ============================================================================
// Agent Attention Events
// ============================================================================

export type AgentAttentionType = 'needs_approval' | 'completed' | 'error' | 'waiting_input';
export type AgentAttentionPriority = 'low' | 'medium' | 'high' | 'critical';

export interface AgentAttentionEvent {
  id: string;
  session_id: string;
  agent_id: string;
  agent_name: string;
  type: AgentAttentionType;
  title: string;
  message: string;
  priority: AgentAttentionPriority;
  metadata: Record<string, unknown>;
  read: boolean;
  dismissed: boolean;
  created_at: string;
}

export interface AgentAttentionReadEvent {
  session_id: string;
  attention_id: string;
}

export interface AgentAttentionDismissEvent {
  session_id: string;
  attention_id: string;
  agent_id: string | null;
}

export interface AgentAttentionDismissAllEvent {
  session_id: string;
}

// ============================================================================
// Skill Execution Events
// ============================================================================

export interface SkillStartEvent {
  session_id: string;
  agent_id: string;
  message_id: string;
  skill_name: string;
  skill_slug: string;
  total_steps: number;
}

export interface SkillStepEvent {
  session_id: string;
  agent_id: string;
  message_id: string;
  step_name: string;
  step_index: number;
  step_status: 'running' | 'success' | 'failed' | 'skipped' | 'error';
}

export interface SkillCompleteEvent {
  session_id: string;
  agent_id: string;
  message_id: string;
  skill_name: string;
  skill_slug: string;
  success: boolean;
  duration_ms: number;
}

// ============================================================================
// Conversation Events
// ============================================================================

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  thinking?: string | null;
  tool_calls?: Record<string, unknown> | null;
  tool_results?: Record<string, unknown> | null;
  model?: string | null;
  stop_reason?: string | null;
  created_at: string;
}

export interface ConversationCreatedEvent {
  session_id: string;
  conversation: {
    id: string;
    name: string;
    attached_agent_ids: string[];
    message_count: number;
    last_message_at: string | null;
    created_at: string;
    updated_at: string;
  };
}

export interface ConversationUpdatedEvent {
  session_id: string;
  conversation: {
    id: string;
    name?: string;
    attached_agent_ids?: string[];
    message_count?: number;
    last_message_at?: string | null;
    created_at?: string;
    updated_at?: string;
  };
}

export interface ConversationDeletedEvent {
  session_id: string;
  conversation_id: string;
}

export interface ConversationAttachedEvent {
  session_id: string;
  conversation_id: string;
  agent_id: string;
}

export interface ConversationDetachedEvent {
  session_id: string;
  conversation_id: string;
  previous_agent_id?: string | null;
}

export interface ConversationMessageEvent {
  session_id: string;
  conversation_id: string;
  message: ConversationMessage;
}

// ============================================================================
// Notification Events
// ============================================================================

export interface NotificationCreatedEvent {
  id: string;
  type: 'info' | 'warning' | 'error' | 'success';
  title: string;
  message: string;
  action_url?: string;
  action_label?: string;
  read: boolean;
  created_at: string;
}

// ============================================================================
// Socket Event Map
// ============================================================================

export interface SocketEvents {
  // Agent events
  agent_message: (data: AgentMessageEvent) => void;
  agent_status: (data: AgentStatusEvent) => void;
  agent_config_update: (data: AgentConfigUpdateEvent) => void;

  // Streaming events
  agent_stream_start: (data: AgentStreamStartEvent) => void;
  agent_token: (data: AgentTokenEvent) => void;
  agent_thinking_token: (data: AgentThinkingTokenEvent) => void;
  agent_stream_end: (data: AgentStreamEndEvent) => void;
  tool_call_start: (data: ToolCallStartEvent) => void;
  tool_call_end: (data: ToolCallEndEvent) => void;

  // Approval events
  approval_request: (data: ApprovalRequestEvent) => void;
  approval_response: (data: ApprovalResponseEvent) => void;
  native_approval_request: (data: NativeApprovalRequestEvent) => void;
  native_approval_decision: (data: NativeApprovalDecisionEvent) => void;

  // Session events
  user_joined: (data: UserJoinedEvent) => void;
  user_left: (data: UserJoinedEvent) => void;
  'layout:change': (data: LayoutChangeEvent) => void;

  // Workspace events
  workspace_status: (data: WorkspaceStatusEvent) => void;
  workspace_billing_standby: (data: WorkspaceBillingStandbyEvent) => void;

  // File events
  file_change: (data: FileChangeEvent) => void;

  // Terminal events
  terminal_data: (data: TerminalDataEvent) => void;
  terminal_ready: (data: TerminalReadyEvent) => void;
  terminal_error: (data: TerminalErrorEvent) => void;

  // Context window events
  context_usage_update: (data: ContextUsageUpdateEvent) => void;
  compaction_started: (data: CompactionStartedEvent) => void;
  compaction_completed: (data: CompactionCompletedEvent) => void;

  // Checkpoint events
  checkpoint_created: (data: CheckpointCreatedEvent) => void;
  checkpoint_restore_started: (data: CheckpointRestoreStartedEvent) => void;
  checkpoint_restore_completed: (data: CheckpointRestoreCompletedEvent) => void;

  // Agent attention events
  agent_attention: (data: AgentAttentionEvent) => void;
  agent_attention_read: (data: AgentAttentionReadEvent) => void;
  agent_attention_dismiss: (data: AgentAttentionDismissEvent) => void;
  agent_attention_dismiss_all: (data: AgentAttentionDismissAllEvent) => void;

  // Skill events
  skill_start: (data: SkillStartEvent) => void;
  skill_step: (data: SkillStepEvent) => void;
  skill_complete: (data: SkillCompleteEvent) => void;

  // Conversation events
  conversation_created: (data: ConversationCreatedEvent) => void;
  conversation_updated: (data: ConversationUpdatedEvent) => void;
  conversation_deleted: (data: ConversationDeletedEvent) => void;
  conversation_attached: (data: ConversationAttachedEvent) => void;
  conversation_detached: (data: ConversationDetachedEvent) => void;
  conversation_message: (data: ConversationMessageEvent) => void;

  // Notification events
  notification_created: (data: NotificationCreatedEvent) => void;
}

// ============================================================================
// Socket Client Configuration
// ============================================================================

export interface SocketClientConfig {
  /** WebSocket URL (defaults to API URL) */
  url: string;
  /** Auth token getter function */
  getAuthToken?: () => string | null | undefined;
  /** Auto-connect on creation (default: false) */
  autoConnect?: boolean;
  /** Reconnection attempts (default: 10) */
  reconnectionAttempts?: number;
  /** Initial reconnection delay in ms (default: 1000) */
  reconnectionDelay?: number;
  /** Max reconnection delay in ms (default: 30000) */
  reconnectionDelayMax?: number;
}
