/**
 * Socket.IO client for real-time communication with Podex API.
 */

import type { Socket } from 'socket.io-client';
import { io } from 'socket.io-client';

const SOCKET_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// Socket.IO client instance
let socket: Socket | null = null;

// Connection state tracking for UI feedback
export interface ConnectionState {
  connected: boolean;
  reconnecting: boolean;
  reconnectAttempt: number;
  error: string | null;
  disconnectReason?: string;
}

const connectionState: ConnectionState = {
  connected: false,
  reconnecting: false,
  reconnectAttempt: 0,
  error: null,
};

type ConnectionListener = (state: ConnectionState) => void;
const connectionListeners = new Set<ConnectionListener>();

function notifyConnectionListeners(): void {
  connectionListeners.forEach((listener) => listener({ ...connectionState }));
}

/**
 * Subscribe to connection state changes for UI feedback.
 * Returns an unsubscribe function.
 */
export function onConnectionStateChange(listener: ConnectionListener): () => void {
  connectionListeners.add(listener);
  // Immediately notify with current state
  listener({ ...connectionState });
  return () => connectionListeners.delete(listener);
}

/**
 * Get current connection state.
 */
export function getConnectionState(): ConnectionState {
  return { ...connectionState };
}

export interface AgentMessageEvent {
  id: string;
  agent_id: string;
  agent_name: string;
  role: 'user' | 'assistant';
  content: string;
  session_id: string;
  created_at: string;
  // Voice/TTS fields for auto-play
  auto_play?: boolean;
  tts_summary?: string | null;
  // Tool calls executed during this message
  tool_calls?: Array<{
    id: string;
    name: string;
    args: Record<string, unknown>;
    result?: string;
    status: 'pending' | 'running' | 'completed' | 'error';
  }> | null;
}

export interface AgentStatusEvent {
  agent_id: string;
  status: 'idle' | 'active' | 'error';
  session_id: string;
  error?: string;
}

export interface UserJoinedEvent {
  user_id: string;
  session_id: string;
}

export interface FileChangeEvent {
  session_id: string;
  file_path: string;
  change_type: 'created' | 'modified' | 'deleted';
  changed_by: string;
}

