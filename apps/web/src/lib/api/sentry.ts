/**
 * Sentry API functions for the Sentry panel.
 *
 * Uses MCP tool execution to interact with the Sentry MCP server.
 */

import { enableMCPDefault, disableMCPDefault, listMCPServers, type MCPServer } from '@/lib/api';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

// ============================================================================
// Types
// ============================================================================

export interface SentryProject {
  id: string;
  slug: string;
  name: string;
  platform: string;
  organization?: {
    id: string;
    slug: string;
    name: string;
  };
}

export interface SentryIssue {
  id: string;
  shortId: string;
  title: string;
  culprit: string;
  permalink: string;
  level: 'fatal' | 'error' | 'warning' | 'info';
  status: 'resolved' | 'unresolved' | 'ignored';
  count: number;
  userCount: number;
  firstSeen: string;
  lastSeen: string;
  project: {
    id: string;
    slug: string;
    name: string;
  };
}

export interface SentryIssueDetail extends SentryIssue {
  metadata?: {
    type?: string;
    value?: string;
    filename?: string;
    function?: string;
  };
  annotations?: string[];
  assignedTo?: {
    type: string;
    id: string;
    name: string;
  };
}

interface MCPToolExecuteResponse {
  success: boolean;
  result: unknown;
  error?: string;
  is_error: boolean;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get auth headers for API requests
 */
function getAuthHeaders(): HeadersInit {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };

  // Get token from auth store (access state directly to avoid circular deps)
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Dynamic runtime access to avoid circular deps
  const { useAuthStore } = require('@/stores/auth');
  const tokens = useAuthStore.getState().tokens;
  if (tokens?.accessToken) {
    headers['Authorization'] = `Bearer ${tokens.accessToken}`;
  }

  return headers;
}

/**
 * Execute an MCP tool on the Sentry server
 */
async function executeSentryTool(
  toolName: string,
  args: Record<string, unknown> = {}
): Promise<MCPToolExecuteResponse> {
  const response = await fetch(`${API_BASE_URL}/api/mcp/servers/execute`, {
    method: 'POST',
    headers: getAuthHeaders(),
    credentials: 'include',
    body: JSON.stringify({
      server_name: 'Sentry',
      tool_name: toolName,
      arguments: args,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({
      detail: `HTTP ${response.status}: ${response.statusText}`,
    }));
    throw new Error(error.detail || `Failed to execute tool: ${toolName}`);
  }

  return response.json();
}

// ============================================================================
// Setup Functions
// ============================================================================

/**
 * Check if Sentry MCP server is configured and enabled
 */
export async function checkSentryConfigured(): Promise<{
  isConfigured: boolean;
  server: MCPServer | null;
}> {
  try {
    const servers = await listMCPServers();
    const sentryServer = servers.find((s) => s.source_slug === 'sentry' && s.is_enabled);
    return {
      isConfigured: !!sentryServer,
      server: sentryServer || null,
    };
  } catch {
    return { isConfigured: false, server: null };
  }
}

/**
 * Test if a Sentry auth token is valid by trying to connect
 */
export async function testSentryToken(token: string): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    // First enable the server temporarily to test
    const response = await fetch(`${API_BASE_URL}/api/mcp/defaults/sentry/test`, {
      method: 'POST',
      headers: getAuthHeaders(),
      credentials: 'include',
      body: JSON.stringify({
        env_vars: { SENTRY_AUTH_TOKEN: token },
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({
        detail: 'Failed to validate token',
      }));
      return { success: false, error: error.detail || 'Invalid token' };
    }

    const result = await response.json();
    return { success: result.success, error: result.error };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to validate token',
    };
  }
}

/**
 * Enable Sentry MCP server with the provided auth token
 */
export async function enableSentry(token: string): Promise<{
  success: boolean;
  server?: MCPServer;
  error?: string;
}> {
  try {
    const server = await enableMCPDefault('sentry', {
      SENTRY_AUTH_TOKEN: token,
    });
    return { success: true, server };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to enable Sentry',
    };
  }
}

/**
 * Disable/disconnect Sentry MCP server
 */
export async function disableSentry(): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    await disableMCPDefault('sentry');
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to disable Sentry',
    };
  }
}

// ============================================================================
// Data Functions
// ============================================================================

/**
 * Get list of Sentry projects
 */
export async function getSentryProjects(): Promise<SentryProject[]> {
  const response = await executeSentryTool('list_projects');

  if (!response.success || response.is_error) {
    throw new Error(response.error || 'Failed to fetch projects');
  }

  // Normalize the response - the Sentry MCP may return different formats
  const result = response.result as SentryProject[] | { projects: SentryProject[] };
  return Array.isArray(result) ? result : result.projects || [];
}

/**
 * Get list of Sentry issues for a project
 */
export async function getSentryIssues(
  projectSlug: string,
  options: {
    query?: string;
    status?: 'resolved' | 'unresolved' | 'ignored';
    limit?: number;
  } = {}
): Promise<SentryIssue[]> {
  const args: Record<string, unknown> = {
    project_slug: projectSlug,
  };

  if (options.query) {
    args.query = options.query;
  }
  if (options.status) {
    args.status = options.status;
  }
  if (options.limit) {
    args.limit = options.limit;
  }

  const response = await executeSentryTool('list_issues', args);

  if (!response.success || response.is_error) {
    throw new Error(response.error || 'Failed to fetch issues');
  }

  // Normalize the response
  const result = response.result as SentryIssue[] | { issues: SentryIssue[] };
  return Array.isArray(result) ? result : result.issues || [];
}

/**
 * Get details for a specific Sentry issue
 */
export async function getSentryIssueDetails(issueId: string): Promise<SentryIssueDetail> {
  const response = await executeSentryTool('get_issue', { issue_id: issueId });

  if (!response.success || response.is_error) {
    throw new Error(response.error || 'Failed to fetch issue details');
  }

  return response.result as SentryIssueDetail;
}

/**
 * Resolve a Sentry issue
 */
export async function resolveSentryIssue(issueId: string): Promise<void> {
  const response = await executeSentryTool('resolve_issue', { issue_id: issueId });

  if (!response.success || response.is_error) {
    throw new Error(response.error || 'Failed to resolve issue');
  }
}

/**
 * Ignore a Sentry issue
 */
export async function ignoreSentryIssue(issueId: string): Promise<void> {
  const response = await executeSentryTool('ignore_issue', { issue_id: issueId });

  if (!response.success || response.is_error) {
    throw new Error(response.error || 'Failed to ignore issue');
  }
}
