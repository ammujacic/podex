/**
 * API client for Podex backend services.
 */

import * as Sentry from '@sentry/nextjs';
import type { User, AuthTokens } from '@/stores/auth';
import { useAuthStore } from '@/stores/auth';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

// ============================================================================
// Request Cache for deduplication and caching
// ============================================================================

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  expiresAt: number;
}

class RequestCache {
  private cache = new Map<string, CacheEntry<unknown>>();
  private pendingRequests = new Map<string, Promise<unknown>>();
  private defaultTTL = 30 * 1000; // 30 seconds default

  /**
   * Get cached data if valid, otherwise return null.
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  /**
   * Set cached data with optional TTL.
   */
  set<T>(key: string, data: T, ttl?: number): void {
    const now = Date.now();
    this.cache.set(key, {
      data,
      timestamp: now,
      expiresAt: now + (ttl ?? this.defaultTTL),
    });
  }

  /**
   * Delete cached data.
   */
  delete(key: string): void {
    this.cache.delete(key);
  }

  /**
   * Invalidate all cache entries matching a pattern.
   */
  invalidatePattern(pattern: string | RegExp): void {
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear all cache.
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Deduplicate concurrent requests to the same endpoint.
   */
  async deduplicateRequest<T>(key: string, request: () => Promise<T>): Promise<T> {
    // Check if there's already a pending request for this key
    const pending = this.pendingRequests.get(key);
    if (pending) {
      return pending as Promise<T>;
    }

    // Create the request and store it
    const promise = request().finally(() => {
      this.pendingRequests.delete(key);
    });

    this.pendingRequests.set(key, promise);
    return promise;
  }
}

export const requestCache = new RequestCache();

// Types
export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  name: string;
}

export interface AuthResponse {
  user: {
    id: string;
    email: string;
    name: string | null;
    avatar_url: string | null;
    role: string;
  };
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

export interface ApiError {
  detail: string;
}

// Helper to transform snake_case to camelCase for user
function transformUser(data: AuthResponse['user']): User {
  return {
    id: data.id,
    email: data.email,
    name: data.name,
    avatarUrl: data.avatar_url,
    role: data.role,
  };
}

// Helper to calculate token expiry
function calculateExpiry(expiresIn: number): number {
  return Date.now() + expiresIn * 1000;
}

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private getHeaders(includeAuth = true): HeadersInit {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };

    if (includeAuth) {
      const tokens = useAuthStore.getState().tokens;
      if (tokens?.accessToken) {
        headers['Authorization'] = `Bearer ${tokens.accessToken}`;
      }
    }

    return headers;
  }

  private async handleResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
      const error = await response.json().catch(() => ({
        detail: `HTTP ${response.status}: ${response.statusText}`,
      }));

      // Handle Pydantic validation errors (422) which return detail as an array
      let message: string;
      if (Array.isArray(error.detail)) {
        // Format: [{ loc: ["body", "field"], msg: "error message" }]
        message = error.detail.map((e: { msg: string }) => e.msg).join(', ');
      } else if (typeof error.detail === 'string') {
        message = error.detail;
      } else {
        message = `HTTP ${response.status}: ${response.statusText}`;
      }

      const err = new Error(message) as Error & { status: number };
      err.status = response.status;

      // Report API errors to Sentry (skip 401/403 as they're expected auth errors)
      if (
        response.status >= 500 ||
        (response.status >= 400 && response.status !== 401 && response.status !== 403)
      ) {
        Sentry.captureException(err, {
          tags: {
            apiError: true,
            statusCode: response.status,
          },
          extra: {
            url: response.url,
            status: response.status,
            statusText: response.statusText,
          },
        });
      }

      throw err;
    }
    return response.json();
  }

  async get<T>(path: string, includeAuth = true): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers: this.getHeaders(includeAuth),
    });
    return this.handleResponse<T>(response);
  }

  /**
   * GET request with caching and deduplication.
   * @param path - API path
   * @param options - Cache options
   * @returns Cached or fresh data
   */
  async getCached<T>(
    path: string,
    options: {
      ttl?: number;
      includeAuth?: boolean;
      forceRefresh?: boolean;
    } = {}
  ): Promise<T> {
    const { ttl, includeAuth = true, forceRefresh = false } = options;
    const cacheKey = `GET:${path}`;

    // Check cache first (unless force refresh)
    if (!forceRefresh) {
      const cached = requestCache.get<T>(cacheKey);
      if (cached !== null) {
        return cached;
      }
    }

    // Deduplicate concurrent requests
    return requestCache.deduplicateRequest(cacheKey, async () => {
      const data = await this.get<T>(path, includeAuth);
      requestCache.set(cacheKey, data, ttl);
      return data;
    });
  }

  async post<T>(path: string, data: unknown, includeAuth = true): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this.getHeaders(includeAuth),
      body: JSON.stringify(data),
    });
    return this.handleResponse<T>(response);
  }

  async put<T>(path: string, data: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify(data),
    });
    return this.handleResponse<T>(response);
  }

  async delete<T>(path: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    return this.handleResponse<T>(response);
  }

  async patch<T>(path: string, data: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'PATCH',
      headers: this.getHeaders(),
      body: JSON.stringify(data),
    });
    return this.handleResponse<T>(response);
  }

  // Auth methods
  async login(data: LoginRequest): Promise<{ user: User; tokens: AuthTokens }> {
    const response = await this.post<AuthResponse>('/api/auth/login', data, false);
    return {
      user: transformUser(response.user),
      tokens: {
        accessToken: response.access_token,
        refreshToken: response.refresh_token,
        expiresAt: calculateExpiry(response.expires_in),
      },
    };
  }

  async register(data: RegisterRequest): Promise<{ user: User; tokens: AuthTokens }> {
    const response = await this.post<AuthResponse>('/api/auth/register', data, false);
    return {
      user: transformUser(response.user),
      tokens: {
        accessToken: response.access_token,
        refreshToken: response.refresh_token,
        expiresAt: calculateExpiry(response.expires_in),
      },
    };
  }

  async refreshToken(refreshToken: string): Promise<AuthTokens> {
    const response = await this.post<TokenResponse>(
      '/api/auth/refresh',
      { refresh_token: refreshToken },
      false
    );
    return {
      accessToken: response.access_token,
      refreshToken: response.refresh_token,
      expiresAt: calculateExpiry(response.expires_in),
    };
  }

  async getCurrentUser(): Promise<User> {
    const response = await this.get<AuthResponse['user']>('/api/auth/me');
    return transformUser(response);
  }
}

// Export singleton instance
export const api = new ApiClient(API_BASE_URL);

// Auth actions that update the store
export async function login(email: string, password: string): Promise<User> {
  const store = useAuthStore.getState();
  store.setLoading(true);
  store.clearError();

  try {
    const { user, tokens } = await api.login({ email, password });
    store.setUser(user);
    store.setTokens(tokens);
    return user;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Login failed';
    store.setError(message);
    throw error;
  } finally {
    store.setLoading(false);
  }
}

export async function register(email: string, password: string, name: string): Promise<User> {
  const store = useAuthStore.getState();
  store.setLoading(true);
  store.clearError();

  try {
    const { user, tokens } = await api.register({ email, password, name });
    store.setUser(user);
    store.setTokens(tokens);
    return user;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Registration failed';
    store.setError(message);
    throw error;
  } finally {
    store.setLoading(false);
  }
}

export async function refreshAuth(): Promise<boolean> {
  const store = useAuthStore.getState();
  const tokens = store.tokens;

  if (!tokens?.refreshToken) {
    store.logout();
    return false;
  }

  try {
    const newTokens = await api.refreshToken(tokens.refreshToken);
    store.setTokens(newTokens);
    return true;
  } catch (error) {
    // Only logout on 401 (invalid refresh token) - keep session for network errors
    const status = (error as Error & { status?: number }).status;
    if (status === 401) {
      store.logout();
    }
    return false;
  }
}

export async function initializeAuth(): Promise<void> {
  const store = useAuthStore.getState();

  if (store.isInitialized) return;

  const tokens = store.tokens;
  if (!tokens) {
    store.setInitialized(true);
    return;
  }

  // Check if token is expired or about to expire (within 5 minutes)
  const isExpiringSoon = tokens.expiresAt - Date.now() < 5 * 60 * 1000;

  if (isExpiringSoon) {
    await refreshAuth();
  }

  // Fetch current user to validate token
  if (store.tokens) {
    try {
      const user = await api.getCurrentUser();
      store.setUser(user);
    } catch (error) {
      // Only logout on 401 (unauthorized) - keep session for network errors
      const status = (error as Error & { status?: number }).status;
      if (status === 401) {
        store.logout();
      }
      // For other errors (network, 500, etc.), keep the existing auth state
    }
  }

  store.setInitialized(true);
}

export function logout(): void {
  useAuthStore.getState().logout();
}

// OAuth types
interface OAuthURLResponse {
  url: string;
  state: string;
}

interface OAuthTokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  user: {
    id: string;
    email: string;
    name: string | null;
    avatar_url: string | null;
    role: string;
  };
}

// OAuth methods
export async function getOAuthURL(provider: 'github' | 'google'): Promise<string> {
  const response = await api.get<OAuthURLResponse>(`/api/oauth/${provider}/authorize`, false);
  // Store state in sessionStorage for verification
  if (typeof window !== 'undefined') {
    sessionStorage.setItem('oauth_state', response.state);
  }
  return response.url;
}