export interface TerminalDataEvent {
  workspace_id: string;
  data: string;
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

// Voice/Audio events
export interface VoiceTranscriptionEvent {
  session_id: string;
  agent_id: string;
  text: string;
  confidence: number;
  is_final: boolean;
}

export interface VoiceTranscriptionProgressEvent {
  session_id: string;
  agent_id: string;
  chunks_received: number;
}

export interface VoiceStreamReadyEvent {
  agent_id: string;
}

export interface VoiceErrorEvent {
  error: string;
}

export interface TTSAudioReadyEvent {
  session_id: string;
  message_id: string;
  audio_url: string;
  duration_ms: number;
}

export interface TTSStatusEvent {
  session_id: string;
  message_id: string;
  status: 'processing' | 'ready' | 'error';
}

// Agent Attention events
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

// Agent approval events
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

// Native agent approval events (for Podex native agents, not CLI agents)
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

// Context window events
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

// Checkpoint events
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
    files: Array<{
      path: string;
      change_type: 'create' | 'modify' | 'delete';
      lines_added: number;
      lines_removed: number;
    }>;
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

// Worktree events for parallel agent execution
export interface WorktreeCreatedEvent {
  session_id: string;
  worktree: {
    id: string;
    agent_id: string;
    session_id: string;
    worktree_path: string;
    branch_name: string;
    status: string;
    created_at: string;
  };
}

export interface WorktreeStatusChangedEvent {
  session_id: string;
  worktree_id: string;
  agent_id: string;
  old_status: string;
  new_status: string;
}

export interface WorktreeConflictDetectedEvent {
  session_id: string;
  worktree_id: string;
  agent_id: string;
  conflicting_files: string[];
}

export interface WorktreeMergedEvent {
  session_id: string;
  worktree_id: string;
  agent_id: string;
  merge_result: {
    success: boolean;
    message: string;
  };
}

export interface WorktreeDeletedEvent {
  session_id: string;
  worktree_id: string;
  agent_id: string;
}

// Streaming events for real-time token delivery
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
  tool_calls?: Array<{
    id: string;
    name: string;
    args: Record<string, unknown>;
    result?: string;
    status: 'pending' | 'running' | 'completed' | 'error';
  }> | null;
  timestamp: string;
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

// Extension sync events
export interface ExtensionInstalledEvent {
  extension_id: string;
  namespace: string;
  name: string;
  display_name: string;
  version: string;
  scope: 'user' | 'workspace';
  workspace_id?: string;
  icon_url?: string;
  timestamp: string;
}

export interface ExtensionUninstalledEvent {
  extension_id: string;
  scope: 'user' | 'workspace';
  workspace_id?: string;
  timestamp: string;
}

export interface ExtensionToggledEvent {
  extension_id: string;
  enabled: boolean;
  scope: 'user' | 'workspace';
  workspace_id?: string;
  timestamp: string;
}

export interface ExtensionSettingsChangedEvent {
  extension_id: string;
  settings: Record<string, unknown>;
  scope: 'user' | 'workspace';
  workspace_id?: string;
  timestamp: string;
}

export interface ExtensionSubscribedEvent {
  user_id: string;
}

// Pending change events (agent diff review)
export interface PendingChangeProposedEvent {
  id: string;
  session_id: string;
  agent_id: string;
  agent_name: string;
  file_path: string;
  original_content: string | null;
  proposed_content: string;
  description: string | null;
  created_at: string;
}

export interface PendingChangeResolvedEvent {
  id: string;
  session_id: string;
  status: 'accepted' | 'rejected';
  file_path: string;
}

// Skill execution events
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

/**
 * Event emitted when an agent's configuration changes.
 * Enables sync between agents and Podex UI.
 */
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

/**
 * Event emitted when workspace status changes (running, stopped, error, etc.)
 */
export interface WorkspaceStatusEvent {
  workspace_id: string;
  status: 'pending' | 'running' | 'stopped' | 'error' | 'offline';
  error?: string;
}

/**
 * Event emitted when workspace is stopped due to credit exhaustion
 */
export interface WorkspaceBillingStandbyEvent {
  workspace_id: string;
  status: 'stopped';
  reason: 'credit_exhaustion';
  message: string;
  upgrade_url: string;
  add_credits_url: string;
}

export interface SocketEvents {
  agent_message: (data: AgentMessageEvent) => void;
  agent_status: (data: AgentStatusEvent) => void;
  user_joined: (data: UserJoinedEvent) => void;
  user_left: (data: UserJoinedEvent) => void;
  file_change: (data: FileChangeEvent) => void;
  terminal_data: (data: TerminalDataEvent) => void;
  terminal_ready: (data: { workspace_id: string; cwd: string }) => void;
  terminal_error: (data: { error: string }) => void;
  'layout:change': (data: LayoutChangeEvent) => void;
  // Voice events
  voice_transcription: (data: VoiceTranscriptionEvent) => void;
  voice_transcription_progress: (data: VoiceTranscriptionProgressEvent) => void;
  voice_stream_ready: (data: VoiceStreamReadyEvent) => void;
  voice_error: (data: VoiceErrorEvent) => void;
  tts_audio_ready: (data: TTSAudioReadyEvent) => void;
  tts_status: (data: TTSStatusEvent) => void;
  // Agent attention events
  agent_attention: (data: AgentAttentionEvent) => void;
  agent_attention_read: (data: AgentAttentionReadEvent) => void;
  agent_attention_dismiss: (data: AgentAttentionDismissEvent) => void;
  agent_attention_dismiss_all: (data: AgentAttentionDismissAllEvent) => void;
  // Agent approval events
  approval_request: (data: ApprovalRequestEvent) => void;
  approval_response: (data: ApprovalResponseEvent) => void;
  // Native Podex agent approval events
  native_approval_request: (data: NativeApprovalRequestEvent) => void;
  native_approval_decision: (data: NativeApprovalDecisionEvent) => void;
  // Context window events
  context_usage_update: (data: ContextUsageUpdateEvent) => void;
  compaction_started: (data: CompactionStartedEvent) => void;
  compaction_completed: (data: CompactionCompletedEvent) => void;
  // Checkpoint events
  checkpoint_created: (data: CheckpointCreatedEvent) => void;
  checkpoint_restore_started: (data: CheckpointRestoreStartedEvent) => void;
  checkpoint_restore_completed: (data: CheckpointRestoreCompletedEvent) => void;
  // Worktree events
  worktree_created: (data: WorktreeCreatedEvent) => void;
  worktree_status_changed: (data: WorktreeStatusChangedEvent) => void;
  worktree_conflict_detected: (data: WorktreeConflictDetectedEvent) => void;
  worktree_merged: (data: WorktreeMergedEvent) => void;
  worktree_deleted: (data: WorktreeDeletedEvent) => void;
  // Streaming events
  agent_stream_start: (data: AgentStreamStartEvent) => void;
  agent_token: (data: AgentTokenEvent) => void;
  agent_thinking_token: (data: AgentThinkingTokenEvent) => void;
  agent_stream_end: (data: AgentStreamEndEvent) => void;
  tool_call_start: (data: ToolCallStartEvent) => void;
  tool_call_end: (data: ToolCallEndEvent) => void;
  // Extension sync events
  extension_installed: (data: ExtensionInstalledEvent) => void;
  extension_uninstalled: (data: ExtensionUninstalledEvent) => void;
  extension_toggled: (data: ExtensionToggledEvent) => void;
  extension_settings_changed: (data: ExtensionSettingsChangedEvent) => void;
  extension_subscribed: (data: ExtensionSubscribedEvent) => void;
  // Pending change events (agent diff review)
  pending_change_proposed: (data: PendingChangeProposedEvent) => void;
  pending_change_resolved: (data: PendingChangeResolvedEvent) => void;
  // Skill execution events
  skill_start: (data: SkillStartEvent) => void;
  skill_step: (data: SkillStepEvent) => void;
  skill_complete: (data: SkillCompleteEvent) => void;
  // Agent config sync events
  agent_config_update: (data: AgentConfigUpdateEvent) => void;
  // Workspace status events
  workspace_status: (data: WorkspaceStatusEvent) => void;
  // Billing standby event (credit exhaustion)
  workspace_billing_standby: (data: WorkspaceBillingStandbyEvent) => void;
}

// Track active session for auto-rejoin on reconnect
interface ActiveSession {
  sessionId: string;
  userId: string;
  authToken?: string;
}

let activeSession: ActiveSession | null = null;

/**
 * Get or create the Socket.IO client instance.
 * Uses exponential backoff with more reconnection attempts for better reliability.
 */
export function getSocket(): Socket {
  if (!socket) {
    socket = io(SOCKET_URL, {
      autoConnect: false,
      transports: ['websocket', 'polling'],
      reconnection: true,
      // Exponential backoff: starts at 1s, doubles each attempt, max 30s
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      // Increased attempts (10 attempts = ~5 min total with exponential backoff)
      reconnectionAttempts: 10,
      // Random jitter to prevent thundering herd
      randomizationFactor: 0.5,
      // Timeout for connection attempts
      timeout: 20000,
    });

    socket.on('connect', () => {
      connectionState.connected = true;
      connectionState.error = null;
      connectionState.reconnecting = false;
      connectionState.reconnectAttempt = 0;
      notifyConnectionListeners();
    });

    socket.on('disconnect', (reason: string) => {
      connectionState.connected = false;
      connectionState.disconnectReason = reason;
      notifyConnectionListeners();
    });

    socket.on('connect_error', (error: Error) => {
      connectionState.connected = false;
      connectionState.error = error.message;
      notifyConnectionListeners();
    });

    socket.io.on('reconnect_attempt', (attempt: number) => {
      connectionState.reconnecting = true;
      connectionState.reconnectAttempt = attempt;
      notifyConnectionListeners();
    });

    socket.io.on('reconnect', () => {
      connectionState.reconnecting = false;
      connectionState.reconnectAttempt = 0;
      connectionState.error = null;
      notifyConnectionListeners();

      // Auto-rejoin session after reconnection
      if (activeSession) {
        const { sessionId, userId, authToken } = activeSession;
        socket?.emit('session_join', {
          session_id: sessionId,
          user_id: userId,
          ...(authToken && { auth_token: authToken }),
        });
      }
    });

    socket.io.on('reconnect_failed', () => {
      connectionState.reconnecting = false;
      connectionState.error =
        'Reconnection failed after maximum attempts. Please refresh the page.';
      notifyConnectionListeners();
    });
  }

  return socket;
}

/**
 * Manually trigger a reconnection attempt.
 * Useful for UI "Reconnect" buttons when auto-reconnect has failed.
 */
export function reconnectSocket(): void {
  if (socket) {
    // Reset state
    connectionState.error = null;
    connectionState.reconnecting = true;
    connectionState.reconnectAttempt = 1;
    notifyConnectionListeners();

    // Force disconnect and reconnect
    socket.disconnect();
    socket.connect();
  }
}

/**
 * Connect to the Socket.IO server.
 */
export function connectSocket(): void {
  const sock = getSocket();
  if (!sock.connected) {
    sock.connect();
  }
}

/**
 * Disconnect from the Socket.IO server.
 */
export function disconnectSocket(): void {
  if (socket?.connected) {
    socket.disconnect();
  }
}

/**
 * Join a session room to receive updates.
 * Waits for socket connection before emitting join event.
 * Stores session info for automatic rejoin after reconnection.
 *
 * Security Note: Auth token is transmitted via WebSocket. The connection
 * should always use WSS (WebSocket Secure) in production. The token is
 * validated server-side and not stored in the socket state.
 */
export function joinSession(sessionId: string, userId: string, authToken?: string): void {
  const sock = getSocket();

  // Store session info for auto-rejoin on reconnect
  activeSession = { sessionId, userId, authToken };

  // Warn in development if not using secure connection
  if (
    typeof window !== 'undefined' &&
    window.location.protocol === 'http:' &&
    process.env.NODE_ENV === 'production'
  ) {
    console.warn(
      '[Socket] Warning: Using insecure WebSocket connection in production. Auth tokens may be exposed.'
    );
  }

  const emitJoin = () => {
    // Only send token if present; server should validate via secure session cookie as fallback
    sock.emit('session_join', {
      session_id: sessionId,
      user_id: userId,
      // Token sent for backwards compatibility; prefer cookie-based auth when available
      ...(authToken && { auth_token: authToken }),
    });
  };

  // If already connected, emit immediately
  if (sock.connected) {
    emitJoin();
  } else {
    // Wait for connection before emitting
    sock.once('connect', emitJoin);
  }
}

/**
 * Leave a session room.
 * Clears the active session to prevent auto-rejoin on reconnect.
 */
export function leaveSession(sessionId: string, userId: string): void {
  const sock = getSocket();
  sock.emit('session_leave', { session_id: sessionId, user_id: userId });

  // Clear active session to prevent auto-rejoin
  if (activeSession?.sessionId === sessionId) {
    activeSession = null;
  }
}

/**
 * Subscribe to an event.
 */
export function onSocketEvent<K extends keyof SocketEvents>(
  event: K,
  handler: SocketEvents[K]
): () => void {
  const sock = getSocket();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sock.on(event, handler as any);

  return () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sock.off(event, handler as any);
  };
}

