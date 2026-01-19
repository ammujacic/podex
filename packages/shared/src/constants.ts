// ==========================================
// Agent Roles
// ==========================================
// NOTE: Agent role configurations (name, description, color, features, etc.) are stored
// in the database and fetched via /api/agent-roles endpoint.
// Frontend should use useConfigStore().agentRoles to get the authoritative list.
//
// The type below provides TypeScript autocomplete for known built-in roles,
// but also accepts any string to support custom roles added via admin panel.

/**
 * Known built-in agent role identifiers (for TypeScript autocomplete).
 * The authoritative list comes from the database via /api/agent-roles.
 * Custom roles can be added through the admin panel.
 */
export type KnownAgentRole =
  | 'architect'
  | 'coder'
  | 'reviewer'
  | 'tester'
  | 'security'
  | 'devops'
  | 'orchestrator'
  | 'agent_builder'
  | 'documentator'
  | 'chat'
  | 'custom'
  | 'claude-code'
  | 'openai-codex'
  | 'gemini-cli';

/**
 * Agent role type - accepts known roles for autocomplete plus any custom string.
 */
export type AgentRole = KnownAgentRole | (string & {});

// ==========================================
// Attachment & Image Constants
// ==========================================

/**
 * Supported image types for vision models
 */
export const SUPPORTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

/**
 * Maximum file size for attachments (20MB)
 */
export const MAX_ATTACHMENT_SIZE_MB = 20;

// ==========================================
// API Endpoints
// ==========================================

export const API_ENDPOINTS = {
  auth: {
    login: '/api/auth/login',
    logout: '/api/auth/logout',
    refresh: '/api/auth/refresh',
    me: '/api/auth/me',
  },
  sessions: {
    list: '/api/sessions',
    create: '/api/sessions',
    get: (id: string) => `/api/sessions/${id}`,
    delete: (id: string) => `/api/sessions/${id}`,
  },
  agents: {
    list: (sessionId: string) => `/api/sessions/${sessionId}/agents`,
    create: (sessionId: string) => `/api/sessions/${sessionId}/agents`,
    get: (sessionId: string, agentId: string) => `/api/sessions/${sessionId}/agents/${agentId}`,
    message: (sessionId: string, agentId: string) =>
      `/api/sessions/${sessionId}/agents/${agentId}/messages`,
  },
  workspaces: {
    get: (id: string) => `/api/workspaces/${id}`,
    files: (id: string) => `/api/workspaces/${id}/files`,
    terminal: (id: string) => `/api/workspaces/${id}/terminal`,
  },
} as const;

// ==========================================
// WebSocket Events
// ==========================================

export const WS_EVENTS = {
  // Connection
  CONNECT: 'connect',
  DISCONNECT: 'disconnect',
  ERROR: 'error',

  // Session
  SESSION_JOIN: 'session:join',
  SESSION_LEAVE: 'session:leave',
  SESSION_UPDATE: 'session:update',

  // Collaboration
  CURSOR_UPDATE: 'cursor:update',
  SELECTION_UPDATE: 'selection:update',

  // Files
  FILE_CHANGE: 'file:change',
  FILE_SYNC: 'file:sync',

  // Agents
  AGENT_MESSAGE: 'agent:message',
  AGENT_STATUS: 'agent:status',
  AGENT_TOOL_CALL: 'agent:tool_call',

  // Terminal
  TERMINAL_DATA: 'terminal:data',
  TERMINAL_INPUT: 'terminal:input',
  TERMINAL_RESIZE: 'terminal:resize',
} as const;