export async function handleOAuthCallback(
  provider: 'github' | 'google',
  code: string,
  state: string
): Promise<User> {
  const store = useAuthStore.getState();
  store.setLoading(true);
  store.clearError();

  try {
    // Verify state parameter to prevent CSRF attacks
    if (typeof window !== 'undefined') {
      const storedState = sessionStorage.getItem('oauth_state');
      if (!storedState || storedState !== state) {
        throw new Error('Invalid OAuth state - possible CSRF attack');
      }
      // Clear the state after verification
      sessionStorage.removeItem('oauth_state');
    }

    const response = await api.post<OAuthTokenResponse>(
      `/api/oauth/${provider}/callback`,
      { code, state },
      false
    );

    const user: User = {
      id: response.user.id,
      email: response.user.email,
      name: response.user.name,
      avatarUrl: response.user.avatar_url,
      role: response.user.role,
    };

    const tokens: AuthTokens = {
      accessToken: response.access_token,
      refreshToken: response.refresh_token,
      expiresAt: calculateExpiry(response.expires_in),
    };

    store.setUser(user);
    store.setTokens(tokens);
    return user;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'OAuth failed';
    store.setError(message);
    throw error;
  } finally {
    store.setLoading(false);
  }
}

// Agent types
export interface AgentCreateRequest {
  name: string;
  role:
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
  model: string;
  config?: Record<string, unknown>;
  template_id?: string; // Reference to custom agent template
}

export interface AgentResponse {
  id: string;
  session_id: string;
  name: string;
  role: string;
  model: string;
  status: string;
  mode?: 'plan' | 'ask' | 'auto' | 'sovereign';
  config?: Record<string, unknown>;
  template_id?: string | null;
  created_at: string;
}

export interface MessageResponse {
  id: string;
  agent_id: string;
  role: 'user' | 'assistant';
  content: string;
  tool_calls?: Record<string, unknown>;
  created_at: string;
}

// Agent API methods
export async function createAgent(
  sessionId: string,
  data: AgentCreateRequest
): Promise<AgentResponse> {
  return api.post<AgentResponse>(`/api/sessions/${sessionId}/agents`, data);
}

export async function listAgents(sessionId: string): Promise<AgentResponse[]> {
  return api.get<AgentResponse[]>(`/api/sessions/${sessionId}/agents`);
}

export async function getAgent(sessionId: string, agentId: string): Promise<AgentResponse> {
  return api.get<AgentResponse>(`/api/sessions/${sessionId}/agents/${agentId}`);
}

export async function deleteAgent(sessionId: string, agentId: string): Promise<void> {
  await api.delete(`/api/sessions/${sessionId}/agents/${agentId}`);
}

export async function duplicateAgent(
  sessionId: string,
  agentId: string,
  newName?: string
): Promise<AgentResponse> {
  return api.post<AgentResponse>(`/api/sessions/${sessionId}/agents/${agentId}/duplicate`, {
    name: newName,
  });
}

export async function deleteAgentMessage(
  sessionId: string,
  agentId: string,
  messageId: string
): Promise<void> {
  await api.delete(`/api/sessions/${sessionId}/agents/${agentId}/messages/${messageId}`);
}

export async function sendAgentMessage(
  sessionId: string,
  agentId: string,
  content: string
): Promise<MessageResponse> {
  return api.post<MessageResponse>(`/api/sessions/${sessionId}/agents/${agentId}/messages`, {
    content,
  });
}

export async function getAgentMessages(
  sessionId: string,
  agentId: string
): Promise<MessageResponse[]> {
  return api.get<MessageResponse[]>(`/api/sessions/${sessionId}/agents/${agentId}/messages`);
}

export interface AbortAgentResponse {
  success: boolean;
  agent_id: string;
  cancelled_count: number;
  message: string;
}

export async function abortAgent(sessionId: string, agentId: string): Promise<AbortAgentResponse> {
  return api.post<AbortAgentResponse>(`/api/sessions/${sessionId}/agents/${agentId}/abort`, {});
}

// ==================== Agent Mode & Approvals ====================

export type AgentMode = 'plan' | 'ask' | 'auto' | 'sovereign';

export interface AgentModeResponse {
  agent_id: string;
  mode: AgentMode;
  command_allowlist: string[] | null;
}

export interface PendingApproval {
  id: string;
  agent_id: string;
  session_id: string;
  action_type: 'file_write' | 'command_execute';
  action_details: {
    tool_name?: string;
    file_path?: string;
    command?: string;
    arguments?: Record<string, unknown>;
  };
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  expires_at: string;
  created_at: string;
}

export interface ApprovalResponse {
  approved: boolean;
  add_to_allowlist?: boolean; // For Auto mode - add command to allowlist
  message?: string;
}

export async function updateAgentMode(
  sessionId: string,
  agentId: string,
  mode: AgentMode,
  commandAllowlist?: string[]
): Promise<AgentModeResponse> {
  return api.patch<AgentModeResponse>(`/api/sessions/${sessionId}/agents/${agentId}/mode`, {
    mode,
    command_allowlist: commandAllowlist,
  });
}

export async function getAgentMode(sessionId: string, agentId: string): Promise<AgentModeResponse> {
  return api.get<AgentModeResponse>(`/api/sessions/${sessionId}/agents/${agentId}/mode`);
}

export async function getPendingApprovals(
  sessionId: string,
  agentId: string
): Promise<PendingApproval[]> {
  return api.get<PendingApproval[]>(
    `/api/sessions/${sessionId}/agents/${agentId}/pending-approvals`
  );
}

export async function respondToApproval(
  sessionId: string,
  agentId: string,
  approvalId: string,
  response: ApprovalResponse
): Promise<{ success: boolean; message: string }> {
  return api.post<{ success: boolean; message: string }>(
    `/api/sessions/${sessionId}/agents/${agentId}/approvals/${approvalId}`,
    response
  );
}

// ==================== Context Window ====================

export interface ContextUsageResponse {
  agent_id: string;
  tokens_used: number;
  tokens_max: number;
  percentage: number;
}

export interface CompactResponse {
  success: boolean;
  tokens_before: number;
  tokens_after: number;
  messages_removed: number;
  summary: string | null;
}

export async function getAgentContextUsage(agentId: string): Promise<ContextUsageResponse> {
  return api.get<ContextUsageResponse>(`/api/context/agents/${agentId}/context`);
}

export async function compactAgentContext(
  agentId: string,
  customInstructions?: string
): Promise<CompactResponse> {
  return api.post<CompactResponse>(`/api/context/agents/${agentId}/compact`, {
    custom_instructions: customInstructions,
  });
}

// ==================== Pod Templates ====================

export interface PodTemplate {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  icon_url: string | null; // CDN URL for the icon
  base_image: string;
  pre_install_commands: string[] | null;
  environment_variables: Record<string, string> | null;
  default_ports: Array<{ port: number; label: string; protocol: string }> | null;
  language_versions: Record<string, string> | null;
  is_public: boolean;
  is_official: boolean;
  owner_id: string | null;
  usage_count: number;
}

export interface CreateTemplateRequest {
  name: string;
  slug: string;
  description?: string;
  icon?: string;
  base_image?: string;
  pre_install_commands?: string[];
  environment_variables?: Record<string, string>;
  default_ports?: Array<{ port: number; label: string; protocol: string }>;
  language_versions?: Record<string, string>;
  is_public?: boolean;
}

export async function listTemplates(includePrivate = false): Promise<PodTemplate[]> {
  const query = includePrivate ? '?include_private=true' : '';
  return api.get<PodTemplate[]>(`/api/templates${query}`);
}

export async function getTemplate(templateIdOrSlug: string): Promise<PodTemplate> {
  return api.get<PodTemplate>(`/api/templates/${templateIdOrSlug}`);
}

export async function createTemplate(data: CreateTemplateRequest): Promise<PodTemplate> {
  return api.post<PodTemplate>('/api/templates', data);
}

export async function updateTemplate(
  templateId: string,
  data: Partial<CreateTemplateRequest>
): Promise<PodTemplate> {
  return api.patch<PodTemplate>(`/api/templates/${templateId}`, data);
}

export async function deleteTemplate(templateId: string): Promise<void> {
  await api.delete(`/api/templates/${templateId}`);
}

// ==================== User Config ====================

export interface UserConfig {
  id: string;
  user_id: string;
  sync_dotfiles: boolean;
  dotfiles_repo: string | null;
  dotfiles_paths: string[] | null;
  default_shell: string;
  default_editor: string;
  git_name: string | null;
  git_email: string | null;
  default_template_id: string | null;
  theme: string;
  editor_theme: string;
}

export interface UpdateUserConfigRequest {
  sync_dotfiles?: boolean;
  dotfiles_repo?: string | null;
  dotfiles_paths?: string[];
  default_shell?: string;
  default_editor?: string;
  git_name?: string | null;
  git_email?: string | null;
  default_template_id?: string | null;
  theme?: string;
  editor_theme?: string;
}

export interface DotfileContent {
  path: string;
  content: string;
}

export async function getUserConfig(): Promise<UserConfig> {
  return api.get<UserConfig>('/api/user/config');
}

export async function updateUserConfig(data: UpdateUserConfigRequest): Promise<UserConfig> {
  return api.patch<UserConfig>('/api/user/config', data);
}

export async function getDotfiles(): Promise<DotfileContent[]> {
  return api.get<DotfileContent[]>('/api/user/config/dotfiles');
}