/**
 * Emit a cursor update to other users in the session.
 */
export function emitCursorUpdate(data: {
  session_id: string;
  user_id: string;
  file_path: string;
  position: { line: number; column: number };
}): void {
  const sock = getSocket();
  sock.emit('cursor_update', data);
}

/**
 * Emit a file change event.
 */
export function emitFileChange(data: {
  session_id: string;
  file_path: string;
  change_type: 'created' | 'modified' | 'deleted';
  changed_by: string;
}): void {
  const sock = getSocket();
  sock.emit('file_change', data);
}

// Terminal-specific functions
export function attachTerminal(workspaceId: string): void {
  const sock = getSocket();
  sock.emit('terminal_attach', { workspace_id: workspaceId });
}

export function detachTerminal(workspaceId: string): void {
  const sock = getSocket();
  sock.emit('terminal_detach', { workspace_id: workspaceId });
}

export function sendTerminalInput(workspaceId: string, data: string): void {
  const sock = getSocket();
  sock.emit('terminal_input', { workspace_id: workspaceId, data });
}

export function resizeTerminal(workspaceId: string, rows: number, cols: number): void {
  const sock = getSocket();
  sock.emit('terminal_resize', { workspace_id: workspaceId, rows, cols });
}

// Layout sync functions with debouncing to prevent network spam
let layoutChangeTimeout: ReturnType<typeof setTimeout> | null = null;
let pendingLayoutChange: {
  session_id: string;
  user_id: string;
  device_id: string;
  type: LayoutChangeEvent['type'];
  payload: Record<string, unknown>;
} | null = null;

