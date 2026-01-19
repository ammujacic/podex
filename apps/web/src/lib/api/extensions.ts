/**
 * Extensions API client for Open VSX marketplace integration.
 */

import { api, requestCache } from '@/lib/api';

// =============================================================================
// Types
// =============================================================================

export interface OpenVSXExtension {
  namespace: string;
  name: string;
  displayName: string | null;
  version: string;
  description: string | null;
  publisherDisplayName: string | null;
  verified: boolean;
  downloadCount: number;
  averageRating: number | null;
  reviewCount: number;
  timestamp: string | null;
  preview: boolean;
  categories: string[];
  tags: string[];
  iconUrl: string | null;
  repository: string | null;
  license: string | null;
}

export interface ExtensionSearchResult {
  extensions: OpenVSXExtension[];
  totalSize: number;
  offset: number;
}

export interface ExtensionDetail {
  namespace: string;
  name: string;
  displayName: string | null;
  version: string;
  description: string | null;
  publisherDisplayName: string | null;
  verified: boolean;
  downloadCount: number;
  averageRating: number | null;
  reviewCount: number;
  categories: string[];
  tags: string[];
  iconUrl: string | null;
  repository: string | null;
  license: string | null;
  readme: string | null;
  changelog: string | null;
  downloadUrl: string | null;
  manifest: Record<string, unknown> | null;
}

export interface InstalledExtension {
  id: string;
  extension_id: string;
  namespace: string;
  name: string;
  display_name: string;
  version: string;
  enabled: boolean;
  scope: 'user' | 'workspace';
  icon_url: string | null;
  publisher: string | null;
  settings: Record<string, unknown> | null;
  installed_at: string;
}

export interface InstallExtensionRequest {
  extension_id: string;
  version?: string;
  scope: 'user' | 'workspace';
  workspace_id?: string;
}

export interface ExtensionSearchParams {
  query?: string;
  category?: string;
  sortBy?: 'relevance' | 'rating' | 'downloadCount' | 'timestamp';
  sortOrder?: 'asc' | 'desc';
  size?: number;
  offset?: number;
}

// =============================================================================
// Marketplace API
// =============================================================================

/**
 * Search extensions in the Open VSX marketplace.
 */
export async function searchExtensions(
  params: ExtensionSearchParams = {}
): Promise<ExtensionSearchResult> {
  const searchParams = new URLSearchParams();

  if (params.query) searchParams.set('query', params.query);
  if (params.category) searchParams.set('category', params.category);
  if (params.sortBy) searchParams.set('sort_by', params.sortBy);
  if (params.sortOrder) searchParams.set('sort_order', params.sortOrder);
  if (params.size) searchParams.set('size', params.size.toString());
  if (params.offset) searchParams.set('offset', params.offset.toString());

  const queryString = searchParams.toString();
  const cacheKey = `extensions:search:${queryString}`;

  // Check cache first
  const cached = requestCache.get<ExtensionSearchResult>(cacheKey);
  if (cached) return cached;

  const result = await api.get<ExtensionSearchResult>(
    `/api/extensions/marketplace/search${queryString ? `?${queryString}` : ''}`
  );

  // Cache for 5 minutes
  requestCache.set(cacheKey, result, 5 * 60 * 1000);

  return result;
}

/**
 * Get detailed information about an extension.
 */
export async function getExtensionDetail(
  namespace: string,
  name: string,
  version?: string
): Promise<ExtensionDetail> {
  const cacheKey = `extensions:detail:${namespace}:${name}:${version || 'latest'}`;

  // Check cache first
  const cached = requestCache.get<ExtensionDetail>(cacheKey);
  if (cached) return cached;

  const params = version ? `?version=${version}` : '';
  const result = await api.get<ExtensionDetail>(
    `/api/extensions/marketplace/${namespace}/${name}${params}`
  );

  // Cache for 1 hour
  requestCache.set(cacheKey, result, 60 * 60 * 1000);

  return result;
}

/**
 * Get the download URL for an extension VSIX file.
 */