export async function uploadDotfiles(
  files: DotfileContent[]
): Promise<{ uploaded: number; errors: Array<{ path: string; error: string }> }> {
  return api.post('/api/user/config/dotfiles', { files });
}

export async function deleteDotfile(path: string): Promise<void> {
  await api.delete(`/api/user/config/dotfiles/${encodeURIComponent(path)}`);
}

// ==================== Onboarding Tours ====================

export interface CompletedToursResponse {
  completed_tours: string[];
}

export async function getCompletedTours(): Promise<CompletedToursResponse> {
  return api.get<CompletedToursResponse>('/api/user/config/tours');
}

export async function completeTour(tourId: string): Promise<CompletedToursResponse> {
  return api.post<CompletedToursResponse>(
    `/api/user/config/tours/${encodeURIComponent(tourId)}/complete`,
    {}
  );
}

export async function uncompleteTour(tourId: string): Promise<CompletedToursResponse> {
  return api.delete<CompletedToursResponse>(`/api/user/config/tours/${encodeURIComponent(tourId)}`);
}

export async function resetAllTours(): Promise<CompletedToursResponse> {
  return api.delete<CompletedToursResponse>('/api/user/config/tours');
}

// ==================== Sessions ====================

export interface Session {
  id: string;
  name: string;
  owner_id: string;
  workspace_id: string | null;
  branch: string;
  status: 'active' | 'stopped' | 'creating' | 'error';
  template_id: string | null;
  git_url: string | null;
  created_at: string;
  updated_at: string;
  pinned?: boolean;
  active_agents?: number;
  total_tokens?: number;
}

export interface SessionListResponse {
  items: Session[];
  total: number;
  page: number;
  page_size: number;
  has_more: boolean;
}

export interface CreateSessionRequest {
  name: string;
  git_url?: string;
  branch?: string;
  template_id?: string;
  // Pod configuration
  tier?: string;
  python_version?: string;
  node_version?: string;
  os_version?: string;
  // Local pod (for self-hosted compute)
  local_pod_id?: string;
}

export async function createSession(data: CreateSessionRequest): Promise<Session> {
  return api.post<Session>('/api/sessions', data);
}

export async function listSessions(page = 1, pageSize = 20): Promise<SessionListResponse> {
  return api.get<SessionListResponse>(`/api/sessions?page=${page}&page_size=${pageSize}`);
}

export async function getSession(sessionId: string): Promise<Session> {
  return api.get<Session>(`/api/sessions/${sessionId}`);
}

export async function deleteSession(sessionId: string): Promise<void> {
  await api.delete(`/api/sessions/${sessionId}`);
}

// ==================== Workspace Standby ====================

export interface WorkspaceStatusResponse {
  id: string;
  status: 'pending' | 'running' | 'standby' | 'stopped' | 'error';
  standby_at: string | null;
  last_activity: string | null;
}

export interface StandbySettingsResponse {
  timeout_minutes: number | null; // null = Never
  source: 'session' | 'user_default';
}

export async function pauseWorkspace(workspaceId: string): Promise<WorkspaceStatusResponse> {
  return api.post<WorkspaceStatusResponse>(`/api/workspaces/${workspaceId}/pause`, {});
}

export async function resumeWorkspace(workspaceId: string): Promise<WorkspaceStatusResponse> {
  return api.post<WorkspaceStatusResponse>(`/api/workspaces/${workspaceId}/resume`, {});
}

export async function getWorkspaceStatus(workspaceId: string): Promise<WorkspaceStatusResponse> {
  return api.get<WorkspaceStatusResponse>(`/api/workspaces/${workspaceId}/status`);
}

export async function getStandbySettings(sessionId: string): Promise<StandbySettingsResponse> {
  return api.get<StandbySettingsResponse>(`/api/sessions/${sessionId}/standby-settings`);
}

export async function updateStandbySettings(
  sessionId: string,
  timeoutMinutes: number | null
): Promise<StandbySettingsResponse> {
  return api.patch<StandbySettingsResponse>(`/api/sessions/${sessionId}/standby-settings`, {
    timeout_minutes: timeoutMinutes,
  });
}

export async function clearStandbySettings(sessionId: string): Promise<StandbySettingsResponse> {
  return api.delete(`/api/sessions/${sessionId}/standby-settings`);
}

// ==================== Git ====================

export interface GitStatus {
  branch: string;
  is_clean: boolean;
  ahead: number;
  behind: number;
  staged: Array<{ path: string; status: string }>;
  unstaged: Array<{ path: string; status: string }>;
  untracked: string[];
}

export interface GitBranch {
  name: string;
  is_current: boolean;
  is_remote: boolean;
  commit_hash: string | null;
}

export interface GitCommit {
  hash: string;
  short_hash: string;
  message: string;
  author: string;
  date: string;
}

export interface GitDiffFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  diff: string | null;
}

export async function getGitStatus(sessionId: string): Promise<GitStatus> {
  return api.get<GitStatus>(`/api/sessions/${sessionId}/git/status`);
}

export async function getGitBranches(sessionId: string): Promise<GitBranch[]> {
  return api.get<GitBranch[]>(`/api/sessions/${sessionId}/git/branches`);
}

export async function getGitLog(sessionId: string, limit = 20): Promise<GitCommit[]> {
  return api.get<GitCommit[]>(`/api/sessions/${sessionId}/git/log?limit=${limit}`);
}

export async function getGitDiff(sessionId: string, staged = false): Promise<GitDiffFile[]> {
  return api.get<GitDiffFile[]>(`/api/sessions/${sessionId}/git/diff?staged=${staged}`);
}

export async function stageFiles(sessionId: string, files: string[]): Promise<void> {
  await api.post(`/api/sessions/${sessionId}/git/stage`, { files });
}

export async function unstageFiles(sessionId: string, files: string[]): Promise<void> {
  await api.post(`/api/sessions/${sessionId}/git/unstage`, { files });
}

export async function commitChanges(
  sessionId: string,
  message: string,
  files?: string[]
): Promise<{ message: string; hash: string }> {
  return api.post(`/api/sessions/${sessionId}/git/commit`, { message, files });
}

export async function pushChanges(
  sessionId: string,
  remote = 'origin',
  branch?: string
): Promise<{ message: string }> {
  return api.post(`/api/sessions/${sessionId}/git/push`, { remote, branch });
}

export async function pullChanges(
  sessionId: string,
  remote = 'origin',
  branch?: string
): Promise<{ message: string }> {
  return api.post(`/api/sessions/${sessionId}/git/pull`, { remote, branch });
}

export async function checkoutBranch(
  sessionId: string,
  branch: string,
  create = false
): Promise<{ message: string }> {
  return api.post(`/api/sessions/${sessionId}/git/checkout`, { branch, create });
}

// ==================== File System ====================

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
}

export interface FileContent {
  path: string;
  content: string;
  language: string;
}

export async function listFiles(sessionId: string, path = '.'): Promise<FileNode[]> {
  return api.get<FileNode[]>(`/api/sessions/${sessionId}/files?path=${encodeURIComponent(path)}`);
}

export async function getFileContent(sessionId: string, path: string): Promise<FileContent> {
  return api.get<FileContent>(
    `/api/sessions/${sessionId}/files/content?path=${encodeURIComponent(path)}`
  );
}

export async function createFile(
  sessionId: string,
  path: string,
  content = ''
): Promise<FileContent> {
  return api.post<FileContent>(`/api/sessions/${sessionId}/files`, { path, content });
}

export async function updateFileContent(
  sessionId: string,
  path: string,
  content: string
): Promise<FileContent> {
  return api.put<FileContent>(
    `/api/sessions/${sessionId}/files/content?path=${encodeURIComponent(path)}`,
    { content }
  );
}

export async function deleteFile(sessionId: string, path: string): Promise<{ deleted: string }> {
  return api.delete<{ deleted: string }>(
    `/api/sessions/${sessionId}/files?path=${encodeURIComponent(path)}`
  );
}

export async function moveFile(
  sessionId: string,
  sourcePath: string,
  destPath: string
): Promise<{ source: string; destination: string }> {
  return api.post<{ source: string; destination: string }>(
    `/api/sessions/${sessionId}/files/move`,
    {
      source_path: sourcePath,
      dest_path: destPath,
    }
  );
}

// ==================== Session Layout ====================

export interface GridSpanLayout {
  col_span: number;
  row_span: number;
}

export interface PositionLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  z_index: number;
}

export interface AgentLayoutState {
  agent_id: string;
  grid_span?: GridSpanLayout;
  position?: PositionLayout;
}

export interface FilePreviewLayoutState {
  preview_id: string;
  path: string;
  grid_span?: GridSpanLayout;
  position?: PositionLayout;
  docked?: boolean;
  pinned?: boolean;
}

export interface SessionLayoutState {
  view_mode: string;
  active_agent_id: string | null;
  agent_layouts: Record<string, AgentLayoutState>;
  file_preview_layouts: Record<string, FilePreviewLayoutState>;
  sidebar_open: boolean;
  sidebar_width: number;
}

export interface LayoutUpdateRequest {
  view_mode?: string;
  active_agent_id?: string | null;
  agent_layouts?: Record<string, AgentLayoutState>;
  file_preview_layouts?: Record<string, FilePreviewLayoutState>;
  sidebar_open?: boolean;
  sidebar_width?: number;
}