export function emitLayoutChange(data: {
  session_id: string;
  user_id: string;
  device_id: string;
  type: LayoutChangeEvent['type'];
  payload: Record<string, unknown>;
}): void {
  // Store the latest data
  pendingLayoutChange = data;

  // Clear any existing timeout
  if (layoutChangeTimeout) {
    clearTimeout(layoutChangeTimeout);
  }

  // Debounce: wait 150ms before emitting to batch rapid changes
  layoutChangeTimeout = setTimeout(() => {
    if (pendingLayoutChange) {
      const sock = getSocket();
      sock.emit('layout:change', {
        session_id: pendingLayoutChange.session_id,
        sender_id: pendingLayoutChange.user_id,
        sender_device: pendingLayoutChange.device_id,
        type: pendingLayoutChange.type,
        payload: pendingLayoutChange.payload,
        timestamp: new Date().toISOString(),
      });
      pendingLayoutChange = null;
    }
    layoutChangeTimeout = null;
  }, 150);
}

// Agent attention functions
export function emitAttentionRead(sessionId: string, attentionId: string): void {
  const sock = getSocket();
  sock.emit('agent_attention_read', {
    session_id: sessionId,
    attention_id: attentionId,
  });
}

export function emitAttentionDismiss(
  sessionId: string,
  attentionId: string,
  agentId?: string
): void {
  const sock = getSocket();
  sock.emit('agent_attention_dismiss', {
    session_id: sessionId,
    attention_id: attentionId,
    agent_id: agentId || null,
  });
}

