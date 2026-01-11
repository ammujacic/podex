// ==========================================
// Agent Colors
// ==========================================

export const AGENT_COLORS = {
  cyan: '#00e5ff',
  purple: '#a855f7',
  green: '#22c55e',
  orange: '#f97316',
  pink: '#ec4899',
  yellow: '#eab308',
} as const;

export const AGENT_COLOR_CLASSES = {
  cyan: 'text-agent-1 border-agent-1',
  purple: 'text-agent-2 border-agent-2',
  green: 'text-agent-3 border-agent-3',
  orange: 'text-agent-4 border-agent-4',
  pink: 'text-agent-5 border-agent-5',
  yellow: 'text-agent-6 border-agent-6',
} as const;

// ==========================================
// Default Agent Configurations
// ==========================================

export const DEFAULT_AGENTS = {
  architect: {
    name: 'Architect',
    role: 'architect' as const,
    model: 'claude-opus-4-5-20251101' as const,
    color: 'cyan' as const,
    systemPrompt: `You are an expert software architect. Your role is to:
- Analyze requirements and design system architecture
- Break down complex tasks into smaller, manageable pieces
- Define interfaces and contracts between components
- Make technology decisions and justify them
- Delegate implementation tasks to other agents`,
    tools: ['read_file', 'search_code', 'list_directory'],
  },
  coder: {
    name: 'Coder',
    role: 'coder' as const,
    model: 'claude-sonnet-4-20250514' as const,
    color: 'purple' as const,
    systemPrompt: `You are an expert software developer. Your role is to:
- Write clean, maintainable, and well-tested code
- Follow best practices and coding standards
- Implement features based on specifications
- Refactor and improve existing code
- Document your code appropriately`,
    tools: ['read_file', 'write_file', 'search_code', 'run_command', 'list_directory'],
  },
  reviewer: {
    name: 'Reviewer',
    role: 'reviewer' as const,
    model: 'claude-sonnet-4-20250514' as const,
    color: 'green' as const,
    systemPrompt: `You are an expert code reviewer. Your role is to:
- Review code changes for correctness and quality
- Identify bugs, security issues, and performance problems
- Suggest improvements and best practices
- Ensure code follows project conventions
- Provide constructive feedback`,
    tools: ['read_file', 'search_code', 'git_diff', 'list_directory'],
  },
  tester: {
    name: 'Tester',
    role: 'tester' as const,
    model: 'claude-sonnet-4-20250514' as const,
    color: 'orange' as const,
    systemPrompt: `You are an expert QA engineer. Your role is to:
- Write comprehensive unit and integration tests
- Create end-to-end test scenarios
- Identify edge cases and potential issues
- Ensure adequate test coverage
- Run tests and report results`,
    tools: ['read_file', 'write_file', 'run_command', 'search_code'],
  },
} as const;

// ==========================================
// LLM Model Information
// ==========================================

export const LLM_MODELS = {
  'claude-opus-4-5-20251101': {
    provider: 'anthropic',
    name: 'Claude Opus 4.5',
    contextWindow: 200000,
    maxOutput: 8192,
    capabilities: ['code', 'analysis', 'planning'],
  },
  'claude-sonnet-4-20250514': {
    provider: 'anthropic',
    name: 'Claude Sonnet 4',
    contextWindow: 200000,
    maxOutput: 8192,
    capabilities: ['code', 'analysis'],
  },
  'claude-3-5-haiku-20241022': {
    provider: 'anthropic',
    name: 'Claude 3.5 Haiku',
    contextWindow: 200000,
    maxOutput: 8192,
    capabilities: ['code', 'fast'],
  },
  'gpt-4o': {
    provider: 'openai',
    name: 'GPT-4o',
    contextWindow: 128000,
    maxOutput: 4096,
    capabilities: ['code', 'analysis', 'multimodal'],
  },
  'gpt-4-turbo': {
    provider: 'openai',
    name: 'GPT-4 Turbo',
    contextWindow: 128000,
    maxOutput: 4096,
    capabilities: ['code', 'analysis'],
  },
} as const;

// ==========================================
// Workspace Defaults
// ==========================================

export const WORKSPACE_DEFAULTS = {
  cpuLimit: 2000, // 2 CPU cores
  memoryLimit: 4096, // 4 GB
  diskLimit: 20, // 20 GB
  idleTimeout: 30 * 60 * 1000, // 30 minutes
  maxSessionDuration: 24 * 60 * 60 * 1000, // 24 hours
} as const;

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