export async function getSessionLayout(sessionId: string): Promise<SessionLayoutState> {
  return api.get<SessionLayoutState>(`/api/sessions/${sessionId}/layout`);
}

export async function updateSessionLayout(
  sessionId: string,
  data: LayoutUpdateRequest
): Promise<SessionLayoutState> {
  return api.put<SessionLayoutState>(`/api/sessions/${sessionId}/layout`, data);
}

export async function updateAgentLayout(
  sessionId: string,
  agentId: string,
  data: Partial<AgentLayoutState>
): Promise<AgentLayoutState> {
  return api.patch<AgentLayoutState>(`/api/sessions/${sessionId}/layout/agent/${agentId}`, data);
}

export async function updateFilePreviewLayout(
  sessionId: string,
  previewId: string,
  data: Partial<FilePreviewLayoutState>
): Promise<FilePreviewLayoutState> {
  return api.patch<FilePreviewLayoutState>(
    `/api/sessions/${sessionId}/layout/file-preview/${previewId}`,
    data
  );
}

// ==================== Agent Templates ====================

export interface AgentTemplate {
  id: string;
  user_id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  system_prompt: string;
  allowed_tools: string[];
  model: string;
  temperature: number | null;
  max_tokens: number | null;
  config: Record<string, unknown> | null;
  is_public: boolean;
  share_token: string | null;
  usage_count: number;
  clone_count: number;
  created_at: string;
  updated_at: string;
}

export interface SharedTemplateOwner {
  name: string | null;
  avatar_url: string | null;
}

export interface SharedTemplate {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  system_prompt_preview: string;
  allowed_tools: string[];
  model: string;
  clone_count: number;
  created_at: string;
  owner: SharedTemplateOwner;
}

export interface ShareLinkResponse {
  share_token: string;
  share_url: string;
}

export interface CreateAgentTemplateRequest {
  name: string;
  slug: string;
  description?: string;
  icon?: string;
  system_prompt: string;
  allowed_tools: string[];
  model?: string;
  temperature?: number;
  max_tokens?: number;
  config?: Record<string, unknown>;
}

export interface UpdateAgentTemplateRequest {
  name?: string;
  description?: string;
  icon?: string;
  system_prompt?: string;
  allowed_tools?: string[];
  model?: string;
  temperature?: number;
  max_tokens?: number;
  config?: Record<string, unknown>;
}

export interface AvailableToolsResponse {
  tools: Record<string, string>;
}

export async function listAgentTemplates(): Promise<AgentTemplate[]> {
  return api.get<AgentTemplate[]>('/api/agent-templates');
}

export async function getAgentTemplate(templateId: string): Promise<AgentTemplate> {
  return api.get<AgentTemplate>(`/api/agent-templates/${templateId}`);
}

export async function createAgentTemplate(
  data: CreateAgentTemplateRequest
): Promise<AgentTemplate> {
  return api.post<AgentTemplate>('/api/agent-templates', data);
}

export async function updateAgentTemplate(
  templateId: string,
  data: UpdateAgentTemplateRequest
): Promise<AgentTemplate> {
  return api.patch<AgentTemplate>(`/api/agent-templates/${templateId}`, data);
}

export async function deleteAgentTemplate(templateId: string): Promise<void> {
  await api.delete(`/api/agent-templates/${templateId}`);
}

export async function getAvailableAgentTools(): Promise<AvailableToolsResponse> {
  return api.get<AvailableToolsResponse>('/api/agent-templates/tools');
}

// Alias for backward compatibility
export const getAgentTemplates = listAgentTemplates;

// ==================== Template Sharing ====================

export async function createShareLink(templateId: string): Promise<ShareLinkResponse> {
  return api.post<ShareLinkResponse>(`/api/agent-templates/${templateId}/share`, {});
}

export async function revokeShareLink(templateId: string): Promise<void> {
  await api.delete(`/api/agent-templates/${templateId}/share`);
}

export async function getSharedTemplate(shareToken: string): Promise<SharedTemplate> {
  // This is a public endpoint - no auth required
  return api.get<SharedTemplate>(`/api/agent-templates/shared/${shareToken}`, false);
}

export async function cloneSharedTemplate(shareToken: string): Promise<AgentTemplate> {
  return api.post<AgentTemplate>(`/api/agent-templates/shared/${shareToken}/clone`, {});
}

// ==================== Dashboard Statistics ====================

export interface PodStats {
  session_id: string;
  session_name: string;
  active_agents: number;
  total_tokens: number;
  total_cost: number;
  last_activity: string;
}

export interface UsageStats {
  total_tokens_used: number;
  total_api_calls: number;
  total_cost: number;
  tokens_this_month: number;
  api_calls_this_month: number;
  cost_this_month: number;
}

export interface DashboardStats {
  usage: UsageStats;
  pods: PodStats[];
  total_pods: number;
  active_pods: number;
  total_agents: number;
}

export async function getDashboardStats(): Promise<DashboardStats> {
  return api.get<DashboardStats>('/api/dashboard/stats');
}

// ==================== Activity Feed ====================

export type ActivityType =
  | 'agent_message'
  | 'file_change'
  | 'git_commit'
  | 'git_push'
  | 'session_created'
  | 'session_started'
  | 'session_stopped'
  | 'agent_created'
  | 'agent_error';

export interface ActivityItem {
  id: string;
  type: ActivityType;
  session_id: string;
  session_name: string;
  agent_id?: string;
  agent_name?: string;
  message: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export interface ActivityFeedResponse {
  items: ActivityItem[];
  has_more: boolean;
}

export async function getActivityFeed(limit = 20): Promise<ActivityFeedResponse> {
  return api.get<ActivityFeedResponse>(`/api/dashboard/activity?limit=${limit}`);
}

// ==================== Notifications ====================

export type NotificationType = 'info' | 'warning' | 'error' | 'success';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  action_url?: string;
  action_label?: string;
  read: boolean;
  created_at: string;
}

export interface NotificationsResponse {
  items: Notification[];
  unread_count: number;
}

export async function getNotifications(): Promise<NotificationsResponse> {
  return api.get<NotificationsResponse>('/api/notifications');
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  await api.post(`/api/notifications/${notificationId}/read`, {});
}

export async function markAllNotificationsRead(): Promise<void> {
  await api.post('/api/notifications/read-all', {});
}

// ==================== Pinned Sessions ====================

export async function pinSession(sessionId: string): Promise<void> {
  await api.post(`/api/sessions/${sessionId}/pin`, {});
}

export async function unpinSession(sessionId: string): Promise<void> {
  await api.delete(`/api/sessions/${sessionId}/pin`);
}

export async function getPinnedSessions(): Promise<Session[]> {
  return api.get<Session[]>('/api/sessions/pinned');
}

// ==================== Usage History ====================

export interface UsageDataPoint {
  date: string;
  tokens: number;
  api_calls: number;
  cost: number;
}

export interface UsageHistoryResponse {
  daily: UsageDataPoint[];
  period_start: string;
  period_end: string;
}

export async function getUsageHistory(days = 30): Promise<UsageHistoryResponse> {
  return api.get<UsageHistoryResponse>(`/api/dashboard/usage-history?days=${days}`);
}

// ==================== Voice/Audio ====================

export interface VoiceConfig {
  tts_enabled: boolean;
  auto_play: boolean;
  voice_id: string | null;
  speed: number;
  language: string;
}

export interface VoiceInfo {
  id: string;
  name: string;
  language_code: string;
  language_name: string;
  gender: string;
  engine: string;
}

export interface TranscribeResponse {
  text: string;
  confidence: number;
  duration_ms: number;
}

export interface SynthesizeResponse {
  audio_url: string;
  audio_b64: string | null;
  duration_ms: number;
  content_type: string;
}

export async function listVoices(language?: string): Promise<VoiceInfo[]> {
  const query = language ? `?language=${encodeURIComponent(language)}` : '';
  return api.get<VoiceInfo[]>(`/api/voice/voices${query}`);
}

export async function getAgentVoiceConfig(
  sessionId: string,
  agentId: string
): Promise<VoiceConfig> {
  return api.get<VoiceConfig>(`/api/voice/sessions/${sessionId}/agents/${agentId}/voice-config`);
}

export async function updateAgentVoiceConfig(
  sessionId: string,
  agentId: string,
  config: Partial<VoiceConfig>
): Promise<VoiceConfig> {
  return api.patch<VoiceConfig>(
    `/api/voice/sessions/${sessionId}/agents/${agentId}/voice-config`,
    config
  );
}

export async function transcribeAudio(
  sessionId: string,
  audioBase64: string,
  format: string = 'webm',
  language: string = 'en-US'
): Promise<TranscribeResponse> {
  return api.post<TranscribeResponse>(`/api/voice/sessions/${sessionId}/transcribe`, {
    audio_b64: audioBase64,
    format,
    language,
  });
}

export async function synthesizeSpeech(
  sessionId: string,
  text: string,
  voiceId?: string,
  format: string = 'mp3',
  speed: number = 1.0
): Promise<SynthesizeResponse> {
  return api.post<SynthesizeResponse>(`/api/voice/sessions/${sessionId}/synthesize`, {
    text,
    voice_id: voiceId,
    format,
    speed,
  });
}