// Agent approval functions
export function emitApprovalResponse(
  sessionId: string,
  agentId: string,
  approvalId: string,
  approved: boolean,
  addToAllowlist: boolean = false
): void {
  const sock = getSocket();
  sock.emit('approval_response', {
    session_id: sessionId,
    agent_id: agentId,
    approval_id: approvalId,
    approved,
    added_to_allowlist: addToAllowlist,
  });
}

// Native Podex agent approval response
export function emitNativeApprovalResponse(
  sessionId: string,
  agentId: string,
  approvalId: string,
  approved: boolean,
  addToAllowlist: boolean = false
): void {
  const sock = getSocket();
  sock.emit('native_approval_response', {
    session_id: sessionId,
    agent_id: agentId,
    approval_id: approvalId,
    approved,
    add_to_allowlist: addToAllowlist,
  });
}

// Extension sync functions
/**
 * Subscribe to extension sync events for the authenticated user.
 * This allows real-time updates when extensions are installed/uninstalled/toggled
 * on other devices.
 */
export function subscribeToExtensions(authToken: string): void {
  const sock = getSocket();
  sock.emit('extension_subscribe', { auth_token: authToken });
}

/**
 * Unsubscribe from extension sync events.
 */
export function unsubscribeFromExtensions(): void {
  const sock = getSocket();
  sock.emit('extension_unsubscribe', {});
}
