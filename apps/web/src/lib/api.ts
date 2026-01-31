/**
 * API client for Podex backend services.
 *
 * This module uses @podex/api-client for platform-agnostic API functionality
 * with web-specific adapters for HTTP, auth, and error reporting.
 */

import type { User, AuthTokens } from '@/stores/auth';
import { useAuthStore } from '@/stores/auth';
import { useSessionStore } from '@/stores/session';
import type { ThinkingConfig, AttachmentFile, HardwareSpec } from '@podex/shared';
import type { BrowserContextData } from '@/stores/browserContext';

// Re-export from @podex/api-client for backward compatibility
export { ApiRequestError, isAbortError, isQuotaError } from '@podex/api-client';
import { ApiRequestError as ApiError } from '@podex/api-client';
import { calculateExpiry } from '@podex/api-client';
export type { LoginRequest, RegisterRequest } from '@/lib/api-adapters';
import { useBillingStore, type BillingErrorDetail } from '@/stores/billing';

/**
 * Check if an error is a billing/payment required error (402).
 */
export function isBillingError(
  error: unknown
): error is ApiError & { detail?: BillingErrorDetail } {
  if (error instanceof ApiError && error.status === 402) {
    return true;
  }
  return false;
}

/**
 * Handle billing errors by showing the credit exhausted modal.
 * Call this in catch blocks for API calls that might return 402.
 */
export function handleBillingError(error: unknown): boolean {
  if (isBillingError(error)) {
    const store = useBillingStore.getState();
    // Try to extract error detail from the error message (JSON)
    try {
      const detail = JSON.parse(error.message) as BillingErrorDetail;
      store.showCreditExhaustedModal(detail);
    } catch {
      // If parsing fails, create a basic error detail
      store.showCreditExhaustedModal({
        error_code: 'CREDITS_EXHAUSTED',
        message: error.message || 'Your credits have been exhausted.',
        quota_remaining: 0,
        credits_remaining: 0,
      });
    }
    return true;
  }
  return false;
}

/**
 * Check if an error is a workspace unavailable error (503, 500, 404, or network error).
 */
export function isWorkspaceError(error: unknown): boolean {
  if (error instanceof ApiError) {
    // 503 Service Unavailable - workspace container not responding
    // 500 Internal Server Error - often indicates container issues
    // 404 Not Found - container doesn't exist
    return error.status === 503 || error.status === 500 || error.status === 404;
  }
  // Network errors (fetch failed)
  if (error instanceof TypeError && error.message.includes('fetch')) {
    return true;
  }
  return false;
}

/**
 * Handle workspace unavailable errors by setting the workspace error in the session store.
 * Call this in catch blocks for workspace-related API calls.
 * @param error The error from the API call
 * @param sessionId The session ID to associate the error with
 * @returns true if the error was handled as a workspace error
 */
export function handleWorkspaceError(error: unknown, sessionId: string): boolean {
  if (isWorkspaceError(error)) {
    const store = useSessionStore.getState();
    let message = 'The workspace container is not responding. It may need to be restarted.';

    if (error instanceof ApiError) {
      if (error.status === 404) {
        message = 'Workspace container not found. Click "Recreate" to create a new container.';
      } else if (error.status === 503) {
        message = 'Workspace unavailable. The container may have stopped or crashed.';
      } else if (error.status === 500) {
        message = 'Workspace error. The container encountered an internal error.';
      }
    } else if (error instanceof TypeError) {
      message = 'Unable to connect to the workspace. Check your network connection.';
    }

    store.setWorkspaceError(sessionId, message);
    return true;
  }
  return false;
}

/**
 * Clear any workspace error for a session.
 * Call this when a workspace operation succeeds.
 */
export function clearWorkspaceError(sessionId: string): void {
  const store = useSessionStore.getState();
  if (store.sessions[sessionId]?.workspaceError) {
    store.setWorkspaceError(sessionId, null);
  }
}

// Import adapters and client
import {
  FetchHttpAdapter,
  PodexApiClient,
  SentryErrorReporter,
  ZustandAuthProvider,
} from '@/lib/api-adapters';
import { getApiBaseUrlSync } from '@/lib/api-url';

const API_BASE_URL = getApiBaseUrlSync();

// Create and export the API client singleton
export const api = new PodexApiClient({
  baseUrl: API_BASE_URL,
  httpAdapter: new FetchHttpAdapter(),
  authProvider: new ZustandAuthProvider(),
  errorReporter: new SentryErrorReporter(),
});

// Export the request cache for direct access
export const requestCache = api.getCache();

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

export async function register(
  email: string,
  password: string,
  name: string,
  invitationToken?: string
): Promise<User> {
  const store = useAuthStore.getState();
  store.setLoading(true);
  store.clearError();

  try {
    const { user, tokens } = await api.register({
      email,
      password,
      name,
      invitation_token: invitationToken,
    });
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

// ==================== Invitation API ====================

export interface InvitationValidation {
  valid: boolean;
  email?: string;
  gift_plan_name?: string;
  gift_months?: number;
  expires_at?: string;
  message?: string;
  inviter_name?: string;
}

export interface PlatformInvitation {
  id: string;
  email: string;
  status: 'pending' | 'accepted' | 'expired' | 'revoked';
  message: string | null;
  gift_plan_id: string | null;
  gift_plan_name: string | null;
  gift_months: number | null;
  expires_at: string;
  invited_by_id: string | null;
  invited_by_name: string | null;
  invited_by_email: string | null;
  accepted_at: string | null;
  accepted_by_id: string | null;
  created_at: string;
}

export interface CreateInvitationRequest {
  email: string;
  message?: string;
  gift_plan_id?: string;
  gift_months?: number;
  expires_in_days?: number;
}

export interface InvitationsListResponse {
  items: PlatformInvitation[];
  total: number;
  page: number;
  page_size: number;
  has_more: boolean;
}

/**
 * Validate an invitation token (public endpoint).
 */
export async function validateInvitation(token: string): Promise<InvitationValidation> {
  return api.get(`/api/auth/invitation/${token}`, false);
}

/**
 * List platform invitations (admin only).
 */
export async function listPlatformInvitations(
  page = 1,
  pageSize = 50,
  status?: string,
  search?: string
): Promise<InvitationsListResponse> {
  const params = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  });
  if (status) params.append('status', status);
  if (search) params.append('search', search);
  return api.get(`/api/admin/invitations?${params}`);
}

/**
 * Create a platform invitation (admin only).
 */
export async function createPlatformInvitation(
  data: CreateInvitationRequest
): Promise<PlatformInvitation> {
  return api.post('/api/admin/invitations', data);
}

/**
 * Resend a platform invitation (admin only).
 */
export async function resendPlatformInvitation(
  id: string,
  extendDays = 7
): Promise<{ message: string }> {
  return api.post(`/api/admin/invitations/${id}/resend?extend_days=${extendDays}`, {});
}

/**
 * Revoke a platform invitation (admin only).
 */
export async function revokePlatformInvitation(id: string): Promise<{ message: string }> {
  return api.post(`/api/admin/invitations/${id}/revoke`, {});
}

/**
 * Delete a platform invitation (admin only).
 */
export async function deletePlatformInvitation(id: string): Promise<{ message: string }> {
  return api.delete(`/api/admin/invitations/${id}`);
}