export async function synthesizeMessage(
  sessionId: string,
  agentId: string,
  messageId: string,
  regenerate: boolean = false
): Promise<SynthesizeResponse> {
  const params = regenerate ? '?regenerate=true' : '';
  return api.post<SynthesizeResponse>(
    `/api/voice/sessions/${sessionId}/agents/${agentId}/messages/${messageId}/synthesize${params}`,
    {}
  );
}

// ==================== Voice Commands ====================

export type VoiceCommandType =
  | 'open_file'
  | 'close_file'
  | 'search_files'
  | 'talk_to_agent'
  | 'create_agent'
  | 'delete_agent'
  | 'show_terminal'
  | 'show_preview'
  | 'toggle_sidebar'
  | 'run_command'
  | 'create_session'
  | 'unknown';

export interface VoiceCommandResponse {
  command_type: VoiceCommandType;
  target: string | null;
  message: string | null;
  confidence: number;
  description: string;
  raw_text: string;
  metadata: Record<string, unknown> | null;
}

export async function parseVoiceCommand(
  text: string,
  sessionId?: string
): Promise<VoiceCommandResponse> {
  return api.post<VoiceCommandResponse>('/api/voice/command', {
    text,
    session_id: sessionId,
  });
}

// ==================== Billing ====================

export interface SubscriptionPlanResponse {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  price_monthly: number;
  price_yearly: number;
  currency: string;
  tokens_included: number;
  compute_hours_included: number; // Legacy - for backward compatibility
  compute_credits_included: number; // Compute credits in dollars
  storage_gb_included: number;
  max_agents: number;
  max_sessions: number;
  max_team_members: number;
  overage_allowed: boolean;
  overage_token_rate: number;
  overage_compute_rate: number;
  overage_storage_rate: number;
  features: Record<string, boolean>;
  is_popular: boolean;
  is_enterprise: boolean;
}

export interface SubscriptionResponse {
  id: string;
  user_id: string;
  plan: SubscriptionPlanResponse;
  status: string;
  billing_cycle: string;
  current_period_start: string;
  current_period_end: string;
  cancel_at_period_end: boolean;
  canceled_at: string | null;
  trial_end: string | null;
  created_at: string;
}

export interface UsageSummaryResponse {
  period_start: string;
  period_end: string;
  tokens_input: number;
  tokens_output: number;
  tokens_total: number;
  tokens_cost: number;
  compute_seconds: number;
  compute_hours: number; // Legacy display
  compute_credits_used: number; // Compute cost in dollars
  compute_credits_included: number; // Plan's included compute in dollars
  compute_cost: number; // Same as compute_credits_used
  storage_gb: number;
  storage_cost: number;
  api_calls: number;
  total_cost: number;
  usage_by_model: Record<string, { input: number; output: number; cost: number }>;
  usage_by_agent: Record<string, { tokens: number; cost: number }>;
  usage_by_tier: Record<string, { seconds: number; cost: number }>; // Compute by tier
}

export interface UsageRecordResponse {
  id: string;
  usage_type: string;
  quantity: number;
  unit: string;
  cost: number;
  model: string | null;
  tier: string | null;
  session_id: string | null;
  agent_id: string | null;
  is_overage: boolean;
  created_at: string;
}

export interface QuotaResponse {
  id: string;
  quota_type: string;
  limit_value: number;
  current_usage: number;
  usage_percentage: number;
  reset_at: string | null;
  overage_allowed: boolean;
  is_exceeded: boolean;
  is_warning: boolean;
}

export interface CreditBalanceResponse {
  balance: number;
  pending: number;
  expiring_soon: number;
  total_purchased: number;
  total_used: number;
  total_bonus: number;
  last_updated: string;
}

export interface CreditTransactionResponse {
  id: string;
  amount: number;
  currency: string;
  transaction_type: string;
  description: string;
  expires_at: string | null;
  created_at: string;
}

export interface InvoiceResponse {
  id: string;
  invoice_number: string;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  currency: string;
  status: string;
  line_items: Array<{
    description: string;
    quantity: number;
    unit_price: number;
    total: number;
  }>;
  period_start: string;
  period_end: string;
  due_date: string;
  paid_at: string | null;
  pdf_url: string | null;
  payment_method?: string;
  created_at: string;
}

export interface HardwareSpecResponse {
  id: string;
  tier: string;
  display_name: string;
  description: string | null;
  architecture: string;
  vcpu: number;
  memory_mb: number;
  gpu_type: string | null;
  gpu_memory_gb: number | null;
  gpu_count: number;
  storage_gb_default: number;
  storage_gb_max: number;
  hourly_rate: number;
  is_available: boolean;
  requires_subscription: string | null;
  region_availability: string[];
}

// Subscription Plans
export async function listSubscriptionPlans(): Promise<SubscriptionPlanResponse[]> {
  return api.get<SubscriptionPlanResponse[]>('/api/billing/plans');
}

export async function getSubscriptionPlan(slug: string): Promise<SubscriptionPlanResponse> {
  return api.get<SubscriptionPlanResponse>(`/api/billing/plans/${slug}`);
}

// User Subscription
export async function getSubscription(): Promise<SubscriptionResponse | null> {
  return api.get<SubscriptionResponse | null>('/api/billing/subscription');
}

export async function createSubscription(
  planSlug: string,
  billingCycle: 'monthly' | 'yearly' = 'monthly'
): Promise<SubscriptionResponse> {
  return api.post<SubscriptionResponse>('/api/billing/subscription', {
    plan_slug: planSlug,
    billing_cycle: billingCycle,
  });
}

export async function updateSubscription(data: {
  plan_slug?: string;
  cancel_at_period_end?: boolean;
  cancellation_reason?: string;
}): Promise<SubscriptionResponse> {
  return api.patch<SubscriptionResponse>('/api/billing/subscription', data);
}

export async function cancelSubscription(reason?: string): Promise<SubscriptionResponse> {
  return updateSubscription({
    cancel_at_period_end: true,
    cancellation_reason: reason,
  });
}

// Usage
export async function getUsageSummary(
  period: 'current' | 'last_month' | 'all_time' = 'current'
): Promise<UsageSummaryResponse> {
  return api.get<UsageSummaryResponse>(`/api/billing/usage?period=${period}`);
}

export async function getBillingUsageHistory(
  page = 1,
  pageSize = 50,
  usageType?: string,
  sessionId?: string
): Promise<UsageRecordResponse[]> {
  const params = new URLSearchParams({
    page: page.toString(),
    page_size: pageSize.toString(),
  });
  if (usageType) params.append('usage_type', usageType);
  if (sessionId) params.append('session_id', sessionId);
  return api.get<UsageRecordResponse[]>(`/api/billing/usage/history?${params}`);
}

// Quotas
export async function getQuotas(): Promise<QuotaResponse[]> {
  return api.get<QuotaResponse[]>('/api/billing/quotas');
}

// Credits
export async function getCreditBalance(): Promise<CreditBalanceResponse> {
  return api.get<CreditBalanceResponse>('/api/billing/credits');
}

export async function purchaseCredits(amountCents: number): Promise<CreditTransactionResponse> {
  return api.post<CreditTransactionResponse>('/api/billing/credits/purchase', {
    amount_cents: amountCents,
  });
}

export async function getCreditHistory(
  page = 1,
  pageSize = 50
): Promise<CreditTransactionResponse[]> {
  return api.get<CreditTransactionResponse[]>(
    `/api/billing/credits/history?page=${page}&page_size=${pageSize}`
  );
}

// Invoices
export async function listInvoices(page = 1, pageSize = 20): Promise<InvoiceResponse[]> {
  return api.get<InvoiceResponse[]>(`/api/billing/invoices?page=${page}&page_size=${pageSize}`);
}

export async function getInvoice(invoiceId: string): Promise<InvoiceResponse> {
  return api.get<InvoiceResponse>(`/api/billing/invoices/${invoiceId}`);
}

// Hardware Specs
export async function listHardwareSpecs(): Promise<HardwareSpecResponse[]> {
  return api.get<HardwareSpecResponse[]>('/api/billing/hardware-specs');
}

export async function getHardwareSpec(tier: string): Promise<HardwareSpecResponse> {
  return api.get<HardwareSpecResponse>(`/api/billing/hardware-specs/${tier}`);
}

// Billing Events (for audit)
export async function listBillingEvents(
  page = 1,
  pageSize = 50
): Promise<
  Array<{ id: string; event_type: string; event_data: Record<string, unknown>; created_at: string }>
> {
  return api.get(`/api/billing/events?page=${page}&page_size=${pageSize}`);
}

// ==================== Agent Attention ====================

export type AgentAttentionType = 'needs_approval' | 'completed' | 'error' | 'waiting_input';
export type AgentAttentionPriority = 'low' | 'medium' | 'high' | 'critical';

export interface AttentionItem {
  id: string;
  agent_id: string;
  agent_name: string;
  session_id: string;
  attention_type: AgentAttentionType;
  title: string;
  message: string;
  metadata: Record<string, unknown> | null;
  priority: AgentAttentionPriority;
  is_read: boolean;
  is_dismissed: boolean;
  created_at: string;
  expires_at: string | null;
}

export interface AttentionListResponse {
  items: AttentionItem[];
  total: number;
}

export interface UnreadCountResponse {
  count: number;
}

export async function getAttentionItems(
  sessionId: string,
  options?: { unread_only?: boolean; type?: AgentAttentionType }
): Promise<AttentionListResponse> {
  const params = new URLSearchParams();
  if (options?.unread_only) params.append('unread_only', 'true');
  if (options?.type) params.append('type', options.type);
  const query = params.toString() ? `?${params}` : '';
  return api.get<AttentionListResponse>(`/api/sessions/${sessionId}/attention${query}`);
}