export async function getExtensionDownloadUrl(
  namespace: string,
  name: string,
  version?: string
): Promise<{ download_url: string; version: string }> {
  const params = version ? `?version=${version}` : '';
  return api.get(`/api/extensions/marketplace/${namespace}/${name}/download${params}`);
}

// =============================================================================
// Installed Extensions API
// =============================================================================

/**
 * Get all installed extensions for the current user.
 */
export async function getInstalledExtensions(workspaceId?: string): Promise<InstalledExtension[]> {
  const params = workspaceId ? `?workspace_id=${workspaceId}` : '';
  return api.get<InstalledExtension[]>(`/api/extensions/installed${params}`);
}

/**
 * Install an extension.
 */
export async function installExtension(
  request: InstallExtensionRequest
): Promise<InstalledExtension> {
  const result = await api.post<InstalledExtension>('/api/extensions/install', request);

  // Invalidate installed extensions cache
  requestCache.invalidatePattern(/^extensions:installed/);

  return result;
}

/**
 * Uninstall an extension.
 */
export async function uninstallExtension(
  extensionId: string,
  scope: 'user' | 'workspace' = 'user',
  workspaceId?: string
): Promise<{ status: string; extension_id: string }> {
  const params = new URLSearchParams({ scope });
  if (workspaceId) params.set('workspace_id', workspaceId);

  const result = await api.delete<{ status: string; extension_id: string }>(
    `/api/extensions/${encodeURIComponent(extensionId)}?${params}`
  );

  // Invalidate installed extensions cache
  requestCache.invalidatePattern(/^extensions:installed/);

  return result;
}

/**
 * Enable or disable an extension.
 */
export async function toggleExtension(
  extensionId: string,
  enabled: boolean,
  scope: 'user' | 'workspace' = 'user',
  workspaceId?: string
): Promise<InstalledExtension> {
  const params = new URLSearchParams({
    enabled: enabled.toString(),
    scope,
  });
  if (workspaceId) params.set('workspace_id', workspaceId);

  const result = await api.patch<InstalledExtension>(
    `/api/extensions/${encodeURIComponent(extensionId)}/toggle?${params}`,
    {}
  );

  // Invalidate installed extensions cache
  requestCache.invalidatePattern(/^extensions:installed/);

  return result;
}

/**
 * Update extension settings.
 */
export async function updateExtensionSettings(
  extensionId: string,
  settings: Record<string, unknown>,
  scope: 'user' | 'workspace' = 'user',
  workspaceId?: string
): Promise<InstalledExtension> {
  const params = new URLSearchParams({ scope });
  if (workspaceId) params.set('workspace_id', workspaceId);

  const result = await api.patch<InstalledExtension>(
    `/api/extensions/${encodeURIComponent(extensionId)}/settings?${params}`,
    { settings }
  );

  // Invalidate installed extensions cache
  requestCache.invalidatePattern(/^extensions:installed/);

  return result;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Parse an extension ID into namespace and name.
 */
export function parseExtensionId(extensionId: string): { namespace: string; name: string } {
  const parts = extensionId.split('.');
  const namespace = parts[0] ?? '';
  const name = parts.slice(1).join('.');
  return { namespace, name };
}

/**
 * Create an extension ID from namespace and name.
 */
export function createExtensionId(namespace: string, name: string): string {
  return `${namespace}.${name}`;
}

/**
 * Get a display-friendly name for an extension.
 */
export function getExtensionDisplayName(extension: OpenVSXExtension | InstalledExtension): string {
  if ('displayName' in extension && extension.displayName) {
    return extension.displayName;
  }
  if ('display_name' in extension && extension.display_name) {
    return extension.display_name;
  }
  return extension.name;
}

/**
 * Format download count for display.
 */
export function formatDownloadCount(count: number): string {
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K`;
  }
  return count.toString();
}

/**
 * Format rating for display.
 */
export function formatRating(rating: number | null): string {
  if (rating === null) return 'No ratings';
  return rating.toFixed(1);
}
