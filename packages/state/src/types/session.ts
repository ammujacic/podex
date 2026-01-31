/**
 * Core session and agent types for @podex/state.
 * Platform-agnostic types used across web, mobile, CLI, and VSCode.
 */

// ============================================================================
// Agent Types
// ============================================================================

/** Agent permission modes */
export type AgentMode = 'plan' | 'ask' | 'auto' | 'sovereign';

/** Agent roles */
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

/** Agent status */
export type AgentStatus = 'idle' | 'active' | 'error';

/** Extended thinking configuration */
export interface ThinkingConfig {
  enabled: boolean;
  budget_tokens?: number;
}

/** Core agent data (platform-agnostic) */
export interface AgentCore {
  id: string;
  name: string;
  role: AgentRole;
  model: string;
  modelDisplayName?: string;
  status: AgentStatus;
  color: string;
  mode: AgentMode;
  previousMode?: AgentMode;
  commandAllowlist?: string[];
  thinkingConfig?: ThinkingConfig;
  conversationSessionId: string | null;
  templateId?: string;
}

// ============================================================================
// Message Types
// ============================================================================

/** Tool call from agent execution */
export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: string;
  status: 'pending' | 'running' | 'completed' | 'error';
}

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

/** Agent message */
export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
  timestamp: Date;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  stopReason?: string;
  usage?: UsageStats;
  model?: string;
}

/** Streaming message state */
export interface StreamingMessage {
  messageId: string;
  agentId: string;
  sessionId: string;
  content: string;
  thinkingContent: string;
  isStreaming: boolean;
  startedAt: Date;
}

// ============================================================================
// Conversation Types
// ============================================================================

/**
 * A portable conversation session that can be attached to any agent.
 * Sessions hold the message history and can be moved between agents.
 */
export interface ConversationSession {
  id: string;
  name: string;
  messages: AgentMessage[];
  attachedAgentIds: string[];
  messageCount: number;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// Workspace Types
// ============================================================================

/** Workspace status */
export type WorkspaceStatus = 'pending' | 'running' | 'stopped' | 'error' | 'offline';

// ============================================================================
// Session Types (Core)
// ============================================================================

/** Core session data (platform-agnostic, minimal) */
export interface SessionCore {
  id: string;
  name: string;
  workspaceId: string;
  workspaceTier?: string;
  branch: string;
  gitUrl?: string | null;
  workspaceStatus: WorkspaceStatus;
  workspaceError?: string | null;
  localPodId?: string | null;
  localPodName?: string | null;
  mount_path?: string | null;
}

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

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ============================================================================
// Constants
// ============================================================================

/** Maximum number of messages to keep per conversation to prevent storage overflow */
export const MAX_MESSAGES_PER_CONVERSATION = 100;