export async function getAttentionUnreadCount(sessionId: string): Promise<UnreadCountResponse> {
  return api.get<UnreadCountResponse>(`/api/sessions/${sessionId}/attention/unread-count`);
}

export async function markAttentionRead(
  sessionId: string,
  attentionId: string
): Promise<AttentionItem> {
  return api.post<AttentionItem>(`/api/sessions/${sessionId}/attention/${attentionId}/read`, {});
}

export async function dismissAttention(
  sessionId: string,
  attentionId: string
): Promise<{ success: boolean }> {
  return api.post<{ success: boolean }>(
    `/api/sessions/${sessionId}/attention/${attentionId}/dismiss`,
    {}
  );
}

export async function dismissAllAttention(sessionId: string): Promise<{ dismissed: number }> {
  return api.post<{ dismissed: number }>(`/api/sessions/${sessionId}/attention/dismiss-all`, {});
}

export async function dismissAgentAttention(
  sessionId: string,
  agentId: string
): Promise<{ dismissed: number }> {
  return api.post<{ dismissed: number }>(
    `/api/sessions/${sessionId}/attention/agent/${agentId}/dismiss`,
    {}
  );
}

// ==================== MCP (Model Context Protocol) Servers ====================

export interface MCPDefaultServer {
  slug: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  transport: 'stdio' | 'sse';
  command: string | null;
  args: string[] | null;
  url: string | null;
  required_env: string[];
  is_builtin: boolean;
  is_enabled: boolean;
  has_required_env: boolean;
}

export interface MCPDefaultsListResponse {
  servers: MCPDefaultServer[];
  categories: string[];
}

export interface MCPToolInfo {
  name: string;
  description: string | null;
  input_schema: Record<string, unknown>;
}

