// ==========================================
// User & Authentication Types
// ==========================================

export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
  provider: 'github' | 'google' | 'email';
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
}

export type UserRole = 'owner' | 'admin' | 'member' | 'viewer';

export interface AuthToken {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

// ==========================================
// Session & Workspace Types
// ==========================================

export interface Session {
  id: string;
  name: string;
  ownerId: string;
  workspaceId: string;
  branch: string;
  status: SessionStatus;
  collaborators: SessionCollaborator[];
  agents: AgentInstance[];
  createdAt: Date;
  updatedAt: Date;
}

export type SessionStatus = 'active' | 'paused' | 'terminated';

export interface SessionCollaborator {
  userId: string;
  role: 'editor' | 'viewer';
  joinedAt: Date;
  cursor?: CursorPosition;
}

export interface CursorPosition {
  fileId: string;
  line: number;
  column: number;
}

export interface Workspace {
  id: string;
  sessionId: string;
  containerId: string;
  status: WorkspaceStatus;
  gitUrl?: string;
  branch: string;
  rootPath: string;
  ports: PortMapping[];
  resources: WorkspaceResources;
  createdAt: Date;
}

export type WorkspaceStatus = 'provisioning' | 'running' | 'paused' | 'terminated' | 'error';

export interface PortMapping {
  internal: number;
  external: number;
  protocol: 'http' | 'https' | 'tcp';
  label?: string;
}

export interface WorkspaceResources {
  cpuLimit: number; // millicores
  memoryLimit: number; // MB
  diskLimit: number; // GB
}

// ==========================================
// Agent Types
// ==========================================

export interface AgentInstance {
  id: string;
  sessionId: string;
  name: string;
  role: AgentRole;
  model: LLMModel;
  status: AgentStatus;
  color: AgentColor;
  systemPrompt?: string;
  tools: AgentTool[];
  createdAt: Date;
}

export type AgentRole = 'architect' | 'coder' | 'reviewer' | 'tester' | 'custom';

export type AgentStatus = 'idle' | 'thinking' | 'executing' | 'waiting' | 'error';

export type AgentColor = 'cyan' | 'purple' | 'green' | 'orange' | 'pink' | 'yellow';

export interface AgentTool {
  name: string;
  description: string;
  enabled: boolean;
}

// ==========================================
// Message & Conversation Types
// ==========================================

export interface Message {
  id: string;
  agentId: string;
  role: MessageRole;
  content: string;
  toolCalls?: ToolCall[];
  timestamp: Date;
}

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: ToolResult;
  status: ToolCallStatus;
  startedAt?: Date;
  completedAt?: Date;
}

export type ToolCallStatus = 'pending' | 'running' | 'completed' | 'error';

export interface ToolResult {
  success: boolean;
  output?: string;
  error?: string;
}

// ==========================================
// File & Editor Types
// ==========================================

export interface FileNode {
  id: string;
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
  size?: number;
  modifiedAt?: Date;
}

export interface FileContent {
  id: string;
  path: string;
  content: string;
  language: string;
  version: number;
}

export interface FileChange {
  type: 'create' | 'update' | 'delete' | 'rename';
  path: string;
  oldPath?: string;
  content?: string;
  agentId?: string;
  timestamp: Date;
}

// ==========================================
// LLM & Provider Types
// ==========================================

export type LLMProvider = 'anthropic' | 'openai' | 'bedrock';

export type LLMModel =
  // Anthropic
  | 'claude-opus-4-5-20251101'
  | 'claude-sonnet-4-20250514'
  | 'claude-3-5-haiku-20241022'
  // OpenAI
  | 'gpt-4o'
  | 'gpt-4-turbo'
  | 'gpt-3.5-turbo'
  // Bedrock (Anthropic)
  | 'anthropic.claude-3-opus-20240229-v1:0'
  | 'anthropic.claude-3-sonnet-20240229-v1:0';

export interface LLMConfig {
  provider: LLMProvider;
  model: LLMModel;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
}

// ==========================================
// WebSocket Event Types
// ==========================================

export type WebSocketEvent =
  | { type: 'session:join'; payload: { sessionId: string; userId: string } }
  | { type: 'session:leave'; payload: { sessionId: string; userId: string } }
  | { type: 'cursor:update'; payload: CursorPosition & { userId: string } }
  | { type: 'file:change'; payload: FileChange }
  | { type: 'agent:message'; payload: Message }
  | { type: 'agent:status'; payload: { agentId: string; status: AgentStatus } }
  | { type: 'agent:attention'; payload: AgentAttentionEvent }
  | { type: 'agent:attention_read'; payload: { sessionId: string; attentionId: string } }
  | {
      type: 'agent:attention_dismiss';
      payload: { sessionId: string; attentionId: string; agentId: string };
    }
  | { type: 'terminal:data'; payload: { workspaceId: string; data: string } }
  | { type: 'terminal:input'; payload: { workspaceId: string; data: string } };

// ==========================================
// API Response Types
// ==========================================

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: ApiError;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// ==========================================
// Agent Attention Types
// ==========================================

/**
 * Types of attention that an agent may require from the user.
 */
export type AgentAttentionType =
  | 'needs_approval' // Agent needs user approval to proceed (e.g., plan approval)
  | 'completed' // Agent completed a significant task
  | 'error' // Agent encountered an error
  | 'waiting_input'; // Agent is waiting for user input/clarification

/**
 * Priority levels for agent attention notifications.
 */
export type AgentAttentionPriority = 'low' | 'medium' | 'high' | 'critical';

/**
 * Agent attention notification - represents a request for user attention.
 */
export interface AgentAttention {
  id: string;
  agentId: string;
  agentName: string;
  sessionId: string;
  type: AgentAttentionType;
  title: string;
  message: string;
  metadata?: {
    planId?: string; // For approval requests
    taskDescription?: string; // For completed tasks
    errorCode?: string; // For errors
    responseId?: string; // Reference to the message that triggered this
    suggestedActions?: string[]; // Possible user actions
  };
  priority: AgentAttentionPriority;
  read: boolean;
  dismissed: boolean;
  createdAt: Date;
  expiresAt?: Date;
}

/**
 * Payload for agent attention WebSocket events.
 */
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