export async function refreshAuth(): Promise<boolean> {
  const store = useAuthStore.getState();
  const tokens = store.tokens;

  try {
    const newTokens = await api.refreshToken(tokens?.refreshToken);
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

  // Skip auth initialization during OAuth callback - the callback will handle auth
  if (typeof window !== 'undefined') {
    const isOAuthCallback = window.location.pathname.includes('/auth/callback/');
    if (isOAuthCallback) {
      // Don't initialize auth during callback - the callback page handles it
      // Just mark as initialized to prevent re-runs
      store.setInitialized(true);
      return;
    }
  }

  const tokens = store.tokens;

  // If no tokens exist, user is not authenticated - skip API calls
  // This prevents unnecessary 401 errors for unauthenticated users
  if (!tokens?.accessToken) {
    store.setInitialized(true);
    return;
  }

  // Check if token is expiring soon and refresh if needed
  if (tokens.expiresAt) {
    const isExpiringSoon = tokens.expiresAt - Date.now() < 5 * 60 * 1000;
    if (isExpiringSoon) {
      await refreshAuth();
    }
  }

  // Fetch current user to validate token-based session
  try {
    const user = await api.getCurrentUser();
    store.setUser(user);
  } catch (error) {
    const status = (error as Error & { status?: number }).status;
    if (status === 401) {
      store.logout();
    }
  }

  store.setInitialized(true);
}

export async function logout(): Promise<void> {
  // Clear server-side httpOnly cookies
  try {
    await api.post('/api/auth/logout', {}, { includeAuth: false });
  } catch {
    // Ignore errors - cookies might already be cleared or invalid
  }
  // Clear local auth state
  useAuthStore.getState().logout();
}

// OAuth types
interface OAuthURLResponse {
  url: string;
  state: string;
}

interface OAuthTokenResponse {
  access_token: string | null;
  refresh_token: string | null;
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
    // Note: Server validates state in Redis (one-time use, secure)
    // No need for client-side CSRF check which can fail due to sessionStorage issues
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

// GitHub integration methods
export interface GitHubConnectionStatus {
  connected: boolean;
  username: string | null;
  avatar_url: string | null;
  scopes: string[] | null;
  connected_at: string | null;
  last_used_at: string | null;
}

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
  default_branch: string;
}

export async function getGitHubStatus(): Promise<GitHubConnectionStatus> {
  return api.get<GitHubConnectionStatus>('/api/v1/github/status');
}

export async function getGitHubRepos(params?: {
  per_page?: number;
  page?: number;
}): Promise<GitHubRepo[]> {
  const query = params
    ? `?${new URLSearchParams(params as Record<string, string>).toString()}`
    : '';
  return api.get<GitHubRepo[]>(`/api/v1/github/repos${query}`);
}

export interface GitHubBranch {
  name: string;
  commit_sha: string;
  protected: boolean;
}

export async function getGitHubBranches(owner: string, repo: string): Promise<GitHubBranch[]> {
  return api.get<GitHubBranch[]>(`/api/v1/github/repos/${owner}/${repo}/branches`);
}

export interface GitHubUser {
  id: number;
  login: string;
  avatar_url: string | null;
  html_url: string | null;
}

export interface GitHubLabel {
  id: number;
  name: string;
  color: string;
  description: string | null;
}

export interface GitHubPullRequest {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: string;
  draft: boolean;
  merged: boolean;
  mergeable: boolean | null;
  mergeable_state: string | null;
  html_url: string;
  diff_url: string;
  user: GitHubUser;
  head_ref: string;
  head_sha: string;
  base_ref: string;
  base_sha: string;
  labels: GitHubLabel[];
  requested_reviewers: GitHubUser[];
  additions: number;
  deletions: number;
  changed_files: number;
  created_at: string;
  updated_at: string;
  merged_at: string | null;
  closed_at: string | null;
}

export async function getGitHubPullRequests(
  owner: string,
  repo: string,
  params?: {
    state?: string;
    per_page?: number;
    page?: number;
  }
): Promise<GitHubPullRequest[]> {
  const query = params
    ? `?${new URLSearchParams(params as Record<string, string>).toString()}`
    : '';
  return api.get<GitHubPullRequest[]>(`/api/v1/github/repos/${owner}/${repo}/pulls${query}`);
}

export interface GitHubWorkflowRun {
  id: number;
  name: string;
  workflow_id: number;
  status: string;
  conclusion: string | null;
  html_url: string;
  run_number: number;
  event: string;
  head_branch: string | null;
  head_sha: string;
  created_at: string;
  updated_at: string;
  run_started_at: string | null;
}

export interface GitHubWorkflowJob {
  id: number;
  run_id: number;
  name: string;
  status: string;
  conclusion: string | null;
  started_at: string | null;
  completed_at: string | null;
  steps: Array<{
    name: string;
    status: string;
    conclusion: string | null;
    number: number;
    started_at: string | null;
    completed_at: string | null;
  }>;
}

export async function getGitHubWorkflowRuns(
  owner: string,
  repo: string,
  params?: {
    workflow_id?: string;
    branch?: string;
    status?: string;
    per_page?: number;
    page?: number;
  }
): Promise<GitHubWorkflowRun[]> {
  const query = params
    ? `?${new URLSearchParams(params as Record<string, string>).toString()}`
    : '';
  return api.get<GitHubWorkflowRun[]>(`/api/v1/github/repos/${owner}/${repo}/actions/runs${query}`);
}

export async function getGitHubWorkflowJobs(
  owner: string,
  repo: string,
  runId: number
): Promise<GitHubWorkflowJob[]> {
  return api.get<GitHubWorkflowJob[]>(
    `/api/v1/github/repos/${owner}/${repo}/actions/runs/${runId}/jobs`
  );
}

export async function disconnectGitHub(): Promise<{ success: boolean }> {
  return api.delete<{ success: boolean }>('/api/v1/github/disconnect');
}

// GitHub account linking methods (for logged-in users to link GitHub to their account)
export interface GitHubLinkResponse {
  success: boolean;
  github_username: string;
  message: string;
}

export async function getGitHubLinkURL(): Promise<string> {
  const response = await api.get<OAuthURLResponse>('/api/oauth/github/link-authorize');
  // Store state in sessionStorage to detect link flow in callback
  if (typeof window !== 'undefined') {
    sessionStorage.setItem('github_link_state', response.state);
  }
  return response.url;
}

export async function handleGitHubLinkCallback(
  code: string,
  state: string
): Promise<GitHubLinkResponse> {
  // Clear the stored state (server validates state in Redis)
  if (typeof window !== 'undefined') {
    sessionStorage.removeItem('github_link_state');
  }

  return api.post<GitHubLinkResponse>('/api/oauth/github/link-callback', { code, state });
}

// Unified GitHub callback that auto-detects link vs login flow
// This is more reliable than sessionStorage-based flow detection
export interface GitHubUnifiedCallbackResponse {
  flow_type: 'link' | 'login';
  // Link flow fields
  github_username?: string;
  link_message?: string;
  // Login flow fields
  access_token?: string | null;
  refresh_token?: string | null;
  token_type?: string;
  expires_in?: number;
  user?: {
    id: string;
    email: string;
    name: string | null;
    avatar_url: string | null;
    role: string;
  };
}

export async function handleGitHubCallbackAuto(
  code: string,
  state: string
): Promise<GitHubUnifiedCallbackResponse> {
  // Clean up any sessionStorage state (no longer needed but clean up for hygiene)
  if (typeof window !== 'undefined') {
    sessionStorage.removeItem('github_link_state');
  }

  const response = await api.post<GitHubUnifiedCallbackResponse>(
    '/api/oauth/github/callback-auto',
    { code, state }
  );

  // If this was a login flow, update the auth store
  if (response.flow_type === 'login' && response.user) {
    const store = useAuthStore.getState();
    const user: User = {
      id: response.user.id,
      email: response.user.email,
      name: response.user.name,
      avatarUrl: response.user.avatar_url,
      role: response.user.role,
    };

    const tokens: AuthTokens = {
      accessToken: response.access_token ?? null,
      refreshToken: response.refresh_token ?? null,
      // Default to 1 hour if expires_in not provided (shouldn't happen for login flow)
      expiresAt: calculateExpiry(response.expires_in ?? 3600),
    };

    store.setUser(user);
    store.setTokens(tokens);
  }

  return response;
}

// Google account linking methods (for logged-in users to link Google to their account)
export interface GoogleLinkResponse {
  success: boolean;
  google_email: string;
  message: string;
}

export async function getGoogleLinkURL(): Promise<string> {
  const response = await api.get<OAuthURLResponse>('/api/oauth/google/link-authorize');
  // Store state in sessionStorage (backup, but server-side detection is primary)
  if (typeof window !== 'undefined') {
    sessionStorage.setItem('google_link_state', response.state);
  }
  return response.url;
}

// Unified Google callback that auto-detects link vs login flow
export interface GoogleUnifiedCallbackResponse {
  flow_type: 'link' | 'login';
  // Link flow fields
  google_email?: string;
  link_message?: string;
  // Login flow fields
  access_token?: string | null;
  refresh_token?: string | null;
  token_type?: string;
  expires_in?: number;
  user?: {
    id: string;
    email: string;
    name: string | null;
    avatar_url: string | null;
    role: string;
  };
}

export async function handleGoogleCallbackAuto(
  code: string,
  state: string
): Promise<GoogleUnifiedCallbackResponse> {
  // Clean up any sessionStorage state (no longer needed but clean up for hygiene)
  if (typeof window !== 'undefined') {
    sessionStorage.removeItem('google_link_state');
  }

  const response = await api.post<GoogleUnifiedCallbackResponse>(
    '/api/oauth/google/callback-auto',
    { code, state }
  );

  // If this was a login flow, update the auth store
  if (response.flow_type === 'login' && response.user) {
    const store = useAuthStore.getState();
    const user: User = {
      id: response.user.id,
      email: response.user.email,
      name: response.user.name,
      avatarUrl: response.user.avatar_url,
      role: response.user.role,
    };

    const tokens: AuthTokens = {
      accessToken: response.access_token ?? null,
      refreshToken: response.refresh_token ?? null,
      // Default to 1 hour if expires_in not provided
      expiresAt: calculateExpiry(response.expires_in ?? 3600),
    };

    store.setUser(user);
    store.setTokens(tokens);
  }

  return response;
}

// Google connection status and management
export interface GoogleConnectionStatus {
  connected: boolean;
  email: string | null;
  name: string | null;
  avatar_url: string | null;
}

export async function getGoogleStatus(): Promise<GoogleConnectionStatus> {
  return api.get<GoogleConnectionStatus>('/api/google/status');
}

export async function disconnectGoogle(): Promise<void> {
  await api.delete('/api/google/disconnect');
}

// Marketplace methods

// Skills methods
export interface SkillStatsResponse {
  total_skills: number;
  total_executions: number;
  agent_generated: number;
  user_created: number;
  public_skills: number;
  by_tag: Record<string, number>;
  most_used: Array<Record<string, unknown>>;
}

export async function getSkillsStats(): Promise<SkillStatsResponse> {
  return api.get<SkillStatsResponse>('/api/v1/skills/stats');
}

export async function importSkills(data: unknown): Promise<unknown> {
  return api.post<unknown>('/api/v1/skills/import', data);
}

// Memories methods
export interface MemoryStatsResponse {
  total_memories: number;
  by_type: Record<string, number>;
  by_session: number;
  by_project: number;
  average_importance: number;
  oldest_memory: string | null;
  newest_memory: string | null;
}

export async function getMemoriesStats(): Promise<MemoryStatsResponse> {
  return api.get<MemoryStatsResponse>('/api/v1/memories/stats');
}

export interface CreateMemoryRequest {
  content: string;
  memory_type?: string;
  tags?: string[];
  importance?: number;
}

export async function createMemory(data: CreateMemoryRequest): Promise<Memory> {
  return api.post<Memory>('/api/v1/memories', data);
}

// Cost Insights methods
export interface CostSummary {
  current_month_cost: number;
  last_month_cost: number;
  month_over_month_change: number;
  projected_monthly_cost: number;
  total_tokens_used: number;
  total_compute_minutes: number;
  potential_savings: number;
}

export interface CostSuggestion {
  id: string;
  type: string;
  title: string;
  description: string;
  estimated_savings: number;
  savings_percent: number;
  priority: string;
  actionable: boolean;
  action_label: string | null;
  affected_usage: string | null;
}

export interface ModelComparison {
  current_model: string;
  current_cost: number;
  alternatives: Array<{
    model: string;
    cost: number;
    savings: number;
    quality_impact: string;
  }>;
}

export async function getCostInsightsSummary(): Promise<CostSummary> {
  return api.get<CostSummary>('/api/v1/cost-insights/summary');
}

export async function getCostInsightsSuggestions(): Promise<CostSuggestion[]> {
  return api.get<CostSuggestion[]>('/api/v1/cost-insights/suggestions');
}

export async function getCostInsightsModelComparison(): Promise<ModelComparison> {
  return api.get<ModelComparison>('/api/v1/cost-insights/model-comparison');
}

export async function getCostInsightsForecast(): Promise<unknown> {
  return api.get<unknown>('/api/v1/cost-insights/forecast');
}

// LLM Providers methods
export interface LLMProviderResponse {
  id: string;
  user_id: string;
  name: string;
  provider_type: string;
  base_url: string;
  auth_header: string;
  auth_scheme: string;
  default_model: string;
  available_models: string[];
  context_window: number;
  max_output_tokens: number;
  supports_streaming: boolean;
  supports_tools: boolean;
  supports_vision: boolean;
  request_timeout_seconds: number;
  extra_headers: Record<string, string> | null;
  extra_body_params: unknown | null;
}

export async function getLLMProviders(): Promise<LLMProviderResponse[]> {
  return api.get<LLMProviderResponse[]>('/api/llm-providers');
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
  model?: string; // Optional - uses role default from platform settings if not provided
  config?: Record<string, unknown>;
  template_id?: string; // Reference to custom agent template
}

export interface AgentResponse {
  id: string;
  session_id: string;
  name: string;
  role: string;
  model: string;
  model_display_name?: string | null; // User-friendly model name from backend
  status: string;
  mode?: 'plan' | 'ask' | 'auto' | 'sovereign';
  config?: Record<string, unknown>;
  template_id?: string | null;
  conversation_session_id?: string | null; // Reference to attached conversation session
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

// Conversation session API types
export interface ConversationSummary {
  id: string;
  name: string;
  attached_agent_ids: string[];
  message_count: number;
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConversationMessage {
  id: string;
  role: string;
  content: string;
  thinking?: string | null;
  tool_calls?: Record<string, unknown> | null;
  tool_results?: Record<string, unknown> | null;
  model?: string | null;
  stop_reason?: string | null;
  usage?: Record<string, unknown> | null;
  audio_url?: string | null;
  audio_duration_ms?: number | null;
  input_type?: string;
  transcription_confidence?: number | null;
  tts_summary?: string | null;
  created_at: string;
}

export interface ConversationWithMessages extends ConversationSummary {
  messages: ConversationMessage[];
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

export async function listConversations(sessionId: string): Promise<ConversationSummary[]> {
  return api.get<ConversationSummary[]>(`/api/sessions/${sessionId}/conversations`);
}

export interface CreateConversationRequest {
  name?: string;
  first_message?: string;
}

export async function createConversation(
  sessionId: string,
  data?: CreateConversationRequest
): Promise<ConversationSummary> {
  return api.post<ConversationSummary>(
    `/api/sessions/${sessionId}/conversations`,
    data ?? { name: 'New Session' }
  );
}

export async function getConversation(
  sessionId: string,
  conversationId: string
): Promise<ConversationWithMessages> {
  return api.get<ConversationWithMessages>(
    `/api/sessions/${sessionId}/conversations/${conversationId}`
  );
}

export async function attachConversation(
  sessionId: string,
  conversationId: string,
  agentId: string
): Promise<ConversationSummary> {
  return api.post(`/api/sessions/${sessionId}/conversations/${conversationId}/attach`, {
    agent_id: agentId,
  }) as Promise<ConversationSummary>;
}

export async function detachConversation(
  sessionId: string,
  conversationId: string,
  agentId?: string
): Promise<ConversationSummary> {
  return api.post(
    `/api/sessions/${sessionId}/conversations/${conversationId}/detach`,
    agentId ? { agent_id: agentId } : {}
  ) as Promise<ConversationSummary>;
}

// ==================== Agent Role Configuration ====================

/**
 * Agent role configuration from database.
 */
export interface AgentRoleConfig {
  id: string;
  role: string;
  name: string;
  color: string;
  icon: string | null;
  description: string | null;
  system_prompt: string;
  tools: string[];
  category: string; // development, terminal, system, custom
  gradient_start: string | null;
  gradient_end: string | null;
  features: string[] | null;
  example_prompts: string[] | null;
  requires_subscription: string | null;
  sort_order: number;
  is_enabled: boolean;
  is_system: boolean;
  created_at: string;
  updated_at: string;
}

export interface AgentRoleConfigListResponse {
  roles: AgentRoleConfig[];
  total: number;
}

/**
 * Get all enabled agent role configurations from the database.
 * This is the single source of truth for agent role defaults.
 */
export async function getAgentRoleConfigs(): Promise<AgentRoleConfigListResponse> {
  return api.get<AgentRoleConfigListResponse>('/api/agent-roles');
}

/**
 * Get a specific agent role configuration by role name.
 */
export async function getAgentRoleConfig(role: string): Promise<AgentRoleConfig> {
  return api.get<AgentRoleConfig>(`/api/agent-roles/${role}`);
}

export async function getAgent(sessionId: string, agentId: string): Promise<AgentResponse> {
  return api.get<AgentResponse>(`/api/sessions/${sessionId}/agents/${agentId}`);
}

export async function deleteAgent(sessionId: string, agentId: string): Promise<void> {
  await api.delete(`/api/sessions/${sessionId}/agents/${agentId}`);
}

/**
 * Update agent settings (name, model).
 */
export async function updateAgentSettings(
  sessionId: string,
  agentId: string,
  updates: { name?: string; model?: string }
): Promise<AgentResponse> {
  return api.patch<AgentResponse>(`/api/sessions/${sessionId}/agents/${agentId}`, updates);
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

export interface SendMessageOptions {
  attachments?: AttachmentFile[];
  thinkingConfig?: ThinkingConfig;
  browserContext?: BrowserContextData;
}

export async function sendAgentMessage(
  sessionId: string,
  agentId: string,
  content: string,
  options?: SendMessageOptions
): Promise<MessageResponse> {
  const { attachments, thinkingConfig, browserContext } = options ?? {};

  // Use multipart form data when attachments are present
  if (attachments && attachments.length > 0) {
    const formData = new FormData();
    formData.append('content', content);

    // Add thinking config if enabled
    if (thinkingConfig) {
      formData.append('thinking_enabled', String(thinkingConfig.enabled));
      formData.append('thinking_budget', String(thinkingConfig.budgetTokens));
    }

    // Add browser context if provided
    if (browserContext) {
      formData.append('browser_context', JSON.stringify(browserContext));
    }

    // Add all attachments
    for (const att of attachments) {
      // AttachmentFile should have the actual File object when sending
      // If it has a preview (data URL), we need to convert it back to a blob
      if (att.preview && att.type.startsWith('image/')) {
        const response = await fetch(att.preview);
        const blob = await response.blob();
        formData.append('attachments', blob, att.name);
      }
    }

    // Use direct fetch for multipart form data
    const headers: Record<string, string> = {};
    const tokens = useAuthStore.getState().tokens;
    if (tokens?.accessToken) {
      headers['Authorization'] = `Bearer ${tokens.accessToken}`;
    }

    const response = await fetch(
      `${API_BASE_URL}/api/sessions/${sessionId}/agents/${agentId}/messages`,
      {
        method: 'POST',
        headers,
        body: formData,
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      // Handle 402 billing errors specially
      if (response.status === 402) {
        const store = useBillingStore.getState();
        store.showCreditExhaustedModal(
          errorData.detail || {
            error_code: 'CREDITS_EXHAUSTED',
            message:
              errorData.detail?.message || 'Token quota exceeded. Please upgrade or add credits.',
            quota_remaining: errorData.detail?.quota_remaining || 0,
            credits_remaining: errorData.detail?.credits_remaining || 0,
            resource_type: 'tokens',
          }
        );
      }
      throw new Error(errorData.detail?.message || errorData.detail || 'Failed to send message');
    }

    return response.json();
  }

  // Standard JSON request (no attachments)
  try {
    return await api.post<MessageResponse>(
      `/api/sessions/${sessionId}/agents/${agentId}/messages`,
      {
        content,
        thinking_config: thinkingConfig,
        browser_context: browserContext,
      }
    );
  } catch (error) {
    // Handle billing errors
    if (handleBillingError(error)) {
      throw error; // Re-throw after showing modal
    }
    throw error;
  }
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

export interface PlanModeToggleResponse {
  mode: AgentMode;
  previous_mode: AgentMode | null;
  toggled_to_plan: boolean;
}

export async function togglePlanMode(
  sessionId: string,
  agentId: string
): Promise<PlanModeToggleResponse> {
  return api.post<PlanModeToggleResponse>(
    `/api/sessions/${sessionId}/agents/${agentId}/toggle-plan-mode`,
    {}
  );
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

// ==================== Pending Changes (Agent Diff Review) ====================

export interface PendingChangeResponse {
  id: string;
  session_id: string;
  agent_id: string;
  agent_name: string;
  file_path: string;
  original_content: string | null;
  proposed_content: string;
  description: string | null;
  status: 'pending' | 'accepted' | 'rejected';
  created_at: string;
}

export async function getPendingChanges(
  sessionId: string,
  status?: 'pending' | 'accepted' | 'rejected'
): Promise<PendingChangeResponse[]> {
  const params = status ? `?status=${status}` : '';
  return api.get<PendingChangeResponse[]>(`/api/sessions/${sessionId}/pending-changes${params}`);
}

export async function getPendingChange(
  sessionId: string,
  changeId: string
): Promise<PendingChangeResponse> {
  return api.get<PendingChangeResponse>(`/api/sessions/${sessionId}/pending-changes/${changeId}`);
}

export async function acceptPendingChange(
  sessionId: string,
  changeId: string
): Promise<{ status: string; change_id: string; file_path: string }> {
  return api.post<{ status: string; change_id: string; file_path: string }>(
    `/api/sessions/${sessionId}/pending-changes/${changeId}/accept`,
    {}
  );
}

export async function rejectPendingChange(
  sessionId: string,
  changeId: string,
  feedback?: string
): Promise<{ status: string; change_id: string; file_path: string }> {
  return api.post<{ status: string; change_id: string; file_path: string }>(
    `/api/sessions/${sessionId}/pending-changes/${changeId}/reject`,
    { feedback }
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
  options?: {
    customInstructions?: string;
    preserveRecentMessages?: number;
  }
): Promise<CompactResponse> {
  return api.post<CompactResponse>(`/api/context/agents/${agentId}/compact`, {
    custom_instructions: options?.customInstructions,
    preserve_recent_messages: options?.preserveRecentMessages,
  });
}

export interface CompactionSettingsResponse {
  auto_compact_enabled: boolean;
  auto_compact_threshold_percent: number;
  custom_compaction_instructions: string | null;
  preserve_recent_messages: number;
}

export interface CompactionSettingsUpdate {
  auto_compact_enabled?: boolean;
  auto_compact_threshold_percent?: number;
  custom_compaction_instructions?: string | null;
  preserve_recent_messages?: number;
}

export async function getCompactionSettings(
  sessionId: string
): Promise<CompactionSettingsResponse> {
  return api.get<CompactionSettingsResponse>(`/api/context/sessions/${sessionId}/context/settings`);
}

export async function updateCompactionSettings(
  sessionId: string,
  settings: CompactionSettingsUpdate
): Promise<CompactionSettingsResponse> {
  return api.put<CompactionSettingsResponse>(
    `/api/context/sessions/${sessionId}/context/settings`,
    settings
  );
}

// ==================== Checkpoints (Undo/Redo) ====================

export interface FileChange {
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
  files: FileChange[];
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

export interface RestoreResponse {
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
  agentId?: string,
  limit: number = 50
): Promise<Checkpoint[]> {
  const params = new URLSearchParams();
  if (agentId) params.append('agent_id', agentId);
  params.append('limit', limit.toString());
  return api.get<Checkpoint[]>(`/api/checkpoints/sessions/${sessionId}/checkpoints?${params}`);
}

export async function getCheckpoint(checkpointId: string): Promise<Checkpoint> {
  return api.get<Checkpoint>(`/api/checkpoints/checkpoints/${checkpointId}`);
}

export async function getCheckpointDiff(checkpointId: string): Promise<CheckpointDiff> {
  return api.get<CheckpointDiff>(`/api/checkpoints/checkpoints/${checkpointId}/diff`);
}

export async function restoreCheckpoint(checkpointId: string): Promise<RestoreResponse> {
  return api.post<RestoreResponse>(`/api/checkpoints/checkpoints/${checkpointId}/restore`, {});
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
  default_shell: string;
  default_editor: string;
  git_name: string | null;
  git_email: string | null;
  default_template_id: string | null;
  theme: string;
  editor_theme: string;
}

export interface UpdateUserConfigRequest {
  default_shell?: string;
  default_editor?: string;
  git_name?: string | null;
  git_email?: string | null;
  default_template_id?: string | null;
  theme?: string;
  editor_theme?: string;
}

export async function getUserConfig(): Promise<UserConfig> {
  return api.get<UserConfig>('/api/user/config');
}

export async function updateUserConfig(data: UpdateUserConfigRequest): Promise<UserConfig> {
  return api.patch<UserConfig>('/api/user/config', data);
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

/**
 * Session: one "pod" / dev environment the user has.
 *
 * Status fields (they are not the same):
 * - status: Session lifecycle (active, creating, stopped, error). "Is this session in use?"
 * - workspace_status: Compute/container lifecycle (running, stopped, pending, error, etc.).
 *   "Is the actual container running?" Can be stale in DB until someone calls GET workspace status
 *   (which syncs from compute) or compute pushes a sync.
 */
export interface Session {
  id: string;
  name: string;
  owner_id: string;
  workspace_id: string | null;
  branch: string;
  status: 'active' | 'stopped' | 'creating' | 'error';
  workspace_status: 'running' | 'standby' | 'stopped' | 'pending' | 'error' | 'offline' | null;
  template_id: string | null;
  git_url: string | null;
  created_at: string;
  updated_at: string;
  pinned?: boolean;
  active_agents?: number;
  total_tokens?: number;
  // Local pod info (null = cloud workspace)
  local_pod_id?: string | null;
  local_pod_name?: string | null;
  mount_path?: string | null;
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
  // Mount path for local pod workspace (optional)
  mount_path?: string;
  // Region preference for workspace placement
  region_preference?: string;
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

export interface UpdateSessionRequest {
  name?: string;
}

export async function updateSession(
  sessionId: string,
  data: UpdateSessionRequest
): Promise<Session> {
  return api.patch<Session>(`/api/sessions/${sessionId}`, data);
}

// ==================== Workspace Status ====================

export interface WorkspaceStatusResponse {
  id: string;
  status: 'pending' | 'running' | 'stopped' | 'error';
  last_activity: string | null;
}

export async function startWorkspace(workspaceId: string): Promise<WorkspaceStatusResponse> {
  return api.post<WorkspaceStatusResponse>(`/api/workspaces/${workspaceId}/start`, {});
}

export async function stopWorkspace(workspaceId: string): Promise<WorkspaceStatusResponse> {
  return api.post<WorkspaceStatusResponse>(`/api/workspaces/${workspaceId}/stop`, {});
}

export async function getWorkspaceStatus(workspaceId: string): Promise<WorkspaceStatusResponse> {
  return api.get<WorkspaceStatusResponse>(`/api/workspaces/${workspaceId}/status`);
}

// ==================== Tunnels (Cloudflare external exposure) ====================

export interface TunnelItem {
  id: string;
  workspace_id: string;
  port: number;
  public_url: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface TunnelListResponse {
  tunnels: TunnelItem[];
  total: number;
}

export interface TunnelStatusResponse {
  status: string;
  connected: boolean;
  error: string | null;
}

export async function listTunnels(workspaceId: string): Promise<TunnelListResponse> {
  return api.get<TunnelListResponse>(`/api/workspaces/${workspaceId}/tunnels`);
}

export async function exposePort(workspaceId: string, port: number): Promise<TunnelItem> {
  return api.post<TunnelItem>(`/api/workspaces/${workspaceId}/tunnels`, { port });
}

export async function unexposePort(workspaceId: string, port: number): Promise<void> {
  return api.delete(`/api/workspaces/${workspaceId}/tunnels/${port}`);
}

export async function getTunnelStatus(workspaceId: string): Promise<TunnelStatusResponse> {
  return api.get<TunnelStatusResponse>(`/api/workspaces/${workspaceId}/tunnel-status`);
}

// ==================== SSH Tunnel (VS Code Remote-SSH) ====================

export interface SSHTunnelResponse {
  enabled: boolean;
  hostname: string | null;
  public_url: string | null;
  status: string | null;
  connection_string: string | null;
  proxy_command: string | null;
  ssh_config_snippet: string | null;
}

export async function getSSHTunnel(workspaceId: string): Promise<SSHTunnelResponse> {
  return api.get<SSHTunnelResponse>(`/api/workspaces/${workspaceId}/ssh-tunnel`);
}

export async function enableSSHTunnel(workspaceId: string): Promise<SSHTunnelResponse> {
  return api.post<SSHTunnelResponse>(`/api/workspaces/${workspaceId}/ssh-tunnel`, {});
}

export async function disableSSHTunnel(workspaceId: string): Promise<void> {
  return api.delete(`/api/workspaces/${workspaceId}/ssh-tunnel`);
}

export interface WorkspaceExecRequest {
  command: string;
  working_dir?: string | null;
  timeout?: number;
}

export interface WorkspaceExecResponse {
  exit_code: number;
  stdout: string;
  stderr: string;
}

export async function runWorkspaceCommand(
  workspaceId: string,
  body: WorkspaceExecRequest
): Promise<WorkspaceExecResponse> {
  return api.post<WorkspaceExecResponse>(`/api/workspaces/${workspaceId}/exec`, body);
}

export interface WorkspaceScaleResponse {
  success: boolean;
  message: string;
  new_tier?: string;
  estimated_cost_per_hour?: number;
  requires_restart: boolean;
}

export async function scaleWorkspace(
  sessionId: string,
  newTier: string
): Promise<WorkspaceScaleResponse> {
  return api.post<WorkspaceScaleResponse>(`/api/sessions/${sessionId}/scale-workspace`, {
    new_tier: newTier,
  });
}

// ==================== Workspace Resource Metrics ====================

export interface WorkspaceResourceMetrics {
  cpu_percent: number;
  cpu_limit_cores: number;
  memory_used_mb: number;
  memory_limit_mb: number;
  memory_percent: number;
  disk_read_mb: number;
  disk_write_mb: number;
  network_rx_mb: number;
  network_tx_mb: number;
  collected_at: string | null;
  container_uptime_seconds: number;
}

export async function getWorkspaceResources(
  workspaceId: string
): Promise<WorkspaceResourceMetrics> {
  return api.get<WorkspaceResourceMetrics>(`/compute/workspaces/${workspaceId}/resources`);
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
  working_dir?: string | null; // The actual working directory used for git commands
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

export async function getGitStatus(sessionId: string, workingDir?: string): Promise<GitStatus> {
  const params = workingDir ? `?working_dir=${encodeURIComponent(workingDir)}` : '';
  return api.get<GitStatus>(`/api/sessions/${sessionId}/git/status${params}`);
}

export async function getGitBranches(sessionId: string, workingDir?: string): Promise<GitBranch[]> {
  const params = workingDir ? `?working_dir=${encodeURIComponent(workingDir)}` : '';
  return api.get<GitBranch[]>(`/api/sessions/${sessionId}/git/branches${params}`);
}

export async function getGitLog(
  sessionId: string,
  limit = 20,
  workingDir?: string
): Promise<GitCommit[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (workingDir) params.set('working_dir', workingDir);
  return api.get<GitCommit[]>(`/api/sessions/${sessionId}/git/log?${params}`);
}

export async function getGitDiff(
  sessionId: string,
  staged = false,
  workingDir?: string
): Promise<GitDiffFile[]> {
  const params = new URLSearchParams({ staged: String(staged) });
  if (workingDir) params.set('working_dir', workingDir);
  return api.get<GitDiffFile[]>(`/api/sessions/${sessionId}/git/diff?${params}`);
}

export async function stageFiles(
  sessionId: string,
  files: string[],
  workingDir?: string
): Promise<void> {
  await api.post(`/api/sessions/${sessionId}/git/stage`, { files, working_dir: workingDir });
}

export async function unstageFiles(
  sessionId: string,
  files: string[],
  workingDir?: string
): Promise<void> {
  await api.post(`/api/sessions/${sessionId}/git/unstage`, { files, working_dir: workingDir });
}

export async function commitChanges(
  sessionId: string,
  message: string,
  files?: string[],
  workingDir?: string
): Promise<{ message: string; hash: string }> {
  return api.post(`/api/sessions/${sessionId}/git/commit`, {
    message,
    files,
    working_dir: workingDir,
  });
}

export async function pushChanges(
  sessionId: string,
  remote = 'origin',
  branch?: string,
  workingDir?: string
): Promise<{ message: string }> {
  return api.post(`/api/sessions/${sessionId}/git/push`, {
    remote,
    branch,
    working_dir: workingDir,
  });
}

export async function pullChanges(
  sessionId: string,
  remote = 'origin',
  branch?: string,
  workingDir?: string
): Promise<{ message: string }> {
  return api.post(`/api/sessions/${sessionId}/git/pull`, {
    remote,
    branch,
    working_dir: workingDir,
  });
}

export async function checkoutBranch(
  sessionId: string,
  branch: string,
  create = false,
  workingDir?: string
): Promise<{ message: string }> {
  return api.post(`/api/sessions/${sessionId}/git/checkout`, {
    branch,
    create,
    working_dir: workingDir,
  });
}

// Branch Comparison
export interface BranchCompareCommit {
  sha: string;
  message: string;
  author: string;
  date: string;
}

export interface BranchCompareFile {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
}

export interface BranchCompareResponse {
  base: string;
  compare: string;
  commits: BranchCompareCommit[];
  files: BranchCompareFile[];
  ahead: number;
  stat: string;
}

export interface MergePreviewResponse {
  can_merge: boolean;
  has_conflicts: boolean;
  conflicts: string[];
  files_changed: { path: string; status: string }[];
  error?: string;
}

export async function compareBranches(
  sessionId: string,
  base: string,
  compare: string,
  workingDir?: string,
  includeUncommitted?: boolean
): Promise<BranchCompareResponse> {
  const params = new URLSearchParams();
  params.append('base', base);
  params.append('compare', compare);
  if (workingDir) {
    params.append('working_dir', workingDir);
  }
  if (includeUncommitted) {
    params.append('include_uncommitted', 'true');
  }
  return api.get<BranchCompareResponse>(
    `/api/sessions/${sessionId}/git/compare?${params.toString()}`
  );
}

export async function previewMerge(
  sessionId: string,
  sourceBranch: string,
  targetBranch: string,
  workingDir?: string
): Promise<MergePreviewResponse> {
  return api.post<MergePreviewResponse>(`/api/sessions/${sessionId}/git/merge-preview`, {
    source_branch: sourceBranch,
    target_branch: targetBranch,
    working_dir: workingDir,
  });
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

export interface UpdateWorkspaceResponse {
  success: boolean;
  working_dir?: string | null;
  error?: string | null;
}

export interface WorkspaceInfoResponse {
  working_dir?: string | null;
  mount_path?: string | null;
  status?: string | null;
}

/**
 * Get workspace info including working directory.
 * Useful for local pods where the working_dir might not be stored in session.
 */
export async function getWorkspaceInfo(sessionId: string): Promise<WorkspaceInfoResponse> {
  return api.get<WorkspaceInfoResponse>(`/api/sessions/${sessionId}/workspace/info`);
}

/**
 * Update workspace configuration (e.g., working directory).
 * Only supported for local pod workspaces.
 */
export async function updateWorkspaceConfig(
  sessionId: string,
  workingDir: string
): Promise<UpdateWorkspaceResponse> {
  return api.patch<UpdateWorkspaceResponse>(`/api/sessions/${sessionId}/workspace`, {
    working_dir: workingDir,
  });
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

/**
 * Convenience helper to create a new folder.
 *
 * We model folders as real directories on disk by creating
 * a placeholder file inside the requested folder. This ensures
 * the directory shows up in file listings even if it is empty.
 */
export async function createFolder(sessionId: string, folderPath: string): Promise<FileContent> {
  const normalized =
    folderPath.endsWith('/') || folderPath.endsWith('\\')
      ? folderPath.replace(/[/\\]+$/, '')
      : folderPath;

  const placeholderPath = `${normalized}/.gitkeep`;
  return createFile(sessionId, placeholderPath, '');
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

/**
 * Alias for updateFileContent to better reflect editor semantics.
 * This makes call sites read as \"saveFile\" instead of \"updateFileContent\".
 */
export async function saveFile(
  sessionId: string,
  path: string,
  content: string
): Promise<FileContent> {
  return updateFileContent(sessionId, path, content);
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

/**
 * Download a single file from the session workspace.
 * Triggers a browser download via a temporary anchor element.
 */
export async function downloadFile(sessionId: string, path: string): Promise<void> {
  const url = `${API_BASE_URL}/api/sessions/${sessionId}/files/download?path=${encodeURIComponent(path)}`;

  // Get current auth token
  const { tokens } = useAuthStore.getState();
  const accessToken = tokens?.accessToken;

  // Fetch with auth header (include credentials for httpOnly cookie auth)
  const response = await fetch(url, {
    credentials: 'include',
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `Download failed: ${response.status}`);
  }

  // Get the blob and create download link
  const blob = await response.blob();
  const filename = path.split('/').pop() || 'download';

  // Create temporary download link
  const downloadUrl = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = downloadUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(downloadUrl);
}

/**
 * Download a folder as a ZIP file from the session workspace.
 * Triggers a browser download via a temporary anchor element.
 */
export async function downloadFolder(sessionId: string, path: string): Promise<void> {
  const url = `${API_BASE_URL}/api/sessions/${sessionId}/files/download-folder`;

  // Get current auth token
  const { tokens } = useAuthStore.getState();
  const accessToken = tokens?.accessToken;

  // Build headers - always include Content-Type, optionally include auth
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  // POST request with path in body (include credentials for httpOnly cookie auth)
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify({ path }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `Download failed: ${response.status}`);
  }

  // Get the blob and create download link
  const blob = await response.blob();
  const folderName = path === '.' ? 'workspace' : path.split('/').pop() || 'folder';
  const filename = `${folderName}.zip`;

  // Create temporary download link
  const downloadUrl = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = downloadUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(downloadUrl);
}

// ==================== Session Layout ====================

export interface GridSpanLayout {
  col_span: number;
  row_span: number;
  col_start?: number;
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
  editor_grid_card_id: string | null;
  editor_grid_span: GridSpanLayout | null;
  editor_freeform_position: PositionLayout | null;
  // Optional editor tabs/layout snapshot (per session)
  editor_tabs?: EditorTabsLayoutState | null;
}

export interface LayoutUpdateRequest {
  view_mode?: string;
  active_agent_id?: string | null;
  agent_layouts?: Record<string, AgentLayoutState>;
  file_preview_layouts?: Record<string, FilePreviewLayoutState>;
  sidebar_open?: boolean;
  sidebar_width?: number;
  editor_grid_card_id?: string | null;
  editor_grid_span?: GridSpanLayout | null;
  editor_freeform_position?: PositionLayout | null;
  editor_tabs?: EditorTabsLayoutState | null;
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

export interface EditorLayoutState {
  editor_grid_card_id: string | null;
  editor_grid_span: GridSpanLayout | null;
  editor_freeform_position: PositionLayout | null;
}

// Editor tabs/panes layout persisted per session
export interface EditorTabLayoutState {
  id: string;
  path: string;
  name: string;
  language: string;
  is_preview: boolean;
}

export interface EditorPaneLayoutState {
  id: string;
  tabs: string[];
  active_tab_id: string | null;
  size: number;
}

export interface EditorTabsLayoutState {
  split_layout: 'single' | 'horizontal' | 'vertical' | 'quad';
  panes: Record<string, EditorPaneLayoutState>;
  pane_order: string[];
  active_pane_id: string | null;
  tabs: Record<string, EditorTabLayoutState>;
}

export async function updateEditorLayout(
  sessionId: string,
  data: Partial<EditorLayoutState>
): Promise<EditorLayoutState> {
  return api.patch<EditorLayoutState>(`/api/sessions/${sessionId}/layout/editor`, data);
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

export interface PodUsageDataPoint {
  date: string;
  tokens: number;
  api_calls: number;
  cost: number;
  compute_minutes: number;
}

export interface PodUsageSeries {
  session_id: string;
  session_name: string;
  data: PodUsageDataPoint[];
  color: string;
}

export interface UsageHistoryResponse {
  daily: UsageDataPoint[];
  by_pod: PodUsageSeries[];
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
  // Sponsorship fields
  is_sponsored?: boolean;
  sponsor_reason?: string | null;
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
  usage_by_session: Record<string, { tokens: number; cost: number }>;
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
  storage_gb: number;
  bandwidth_mbps: number | null; // Network bandwidth allocation in Mbps
  hourly_rate: number; // Base cost (provider cost)
  is_available: boolean;
  requires_subscription: string | null;
  region_availability: string[];
  // User-specific pricing (with margin applied)
  user_hourly_rate: number | null;
  compute_margin_percent: number | null;
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

// Hardware Specs
export async function getHardwareSpecs(): Promise<HardwareSpec[]> {
  return api.get<HardwareSpec[]>('/api/billing/hardware-specs');
}

// Usage
// Transform API response to camelCase for consistency with other stores
export interface UsageSummary {
  periodStart: string;
  periodEnd: string;
  tokensInput: number;
  tokensOutput: number;
  tokensTotal: number;
  tokensCost: number;
  computeSeconds: number;
  computeHours: number;
  computeCreditsUsed: number;
  computeCreditsIncluded: number;
  computeCost: number;
  storageGb: number;
  storageCost: number;
  apiCalls: number;
  totalCost: number;
  usageByModel: Record<string, { input: number; output: number; cost: number }>;
  usageByAgent: Record<string, { tokens: number; cost: number }>;
  usageBySession: Record<string, { tokens: number; cost: number; name?: string }>;
  usageByTier: Record<string, { seconds: number; cost: number }>;
}

export interface Quota {
  id: string;
  quotaType: string;
  limitValue: number;
  currentUsage: number;
  usagePercentage: number;
  resetAt: string | null;
  overageAllowed: boolean;
  isExceeded: boolean;
  isWarning: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function transformUsageSummary(data: any): UsageSummary {
  return {
    periodStart: data.period_start,
    periodEnd: data.period_end,
    tokensInput: data.tokens_input ?? 0,
    tokensOutput: data.tokens_output ?? 0,
    tokensTotal: data.tokens_total ?? 0,
    tokensCost: data.tokens_cost ?? 0,
    computeSeconds: data.compute_seconds ?? 0,
    computeHours: data.compute_hours ?? 0,
    computeCreditsUsed: data.compute_credits_used ?? 0,
    computeCreditsIncluded: data.compute_credits_included ?? 0,
    computeCost: data.compute_cost ?? 0,
    storageGb: data.storage_gb ?? 0,
    storageCost: data.storage_cost ?? 0,
    apiCalls: data.api_calls ?? 0,
    totalCost: data.total_cost ?? 0,
    usageByModel: data.usage_by_model ?? {},
    usageByAgent: data.usage_by_agent ?? {},
    usageBySession: data.usage_by_session ?? {},
    usageByTier: data.usage_by_tier ?? {},
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function transformQuota(data: any): Quota {
  return {
    id: data.id,
    quotaType: data.quota_type,
    limitValue: data.limit_value ?? 0,
    currentUsage: data.current_usage ?? 0,
    usagePercentage: data.usage_percentage ?? 0,
    resetAt: data.reset_at ?? null,
    overageAllowed: data.overage_allowed ?? false,
    isExceeded: data.is_exceeded ?? false,
    isWarning: data.is_warning ?? false,
  };
}

export async function getUsageSummary(
  period: 'current' | 'last_month' | 'all_time' = 'current'
): Promise<UsageSummary> {
  const response = await api.get<UsageSummaryResponse>(`/api/billing/usage?period=${period}`);
  return transformUsageSummary(response);
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
export async function getQuotas(): Promise<Quota[]> {
  const response = await api.get<QuotaResponse[]>('/api/billing/quotas');
  return response.map(transformQuota);
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

export interface UnreadCountResponse {
  count: number;
}

export async function getAttentionItems(
  sessionId: string,
  options?: { include_dismissed?: boolean }
): Promise<{ items: AttentionItem[]; total: number }> {
  const params = new URLSearchParams();
  if (options?.include_dismissed) params.append('include_dismissed', 'true');
  const query = params.toString() ? `?${params}` : '';
  const items = await api.get<AttentionItem[]>(`/api/sessions/${sessionId}/attention${query}`);
  return { items, total: items.length };
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

export async function testMCPDefault(
  slug: string,
  envVars?: Record<string, string>
): Promise<MCPTestConnectionResponse> {
  return api.post<MCPTestConnectionResponse>(`/api/mcp/defaults/${slug}/test`, {
    env_vars: envVars,
  });
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

// ==================== Admin MCP Server Catalog ====================

export interface AdminDefaultMCPServer {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  category: string;
  transport: 'stdio' | 'sse' | 'http';
  command: string | null;
  args: string[] | null;
  url: string | null;
  env_vars: Record<string, string> | null;
  required_env: string[] | null;
  optional_env: string[] | null;
  icon: string | null;
  is_builtin: boolean;
  docs_url: string | null;
  sort_order: number;
  is_enabled: boolean;
  is_system: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateAdminMCPServerRequest {
  slug: string;
  name: string;
  description?: string;
  category: string;
  transport: 'stdio' | 'sse' | 'http';
  command?: string;
  args?: string[];
  url?: string;
  env_vars?: Record<string, string>;
  required_env?: string[];
  optional_env?: string[];
  icon?: string;
  is_builtin?: boolean;
  docs_url?: string;
  sort_order?: number;
}

export interface UpdateAdminMCPServerRequest {
  name?: string;
  description?: string;
  category?: string;
  transport?: 'stdio' | 'sse' | 'http';
  command?: string;
  args?: string[];
  url?: string;
  env_vars?: Record<string, string>;
  required_env?: string[];
  optional_env?: string[];
  icon?: string;
  is_builtin?: boolean;
  docs_url?: string;
  sort_order?: number;
  is_enabled?: boolean;
}

export async function listAdminMCPServers(): Promise<AdminDefaultMCPServer[]> {
  const response = await api.get<{ servers: AdminDefaultMCPServer[]; total: number }>(
    '/api/admin/mcp'
  );
  return response.servers;
}

export async function getAdminMCPServer(serverId: string): Promise<AdminDefaultMCPServer> {
  return api.get<AdminDefaultMCPServer>(`/api/admin/mcp/${serverId}`);
}

export async function createAdminMCPServer(
  data: CreateAdminMCPServerRequest
): Promise<AdminDefaultMCPServer> {
  const result = await api.post<AdminDefaultMCPServer>('/api/admin/mcp', data);
  requestCache.invalidatePattern(/^GET:\/api\/admin\/mcp/);
  requestCache.invalidatePattern(/^GET:\/api\/mcp\/defaults/);
  return result;
}

export async function updateAdminMCPServer(
  serverId: string,
  data: UpdateAdminMCPServerRequest
): Promise<AdminDefaultMCPServer> {
  const result = await api.put<AdminDefaultMCPServer>(`/api/admin/mcp/${serverId}`, data);
  requestCache.invalidatePattern(/^GET:\/api\/admin\/mcp/);
  requestCache.invalidatePattern(/^GET:\/api\/mcp\/defaults/);
  return result;
}

export async function deleteAdminMCPServer(serverId: string): Promise<void> {
  await api.delete(`/api/admin/mcp/${serverId}`);
  requestCache.invalidatePattern(/^GET:\/api\/admin\/mcp/);
  requestCache.invalidatePattern(/^GET:\/api\/mcp\/defaults/);
}

export async function toggleAdminMCPServer(serverId: string): Promise<AdminDefaultMCPServer> {
  const result = await api.post<AdminDefaultMCPServer>(`/api/admin/mcp/${serverId}/toggle`, {});
  requestCache.invalidatePattern(/^GET:\/api\/admin\/mcp/);
  requestCache.invalidatePattern(/^GET:\/api\/mcp\/defaults/);
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
  total_memory_mb: number | null;
  total_cpu_cores: number | null;
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
  labels?: Record<string, string>;
}

export interface CreateLocalPodResponse {
  pod: LocalPod;
  token: string; // Only returned on create - save this!
}

export interface UpdateLocalPodRequest {
  name?: string;
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

// Host filesystem browsing
export interface DirectoryEntry {
  name: string;
  path: string;
  is_dir: boolean;
  is_file: boolean;
  size: number | null;
  modified: number | null;
}

export interface BrowseDirectoryResponse {
  path: string;
  parent: string | null;
  entries: DirectoryEntry[];
  is_home: boolean;
  error: string | null;
  allowed_paths: string[] | null;
}

export async function browseLocalPodDirectory(
  podId: string,
  path: string = '~',
  showHidden: boolean = false
): Promise<BrowseDirectoryResponse> {
  return api.post<BrowseDirectoryResponse>(`/api/local-pods/${podId}/browse`, {
    path,
    show_hidden: showHidden,
  });
}

// Local Pod Pricing (from platform settings)
export interface LocalPodPricing {
  hourly_rate_cents: number;
  description: string;
  billing_enabled: boolean;
}

/**
 * Get local pod pricing configuration from platform settings.
 * Returns default free pricing if setting is not found.
 */
export async function getLocalPodPricing(): Promise<LocalPodPricing> {
  try {
    return await getPlatformSetting<LocalPodPricing>('local_pod_pricing');
  } catch {
    // Return default free pricing if setting doesn't exist
    return {
      hourly_rate_cents: 0,
      description: 'Your local machine',
      billing_enabled: false,
    };
  }
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

// ============================================================================
// Doctor/Diagnostics APIs
// ============================================================================

export interface ServiceHealth {
  name: string;
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  latency_ms: number | null;
  message: string | null;
  details: Record<string, unknown> | null;
}

export interface LLMProviderStatus {
  provider: string;
  configured: boolean;
  active: boolean;
  model: string | null;
  details: Record<string, unknown> | null;
}

export interface SystemInfo {
  platform: string;
  python_version: string;
  app_version: string;
  environment: string;
  server_time: string;
}

export interface DoctorReport {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  system: SystemInfo;
  services: ServiceHealth[];
  llm_providers: LLMProviderStatus[];
  recommendations: string[];
}

/**
 * Run comprehensive environment diagnostics.
 * Checks database, Redis, services, Docker, and LLM provider configurations.
 */
export async function runDoctor(): Promise<DoctorReport> {
  return api.get<DoctorReport>('/api/doctor');
}

/**
 * Quick health check without authentication.
 * Useful for monitoring and health probes.
 */
export async function quickHealthCheck(): Promise<{
  status: string;
  version: string;
  environment: string;
  llm_provider: string;
}> {
  return api.get('/api/doctor/quick');
}

// ============================================================================
// Custom Commands APIs
// ============================================================================

export interface CommandArgument {
  name: string;
  type: string;
  required: boolean;
  default: string | null;
  description: string | null;
}

export interface CustomCommand {
  id: string;
  name: string;
  description: string | null;
  prompt_template: string;
  arguments: CommandArgument[] | null;
  category: string;
  enabled: boolean;
  sort_order: number;
  is_global: boolean;
  usage_count: number;
  user_id: string | null;
  session_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CommandListResponse {
  commands: CustomCommand[];
  total: number;
}

export interface CreateCommandRequest {
  name: string;
  description?: string;
  prompt_template: string;
  arguments?: CommandArgument[];
  category?: string;
  session_id?: string;
}

export interface UpdateCommandRequest {
  name?: string;
  description?: string;
  prompt_template?: string;
  arguments?: CommandArgument[];
  category?: string;
  enabled?: boolean;
  sort_order?: number;
}

export interface ExecuteCommandResponse {
  prompt: string;
  command_id: string;
  command_name: string;
}

/**
 * List custom commands for the current user.
 */
export async function listCommands(options?: {
  category?: string;
  sessionId?: string;
  includeGlobal?: boolean;
  enabledOnly?: boolean;
}): Promise<CommandListResponse> {
  const params = new URLSearchParams();
  if (options?.category) params.set('category', options.category);
  if (options?.sessionId) params.set('session_id', options.sessionId);
  if (options?.includeGlobal !== undefined)
    params.set('include_global', String(options.includeGlobal));
  if (options?.enabledOnly !== undefined) params.set('enabled_only', String(options.enabledOnly));
  const query = params.toString();
  return api.get<CommandListResponse>(`/api/commands${query ? `?${query}` : ''}`);
}

/**
 * Create a new custom command.
 */
export async function createCommand(data: CreateCommandRequest): Promise<CustomCommand> {
  return api.post<CustomCommand>('/api/commands', data);
}

/**
 * Get a custom command by ID.
 */
export async function getCommand(commandId: string): Promise<CustomCommand> {
  return api.get<CustomCommand>(`/api/commands/${commandId}`);
}

/**
 * Get a custom command by name.
 */
export async function getCommandByName(name: string, sessionId?: string): Promise<CustomCommand> {
  const params = sessionId ? `?session_id=${sessionId}` : '';
  return api.get<CustomCommand>(`/api/commands/by-name/${name}${params}`);
}

/**
 * Update a custom command.
 */
export async function updateCommand(
  commandId: string,
  data: UpdateCommandRequest
): Promise<CustomCommand> {
  return api.patch<CustomCommand>(`/api/commands/${commandId}`, data);
}

/**
 * Delete a custom command.
 */
export async function deleteCommand(commandId: string): Promise<void> {
  return api.delete(`/api/commands/${commandId}`);
}

/**
 * Execute a command and get the rendered prompt.
 */
export async function executeCommand(
  commandId: string,
  args: Record<string, string> = {}
): Promise<ExecuteCommandResponse> {
  return api.post<ExecuteCommandResponse>(`/api/commands/${commandId}/execute`, {
    arguments: args,
  });
}

// ============================================================================
// Project Init APIs
// ============================================================================

export interface ProjectInfo {
  name: string;
  type: string;
  language: string;
  framework: string | null;
  package_manager: string | null;
  has_tests: boolean;
  has_ci: boolean;
  git_initialized: boolean;
}

export interface ProjectInitRequest {
  session_id: string;
  include_dependencies?: boolean;
  include_structure?: boolean;
  custom_context?: string;
}

export interface ProjectInitResponse {
  success: boolean;
  project_info: ProjectInfo | null;
  agents_md_content: string;
  file_path: string;
  created: boolean;
  message: string;
}

/**
 * Initialize project with AGENTS.md file.
 */
export async function initProject(data: ProjectInitRequest): Promise<ProjectInitResponse> {
  return api.post<ProjectInitResponse>('/api/init/project', data);
}

/**
 * Get project info without creating AGENTS.md.
 */
export async function getProjectInfo(sessionId: string): Promise<ProjectInfo> {
  return api.get<ProjectInfo>(`/api/init/project/${sessionId}/info`);
}

// ============================================================================
// LLM Models APIs
// ============================================================================

export interface ModelCapabilities {
  vision: boolean;
  thinking: boolean;
  thinking_coming_soon?: boolean;
  tool_use: boolean;
  streaming: boolean;
  json_mode: boolean;
}

export interface PublicModel {
  model_id: string;
  display_name: string;
  provider: string;
  family: string;
  description: string | null;
  cost_tier: 'low' | 'medium' | 'high' | 'premium';
  capabilities: ModelCapabilities;
  context_window: number;
  max_output_tokens: number;
  is_default: boolean;
  input_cost_per_million: number | null; // Base cost (provider cost)
  output_cost_per_million: number | null; // Base cost (provider cost)
  good_for: string[];
  // User-specific pricing (with margin applied)
  user_input_cost_per_million: number | null;
  user_output_cost_per_million: number | null;
  llm_margin_percent: number | null;
}

export interface AgentTypeDefaults {
  model_id: string;
  temperature: number;
  max_tokens: number;
}

export interface AgentDefaultsResponse {
  defaults: Record<string, AgentTypeDefaults>;
}

/**
 * Get list of available LLM models.
 */
export async function getAvailableModels(options?: {
  provider?: string;
  family?: string;
}): Promise<PublicModel[]> {
  const params = new URLSearchParams();
  if (options?.provider) params.set('provider', options.provider);
  if (options?.family) params.set('family', options.family);
  const query = params.toString();
  return api.get<PublicModel[]>(`/api/models/available${query ? `?${query}` : ''}`);
}

/**
 * Get default model settings for all agent types.
 */
export async function getModelDefaults(): Promise<AgentDefaultsResponse> {
  return api.get<AgentDefaultsResponse>('/api/models/defaults');
}

/**
 * User-provided API key model.
 */
export interface UserProviderModel {
  model_id: string;
  display_name: string;
  provider: string;
  family: string;
  description: string | null;
  cost_tier: 'low' | 'medium' | 'high' | 'premium';
  capabilities: ModelCapabilities;
  context_window: number;
  max_output_tokens: number;
  is_user_key: boolean; // Always true for user-provider models
  input_cost_per_million: number | null;
  output_cost_per_million: number | null;
  good_for: string[];
}

/**
 * Get models available via user's configured API keys.
 */
export async function getUserProviderModels(): Promise<UserProviderModel[]> {
  return api.get<UserProviderModel[]>('/api/models/user-providers');
}

// ============================================================================
// Local Model Discovery
// ============================================================================

export interface DiscoveredModel {
  id: string;
  name: string;
  size?: number;
  modified_at?: string;
}

export interface DiscoverLocalModelsRequest {
  provider: 'ollama' | 'lmstudio';
  base_url: string;
}

export interface DiscoverLocalModelsResponse {
  models: DiscoveredModel[];
  success: boolean;
  error?: string;
}

/**
 * Discover available models from a local LLM provider (Ollama or LM Studio).
 */
export async function discoverLocalModels(
  request: DiscoverLocalModelsRequest
): Promise<DiscoverLocalModelsResponse> {
  return api.post<DiscoverLocalModelsResponse>('/api/user/config/discover-local-models', request);
}

/**
 * Get saved local LLM configuration (base URLs and discovered models).
 */
export async function getLocalLLMConfig(): Promise<
  Record<string, { base_url: string; models: DiscoveredModel[] }>
> {
  return api.get<Record<string, { base_url: string; models: DiscoveredModel[] }>>(
    '/api/user/config/local-llm-config'
  );
}

/**
 * Save a local LLM provider URL (without discovering models).
 */
export async function saveLocalLLMUrl(
  provider: 'ollama' | 'lmstudio',
  baseUrl: string
): Promise<void> {
  await api.post('/api/user/config/local-llm-config/url', { provider, base_url: baseUrl });
}

// ============================================================================
// Admin Models APIs (for admin users)
// ============================================================================

export interface AdminModel extends PublicModel {
  id: string;
  input_cost_per_million: number;
  output_cost_per_million: number;
  is_enabled: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface CreateModelRequest {
  model_id: string;
  display_name: string;
  provider: string;
  family?: string;
  description?: string;
  cost_tier?: string;
  capabilities?: Partial<ModelCapabilities>;
  context_window?: number;
  max_output_tokens?: number;
  input_cost_per_million?: number;
  output_cost_per_million?: number;
  is_enabled?: boolean;
  is_default?: boolean;
}

export interface UpdateModelRequest {
  display_name?: string;
  description?: string;
  cost_tier?: string;
  capabilities?: Partial<ModelCapabilities>;
  context_window?: number;
  max_output_tokens?: number;
  input_cost_per_million?: number;
  output_cost_per_million?: number;
  is_enabled?: boolean;
  is_default?: boolean;
  sort_order?: number;
}

export interface UpdateAgentDefaultsRequest {
  model_id: string;
  temperature?: number;
  max_tokens?: number;
}

/**
 * Admin: List all LLM models.
 */
export async function adminListModels(options?: {
  provider?: string;
  family?: string;
  enabled_only?: boolean;
}): Promise<AdminModel[]> {
  const params = new URLSearchParams();
  if (options?.provider) params.set('provider', options.provider);
  if (options?.family) params.set('family', options.family);
  if (options?.enabled_only !== undefined) params.set('enabled_only', String(options.enabled_only));
  const query = params.toString();
  return api.get<AdminModel[]>(`/api/admin/models${query ? `?${query}` : ''}`);
}

/**
 * Admin: Create a new LLM model.
 */
export async function adminCreateModel(data: CreateModelRequest): Promise<AdminModel> {
  return api.post<AdminModel>('/api/admin/models', data);
}

/**
 * Admin: Get a specific LLM model.
 */
export async function adminGetModel(modelId: string): Promise<AdminModel> {
  return api.get<AdminModel>(`/api/admin/models/${modelId}`);
}

/**
 * Admin: Update an LLM model.
 */
export async function adminUpdateModel(
  modelId: string,
  data: UpdateModelRequest
): Promise<AdminModel> {
  return api.patch<AdminModel>(`/api/admin/models/${modelId}`, data);
}

/**
 * Admin: Delete an LLM model.
 */
export async function adminDeleteModel(modelId: string): Promise<void> {
  return api.delete(`/api/admin/models/${modelId}`);
}

/**
 * Admin: Get agent type defaults.
 */
export async function adminGetAgentDefaults(): Promise<AgentDefaultsResponse> {
  return api.get<AgentDefaultsResponse>('/api/admin/models/agent-defaults');
}

/**
 * Admin: Update agent type defaults.
 */
export async function adminUpdateAgentDefaults(
  agentType: string,
  data: UpdateAgentDefaultsRequest
): Promise<AgentDefaultsResponse> {
  return api.put<AgentDefaultsResponse>(`/api/admin/models/agent-defaults/${agentType}`, data);
}

/**
 * Admin: Seed default LLM models.
 */
export async function adminSeedModels(): Promise<{
  created: number;
  updated: number;
  total: number;
}> {
  return api.post('/api/admin/models/seed', {});
}

// ============================================================================
// User LLM API Keys Management
// ============================================================================

export interface LLMApiKeysResponse {
  providers: string[];
}

export interface SetLLMApiKeyRequest {
  provider: string;
  api_key: string;
}

/**
 * Get list of LLM providers with configured API keys.
 * Returns provider names only, not the actual keys.
 */
export async function getLLMApiKeys(): Promise<LLMApiKeysResponse> {
  return api.get<LLMApiKeysResponse>('/api/user/config/llm-api-keys');
}

/**
 * Set an LLM API key for a provider.
 */
export async function setLLMApiKey(provider: string, apiKey: string): Promise<LLMApiKeysResponse> {
  return api.post<LLMApiKeysResponse>('/api/user/config/llm-api-keys', {
    provider,
    api_key: apiKey,
  });
}

/**
 * Remove an LLM API key for a provider.
 */
export async function removeLLMApiKey(provider: string): Promise<LLMApiKeysResponse> {
  return api.delete<LLMApiKeysResponse>(`/api/user/config/llm-api-keys/${provider}`);
}

// ============================================================================
// User Model Preferences
// ============================================================================

export interface UserAgentPreferences {
  model_defaults?: Record<string, string>; // role -> model_id
  [key: string]: unknown;
}

/**
 * Get user agent preferences including model defaults.
 */
export async function getUserAgentPreferences(): Promise<UserAgentPreferences> {
  const config = await api.get<{ agent_preferences: UserAgentPreferences | null }>(
    '/api/user/config'
  );
  return config.agent_preferences || { model_defaults: {} };
}

/**
 * Update user model default for a specific agent role.
 */
export async function updateUserModelDefault(role: string, modelId: string): Promise<void> {
  const config = await api.get<{ agent_preferences: UserAgentPreferences | null }>(
    '/api/user/config'
  );
  const currentPrefs = config.agent_preferences || {};
  const modelDefaults = currentPrefs.model_defaults || {};

  await api.patch('/api/user/config', {
    agent_preferences: {
      ...currentPrefs,
      model_defaults: {
        ...modelDefaults,
        [role]: modelId,
      },
    },
  });
}

// ============================================================================
// Skills Management
// ============================================================================

export interface SkillStep {
  name: string;
  description: string;
  tool?: string;
  skill?: string;
  parameters: Record<string, unknown>;
  condition?: string;
  on_success?: string;
  on_failure?: string;
  parallel_with?: string[];
  required: boolean;
}

export interface Skill {
  id: string;
  name: string;
  slug: string;
  description: string;
  version: string;
  triggers: string[];
  tags: string[];
  required_tools: string[];
  required_context: string[];
  steps: SkillStep[];
  system_prompt?: string;
  skill_type: 'system' | 'user';
  is_active: boolean;
  metadata?: {
    category?: string;
    estimated_duration?: number;
    requires_approval?: boolean;
  };
}

export interface SkillsAvailableResponse {
  skills: Skill[];
  total: number;
}

/**
 * Get all skills available to the current user (system + user skills).
 */
export async function getAvailableSkills(): Promise<SkillsAvailableResponse> {
  return api.get<SkillsAvailableResponse>('/api/skills/available');
}

/**
 * Get user's own skills.
 */
export async function getUserSkills(): Promise<Skill[]> {
  const response = await api.get<{ skills: Skill[] }>('/api/skills');
  return response.skills;
}

/**
 * Create a new user skill.
 */
export async function createUserSkill(skill: Partial<Skill>): Promise<Skill> {
  return api.post<Skill>('/api/skills', skill);
}

/**
 * Update a user skill.
 */
export async function updateUserSkill(skillId: string, updates: Partial<Skill>): Promise<Skill> {
  return api.patch<Skill>(`/api/skills/${skillId}`, updates);
}

/**
 * Delete a user skill.
 */
export async function deleteUserSkill(skillId: string): Promise<void> {
  await api.delete(`/api/skills/${skillId}`);
}

// ============================================================================
// Skill Templates
// ============================================================================

export interface SkillTemplate {
  id: string;
  name: string;
  slug: string;
  description: string;
  category: string;
  icon?: string;
  default_triggers?: string[];
  default_tags?: string[];
  required_tools?: string[];
  step_templates?: Record<string, unknown>[];
  variables?: { name: string; type: string; description: string; default?: unknown }[];
  is_system: boolean;
  usage_count: number;
}

export interface SkillTemplatesResponse {
  templates: SkillTemplate[];
  total: number;
  categories: string[];
}

/**
 * List available skill templates.
 */
export async function getSkillTemplates(
  category?: string,
  search?: string
): Promise<SkillTemplatesResponse> {
  const params = new URLSearchParams();
  if (category) params.append('category', category);
  if (search) params.append('search', search);
  const query = params.toString();
  return api.get<SkillTemplatesResponse>(`/api/skill-templates${query ? `?${query}` : ''}`);
}

/**
 * Get a specific skill template.
 */
export async function getSkillTemplate(slug: string): Promise<SkillTemplate> {
  return api.get<SkillTemplate>(`/api/skill-templates/${slug}`);
}

/**
 * Create a skill from a template.
 */
export async function createSkillFromTemplate(
  templateSlug: string,
  data: {
    name: string;
    slug: string;
    description?: string;
    variables?: Record<string, unknown>;
  }
): Promise<Skill> {
  return api.post<Skill>(`/api/skill-templates/${templateSlug}/create-skill`, data);
}

// ============================================================================
// Skill Repositories (Git Sync)
// ============================================================================

export interface SkillRepository {
  id: string;
  name: string;
  repo_url: string;
  branch: string;
  skills_path: string;
  sync_direction: 'pull' | 'push' | 'bidirectional';
  last_synced_at?: string;
  last_sync_status?: 'success' | 'failed' | 'pending';
  last_sync_error?: string;
  is_active: boolean;
  created_at: string;
}

export interface SkillSyncLog {
  id: string;
  repository_id: string;
  direction: string;
  status: string;
  skills_added: number;
  skills_updated: number;
  skills_removed: number;
  error_message?: string;
  started_at: string;
  completed_at?: string;
}

/**
 * List user's connected skill repositories.
 */
export async function getSkillRepositories(includeInactive = false): Promise<SkillRepository[]> {
  const response = await api.get<{ repositories: SkillRepository[] }>(
    `/api/skill-repositories?include_inactive=${includeInactive}`
  );
  return response.repositories;
}

/**
 * Connect a new skill repository.
 */
export async function createSkillRepository(data: {
  name: string;
  repo_url: string;
  branch?: string;
  skills_path?: string;
  sync_direction?: 'pull' | 'push' | 'bidirectional';
}): Promise<SkillRepository> {
  return api.post<SkillRepository>('/api/skill-repositories', data);
}

/**
 * Update a skill repository.
 */
export async function updateSkillRepository(
  repoId: string,
  updates: Partial<SkillRepository>
): Promise<SkillRepository> {
  return api.patch<SkillRepository>(`/api/skill-repositories/${repoId}`, updates);
}

/**
 * Disconnect a skill repository.
 */
export async function deleteSkillRepository(repoId: string): Promise<void> {
  await api.delete(`/api/skill-repositories/${repoId}`);
}

/**
 * Trigger a manual sync for a repository.
 */
export async function syncSkillRepository(
  repoId: string,
  force = false
): Promise<{ sync_id: string; status: string; message: string }> {
  return api.post(`/api/skill-repositories/${repoId}/sync?force=${force}`, {});
}

/**
 * Get sync history for a repository.
 */
export async function getSkillSyncLogs(repoId: string, limit = 20): Promise<SkillSyncLog[]> {
  const response = await api.get<{ logs: SkillSyncLog[] }>(
    `/api/skill-repositories/${repoId}/logs?limit=${limit}`
  );
  return response.logs;
}

/**
 * Get webhook URL for a repository.
 */
export async function getSkillRepositoryWebhook(repoId: string): Promise<{
  webhook_url: string;
  secret: string;
  events: string[];
  content_type: string;
}> {
  return api.get(`/api/skill-repositories/${repoId}/webhook-url`);
}

// ============================================================================
// Skill Marketplace
// ============================================================================

export interface MarketplaceSkill {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  version: string;
  triggers: string[];
  tags: string[];
  install_count: number;
}

export interface MarketplaceListResponse {
  skills: MarketplaceSkill[];
  total: number;
}

export interface UserAddedSkill {
  id: string;
  skill_slug: string;
  skill_name: string;
  is_enabled: boolean;
  added_at: string;
}

/**
 * List approved marketplace skills.
 */
export async function getMarketplaceSkills(
  category?: string,
  search?: string
): Promise<MarketplaceListResponse> {
  const params = new URLSearchParams();
  if (category) params.append('category', category);
  if (search) params.append('search', search);
  const query = params.toString();
  return api.get<MarketplaceListResponse>(`/api/v1/marketplace${query ? `?${query}` : ''}`);
}

/**
 * Install a skill from the marketplace.
 */
export async function installMarketplaceSkill(slug: string): Promise<UserAddedSkill> {
  return api.post<UserAddedSkill>(`/api/marketplace/${slug}/install`, {});
}

/**
 * Uninstall a marketplace skill.
 */
export async function uninstallMarketplaceSkill(slug: string): Promise<void> {
  await api.delete(`/api/marketplace/${slug}/uninstall`);
}

/**
 * Get user's installed marketplace skills.
 */
export async function getMyMarketplaceSkills(): Promise<UserAddedSkill[]> {
  const response = await api.get<{ skills: UserAddedSkill[] }>('/api/marketplace/my/skills');
  return response.skills;
}

/**
 * Submit a skill to the marketplace for approval.
 */
export async function submitSkillToMarketplace(skillId: string): Promise<void> {
  await api.post('/api/marketplace/submit', { skill_id: skillId });
}

/**
 * Get user's marketplace submissions.
 */
export async function getMyMarketplaceSubmissions(): Promise<MarketplaceSkill[]> {
  const response = await api.get<{ submissions: MarketplaceSkill[] }>(
    '/api/marketplace/my/submissions'
  );
  return response.submissions;
}

// ============================================================================
// Skill Analytics
// ============================================================================

export interface SkillAnalytics {
  skill_id: string;
  skill_slug: string;
  skill_name: string;
  total_executions: number;
  successful_executions: number;
  failed_executions: number;
  success_rate: number;
  avg_duration_ms: number;
  last_executed_at?: string;
}

export interface SkillAnalyticsOverview {
  total_executions: number;
  total_skills_used: number;
  success_rate: number;
  avg_duration_ms: number;
  skills: SkillAnalytics[];
}

export interface SkillExecutionTimeline {
  date: string;
  executions: number;
  successes: number;
  failures: number;
}

/**
 * Get user's skill analytics overview.
 */
export async function getSkillAnalytics(days = 30): Promise<SkillAnalyticsOverview> {
  return api.get<SkillAnalyticsOverview>(`/api/skills/analytics?days=${days}`);
}

/**
 * Get analytics for a specific skill.
 */
export async function getSkillAnalyticsDetail(
  skillId: string,
  days = 30
): Promise<SkillAnalytics & { timeline: SkillExecutionTimeline[] }> {
  return api.get(`/api/skills/${skillId}/analytics?days=${days}`);
}

/**
 * Get skill execution timeline.
 */
export async function getSkillAnalyticsTimeline(
  days = 30,
  granularity: 'day' | 'week' = 'day'
): Promise<SkillExecutionTimeline[]> {
  const response = await api.get<{ data: SkillExecutionTimeline[] }>(
    `/api/skills/analytics/timeline?days=${days}&granularity=${granularity}`
  );
  return response.data;
}

/**
 * Get skill usage trends.
 */
export async function getSkillAnalyticsTrends(
  days = 30
): Promise<{ skill_slug: string; skill_name: string; trend: number; executions: number }[]> {
  const response = await api.get<{
    trends: { skill_slug: string; skill_name: string; trend: number; executions: number }[];
  }>(`/api/skills/analytics/trends?days=${days}`);
  return response.trends;
}

// ============================================================================
// Platform Settings (Public)
// ============================================================================

export interface PlatformSetting {
  id: string;
  category: string;
  key: string;
  value: unknown;
  description?: string;
  is_public: boolean;
  sort_order: number;
}

export interface WorkspaceDefaults {
  cpu_limit: number;
  memory_limit: number;
  disk_limit: number;
  idle_timeout: number;
  max_session_duration: number;
}

export interface ThinkingPreset {
  label: string;
  tokens: number;
  description?: string;
}

export interface ThinkingPresets {
  low: ThinkingPreset;
  medium: ThinkingPreset;
  high: ThinkingPreset;
  max: ThinkingPreset;
}

export interface TimeoutOption {
  value: number | null;
  label: string;
}

export interface AgentModeConfigEntry {
  label: string;
  icon: string;
  color: string;
  description: string;
}

export interface AgentModeConfig {
  plan: AgentModeConfigEntry;
  ask: AgentModeConfigEntry;
  auto: AgentModeConfigEntry;
  sovereign: AgentModeConfigEntry;
}

export interface VoiceLanguage {
  code: string;
  name: string;
}

// ============================================================================
// Additional Platform Settings Types
// ============================================================================

export interface SidebarPanelConfig {
  panelId: string;
  height: number;
}

export interface SidebarSideConfig {
  collapsed: boolean;
  width: number;
  panels: SidebarPanelConfig[];
}

export interface SidebarLayoutDefaults {
  left: SidebarSideConfig;
  right: SidebarSideConfig;
}

export interface GridConfigDefaults {
  columns: number;
  rowHeight: number;
  maxRows: number;
  maxCols: number;
}

export interface CardDimensionConfig {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
}

export interface CardDimensions {
  terminal: CardDimensionConfig;
  editor: CardDimensionConfig;
  agent: CardDimensionConfig;
  preview: CardDimensionConfig;
}

export interface ContextCompactionDefaults {
  autoCompactEnabled: boolean;
  autoCompactThresholdPercent: number;
  customCompactionInstructions: string | null;
  preserveRecentMessages: number;
}

export interface ContextUsageDefaults {
  tokensUsed: number;
  tokensMax: number;
  percentage: number;
}

export interface AICompletionConfig {
  debounceMs: number;
  maxPrefixLines: number;
  maxSuffixLines: number;
  minTriggerLength: number;
  enabled: boolean;
}

export interface CodeGeneratorConfig {
  enabled: boolean;
  patterns: string[];
}

export interface BugDetectorConfig {
  debounceMs: number;
  enabled: boolean;
  minCodeLength: number;
  autoAnalyze: boolean;
}

export interface EditorAIConfig {
  defaultModel: string | null;
  completionsEnabled: boolean;
  completionsDebounceMs: number;
}

export interface TimeRangeOption {
  label: string;
  value: string;
  days: number;
}

export interface StorageQuotaDefaults {
  defaultQuotaBytes: number;
  warningThreshold: number;
  criticalThreshold: number;
}

export interface EditorDefaults {
  key_mode: string;
  font_size: number;
  tab_size: number;
  word_wrap: string;
  minimap: boolean;
  line_numbers: boolean;
  bracket_pair_colorization: boolean;
}

export interface VoiceDefaults {
  tts_enabled: boolean;
  auto_play: boolean;
  voice_id: string | null;
  speed: number;
  language: string;
}

export interface FeatureFlags {
  registration_enabled: boolean;
  voice_enabled: boolean;
  collaboration_enabled: boolean;
  custom_agents_enabled: boolean;
  git_integration_enabled: boolean;
  planning_mode_enabled: boolean;
  vision_enabled: boolean;
}

export interface PlatformLimits {
  max_concurrent_agents: number;
  max_sessions_per_user: number;
  max_file_size_mb: number;
  max_upload_size_mb: number;
}

export interface PreviewPortConfig {
  port: number;
  label: string;
  protocol: string;
}

/**
 * Get all public platform settings.
 */
export async function getPlatformSettings(category?: string): Promise<PlatformSetting[]> {
  const params = category ? `?category=${category}` : '';
  const response = await api.get<{ settings: PlatformSetting[] }>(
    `/api/platform/settings${params}`
  );
  return response.settings;
}

/**
 * Get a specific platform setting by key.
 */
export async function getPlatformSetting<T = unknown>(key: string): Promise<T> {
  const response = await api.get<{ value: T }>(`/api/platform/settings/${key}`);
  return response.value;
}

// ============================================================================
// LLM Providers (Public)
// ============================================================================

export interface LLMProvider {
  id: string;
  slug: string;
  name: string;
  description?: string;
  icon?: string;
  color: string;
  is_local: boolean;
  default_url?: string;
  docs_url?: string;
  setup_guide_url?: string;
  requires_api_key: boolean;
  supports_streaming: boolean;
  supports_tools: boolean;
  supports_vision: boolean;
  is_enabled: boolean;
  sort_order: number;
}

/**
 * Get all enabled LLM providers.
 */
export async function getProviders(): Promise<LLMProvider[]> {
  const response = await api.get<{ providers: LLMProvider[] }>('/api/platform/providers');
  return response.providers;
}

/**
 * Get a specific provider by slug.
 */
export async function getProvider(slug: string): Promise<LLMProvider> {
  return api.get<LLMProvider>(`/api/platform/providers/${slug}`);
}

// ============================================================================
// Platform Config (Combined Bootstrap)
// ============================================================================

export interface PlatformConfig {
  settings: Record<string, unknown>;
  providers: LLMProvider[];
}

/**
 * Get combined platform configuration for app bootstrap.
 * Returns all public settings and enabled providers in one call.
 */
export async function getPlatformConfig(): Promise<PlatformConfig> {
  return api.get<PlatformConfig>('/api/platform/config');
}

// ============================================================================
// Admin: LLM Providers
// ============================================================================

export interface AdminLLMProvider extends LLMProvider {
  created_at: string;
  updated_at: string;
}

export interface CreateProviderRequest {
  slug: string;
  name: string;
  description?: string;
  icon?: string;
  color: string;
  is_local?: boolean;
  default_url?: string;
  docs_url?: string;
  setup_guide_url?: string;
  requires_api_key?: boolean;
  supports_streaming?: boolean;
  supports_tools?: boolean;
  supports_vision?: boolean;
  is_enabled?: boolean;
  sort_order?: number;
}

export interface UpdateProviderRequest {
  name?: string;
  description?: string;
  icon?: string;
  color?: string;
  is_local?: boolean;
  default_url?: string;
  docs_url?: string;
  setup_guide_url?: string;
  requires_api_key?: boolean;
  supports_streaming?: boolean;
  supports_tools?: boolean;
  supports_vision?: boolean;
  is_enabled?: boolean;
  sort_order?: number;
}

/**
 * Admin: List all LLM providers (including disabled).
 */
export async function adminListProviders(includeDisabled = true): Promise<AdminLLMProvider[]> {
  const response = await api.get<{ providers: AdminLLMProvider[] }>(
    `/api/admin/settings/providers?include_disabled=${includeDisabled}`
  );
  return response.providers;
}

/**
 * Admin: Get a specific provider.
 */
export async function adminGetProvider(slug: string): Promise<AdminLLMProvider> {
  return api.get<AdminLLMProvider>(`/api/admin/settings/providers/${slug}`);
}

/**
 * Admin: Create a new LLM provider.
 */
export async function adminCreateProvider(data: CreateProviderRequest): Promise<AdminLLMProvider> {
  return api.post<AdminLLMProvider>('/api/admin/settings/providers', data);
}

/**
 * Admin: Update an existing provider.
 */
export async function adminUpdateProvider(
  slug: string,
  data: UpdateProviderRequest
): Promise<AdminLLMProvider> {
  return api.patch<AdminLLMProvider>(`/api/admin/settings/providers/${slug}`, data);
}

/**
 * Admin: Delete a provider.
 */
export async function adminDeleteProvider(slug: string): Promise<void> {
  await api.delete(`/api/admin/settings/providers/${slug}`);
}

// ============================================================================
// Memory Operations
// ============================================================================

export interface Memory {
  id: string;
  content: string;
  memory_type: string;
  tags: string[] | null;
  importance: number;
  session_id: string | null;
  project_id: string | null;
  access_count: number;
  created_at: string;
  updated_at: string;
}

export interface MemoriesResponse {
  memories: Memory[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

/**
 * Get paginated list of memories with optional filters.
 */
export async function getMemories(params?: {
  page?: number;
  page_size?: number;
  memory_type?: string;
  search?: string;
}): Promise<MemoriesResponse> {
  const searchParams = new URLSearchParams();
  if (params?.page) searchParams.set('page', String(params.page));
  if (params?.page_size) searchParams.set('page_size', String(params.page_size));
  if (params?.memory_type) searchParams.set('memory_type', params.memory_type);
  if (params?.search) searchParams.set('search', params.search);

  const query = searchParams.toString();
  return api.get<MemoriesResponse>(`/api/v1/memories${query ? `?${query}` : ''}`);
}

/**
 * Delete a specific memory by ID.
 */
export async function deleteMemory(memoryId: string): Promise<void> {
  await api.delete(`/api/v1/memories/${memoryId}`);
}

/**
 * Clear all memories.
 */
export async function clearAllMemories(): Promise<{ deleted: number }> {
  return api.delete<{ deleted: number }>('/api/v1/memories?confirm=true');
}

// ============================================================================
// Skills Operations
// ============================================================================

export interface SkillsResponse {
  skills: Skill[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

/**
 * Get paginated list of skills with optional filters.
 */
export async function getSkills(params?: {
  page?: number;
  page_size?: number;
  category?: string;
  search?: string;
  enabled?: boolean;
}): Promise<SkillsResponse> {
  const searchParams = new URLSearchParams();
  if (params?.page) searchParams.set('page', String(params.page));
  if (params?.page_size) searchParams.set('page_size', String(params.page_size));
  if (params?.category) searchParams.set('category', params.category);
  if (params?.search) searchParams.set('search', params.search);
  if (params?.enabled !== undefined) searchParams.set('enabled', String(params.enabled));

  const query = searchParams.toString();
  return api.get<SkillsResponse>(`/api/v1/skills${query ? `?${query}` : ''}`);
}

/**
 * Delete a skill by ID.
 */
export async function deleteSkill(skillId: string): Promise<void> {
  await api.delete(`/api/v1/skills/${skillId}`);
}

/**
 * Export a skill by ID.
 */
export async function exportSkill(skillId: string): Promise<unknown> {
  return api.get(`/api/v1/skills/${skillId}/export`);
}

/**
 * Create a new skill.
 */
export async function createSkill(data: Partial<Skill>): Promise<Skill> {
  return api.post<Skill>('/api/v1/skills', data);
}

/**
 * Update an existing skill.
 */
export async function updateSkill(skillId: string, data: Partial<Skill>): Promise<Skill> {
  return api.patch<Skill>(`/api/v1/skills/${skillId}`, data);
}

// ============================================================================
// LLM Provider Operations
// ============================================================================

export interface CreateLLMProviderRequest {
  name: string;
  type: string;
  api_key?: string;
  base_url?: string;
  is_enabled?: boolean;
  config?: Record<string, unknown>;
}

export interface LLMProviderTestResult {
  success: boolean;
  message: string;
  latency_ms?: number;
  model_info?: Record<string, unknown>;
}

/**
 * Create a new LLM provider.
 */
export async function createLLMProvider(
  data: CreateLLMProviderRequest
): Promise<LLMProviderResponse> {
  return api.post<LLMProviderResponse>('/api/llm-providers', data);
}

/**
 * Update an existing LLM provider.
 */
export async function updateLLMProvider(
  providerId: string,
  data: Partial<CreateLLMProviderRequest>
): Promise<LLMProviderResponse> {
  return api.patch<LLMProviderResponse>(`/api/llm-providers/${providerId}`, data);
}

/**
 * Delete an LLM provider.
 */
export async function deleteLLMProvider(providerId: string): Promise<void> {
  await api.delete(`/api/llm-providers/${providerId}`);
}

/**
 * Test an LLM provider connection.
 */
export async function testLLMProvider(
  providerId: string,
  prompt?: string
): Promise<LLMProviderTestResult> {
  return api.post<LLMProviderTestResult>(`/api/llm-providers/${providerId}/test`, {
    prompt: prompt || 'Hello, this is a test.',
  });
}

// ============================================================================
// Workspace Search & Symbols
// ============================================================================

export interface SearchResult {
  path: string;
  line: number;
  column: number;
  content: string;
  match: string;
}

export interface SearchResponse {
  results: SearchResult[];
  total: number;
  truncated: boolean;
}

/**
 * Search workspace files for content.
 */
export async function searchWorkspace(
  sessionId: string,
  query: string,
  options?: {
    path?: string;
    include?: string;
    exclude?: string;
    max_results?: number;
    case_sensitive?: boolean;
    regex?: boolean;
  }
): Promise<SearchResponse> {
  const searchParams = new URLSearchParams({ query });
  if (options?.path) searchParams.set('path', options.path);
  if (options?.include) searchParams.set('include', options.include);
  if (options?.exclude) searchParams.set('exclude', options.exclude);
  if (options?.max_results) searchParams.set('max_results', String(options.max_results));
  if (options?.case_sensitive) searchParams.set('case_sensitive', 'true');
  if (options?.regex) searchParams.set('regex', 'true');

  return api.get<SearchResponse>(`/api/sessions/${sessionId}/search?${searchParams.toString()}`);
}

export interface DocumentSymbol {
  name: string;
  detail?: string;
  kind: number;
  range: {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
  };
  selectionRange: {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
  };
  children?: DocumentSymbol[];
}

/**
 * Get document symbols for a file.
 */
export async function getDocumentSymbols(
  sessionId: string,
  filePath: string
): Promise<DocumentSymbol[]> {
  return api.get<DocumentSymbol[]>(
    `/api/sessions/${sessionId}/symbols?path=${encodeURIComponent(filePath)}`
  );
}

// ============================================================================
// Project Health
// ============================================================================

export interface MetricScore {
  score: number;
  grade: string;
  details?: Record<string, unknown>;
}

export interface HealthScoreResponse {
  id: string;
  session_id: string;
  overall_score: number;
  grade: string;
  code_quality: MetricScore;
  test_coverage: MetricScore;
  security: MetricScore;
  documentation: MetricScore;
  dependencies: MetricScore;
  analyzed_files_count: number;
  analysis_duration_seconds: number;
  analysis_status: string;
  analyzed_at: string | null;
  previous_score: number | null;
  score_change: number | null;
}

export interface Recommendation {
  id: string;
  type: string;
  title: string;
  description: string;
  priority: string;
  effort: string;
  impact: string;
  auto_fixable: boolean;
}

export interface RecommendationsResponse {
  total_count: number;
  by_priority: Record<string, number>;
  by_type: Record<string, number>;
  recommendations: Recommendation[];
}

/**
 * Get project health score for a session.
 */
export async function getSessionHealth(sessionId: string): Promise<HealthScoreResponse | null> {
  try {
    return await api.get<HealthScoreResponse>(`/api/v1/sessions/${sessionId}/health`);
  } catch {
    return null;
  }
}

/**
 * Get health recommendations for a session.
 */
export async function getSessionHealthRecommendations(
  sessionId: string
): Promise<RecommendationsResponse | null> {
  try {
    return await api.get<RecommendationsResponse>(
      `/api/v1/sessions/${sessionId}/health/recommendations`
    );
  } catch {
    return null;
  }
}

/**
 * Start health analysis for a session.
 * @param sessionId - Session ID
 * @param workingDirectory - Optional directory to run all checks in (relative to workspace root)
 */
export async function analyzeSessionHealth(
  sessionId: string,
  workingDirectory?: string
): Promise<{ status: string }> {
  return api.post<{ status: string }>(`/api/v1/sessions/${sessionId}/health/analyze`, {
    working_directory: workingDirectory || null,
  });
}

/**
 * Apply an auto-fix recommendation.
 */
export async function applyHealthFix(
  sessionId: string,
  recommendationId: string
): Promise<{ success: boolean; message: string }> {
  return api.post<{ success: boolean; message: string }>(
    `/api/v1/sessions/${sessionId}/health/fix/${recommendationId}`,
    {}
  );
}

// ============================================================================
// Health Checks (Custom Check Configuration)
// ============================================================================

export interface HealthCheck {
  id: string;
  user_id: string | null;
  session_id: string | null;
  category: string;
  name: string;
  description: string | null;
  command: string;
  working_directory: string | null;
  timeout: number;
  parse_mode: string;
  parse_config: Record<string, unknown>;
  weight: number;
  enabled: boolean;
  is_builtin: boolean;
  project_types: string[] | null;
  fix_command: string | null;
  created_at: string;
  updated_at: string;
}

export interface HealthChecksListResponse {
  checks: HealthCheck[];
  total: number;
}

export interface CreateHealthCheckRequest {
  category: string;
  name: string;
  description?: string;
  command: string;
  working_directory?: string;
  timeout?: number;
  parse_mode: string;
  parse_config: Record<string, unknown>;
  weight?: number;
  enabled?: boolean;
  project_types?: string[];
  fix_command?: string;
  session_id?: string;
}

export interface UpdateHealthCheckRequest {
  name?: string;
  description?: string;
  command?: string;
  working_directory?: string;
  timeout?: number;
  parse_mode?: string;
  parse_config?: Record<string, unknown>;
  weight?: number;
  enabled?: boolean;
  project_types?: string[];
  fix_command?: string;
}

export interface TestHealthCheckRequest {
  command?: string;
  working_directory?: string;
  timeout?: number;
  parse_mode?: string;
  parse_config?: Record<string, unknown>;
}

export interface TestHealthCheckResponse {
  success: boolean;
  score: number;
  raw_output: string;
  parsed_details: Record<string, unknown>;
  execution_time: number;
  error?: string;
}

/**
 * List all health checks (built-in and custom).
 */
export async function getHealthChecks(
  category?: string,
  sessionId?: string
): Promise<HealthChecksListResponse> {
  const params = new URLSearchParams();
  if (category) params.append('category', category);
  if (sessionId) params.append('session_id', sessionId);

  const query = params.toString();
  return api.get<HealthChecksListResponse>(`/api/v1/health/checks${query ? `?${query}` : ''}`);
}

/**
 * List only built-in default health checks.
 */
export async function getDefaultHealthChecks(category?: string): Promise<HealthChecksListResponse> {
  const params = new URLSearchParams();
  if (category) params.append('category', category);

  const query = params.toString();
  return api.get<HealthChecksListResponse>(
    `/api/v1/health/checks/defaults${query ? `?${query}` : ''}`
  );
}

/**
 * Create a new custom health check.
 */
export async function createHealthCheck(data: CreateHealthCheckRequest): Promise<HealthCheck> {
  return api.post<HealthCheck>('/api/v1/health/checks', data);
}

/**
 * Update an existing health check.
 */
export async function updateHealthCheck(
  checkId: string,
  data: UpdateHealthCheckRequest
): Promise<HealthCheck> {
  return api.put<HealthCheck>(`/api/v1/health/checks/${checkId}`, data);
}

/**
 * Delete a health check.
 */
export async function deleteHealthCheck(checkId: string): Promise<void> {
  return api.delete(`/api/v1/health/checks/${checkId}`);
}

/**
 * Test run a saved health check.
 */
export async function testHealthCheck(
  checkId: string,
  sessionId: string,
  options?: TestHealthCheckRequest
): Promise<TestHealthCheckResponse> {
  return api.post<TestHealthCheckResponse>(`/api/v1/health/checks/${checkId}/test`, {
    session_id: sessionId,
    ...options,
  });
}

/**
 * Test run a health check command without saving.
 */
export async function testHealthCommand(
  sessionId: string,
  command: string,
  parseMode: string,
  parseConfig: Record<string, unknown>,
  workingDirectory?: string,
  timeout?: number
): Promise<TestHealthCheckResponse> {
  return api.post<TestHealthCheckResponse>('/api/v1/health/checks/test-command', {
    session_id: sessionId,
    command,
    parse_mode: parseMode,
    parse_config: parseConfig,
    working_directory: workingDirectory,
    timeout,
  });
}

// ============================================================================
// Code Explanation
// ============================================================================

export interface ExplanationResponse {
  explanation: string;
  language?: string;
  concepts?: string[];
}

/**
 * Get an explanation for code.
 */
export async function explainCode(
  code: string,
  language?: string,
  context?: string,
  model?: string | null
): Promise<ExplanationResponse> {
  return api.post<ExplanationResponse>('/api/completion/explain', {
    code,
    language,
    context,
    model,
  });
}

// ============================================================================
// Bug Detection
// ============================================================================

export interface BugDetectionIssue {
  line: number;
  column: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
  suggestion: string;
}

export interface BugDetectionResponse {
  bugs: BugDetectionIssue[];
  analysis_time_ms: number;
}

/**
 * Analyze code for potential bugs and issues.
 */
export async function detectBugs(
  code: string,
  language: string,
  model?: string | null
): Promise<BugDetectionResponse> {
  return api.post<BugDetectionResponse>('/api/completion/detect-bugs', {
    code,
    language,
    model,
  });
}

// ============================================================================
// Editor AI Actions
// ============================================================================

export interface EditorAIActionRequest {
  sessionId: string;
  prompt: string; // e.g., "Explain this code", "Refactor this code"
  code: string; // Selected code
  language: string;
  filePath: string;
  model?: string | null; // Optional - uses default if not provided
}

export interface EditorAIActionResponse {
  response: string;
  model: string;
  tokens_used: {
    input: number;
    output: number;
  };
}

/**
 * Perform an AI action on selected code in the editor.
 * This consumes included tokens or credits.
 */
export async function performEditorAIAction(
  request: EditorAIActionRequest
): Promise<EditorAIActionResponse> {
  return api.post<EditorAIActionResponse>(`/api/sessions/${request.sessionId}/editor/ai-action`, {
    prompt: request.prompt,
    code: request.code,
    language: request.language,
    file_path: request.filePath,
    model: request.model,
  });
}

// ============================================================================
// Productivity Tracking
// ============================================================================

export interface ProductivitySummary {
  period_start: string;
  period_end: string;
  total_days: number;
  active_days: number;
  total_lines_written: number;
  total_lines_deleted: number;
  net_lines: number;
  total_files_modified: number;
  total_commits: number;
  total_agent_messages: number;
  total_suggestions_accepted: number;
  total_suggestions_rejected: number;
  acceptance_rate: number;
  total_tasks_completed: number;
  total_active_minutes: number;
  total_coding_minutes: number;
  total_time_saved_minutes: number;
  time_saved_hours: number;
  avg_lines_per_day: number;
  avg_coding_minutes_per_day: number;
  avg_agent_messages_per_day: number;
  current_streak: number;
  longest_streak: number;
  top_languages: Record<string, number>;
  top_agent_usage: Record<string, number>;
}

export interface ProductivityTrends {
  dates: string[];
  lines_written: number[];
  coding_minutes: number[];
  agent_messages: number[];
  time_saved: number[];
  commits: number[];
}

/**
 * Get productivity summary for the specified period.
 */
export async function getProductivitySummary(days: number = 30): Promise<ProductivitySummary> {
  return api.get<ProductivitySummary>(`/api/productivity/summary?days=${days}`);
}

/**
 * Get productivity trends for the specified period.
 */
export async function getProductivityTrends(days: number = 30): Promise<ProductivityTrends> {
  return api.get<ProductivityTrends>(`/api/productivity/trends?days=${days}`);
}

// ============================================================================
// Region Capacity (for workspace placement)
// ============================================================================

export interface TierCapacity {
  available: boolean;
  slots: number;
}

export interface RegionCapacityResponse {
  region: string;
  tiers: Record<string, TierCapacity>;
}

/**
 * Get available capacity per tier for a specific region.
 * Used to show which hardware tiers are available in the selected region.
 */
export async function getRegionCapacity(region: string): Promise<RegionCapacityResponse> {
  return api.get<RegionCapacityResponse>(`/api/servers/capacity/${region}`);
}

// ============================================================================
// Admin Server Workspaces (per-server workspace metrics)
// ============================================================================

export interface ServerWorkspaceInfo {
  workspace_id: string;
  user_id: string;
  user_email: string | null;
  tier: string | null;
  status: string;
  assigned_cpu: number | null;
  assigned_memory_mb: number | null;
  assigned_bandwidth_mbps: number | null;
  created_at: string;
  last_activity: string | null;
}

export interface ServerWorkspacesResponse {
  server_id: string;
  server_name: string;
  region: string | null;
  workspaces: ServerWorkspaceInfo[];
  total_count: number;
}

/**
 * Get all workspaces running on a specific server.
 * Admin endpoint for viewing which users/workspaces are on a server.
 */
export async function getServerWorkspaces(serverId: string): Promise<ServerWorkspacesResponse> {
  return api.get<ServerWorkspacesResponse>(`/api/servers/${serverId}/workspaces`);
}

// ==================== Waitlist API ====================

export interface WaitlistJoinResponse {
  success: boolean;
  message: string;
  position: number | null;
  already_registered: boolean;
}

export interface WaitlistEntry {
  id: string;
  email: string;
  status: 'waiting' | 'invited' | 'registered';
  source: string;
  referral_code: string | null;
  position: number | null;
  created_at: string;
  invited_at: string | null;
  invitation_id: string | null;
}

export interface WaitlistListResponse {
  items: WaitlistEntry[];
  total: number;
  page: number;
  page_size: number;
  has_more: boolean;
  stats: {
    total: number;
    waiting: number;
    invited: number;
    registered: number;
  };
}

export interface SendWaitlistInviteResponse {
  success: boolean;
  message: string;
  invitation_id: string;
  waitlist_entry: WaitlistEntry;
}

/**
 * Join the waitlist (public endpoint).
 */
export async function joinWaitlist(
  email: string,
  source = 'coming_soon',
  referralCode?: string
): Promise<WaitlistJoinResponse> {
  return api.post<WaitlistJoinResponse>(
    '/api/waitlist',
    { email, source, referral_code: referralCode },
    false // Public endpoint, no auth required
  );
}

/**
 * Check waitlist position (public endpoint).
 */
export async function checkWaitlistPosition(email: string): Promise<{
  email: string;
  position: number | null;
  status: string;
  joined_at: string | null;
}> {
  return api.get(`/api/waitlist/position/${encodeURIComponent(email)}`, false);
}

/**
 * List waitlist entries (admin only).
 */
export async function listWaitlistEntries(
  page = 1,
  pageSize = 50,
  status?: string,
  search?: string,
  source?: string
): Promise<WaitlistListResponse> {
  const params = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  });
  if (status) params.append('status', status);
  if (search) params.append('search', search);
  if (source) params.append('source', source);
  return api.get<WaitlistListResponse>(`/api/admin/waitlist?${params}`);
}

/**
 * Get a specific waitlist entry (admin only).
 */
export async function getWaitlistEntry(entryId: string): Promise<WaitlistEntry> {
  return api.get<WaitlistEntry>(`/api/admin/waitlist/${entryId}`);
}

/**
 * Send invitation to a waitlist entry (admin only).
 */
export async function sendWaitlistInvitation(
  entryId: string,
  options?: {
    message?: string;
    gift_plan_id?: string;
    gift_months?: number;
    expires_in_days?: number;
  }
): Promise<SendWaitlistInviteResponse> {
  return api.post<SendWaitlistInviteResponse>(
    `/api/admin/waitlist/${entryId}/invite`,
    options ?? {}
  );
}

/**
 * Delete a waitlist entry (admin only).
 */
export async function deleteWaitlistEntry(entryId: string): Promise<{ message: string }> {
  return api.delete(`/api/admin/waitlist/${entryId}`);
}

/**
 * Bulk invite waitlist entries (admin only).
 */
export async function bulkInviteWaitlist(
  count = 10,
  options?: {
    message?: string;
    gift_plan_id?: string;
    gift_months?: number;
  }
): Promise<{ message: string; invited: number; skipped: number }> {
  const params = new URLSearchParams({ count: String(count) });
  if (options?.message) params.append('message', options.message);
  if (options?.gift_plan_id) params.append('gift_plan_id', options.gift_plan_id);
  if (options?.gift_months) params.append('gift_months', String(options.gift_months));
  return api.post(`/api/admin/waitlist/bulk-invite?${params}`, {});
}
