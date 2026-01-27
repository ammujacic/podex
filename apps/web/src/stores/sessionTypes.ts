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
  | 'custom';

export interface Agent {
  id: string;
  name: string;
  role: AgentRole;
  model: string;
  modelDisplayName?: string; // User-friendly model name from backend
  status: 'idle' | 'active' | 'error';
  color: string;
  position?: AgentPosition;
  gridSpan?: GridSpan;
  templateId?: string; // Reference to custom agent template
  // Agent mode and command permissions
  mode: AgentMode;
  previousMode?: AgentMode; // For auto-revert tracking when mode is auto-switched
  commandAllowlist?: string[]; // Allowed commands for Auto mode (glob patterns)
  // Extended thinking configuration
  thinkingConfig?: ThinkingConfig;
  // Reference to attached conversation session (can be null if no conversation attached)
  conversationSessionId: string | null;
}

// ============================================================================
// Message Types
// ============================================================================

/** Tool result from agent execution */
export interface ToolResult {
  tool_use_id: string;
  content: unknown;
  is_error: boolean;
}

/** Usage stats from LLM API */
export interface UsageStats {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thinking?: string; // Agent's thinking/reasoning process (collapsible)
  timestamp: Date;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  stopReason?: string;
  usage?: UsageStats;
  model?: string;
}

// ============================================================================
// Conversation Session Types
// ============================================================================

/**
 * A portable conversation session that can be attached to any agent card.
 * Sessions hold the message history and can be moved between agents.
 */
export interface ConversationSession {
  id: string;
  name: string;
  messages: AgentMessage[];
  attachedToAgentId: string | null;
  messageCount: number;
  lastMessageAt: string | null; // ISO timestamp
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
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

export type ViewMode = 'grid' | 'focus' | 'freeform';
export type WorkspaceStatus = 'pending' | 'running' | 'stopped' | 'error' | 'offline';

export interface Session {
  id: string;
  name: string;
  workspaceId: string;
  workspaceTier?: string; // Current workspace compute tier
  branch: string;
  gitUrl?: string | null;
  agents: Agent[];
  conversationSessions: ConversationSession[]; // Portable conversation pool
  filePreviews: FilePreview[];
  activeAgentId: string | null;
  viewMode: ViewMode;
  // Workspace status tracking
  workspaceStatus: WorkspaceStatus;
  workspaceStatusChecking?: boolean;
  workspaceError?: string | null; // Error message when workspace is unavailable (503/500)
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

/** Maximum number of messages to keep per conversation to prevent localStorage overflow */
export const MAX_MESSAGES_PER_CONVERSATION = 100;

/** Maximum number of recent files to keep */
export const MAX_RECENT_FILES = 50;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Derive a conversation session name from the first message.
 * Truncates at word boundary if too long.
 */
export function deriveSessionName(firstMessage: string, maxLength: number = 40): string {
  const cleaned = firstMessage.trim().replace(/\n/g, ' ');
  if (cleaned.length <= maxLength) return cleaned;

  const truncated = cleaned.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');

  if (lastSpace > maxLength / 2) {
    return truncated.slice(0, lastSpace) + '...';
  }
  return truncated + '...';
}

/**
 * Get the display title for an agent card.
 * Format: "Role: Session Name" or just "Role" if no session attached.
 */
export function getAgentDisplayTitle(
  agent: Agent,
  conversationSession: ConversationSession | null
): string {
  const roleDisplay = agent.role.charAt(0).toUpperCase() + agent.role.slice(1);

  if (!conversationSession) {
    return roleDisplay;
  }

  return `${roleDisplay}: ${conversationSession.name}`;
}

/**
 * Format a relative time string (e.g., "2h ago", "3d ago").
 */
export function formatRelativeTime(dateString: string | null): string {
  if (!dateString) return '';

  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMinutes < 1) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  // For older dates, show the date
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

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