export interface MCPServer {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  transport: 'stdio' | 'sse' | 'http';
  command: string | null;
  args: string[] | null;
  url: string | null;
  env_vars: Record<string, string> | null;
  is_enabled: boolean;
  source_slug: string | null;
  category: string | null;
  is_default: boolean;
  config_source: 'env' | 'ui' | 'api';
  icon: string | null;
  discovered_tools: MCPToolInfo[] | null;
  discovered_resources: unknown[] | null;
  last_connected_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface EffectiveMCPServer {
  id: string;
  name: string;
  transport: 'stdio' | 'sse';
  command: string | null;
  args: string[] | null;
  url: string | null;
  env_vars: Record<string, string>;
  source: 'env' | 'database' | 'default';
  source_slug: string | null;
}

export interface EffectiveMCPConfigResponse {
  servers: EffectiveMCPServer[];
  env_configured_count: number;
  db_configured_count: number;
  builtin_count: number;
}

export interface CreateMCPServerRequest {
  name: string;
  description?: string;
  transport: 'stdio' | 'sse' | 'http';
  command?: string;
  args?: string[];
  url?: string;
  env_vars?: Record<string, string>;
  is_enabled?: boolean;
}

export interface UpdateMCPServerRequest {
  name?: string;
  description?: string;
  command?: string;
  args?: string[];
  url?: string;
  env_vars?: Record<string, string>;
  is_enabled?: boolean;
}

export interface SyncFromEnvResponse {
  synced_servers: string[];
  count: number;
}

export interface MCPTestConnectionResponse {
  success: boolean;
  message: string;
  tools_count?: number;
  error?: string;
}

// MCP Defaults
export async function getMCPDefaults(): Promise<MCPDefaultsListResponse> {
  return api.getCached<MCPDefaultsListResponse>('/api/mcp/defaults', { ttl: 60000 });
}

export async function getMCPDefaultServer(slug: string): Promise<MCPDefaultServer> {
  return api.get<MCPDefaultServer>(`/api/mcp/defaults/${slug}`);
}

export async function enableMCPDefault(
  slug: string,
  envVars?: Record<string, string>
): Promise<MCPServer> {
  return api.post<MCPServer>(`/api/mcp/defaults/${slug}/enable`, {
    env_vars: envVars,
  });
}

export async function disableMCPDefault(slug: string): Promise<{ message: string }> {
  return api.post<{ message: string }>(`/api/mcp/defaults/${slug}/disable`, {});
}

// User MCP Servers
export async function listMCPServers(): Promise<MCPServer[]> {
  const response = await api.get<{ servers: MCPServer[]; total: number }>('/api/mcp/servers');
  return response.servers;
}

export async function getMCPServer(serverId: string): Promise<MCPServer> {
  return api.get<MCPServer>(`/api/mcp/servers/${serverId}`);
}

export async function createMCPServer(data: CreateMCPServerRequest): Promise<MCPServer> {
  const result = await api.post<MCPServer>('/api/mcp/servers', data);
  // Invalidate cache after successful creation
  requestCache.invalidatePattern(/^GET:\/api\/mcp\//);
  return result;
}

export async function updateMCPServer(
  serverId: string,
  data: UpdateMCPServerRequest
): Promise<MCPServer> {
  const result = await api.put<MCPServer>(`/api/mcp/servers/${serverId}`, data);
  // Invalidate cache after successful update
  requestCache.invalidatePattern(/^GET:\/api\/mcp\//);
  return result;
}

export async function deleteMCPServer(serverId: string): Promise<void> {
  await api.delete(`/api/mcp/servers/${serverId}`);
  // Invalidate cache after successful deletion
  requestCache.invalidatePattern(/^GET:\/api\/mcp\//);
}

export async function testMCPServerConnection(
  serverId: string
): Promise<MCPTestConnectionResponse> {
  return api.post<MCPTestConnectionResponse>(`/api/mcp/servers/${serverId}/test`, {});
}

// Effective config (merged)
export async function getEffectiveMCPConfig(): Promise<EffectiveMCPConfigResponse> {
  return api.get<EffectiveMCPConfigResponse>('/api/mcp/servers/effective');
}

export async function syncMCPServersFromEnv(): Promise<SyncFromEnvResponse> {
  const result = await api.post<SyncFromEnvResponse>('/api/mcp/servers/sync-from-env', {});
  // Invalidate cache after successful sync
  requestCache.invalidatePattern(/^GET:\/api\/mcp\//);
  return result;
}

// ==================== Local Pods (Self-Hosted Compute) ====================

export type LocalPodStatus = 'offline' | 'online' | 'busy' | 'error';

export interface LocalPod {
  id: string;
  user_id: string;
  name: string;
  token_prefix: string;
  status: LocalPodStatus;
  last_heartbeat: string | null;
  last_error: string | null;
  os_info: string | null;
  architecture: string | null;
  docker_version: string | null;
  total_memory_mb: number | null;
  total_cpu_cores: number | null;
  max_workspaces: number;
  current_workspaces: number;
  labels: Record<string, string> | null;
  created_at: string;
  updated_at: string;
}

export interface LocalPodWithWorkspaces extends LocalPod {
  workspaces: Array<{
    id: string;
    session_id: string;
    status: string;
    created_at: string;
  }>;
}

export interface CreateLocalPodRequest {
  name: string;
  max_workspaces?: number;
  labels?: Record<string, string>;
}

export interface CreateLocalPodResponse {
  pod: LocalPod;
  token: string; // Only returned on create - save this!
}

export interface UpdateLocalPodRequest {
  name?: string;
  max_workspaces?: number;
  labels?: Record<string, string>;
}

export interface RegenerateTokenResponse {
  token: string;
  token_prefix: string;
}

export async function listLocalPods(): Promise<LocalPod[]> {
  const response = await api.get<{ pods: LocalPod[]; total: number }>('/api/local-pods');
  return response.pods;
}

export async function getLocalPod(podId: string): Promise<LocalPodWithWorkspaces> {
  return api.get<LocalPodWithWorkspaces>(`/api/local-pods/${podId}`);
}

export async function createLocalPod(data: CreateLocalPodRequest): Promise<CreateLocalPodResponse> {
  const result = await api.post<CreateLocalPodResponse>('/api/local-pods', data);
  // Invalidate cache after successful creation
  requestCache.invalidatePattern(/^GET:\/api\/local-pods/);
  return result;
}

export async function updateLocalPod(
  podId: string,
  data: UpdateLocalPodRequest
): Promise<LocalPod> {
  const result = await api.patch<LocalPod>(`/api/local-pods/${podId}`, data);
  // Invalidate cache after successful update
  requestCache.invalidatePattern(/^GET:\/api\/local-pods/);
  return result;
}

export async function deleteLocalPod(podId: string): Promise<void> {
  await api.delete(`/api/local-pods/${podId}`);
  // Invalidate cache after successful deletion
  requestCache.invalidatePattern(/^GET:\/api\/local-pods/);
}

export async function regenerateLocalPodToken(podId: string): Promise<RegenerateTokenResponse> {
  return api.post<RegenerateTokenResponse>(`/api/local-pods/${podId}/regenerate-token`, {});
}

export async function getLocalPodWorkspaces(
  podId: string
): Promise<Array<{ id: string; session_id: string; status: string; created_at: string }>> {
  return api.get(`/api/local-pods/${podId}/workspaces`);
}

export async function getOnlineLocalPods(): Promise<LocalPod[]> {
  const pods = await listLocalPods();
  return pods.filter((p) => p.status === 'online');
}

// ==================== Session Sharing ====================

export type SharingMode = 'view_only' | 'can_edit' | 'full_control';

export interface ShareSessionRequest {
  user_id?: string;
  email?: string;
  sharing_mode?: SharingMode;
}

export interface ShareLinkRequest {
  sharing_mode?: SharingMode;
  expires_in_hours?: number | null;
}

export interface SessionShareResponse {
  id: string;
  session_id: string;
  shared_with_id: string | null;
  shared_with_email: string | null;
  sharing_mode: string;
  created_at: string;
}

export interface ShareLinkResponse {
  share_link: string;
  share_code: string;
  sharing_mode: string;
  expires_at: string | null;
}

export interface SessionSharesListResponse {
  shares: SessionShareResponse[];
  share_link: string | null;
  share_link_mode: string | null;
}

export interface JoinSessionResponse {
  session_id: string;
  message: string;
  sharing_mode: string;
}

export async function shareSession(
  sessionId: string,
  data: ShareSessionRequest
): Promise<SessionShareResponse> {
  return api.post<SessionShareResponse>(`/api/sessions/${sessionId}/share`, data);
}

export async function createSessionShareLink(
  sessionId: string,
  data: ShareLinkRequest = {}
): Promise<ShareLinkResponse> {
  return api.post<ShareLinkResponse>(`/api/sessions/${sessionId}/share-link`, data);
}

export async function revokeSessionShareLink(sessionId: string): Promise<{ message: string }> {
  return api.delete<{ message: string }>(`/api/sessions/${sessionId}/share-link`);
}

export async function listSessionShares(sessionId: string): Promise<SessionSharesListResponse> {
  return api.get<SessionSharesListResponse>(`/api/sessions/${sessionId}/shares`);
}

export async function updateSessionShare(
  sessionId: string,
  shareId: string,
  sharingMode: SharingMode
): Promise<SessionShareResponse> {
  return api.put<SessionShareResponse>(`/api/sessions/${sessionId}/shares/${shareId}`, {
    sharing_mode: sharingMode,
  });
}

export async function revokeSessionShare(
  sessionId: string,
  shareId: string
): Promise<{ message: string }> {
  return api.delete<{ message: string }>(`/api/sessions/${sessionId}/shares/${shareId}`);
}

export async function joinSessionViaLink(shareCode: string): Promise<JoinSessionResponse> {
  return api.get<JoinSessionResponse>(`/api/sessions/join/${shareCode}`);
}

// ==================== Checkpoints ====================

export interface CheckpointFile {
  path: string;
  change_type: 'create' | 'modify' | 'delete';
  lines_added: number;
  lines_removed: number;
}

export interface Checkpoint {
  id: string;
  checkpoint_number: number;
  description: string | null;
  action_type: string;
  agent_id: string;
  status: 'active' | 'restored' | 'superseded';
  created_at: string;
  files: CheckpointFile[];
  file_count: number;
  total_lines_added: number;
  total_lines_removed: number;
}

export interface CheckpointDiff {
  id: string;
  description: string | null;
  files: Array<{
    path: string;
    change_type: string;
    content_before: string | null;
    content_after: string | null;
    lines_added: number;
    lines_removed: number;
  }>;
}

export interface RestoreCheckpointResponse {
  success: boolean;
  checkpoint_id: string;
  files: Array<{
    path: string;
    action: string;
    success: boolean;
  }>;
}

export async function getSessionCheckpoints(
  sessionId: string,
  options?: { agentId?: string; limit?: number }
): Promise<Checkpoint[]> {
  const params = new URLSearchParams();
  if (options?.agentId) params.set('agent_id', options.agentId);
  if (options?.limit) params.set('limit', String(options.limit));
  const query = params.toString() ? `?${params.toString()}` : '';
  return api.get<Checkpoint[]>(`/api/checkpoints/sessions/${sessionId}/checkpoints${query}`);
}

export async function getCheckpoint(checkpointId: string): Promise<Checkpoint> {
  return api.get<Checkpoint>(`/api/checkpoints/checkpoints/${checkpointId}`);
}

export async function getCheckpointDiff(checkpointId: string): Promise<CheckpointDiff> {
  return api.get<CheckpointDiff>(`/api/checkpoints/checkpoints/${checkpointId}/diff`);
}

export async function restoreCheckpoint(checkpointId: string): Promise<RestoreCheckpointResponse> {
  return api.post<RestoreCheckpointResponse>(
    `/api/checkpoints/checkpoints/${checkpointId}/restore`,
    {}
  );
}

// ==================== Worktrees ====================

export interface WorktreeResponse {
  id: string;
  agent_id: string;
  session_id: string;
  worktree_path: string;
  branch_name: string;
  status: string;
  created_at: string;
  merged_at: string | null;
}

export interface WorktreeListResponse {
  worktrees: WorktreeResponse[];
  total: number;
  active: number;
  merged: number;
  conflicts: number;
}

export interface MergeWorktreeResponse {
  success: boolean;
  worktree_id: string;
  message: string;
}

export interface DeleteWorktreeResponse {
  success: boolean;
  worktree_id: string;
  message: string;
}

export interface ConflictFile {
  path: string;
  conflict_markers: number;
}

export interface ConflictsResponse {
  has_conflicts: boolean;
  files: ConflictFile[];
}

export async function getSessionWorktrees(sessionId: string): Promise<WorktreeListResponse> {
  return api.get<WorktreeListResponse>(`/api/worktrees/sessions/${sessionId}/worktrees`);
}

export async function getWorktree(worktreeId: string): Promise<WorktreeResponse> {
  return api.get<WorktreeResponse>(`/api/worktrees/worktrees/${worktreeId}`);
}

export async function mergeWorktree(
  worktreeId: string,
  options?: { deleteAfterMerge?: boolean }
): Promise<MergeWorktreeResponse> {
  return api.post<MergeWorktreeResponse>(`/api/worktrees/worktrees/${worktreeId}/merge`, {
    delete_after_merge: options?.deleteAfterMerge ?? true,
  });
}

export async function deleteWorktree(worktreeId: string): Promise<DeleteWorktreeResponse> {
  return api.delete<DeleteWorktreeResponse>(`/api/worktrees/worktrees/${worktreeId}`);
}

export async function checkWorktreeConflicts(worktreeId: string): Promise<ConflictsResponse> {
  return api.get<ConflictsResponse>(`/api/worktrees/worktrees/${worktreeId}/conflicts`);
}

// ==================== Changes ====================

export interface DiffLineResponse {
  type: string;
  content: string;
  old_line_number: number | null;
  new_line_number: number | null;
}

export interface DiffHunkResponse {
  id: string;
  old_start: number;
  old_lines: number;
  new_start: number;
  new_lines: number;
  status: string;
  lines: DiffLineResponse[];
}

export interface FileChangeResponse {
  path: string;
  change_type: string;
  hunks: DiffHunkResponse[];
  additions: number;
  deletions: number;
}

export interface ChangeSetResponse {
  id: string;
  session_id: string;
  agent_id: string;
  agent_name: string;
  description: string;
  files: FileChangeResponse[];
  total_files: number;
  total_additions: number;
  total_deletions: number;
  status: string;
  created_at: string;
}

export interface AggregatedFileChange {
  change_set_id: string;
  agent_id: string;
  agent_name: string;
  change_type: string;
  hunks: DiffHunkResponse[];
  additions: number;
  deletions: number;
}

export interface AggregatedChangesResponse {
  session_id: string;
  files: Record<string, AggregatedFileChange[]>;
  total_files: number;
  total_change_sets: number;
  conflicts: Array<{
    file_path: string;
    agent1: string;
    agent2: string;
    hunk1_id: string;
    hunk2_id: string;
  }>;
}

export async function getSessionChangeSets(
  sessionId: string,
  status?: string
): Promise<ChangeSetResponse[]> {
  const params = status ? `?status=${status}` : '';
  return api.get<ChangeSetResponse[]>(`/api/changes/sessions/${sessionId}/changes${params}`);
}

export async function getAggregatedChanges(sessionId: string): Promise<AggregatedChangesResponse> {
  return api.get<AggregatedChangesResponse>(
    `/api/changes/sessions/${sessionId}/changes/aggregated`
  );
}

export async function createChangeSet(
  sessionId: string,
  data: { agent_id: string; agent_name: string; description: string }
): Promise<ChangeSetResponse> {
  return api.post<ChangeSetResponse>(`/api/changes/sessions/${sessionId}/changes`, data);
}

export async function addFileToChangeSet(
  changeSetId: string,
  data: {
    path: string;
    change_type: string;
    content_before?: string;
    content_after?: string;
  }
): Promise<FileChangeResponse> {
  return api.post<FileChangeResponse>(`/api/changes/changes/${changeSetId}/files`, data);
}

export async function updateHunkStatus(
  changeSetId: string,
  data: { file_path: string; hunk_id: string; status: string }
): Promise<{ status: string }> {
  return api.patch<{ status: string }>(`/api/changes/changes/${changeSetId}/hunks`, data);
}

export async function applyChangeSet(
  changeSetId: string,
  selectedHunks?: Record<string, string[]>
): Promise<{
  success: boolean;
  change_set_id: string;
  files_applied: number;
  details: Array<{ path: string; change_type: string; hunks_applied: number }>;
}> {
  return api.post(`/api/changes/changes/${changeSetId}/apply`, {
    selected_hunks: selectedHunks,
  });
}

export async function rejectChangeSet(
  changeSetId: string
): Promise<{ status: string; change_set_id: string }> {
  return api.post(`/api/changes/changes/${changeSetId}/reject`, {});
}

// ==================== Subagents ====================

export interface SubagentResponse {
  id: string;
  parent_agent_id: string;
  session_id: string;
  name: string;
  type: string;
  task: string;
  status: string;
  background: boolean;
  created_at: string;
  completed_at: string | null;
  result_summary: string | null;
  error: string | null;
  context_tokens: number;
}

export interface SubagentSummaryResponse {
  subagent_id: string;
  summary: string;
  status: string;
}

export async function spawnSubagent(
  agentId: string,
  data: {
    subagent_type: string;
    task: string;
    background?: boolean;
    system_prompt?: string;
  }
): Promise<SubagentResponse> {
  return api.post<SubagentResponse>(`/api/agents/${agentId}/subagents`, data);
}

export async function getAgentSubagents(
  agentId: string,
  status?: string
): Promise<SubagentResponse[]> {
  const params = status ? `?status=${status}` : '';
  return api.get<SubagentResponse[]>(`/api/agents/${agentId}/subagents${params}`);
}

export async function getSubagent(subagentId: string): Promise<SubagentResponse> {
  return api.get<SubagentResponse>(`/api/subagents/${subagentId}`);
}

export async function getSubagentSummary(subagentId: string): Promise<SubagentSummaryResponse> {
  return api.get<SubagentSummaryResponse>(`/api/subagents/${subagentId}/summary`);
}

export async function cancelSubagent(
  subagentId: string
): Promise<{ status: string; subagent_id: string }> {
  return api.post(`/api/subagents/${subagentId}/cancel`, {});
}

// ==================== Hooks ====================

export interface HookCondition {
  trigger: string;
  tool_names: string[];
  file_extensions: string[];
  pattern: string | null;
}

export interface HookResponse {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  hook_type: string;
  command: string;
  condition: HookCondition;
  enabled: boolean;
  timeout_ms: number;
  run_async: boolean;
  created_at: string;
  updated_at: string;
}

export interface HookExecutionResponse {
  hook_id: string;
  success: boolean;
  output: string | null;
  error: string | null;
  duration_ms: number;
}

export interface CreateHookRequest {
  name: string;
  description?: string | null;
  hook_type: string;
  command: string;
  condition?: {
    trigger?: string;
    tool_names?: string[];
    file_extensions?: string[];
    pattern?: string | null;
  };
  timeout_ms?: number;
  run_async?: boolean;
  enabled?: boolean;
}

export async function getHooks(hookType?: string, enabledOnly = true): Promise<HookResponse[]> {
  const params = new URLSearchParams();
  if (hookType) params.append('hook_type', hookType);
  if (!enabledOnly) params.append('enabled_only', 'false');
  const queryString = params.toString();
  return api.get<HookResponse[]>(`/api/hooks${queryString ? `?${queryString}` : ''}`);
}

export async function getHook(hookId: string): Promise<HookResponse> {
  return api.get<HookResponse>(`/api/hooks/${hookId}`);
}

export async function createHook(
  data: CreateHookRequest | Record<string, unknown>
): Promise<HookResponse> {
  return api.post<HookResponse>('/api/hooks', data);
}

export async function updateHook(
  hookId: string,
  data: Partial<CreateHookRequest>
): Promise<HookResponse> {
  return api.patch<HookResponse>(`/api/hooks/${hookId}`, data);
}

export async function deleteHook(hookId: string): Promise<void> {
  await api.delete(`/api/hooks/${hookId}`);
}

export async function enableHook(hookId: string): Promise<HookResponse> {
  return api.post<HookResponse>(`/api/hooks/${hookId}/enable`, {});
}

export async function disableHook(hookId: string): Promise<HookResponse> {
  return api.post<HookResponse>(`/api/hooks/${hookId}/disable`, {});
}

export async function testHook(hookId: string): Promise<HookExecutionResponse> {
  return api.post<HookExecutionResponse>(`/api/hooks/${hookId}/test`, {});
}

export async function getHookHistory(hookId: string, limit = 20): Promise<HookExecutionResponse[]> {
  return api.get<HookExecutionResponse[]>(`/api/hooks/${hookId}/history?limit=${limit}`);
}

export async function getHookTypes(): Promise<{
  hook_types: Array<{ type: string; description: string; context_vars: string[] }>;
  trigger_types: Array<{ type: string; description: string; config?: string }>;
}> {
  return api.get('/api/hooks/types/list');
}

// ==================== Execution Plans ====================

export interface PlanStepResponse {
  id: string;
  description: string;
  action_type: string;
  action_params: Record<string, unknown>;
  status: string;
  result: Record<string, unknown> | null;
  error: string | null;
  can_rollback: boolean;
}

export interface PlanResponse {
  id: string;
  session_id: string;
  agent_id: string | null;
  title: string;
  description: string | null;
  original_task: string | null;
  steps: PlanStepResponse[];
  current_step: number;
  status: string;
  confidence_score: number | null;
  error: string | null;
  created_at: string;
  approved_at: string | null;
  approved_by: string | null;
  started_at: string | null;
  completed_at: string | null;
}

export async function approvePlan(sessionId: string, planId: string): Promise<PlanResponse> {
  return api.post<PlanResponse>(`/api/sessions/${sessionId}/plans/${planId}/approve`, {});
}

export async function rejectPlan(
  sessionId: string,
  planId: string,
  reason: string
): Promise<PlanResponse> {
  return api.post<PlanResponse>(`/api/sessions/${sessionId}/plans/${planId}/reject`, { reason });
}

// ==================== Real-Time Cost Tracking ====================

export interface RealtimeCostResponse {
  session_id: string;
  total_cost: number;
  input_cost: number;
  output_cost: number;
  cached_input_cost: number;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  call_count: number;
  by_model: Record<string, { input_tokens: number; output_tokens: number; cost: number }>;
  by_agent: Record<string, { tokens: number; cost: number }>;
}

export interface BudgetResponse {
  id: string;
  user_id: string;
  session_id: string | null;
  amount: number;
  period: string;
  warning_threshold: number;
  hard_limit: boolean;
  created_at: string;
  expires_at: string | null;
}

export interface BudgetStatusResponse {
  budget: BudgetResponse;
  spent: number;
  remaining: number;
  percentage_used: number;
  period_start: string | null;
}

export interface AlertResponse {
  id: string;
  alert_type: string;
  severity: string;
  message: string;
  current_spent: number;
  budget_amount: number;
  percentage_used: number;
  created_at: string;
  acknowledged: boolean;
}

export interface UsageHistoryEntry {
  call_id: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  cost: number;
  timestamp: string;
  agent_id: string | null;
}

export interface DailyUsageEntry {
  date: string;
  total_cost: number;
  total_tokens: number;
  call_count: number;
}

// Real-time cost endpoints
export async function getSessionRealtimeCost(sessionId: string): Promise<RealtimeCostResponse> {
  return api.get<RealtimeCostResponse>(`/api/billing/realtime/session/${sessionId}`);
}

export async function getAgentRealtimeCost(
  sessionId: string,
  agentId: string
): Promise<RealtimeCostResponse> {
  return api.get<RealtimeCostResponse>(`/api/billing/realtime/agent/${sessionId}/${agentId}`);
}

export async function getSessionUsageHistory(
  sessionId: string,
  limit = 100
): Promise<UsageHistoryEntry[]> {
  return api.get<UsageHistoryEntry[]>(
    `/api/billing/realtime/usage-history/${sessionId}?limit=${limit}`
  );
}

export async function getDailyUsage(days = 30): Promise<DailyUsageEntry[]> {
  return api.get<DailyUsageEntry[]>(`/api/billing/realtime/daily-usage?days=${days}`);
}

// Budget management endpoints
export async function setSessionBudget(
  sessionId: string,
  data: {
    amount: number;
    warning_threshold?: number;
    hard_limit?: boolean;
  }
): Promise<BudgetResponse> {
  return api.post<BudgetResponse>(`/api/billing/budgets/session/${sessionId}`, data);
}

export async function setUserBudget(data: {
  amount: number;
  period?: string;
  warning_threshold?: number;
  hard_limit?: boolean;
}): Promise<BudgetResponse> {
  return api.post<BudgetResponse>('/api/billing/budgets/user', data);
}

export async function getUserBudgets(): Promise<BudgetResponse[]> {
  return api.get<BudgetResponse[]>('/api/billing/budgets');
}

export async function getBudgetStatus(sessionId?: string): Promise<BudgetStatusResponse[]> {
  const query = sessionId ? `?session_id=${sessionId}` : '';
  return api.get<BudgetStatusResponse[]>(`/api/billing/budgets/status${query}`);
}

export async function deleteBudget(budgetId: string): Promise<{ success: boolean }> {
  return api.delete<{ success: boolean }>(`/api/billing/budgets/${budgetId}`);
}

// Alert endpoints
export async function getCostAlerts(
  includeAcknowledged = false,
  limit = 50
): Promise<AlertResponse[]> {
  return api.get<AlertResponse[]>(
    `/api/billing/alerts?include_acknowledged=${includeAcknowledged}&limit=${limit}`
  );
}

export async function acknowledgeCostAlert(alertId: string): Promise<{ success: boolean }> {
  return api.post<{ success: boolean }>(`/api/billing/alerts/${alertId}/acknowledge`, {});
}
