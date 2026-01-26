import type { ThinkingConfig } from '@podex/shared';

// ============================================================================
// Agent Types
// ============================================================================

export interface AgentPosition {
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
}

export interface GridSpan {
  colSpan: number; // 1-3 columns
  rowSpan: number; // 1-2 rows
  colStart?: number; // Optional explicit column start position (1-based)
}

/** Agent permission modes */
export type AgentMode = 'plan' | 'ask' | 'auto' | 'sovereign';

export type AgentRole =
  | 'architect'
  | 'coder'
  | 'reviewer'
  | 'tester'
  | 'agent_builder'
  | 'orchestrator'
  | 'chat'
  | 'security'
  | 'devops'
  | 'documentator'
  | 'custom'
  | 'claude-code'
  | 'openai-codex'
  | 'gemini-cli';

/** Pending permission request from Claude Code CLI */
export interface PendingPermission {
  requestId: string;
  command: string | null;
  description: string | null;
  toolName: string;
  timestamp: string;
  attentionId?: string;
}

/** Info about the currently resumed Claude Code session (synced with backend) */
export interface ClaudeSessionInfo {
  claudeSessionId: string;
  projectPath: string;
  firstPrompt: string | null;
}

export interface Agent {
  id: string;
  name: string;
  role: AgentRole;
  model: string;
  modelDisplayName?: string; // User-friendly model name from backend
  status: 'idle' | 'active' | 'error';
  color: string;
  messages: AgentMessage[];
  position?: AgentPosition;
  gridSpan?: GridSpan;
  templateId?: string; // Reference to custom agent template
  terminalSessionId?: string; // For terminal-integrated agents
  terminalAgentTypeId?: string; // The type ID of the terminal agent (for restarts)
  // Claude Code session info (synced with backend for cross-device support)
  claudeSessionInfo?: ClaudeSessionInfo;
  // Agent mode and command permissions
  mode: AgentMode;
  previousMode?: AgentMode; // For auto-revert tracking when mode is auto-switched
  commandAllowlist?: string[]; // Allowed commands for Auto mode (glob patterns)
  // Extended thinking configuration
  thinkingConfig?: ThinkingConfig;
  // Pending permission request (Claude Code CLI)
  pendingPermission?: PendingPermission;
}

// ============================================================================
// Message Types
// ============================================================================

/** Entry types from Claude Code session files */
export type ClaudeEntryType =
  | 'user'
  | 'assistant'
  | 'progress'
  | 'summary'
  | 'tool_result'
  | 'queue-operation'
  | 'file-history-snapshot'
  | string; // Allow other types

/** Progress event types from Claude Code */
export type ProgressType =
  | 'thinking'
  | 'hook_progress'
  | 'api_request'
  | 'streaming'
  | 'tool_use'
  | string;

/** Tool result from Claude Code */
export interface ToolResult {
  tool_use_id: string;
  content: unknown;
  is_error: boolean;
}

/** Usage stats from Claude API */
export interface UsageStats {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

/** Progress data from Claude Code */
export interface ProgressData {
  type: ProgressType;
  hookEvent?: string;
  hookName?: string;
  command?: string;
  content?: string;
  thinking?: string;
  [key: string]: unknown;
}

export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thinking?: string; // Agent's thinking/reasoning process (collapsible)
  timestamp: Date;
  toolCalls?: ToolCall[];
  // Extended fields for full Claude Code sync
  type?: ClaudeEntryType;
  toolResults?: ToolResult[];
  stopReason?: string;
  usage?: UsageStats;
  model?: string;
  isSidechain?: boolean;
  parentUuid?: string;
  // Progress-specific fields
  progressType?: ProgressType;
  progressData?: ProgressData;
  toolUseId?: string;
  parentToolUseId?: string;
  // Summary-specific fields
  summary?: string;
  leafUuid?: string;
  // Config/mode change fields
  mode?: string;
  configData?: Record<string, unknown>;
  // Raw data for unknown types
  rawData?: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: string;
  status: 'pending' | 'running' | 'completed' | 'error';
}

// ============================================================================
// Streaming Types (for real-time token display)
// ============================================================================

export interface StreamingMessage {
  messageId: string;
  agentId: string;
  sessionId: string;
  content: string; // Accumulated tokens
  thinkingContent: string; // Accumulated thinking tokens
  isStreaming: boolean;
  startedAt: Date;
}

// ============================================================================
// File Preview Types
// ============================================================================

export interface FilePreview {
  id: string;
  path: string;
  content: string;
  language: string;
  pinned: boolean;
  position: { x: number; y: number; width?: number; height?: number; zIndex?: number };
  gridSpan?: GridSpan;
  docked: boolean; // If true, shows in the main grid/freeform area. If false, floats as overlay.
  /** Line number to scroll to when opening the file */
  startLine?: number;
  /** End line for highlighting a range */
  endLine?: number;
}

// ============================================================================
// Session Types
// ============================================================================

export interface StandbySettings {
  timeoutMinutes: number | null; // null = Never
  source: 'session' | 'user_default';
}

export type ViewMode = 'grid' | 'focus' | 'freeform';
export type WorkspaceStatus = 'pending' | 'running' | 'standby' | 'stopped' | 'error' | 'offline';

export interface Session {
  id: string;
  name: string;
  workspaceId: string;
  workspaceTier?: string; // Current workspace compute tier
  branch: string;
  gitUrl?: string | null;
  agents: Agent[];
  filePreviews: FilePreview[];
  activeAgentId: string | null;
  viewMode: ViewMode;
  // Workspace status tracking
  workspaceStatus: WorkspaceStatus;
  workspaceStatusChecking?: boolean;
  workspaceError?: string | null; // Error message when workspace is unavailable (503/500)
  standbyAt: string | null;
  standbySettings: StandbySettings | null;
  // Consolidated editor grid card
  editorGridCardId: string | null;
  editorGridSpan?: GridSpan;
  // Editor position for freeform mode
  editorFreeformPosition?: AgentPosition;
  // Live Preview grid card
  previewGridCardId: string | null;
  previewGridSpan?: GridSpan;
  // Preview position for freeform mode
  previewFreeformPosition?: AgentPosition;
  // Local pod (null = cloud workspace)
  localPodId?: string | null;
  // Display name for the local pod
  localPodName?: string | null;
  // Mount path for local pods (the workspace directory on the local machine)
  mount_path?: string | null;
}

// ============================================================================
// Constants
// ============================================================================

/** Maximum number of messages to keep per agent to prevent localStorage overflow */
export const MAX_MESSAGES_PER_AGENT = 100;

/** Maximum number of recent files to keep */
export const MAX_RECENT_FILES = 50;

// ============================================================================
// Helper Functions
// ============================================================================

/** Get file extension language for syntax highlighting */
export function getLanguageFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  const languageMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    py: 'python',
    rs: 'rust',
    go: 'go',
    rb: 'ruby',
    java: 'java',
    kt: 'kotlin',
    swift: 'swift',
    c: 'c',
    cpp: 'cpp',
    h: 'c',
    hpp: 'cpp',
    cs: 'csharp',
    php: 'php',
    html: 'html',
    css: 'css',
    scss: 'scss',
    less: 'less',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    xml: 'xml',
    md: 'markdown',
    sql: 'sql',
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
  };
  return languageMap[ext] || 'plaintext';
}
