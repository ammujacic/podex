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

export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thinking?: string; // Agent's thinking/reasoning process (collapsible)
  timestamp: Date;
  toolCalls?: ToolCall[];
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
}

// ============================================================================
// Session Types
// ============================================================================

export interface StandbySettings {
  timeoutMinutes: number | null; // null = Never
  source: 'session' | 'user_default';
}

export type ViewMode = 'grid' | 'focus' | 'freeform';
export type WorkspaceStatus = 'pending' | 'running' | 'standby' | 'stopped' | 'error';

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
  standbyAt: string | null;
  standbySettings: StandbySettings | null;
  // Consolidated editor grid card
  editorGridCardId: string | null;
  editorGridSpan?: GridSpan;
  // Editor position for freeform mode
  editorFreeformPosition?: AgentPosition;
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
