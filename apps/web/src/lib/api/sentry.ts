/**
 * Sentry API functions for the Sentry panel.
 *
 * Uses MCP tool execution to interact with the Sentry MCP server.
 */

import {
  enableMCPDefault,
  disableMCPDefault,
  listMCPServers,
  testMCPDefault,
  type MCPServer,
} from '@/lib/api';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

// ============================================================================
// Types
// ============================================================================

export interface SentryOrganization {
  slug: string;
  name: string;
  regionUrl?: string;
}

export interface SentryProject {
  id: string;
  slug: string;
  name: string;
  platform: string;
  organizationSlug: string;
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
export async function testSentryToken(
  token: string,
  host?: string
): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const envVars: Record<string, string> = { SENTRY_ACCESS_TOKEN: token };
    if (host) {
      envVars.SENTRY_HOST = host;
    }
    const result = await testMCPDefault('sentry', envVars);
    return { success: result.success, error: result.error };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to validate token',
    };
  }
}

/**
 * Enable Sentry MCP server with the provided auth token and optional host/OpenAI key
 */
export async function enableSentry(
  token: string,
  host?: string,
  openAIKey?: string
): Promise<{
  success: boolean;
  server?: MCPServer;
  error?: string;
}> {
  try {
    const envVars: Record<string, string> = {
      SENTRY_ACCESS_TOKEN: token,
    };

    // Add host for non-default regions (e.g., de.sentry.io for EU)
    if (host) {
      envVars.SENTRY_HOST = host;
    }

    // Add OpenAI key for AI-powered search tools (search_issues, search_events)
    if (openAIKey) {
      envVars.OPENAI_API_KEY = openAIKey;
    }

    const server = await enableMCPDefault('sentry', envVars);
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
 * Parse the markdown response from Sentry MCP tools.
 * The MCP returns markdown-formatted text, we need to extract structured data.
 */
function parseMarkdownResponse(text: string): string[] {
  // Extract lines that start with "- **" (project/org slugs)
  const matches = text.match(/- \*\*([^*]+)\*\*/g) || [];
  return matches.map((m) => m.replace(/- \*\*([^*]+)\*\*/, '$1').trim());
}

/**
 * Get list of Sentry organizations the user has access to.
 * This is required before fetching projects.
 */
export async function getSentryOrganizations(): Promise<SentryOrganization[]> {
  const response = await executeSentryTool('find_organizations', {});

  if (!response.success || response.is_error) {
    throw new Error(response.error || 'Failed to fetch organizations');
  }

  // The response is markdown text, parse it to extract org slugs
  const text = response.result as string;
  const organizations: SentryOrganization[] = [];

  // Parse markdown sections. Format from Sentry MCP:
  // ## **org-slug**
  //
  // **Web URL:** https://...
  // **Region URL:** https://...
  //
  // ## **another-org**
  // ...

  // Split by organization headers (## **slug**)
  const orgBlocks = text.split(/## \*\*/).slice(1);

  for (const block of orgBlocks) {
    // Extract slug from the beginning of the block (ends with **)
    const slugMatch = block.match(/^([^*]+)\*\*/);
    if (!slugMatch || !slugMatch[1]) continue;

    const slug = slugMatch[1].trim();

    // Extract Region URL (we use this for API calls)
    const regionUrlMatch = block.match(/\*\*Region URL:\*\*\s*([^\n]+)/);
    const regionUrl = regionUrlMatch?.[1]?.trim() || undefined;

    if (slug) {
      organizations.push({
        slug,
        name: slug, // Use slug as name since we don't have separate name
        regionUrl: regionUrl && regionUrl !== '' ? regionUrl : undefined,
      });
    }
  }

  return organizations;
}

/**
 * Get list of Sentry projects for an organization.
 * Requires organizationSlug from getSentryOrganizations().
 */
export async function getSentryProjects(
  organizationSlug: string,
  regionUrl?: string
): Promise<SentryProject[]> {
  const args: Record<string, unknown> = {
    organizationSlug,
  };

  // Pass regionUrl for cloud Sentry (sentry.io) deployments
  if (regionUrl) {
    args.regionUrl = regionUrl;
  }

  const response = await executeSentryTool('find_projects', args);

  if (!response.success || response.is_error) {
    throw new Error(response.error || 'Failed to fetch projects');
  }

  // The response is markdown text, parse it to extract project slugs
  // Format: - **project-slug**
  const text = response.result as string;
  const slugs = parseMarkdownResponse(text);

  return slugs.map((slug) => ({
    id: `${organizationSlug}-${slug}`,
    slug,
    name: slug,
    platform: 'unknown',
    organizationSlug,
  }));
}

/**
 * Get list of Sentry issues for an organization (optionally filtered by project).
 * Uses search_issues tool with natural language queries.
 */
export async function getSentryIssues(
  organizationSlug: string,
  options: {
    projectSlug?: string;
    query?: string;
    status?: 'resolved' | 'unresolved' | 'ignored';
    limit?: number;
    sort?: 'date' | 'freq' | 'new' | 'user';
    regionUrl?: string;
  } = {}
): Promise<SentryIssue[]> {
  // Build natural language query for search_issues
  let naturalLanguageQuery = '';

  // Handle status filter
  if (options.status === 'resolved') {
    naturalLanguageQuery = 'resolved issues';
  } else if (options.status === 'ignored') {
    naturalLanguageQuery = 'ignored issues';
  } else {
    naturalLanguageQuery = 'unresolved issues';
  }

  // Add custom query if provided
  if (options.query) {
    naturalLanguageQuery = `${options.query} ${naturalLanguageQuery}`;
  }

  const args: Record<string, unknown> = {
    organizationSlug,
    naturalLanguageQuery,
    limit: options.limit || 25,
  };

  if (options.projectSlug) {
    args.projectSlugOrId = options.projectSlug;
  }

  // Pass regionUrl for cloud Sentry (sentry.io) deployments
  if (options.regionUrl) {
    args.regionUrl = options.regionUrl;
  }

  const response = await executeSentryTool('search_issues', args);

  if (!response.success || response.is_error) {
    const errorMsg =
      response.error ||
      (typeof response.result === 'string' ? response.result : 'Failed to fetch issues');
    console.error('[Sentry] search_issues error:', errorMsg);
    throw new Error(errorMsg);
  }

  // Parse the markdown response to extract issues
  const text = response.result as string;
  const issues = parseIssuesFromMarkdown(text, organizationSlug);
  return issues;
}

/**
 * Parse issues from the list_issues markdown response.
 * Format from Sentry MCP list_issues:
 * ## 1. [ISSUE-ID](url)
 *
 * **Issue Title**
 *
 * - **Status**: unresolved
 * - **Users**: 5
 * - **Events**: 42
 * - **First seen**: 2 days ago
 * - **Last seen**: 3 hours ago
 * - **Culprit**: `path/to/file.ts`
 */
function parseIssuesFromMarkdown(text: string, _organizationSlug: string): SentryIssue[] {
  const issues: SentryIssue[] = [];

  // Split by issue headers: ## 1. [ISSUE-ID](url) or ## 2. [ISSUE-ID](url)
  const issueBlocks = text.split(/## \d+\. /).slice(1);

  for (const block of issueBlocks) {
    // Parse: [ISSUE-ID](url)\n\n**Title**
    const headerMatch = block.match(/^\[([^\]]+)\]\(([^)]+)\)\s*\n+\*\*([^*]+)\*\*/);
    if (!headerMatch || !headerMatch[1] || !headerMatch[2] || !headerMatch[3]) continue;

    const shortId = headerMatch[1].trim();
    const permalink = headerMatch[2].trim();
    const title = headerMatch[3].trim();

    // Parse metadata lines
    const statusMatch = block.match(/\*\*Status\*\*:\s*(\w+)/i);
    const eventsMatch = block.match(/\*\*Events\*\*:\s*([\d,]+)/i);
    const usersMatch = block.match(/\*\*Users\*\*:\s*([\d,]+)/i);
    const culpritMatch = block.match(/\*\*Culprit\*\*:\s*`?([^`\n]+)`?/i);
    const firstSeenMatch = block.match(/\*\*First seen\*\*:\s*([^\n]+)/i);
    const lastSeenMatch = block.match(/\*\*Last seen\*\*:\s*([^\n]+)/i);
    const categoryMatch = block.match(/\*\*Category\*\*:\s*(\w+)/i);

    // Extract project slug from the issue ID (e.g., "PROJECT-123" -> "project")
    const projectSlug = shortId.split('-')[0]?.toLowerCase() || 'unknown';

    issues.push({
      id: shortId,
      shortId,
      title,
      culprit: culpritMatch?.[1]?.trim() || '',
      permalink,
      level: (categoryMatch?.[1]?.toLowerCase() || 'error') as SentryIssue['level'],
      status: (statusMatch?.[1]?.toLowerCase() || 'unresolved') as SentryIssue['status'],
      count: parseInt((eventsMatch?.[1] || '0').replace(/,/g, ''), 10),
      userCount: parseInt((usersMatch?.[1] || '0').replace(/,/g, ''), 10),
      firstSeen: firstSeenMatch?.[1]?.trim() || new Date().toISOString(),
      lastSeen: lastSeenMatch?.[1]?.trim() || new Date().toISOString(),
      project: {
        id: projectSlug,
        slug: projectSlug,
        name: projectSlug,
      },
    });
  }

  return issues;
}

/**
 * Get details for a specific Sentry issue
 */
export async function getSentryIssueDetails(
  organizationSlug: string,
  issueId: string
): Promise<SentryIssueDetail> {
  const response = await executeSentryTool('get_issue_details', {
    organizationSlug,
    issueId,
  });

  if (!response.success || response.is_error) {
    throw new Error(response.error || 'Failed to fetch issue details');
  }

  // The response is detailed markdown, return it as-is for now
  // The UI can display the markdown or parse it further
  const text = response.result as string;

  // Extract basic info from the markdown
  const titleMatch = text.match(/# Issue: (.+?)(?:\n|$)/);
  const shortIdMatch = text.match(/\*\*ID:\*\*\s*([^\n]+)/);

  return {
    id: issueId,
    shortId: shortIdMatch?.[1]?.trim() || issueId,
    title: titleMatch?.[1]?.trim() || 'Unknown Issue',
    culprit: 'Unknown',
    permalink: `https://sentry.io/organizations/${organizationSlug}/issues/${issueId}/`,
    level: 'error',
    status: 'unresolved',
    count: 0,
    userCount: 0,
    firstSeen: new Date().toISOString(),
    lastSeen: new Date().toISOString(),
    project: { id: 'unknown', slug: 'unknown', name: 'Unknown' },
  };
}

/**
 * Update a Sentry issue (resolve, ignore, or assign)
 */
export async function updateSentryIssue(
  organizationSlug: string,
  issueId: string,
  updates: {
    status?: 'resolved' | 'unresolved' | 'ignored' | 'resolvedInNextRelease';
    assignedTo?: string;
  }
): Promise<void> {
  const args: Record<string, unknown> = {
    organizationSlug,
    issueId,
  };

  if (updates.status) {
    args.status = updates.status;
  }
  if (updates.assignedTo) {
    args.assignedTo = updates.assignedTo;
  }

  const response = await executeSentryTool('update_issue', args);

  if (!response.success || response.is_error) {
    throw new Error(response.error || 'Failed to update issue');
  }
}

/**
 * Resolve a Sentry issue
 */
export async function resolveSentryIssue(organizationSlug: string, issueId: string): Promise<void> {
  return updateSentryIssue(organizationSlug, issueId, { status: 'resolved' });
}

/**
 * Ignore a Sentry issue
 */
export async function ignoreSentryIssue(organizationSlug: string, issueId: string): Promise<void> {
  return updateSentryIssue(organizationSlug, issueId, { status: 'ignored' });
}

/**
 * Get the authenticated Sentry user info
 */
export async function getSentryUser(): Promise<{ id: string; name: string; email: string }> {
  const response = await executeSentryTool('whoami', {});

  if (!response.success || response.is_error) {
    throw new Error(response.error || 'Failed to get user info');
  }

  const text = response.result as string;
  const nameMatch = text.match(/\*\*Name:\*\*\s*(.+?)(?:\n|$)/);
  const emailMatch = text.match(/\*\*Email:\*\*\s*(.+?)(?:\n|$)/);
  const idMatch = text.match(/\*\*ID:\*\*\s*(\d+)/);

  return {
    id: idMatch?.[1] || 'unknown',
    name: nameMatch?.[1]?.trim() || 'Unknown User',
    email: emailMatch?.[1]?.trim() || '',
  };
}

/**
 * Analyze a Sentry issue using Seer AI.
 * Returns root cause analysis and code fix recommendations.
 */
export async function analyzeIssueWithSeer(
  organizationSlug: string,
  issueId: string,
  options: {
    regionUrl?: string;
    instruction?: string;
  } = {}
): Promise<string> {
  const args: Record<string, unknown> = {
    organizationSlug,
    issueId,
  };

  if (options.regionUrl) {
    args.regionUrl = options.regionUrl;
  }

  if (options.instruction) {
    args.instruction = options.instruction;
  }

  const response = await executeSentryTool('analyze_issue_with_seer', args);

  if (!response.success || response.is_error) {
    const errorMsg =
      response.error ||
      (typeof response.result === 'string' ? response.result : 'Failed to analyze issue');
    console.error('[Sentry] analyze_issue_with_seer error:', errorMsg);
    throw new Error(errorMsg);
  }

  // Return the markdown analysis result
  return response.result as string;
}

/**
 * Test a Sentry token directly against the Sentry API.
 * This bypasses the MCP and tests the token at various endpoints.
 * Useful for debugging regional token issues.
 */
export async function testSentryTokenDirect(
  token: string,
  host: string = 'sentry.io'
): Promise<{ endpoint: string; status: number; body: string }[]> {
  const results: { endpoint: string; status: number; body: string }[] = [];
  const endpoints = [`/api/0/users/me/`, `/api/0/users/me/regions/`, `/api/0/organizations/`];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(`https://${host}${endpoint}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const text = await response.text();
      results.push({
        endpoint: `${host}${endpoint}`,
        status: response.status,
        body: text.substring(0, 500),
      });
    } catch (err) {
      results.push({
        endpoint: `${host}${endpoint}`,
        status: 0,
        body: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  return results;
}

/**
 * Refresh the Sentry MCP server to rediscover tools.
 * This is needed if tools weren't discovered during initial enable.
 */
export async function refreshSentryServer(): Promise<void> {
  // Get the Sentry server ID
  const servers = await listMCPServers();
  const sentryServer = servers.find((s) => s.source_slug === 'sentry' && s.is_enabled);

  if (!sentryServer) {
    throw new Error('Sentry server not found or not enabled');
  }

  const response = await fetch(`${API_BASE_URL}/api/mcp/servers/${sentryServer.id}/refresh`, {
    method: 'POST',
    headers: getAuthHeaders(),
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({
      detail: `HTTP ${response.status}: ${response.statusText}`,
    }));
    throw new Error(error.detail || 'Failed to refresh Sentry server');
  }
}
