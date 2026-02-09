'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import {
  Search,
  X,
  Download,
  Check,
  Trash2,
  Power,
  PowerOff,
  Star,
  Box,
  AlertCircle,
  ExternalLink,
  Puzzle,
  Loader2,
  User,
  Briefcase,
  RefreshCw,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import {
  searchExtensions,
  getExtensionDetail,
  getInstalledExtensions,
  installExtension as installExtensionApi,
  uninstallExtension as uninstallExtensionApi,
  toggleExtension,
  formatDownloadCount,
  formatRating,
  createExtensionId,
  type OpenVSXExtension,
  type InstalledExtension,
  type ExtensionSearchParams,
} from '@/lib/api/extensions';
import { useSessionStore } from '@/stores/session';

// ============================================================================
// Types
// ============================================================================

type TabType = 'marketplace' | 'installed';
type SortType = 'relevance' | 'downloadCount' | 'rating' | 'timestamp';
type CategoryType =
  | 'all'
  | 'Programming Languages'
  | 'Themes'
  | 'Linters'
  | 'Formatters'
  | 'Debuggers'
  | 'Other';
type InstallScope = 'user' | 'workspace';

// ============================================================================
// Install Scope Dialog Component
// ============================================================================

interface InstallScopeDialogProps {
  extension: OpenVSXExtension;
  workspaceId?: string;
  onInstall: (scope: InstallScope) => void;
  onCancel: () => void;
  isInstalling: boolean;
}

function InstallScopeDialog({
  extension,
  workspaceId,
  onInstall,
  onCancel,
  isInstalling,
}: InstallScopeDialogProps) {
  const [scope, setScope] = useState<InstallScope>('user');

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onCancel}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="w-full max-w-md rounded-lg border border-border-default bg-elevated p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-text-primary">Install Extension</h2>
        <p className="mt-1 text-sm text-text-secondary">
          Choose where to install &quot;{extension.displayName || extension.name}&quot;
        </p>

        <div className="mt-4 space-y-3">
          {/* User Account Option */}
          <label
            className={cn(
              'flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors',
              scope === 'user'
                ? 'border-accent-primary bg-accent-primary/5'
                : 'border-border-default hover:border-border-subtle'
            )}
          >
            <input
              type="radio"
              name="scope"
              value="user"
              checked={scope === 'user'}
              onChange={() => setScope('user')}
              className="mt-1"
            />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-text-secondary" />
                <span className="font-medium text-text-primary">User Account</span>
              </div>
              <p className="mt-1 text-xs text-text-muted">
                Available in all your workspaces and sessions. Syncs across devices.
              </p>
            </div>
          </label>

          {/* Workspace Option */}
          <label
            className={cn(
              'flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors',
              !workspaceId && 'cursor-not-allowed opacity-50',
              scope === 'workspace'
                ? 'border-accent-primary bg-accent-primary/5'
                : 'border-border-default hover:border-border-subtle'
            )}
          >
            <input
              type="radio"
              name="scope"
              value="workspace"
              checked={scope === 'workspace'}
              onChange={() => setScope('workspace')}
              disabled={!workspaceId}
              className="mt-1"
            />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <Briefcase className="h-4 w-4 text-text-secondary" />
                <span className="font-medium text-text-primary">This Workspace Only</span>
              </div>
              <p className="mt-1 text-xs text-text-muted">
                {workspaceId
                  ? 'Only available in this workspace. Persists across pods.'
                  : 'No workspace selected. Open a workspace to use this option.'}
              </p>
            </div>
          </label>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onCancel}
            disabled={isInstalling}
            className="rounded-md border border-border-default px-4 py-2 text-sm text-text-secondary hover:bg-overlay disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => onInstall(scope)}
            disabled={isInstalling}
            className="flex items-center gap-2 rounded-md bg-accent-primary px-4 py-2 text-sm font-medium text-text-inverse hover:bg-accent-primary/90 disabled:opacity-50"
          >
            {isInstalling && <Loader2 className="h-4 w-4 animate-spin" />}
            Install
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ============================================================================
// Extension Card Component
// ============================================================================

interface ExtensionCardProps {
  extension: OpenVSXExtension;
  installedInfo?: InstalledExtension;
  onInstall: (extension: OpenVSXExtension) => void;
  onUninstall: (extensionId: string, scope: InstallScope, workspaceId?: string) => void;
  onToggle: (
    extensionId: string,
    enabled: boolean,
    scope: InstallScope,
    workspaceId?: string
  ) => void;
  onClick: () => void;
  isInstalling?: boolean;
  isToggling?: boolean;
}

function ExtensionCard({
  extension,
  installedInfo,
  onInstall,
  onUninstall,
  onToggle,
  onClick,
  isInstalling,
  isToggling,
}: ExtensionCardProps) {
  const isInstalled = !!installedInfo;
  const isEnabled = installedInfo?.enabled ?? false;

  return (
    <div
      className="group flex cursor-pointer gap-3 rounded-lg border border-border-subtle bg-surface p-4 transition-colors hover:border-border-default"
      onClick={onClick}
    >
      {/* Icon */}
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-overlay overflow-hidden">
        {extension.iconUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={extension.iconUrl}
            alt=""
            className="h-full w-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <Puzzle className="h-6 w-6 text-text-muted" />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-text-primary truncate">
            {extension.displayName || extension.name}
          </h3>
          {extension.verified && (
            <Check className="h-3.5 w-3.5 text-accent-success" aria-label="Verified publisher" />
          )}
          {installedInfo && (
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-[10px] font-medium',
                installedInfo.scope === 'workspace'
                  ? 'bg-accent-warning/10 text-accent-warning'
                  : 'bg-accent-primary/10 text-accent-primary'
              )}
            >
              {installedInfo.scope === 'workspace' ? 'Workspace' : 'User'}
            </span>
          )}
        </div>

        <p className="mt-0.5 text-xs text-text-secondary truncate">{extension.description}</p>

        <div className="mt-2 flex items-center gap-3 text-xs text-text-muted">
          <span>{extension.publisherDisplayName || extension.namespace}</span>
          {extension.averageRating !== null && (
            <span className="flex items-center gap-1">
              <Star className="h-3 w-3 text-accent-warning" />
              {formatRating(extension.averageRating)} ({formatDownloadCount(extension.reviewCount)})
            </span>
          )}
          <span className="flex items-center gap-1">
            <Download className="h-3 w-3" />
            {formatDownloadCount(extension.downloadCount)}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-2" onClick={(e) => e.stopPropagation()}>
        {!isInstalled ? (
          <button
            onClick={() => onInstall(extension)}
            disabled={isInstalling}
            className="flex items-center gap-1 rounded bg-accent-primary px-3 py-1.5 text-xs font-medium text-text-inverse hover:bg-accent-primary/90 disabled:opacity-50"
          >
            {isInstalling && <Loader2 className="h-3 w-3 animate-spin" />}
            Install
          </button>
        ) : (
          <>
            <button
              onClick={() => onToggle(installedInfo.extension_id, !isEnabled, installedInfo.scope)}
              disabled={isToggling}
              className={cn(
                'rounded p-1.5 text-text-muted hover:bg-overlay',
                isEnabled ? 'hover:text-text-secondary' : 'hover:text-accent-success'
              )}
              title={isEnabled ? 'Disable' : 'Enable'}
            >
              {isToggling ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : isEnabled ? (
                <PowerOff className="h-4 w-4" />
              ) : (
                <Power className="h-4 w-4" />
              )}
            </button>
            <button
              onClick={() => onUninstall(installedInfo.extension_id, installedInfo.scope)}
              className="rounded p-1.5 text-text-muted hover:bg-overlay hover:text-accent-error"
              title="Uninstall"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Extension Detail Panel
// ============================================================================

interface ExtensionDetailPanelProps {
  extension: OpenVSXExtension;
  installedInfo?: InstalledExtension;
  onClose: () => void;
  onInstall: (extension: OpenVSXExtension) => void;
  onUninstall: (extensionId: string, scope: InstallScope, workspaceId?: string) => void;
  onToggle: (
    extensionId: string,
    enabled: boolean,
    scope: InstallScope,
    workspaceId?: string
  ) => void;
  isInstalling?: boolean;
  isToggling?: boolean;
}

function ExtensionDetailPanel({
  extension,
  installedInfo,
  onClose,
  onInstall,
  onUninstall,
  onToggle,
  isInstalling,
  isToggling,
}: ExtensionDetailPanelProps) {
  const isInstalled = !!installedInfo;
  const isEnabled = installedInfo?.enabled ?? false;

  // Fetch detailed info with readme
  const { data: detail } = useQuery({
    queryKey: ['extension-detail', extension.namespace, extension.name],
    queryFn: () => getExtensionDetail(extension.namespace, extension.name),
    staleTime: 60 * 60 * 1000, // 1 hour
  });

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="flex h-full w-96 flex-col border-l border-border-default bg-elevated"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3 flex-shrink-0">
        <h2 className="text-sm font-medium text-text-primary">Extension Details</h2>
        <button
          onClick={onClose}
          className="rounded p-1 text-text-muted hover:bg-overlay hover:text-text-secondary"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {/* Hero */}
        <div className="p-6">
          <div className="flex items-start gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-overlay overflow-hidden">
              {extension.iconUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={extension.iconUrl}
                  alt=""
                  className="h-full w-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              ) : (
                <Puzzle className="h-8 w-8 text-text-muted" />
              )}
            </div>
            <div>
              <h3 className="text-lg font-semibold text-text-primary">
                {extension.displayName || extension.name}
              </h3>
              <p className="text-sm text-text-secondary">
                {extension.publisherDisplayName || extension.namespace}
                {extension.verified && (
                  <Check className="ml-1 inline h-4 w-4 text-accent-success" />
                )}
              </p>
              <p className="mt-1 text-xs text-text-muted">v{extension.version}</p>
            </div>
          </div>

          {/* Stats */}
          <div className="mt-4 flex gap-6 text-sm">
            <div>
              <div className="flex items-center gap-1 text-text-primary">
                <Star className="h-4 w-4 text-accent-warning" />
                {formatRating(extension.averageRating)}
              </div>
              <div className="text-xs text-text-muted">
                {extension.reviewCount.toLocaleString()} ratings
              </div>
            </div>
            <div>
              <div className="flex items-center gap-1 text-text-primary">
                <Download className="h-4 w-4" />
                {extension.downloadCount.toLocaleString()}
              </div>
              <div className="text-xs text-text-muted">downloads</div>
            </div>
          </div>

          {/* Actions */}
          <div className="mt-4 flex gap-2">
            {!isInstalled ? (
              <button
                onClick={() => onInstall(extension)}
                disabled={isInstalling}
                className="flex flex-1 items-center justify-center gap-2 rounded bg-accent-primary py-2 text-sm font-medium text-text-inverse hover:bg-accent-primary/90 disabled:opacity-50"
              >
                {isInstalling && <Loader2 className="h-4 w-4 animate-spin" />}
                Install
              </button>
            ) : (
              <>
                <button
                  onClick={() =>
                    onToggle(installedInfo.extension_id, !isEnabled, installedInfo.scope)
                  }
                  disabled={isToggling}
                  className={cn(
                    'flex flex-1 items-center justify-center gap-2 rounded border py-2 text-sm',
                    isEnabled
                      ? 'border-border-default text-text-secondary hover:bg-overlay'
                      : 'border-transparent bg-accent-primary font-medium text-text-inverse hover:bg-accent-primary/90'
                  )}
                >
                  {isToggling && <Loader2 className="h-4 w-4 animate-spin" />}
                  {isEnabled ? 'Disable' : 'Enable'}
                </button>
                <button
                  onClick={() => onUninstall(installedInfo.extension_id, installedInfo.scope)}
                  className="rounded border border-accent-error/50 px-4 py-2 text-sm text-accent-error hover:bg-accent-error/10"
                >
                  Uninstall
                </button>
              </>
            )}
          </div>
        </div>

        {/* Description */}
        <div className="border-t border-border-subtle px-6 py-4">
          <h4 className="mb-2 text-sm font-medium text-text-primary">Description</h4>
          <p className="text-sm text-text-secondary">{extension.description}</p>
        </div>

        {/* Categories & Tags */}
        {(extension.categories.length > 0 || extension.tags.length > 0) && (
          <div className="border-t border-border-subtle px-6 py-4">
            {extension.categories.length > 0 && (
              <>
                <h4 className="mb-2 text-sm font-medium text-text-primary">Categories</h4>
                <div className="flex flex-wrap gap-2 mb-3">
                  {extension.categories.map((cat) => (
                    <span
                      key={cat}
                      className="rounded-full bg-overlay px-3 py-1 text-xs text-text-secondary"
                    >
                      {cat}
                    </span>
                  ))}
                </div>
              </>
            )}
            {extension.tags.length > 0 && (
              <>
                <h4 className="mb-2 text-sm font-medium text-text-primary">Tags</h4>
                <div className="flex flex-wrap gap-2">
                  {extension.tags.slice(0, 10).map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-overlay px-3 py-1 text-xs text-text-muted"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* More Info */}
        <div className="border-t border-border-subtle px-6 py-4">
          <h4 className="mb-2 text-sm font-medium text-text-primary">More Info</h4>
          <div className="space-y-2 text-xs">
            {extension.timestamp && (
              <div className="flex justify-between">
                <span className="text-text-muted">Last updated</span>
                <span className="text-text-secondary">
                  {new Date(extension.timestamp).toLocaleDateString()}
                </span>
              </div>
            )}
            {extension.license && (
              <div className="flex justify-between">
                <span className="text-text-muted">License</span>
                <span className="text-text-secondary">{extension.license}</span>
              </div>
            )}
            {extension.repository && (
              <div className="flex justify-between">
                <span className="text-text-muted">Repository</span>
                <a
                  href={extension.repository}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-accent-primary hover:underline"
                >
                  GitHub <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}
          </div>
        </div>

        {/* README */}
        {detail?.readme && (
          <div className="border-t border-border-subtle px-6 py-4">
            <h4 className="mb-2 text-sm font-medium text-text-primary">README</h4>
            <div
              className="prose prose-sm prose-invert max-w-none text-text-secondary"
              dangerouslySetInnerHTML={{ __html: detail.readme }}
            />
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ============================================================================
// Main Marketplace Component
// ============================================================================

interface ExtensionMarketplaceProps {
  onClose?: () => void;
  className?: string;
  workspaceId?: string;
}

export function ExtensionMarketplace({
  onClose,
  className,
  workspaceId: propWorkspaceId,
}: ExtensionMarketplaceProps) {
  const queryClient = useQueryClient();
  const sessionWorkspaceId = useSessionStore((s) => {
    const session = s.currentSessionId ? s.sessions[s.currentSessionId] : null;
    return session?.workspaceId;
  });
  const workspaceId = propWorkspaceId || sessionWorkspaceId;

  const [tab, setTab] = useState<TabType>('marketplace');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortType>('relevance');
  const [categoryFilter, setCategoryFilter] = useState<CategoryType>('all');
  const [selectedExtension, setSelectedExtension] = useState<OpenVSXExtension | null>(null);
  const [installDialog, setInstallDialog] = useState<OpenVSXExtension | null>(null);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Search marketplace extensions
  const searchParams: ExtensionSearchParams = {
    query: debouncedQuery || undefined,
    category: categoryFilter !== 'all' ? categoryFilter : undefined,
    sortBy: sortBy,
    sortOrder: 'desc',
    size: 50,
  };

  const {
    data: marketplaceData,
    isLoading: isSearching,
    error: searchError,
    refetch: refetchMarketplace,
  } = useQuery({
    queryKey: ['extensions-search', searchParams],
    queryFn: () => searchExtensions(searchParams),
    enabled: tab === 'marketplace',
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Fetch installed extensions
  const {
    data: installedExtensions = [],
    isLoading: isLoadingInstalled,
    refetch: refetchInstalled,
  } = useQuery({
    queryKey: ['extensions-installed', workspaceId],
    queryFn: () => getInstalledExtensions(workspaceId),
    staleTime: 30 * 1000, // 30 seconds
  });

  // Create installed map for quick lookup
  const installedMap = useMemo(() => {
    const map = new Map<string, InstalledExtension>();
    installedExtensions.forEach((ext) => {
      const id = createExtensionId(ext.namespace, ext.name);
      map.set(id, ext);
    });
    return map;
  }, [installedExtensions]);

  // Install mutation
  const installMutation = useMutation({
    mutationFn: async ({
      extension,
      scope,
    }: {
      extension: OpenVSXExtension;
      scope: InstallScope;
    }) => {
      return installExtensionApi({
        extension_id: createExtensionId(extension.namespace, extension.name),
        version: extension.version,
        scope,
        workspace_id: scope === 'workspace' ? workspaceId : undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['extensions-installed'] });
      setInstallDialog(null);
    },
  });

  // Uninstall mutation
  const uninstallMutation = useMutation({
    mutationFn: async ({ extensionId, scope }: { extensionId: string; scope: InstallScope }) => {
      return uninstallExtensionApi(
        extensionId,
        scope,
        scope === 'workspace' ? workspaceId : undefined
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['extensions-installed'] });
      if (selectedExtension) {
        const id = createExtensionId(selectedExtension.namespace, selectedExtension.name);
        if (installedMap.get(id)?.extension_id === id) {
          setSelectedExtension(null);
        }
      }
    },
  });

  // Toggle mutation
  const toggleMutation = useMutation({
    mutationFn: async ({
      extensionId,
      enabled,
      scope,
    }: {
      extensionId: string;
      enabled: boolean;
      scope: InstallScope;
    }) => {
      return toggleExtension(
        extensionId,
        enabled,
        scope,
        scope === 'workspace' ? workspaceId : undefined
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['extensions-installed'] });
    },
  });

  // Handlers
  const handleInstallClick = useCallback((extension: OpenVSXExtension) => {
    setInstallDialog(extension);
  }, []);

  const handleInstall = useCallback(
    (scope: InstallScope) => {
      if (installDialog) {
        installMutation.mutate({ extension: installDialog, scope });
      }
    },
    [installDialog, installMutation]
  );

  const handleUninstall = useCallback(
    (extensionId: string, scope: InstallScope) => {
      uninstallMutation.mutate({ extensionId, scope });
    },
    [uninstallMutation]
  );

  const handleToggle = useCallback(
    (extensionId: string, enabled: boolean, scope: InstallScope) => {
      toggleMutation.mutate({ extensionId, enabled, scope });
    },
    [toggleMutation]
  );

  // Get extensions to display
  const displayExtensions = useMemo(() => {
    if (tab === 'installed') {
      // Convert installed extensions to OpenVSXExtension format for display
      return installedExtensions.map(
        (installed): OpenVSXExtension => ({
          namespace: installed.namespace,
          name: installed.name,
          displayName: installed.display_name,
          version: installed.version,
          description: null,
          publisherDisplayName: installed.publisher,
          verified: false,
          downloadCount: 0,
          averageRating: null,
          reviewCount: 0,
          timestamp: installed.installed_at,
          preview: false,
          categories: [],
          tags: [],
          iconUrl: installed.icon_url,
          repository: null,
          license: null,
        })
      );
    }
    return marketplaceData?.extensions ?? [];
  }, [tab, installedExtensions, marketplaceData]);

  // Filter installed extensions by search
  const filteredExtensions = useMemo(() => {
    if (!searchQuery || tab === 'marketplace') return displayExtensions;

    const query = searchQuery.toLowerCase();
    return displayExtensions.filter(
      (ext) =>
        (ext.displayName || ext.name).toLowerCase().includes(query) ||
        (ext.description || '').toLowerCase().includes(query) ||
        ext.namespace.toLowerCase().includes(query)
    );
  }, [displayExtensions, searchQuery, tab]);

  const categories: { value: CategoryType; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'Programming Languages', label: 'Languages' },
    { value: 'Themes', label: 'Themes' },
    { value: 'Linters', label: 'Linters' },
    { value: 'Formatters', label: 'Formatters' },
    { value: 'Debuggers', label: 'Debuggers' },
    { value: 'Other', label: 'Other' },
  ];

  const isLoading = tab === 'marketplace' ? isSearching : isLoadingInstalled;

  return (
    <>
      <div className={cn('flex h-full bg-elevated min-h-0', className)}>
        {/* Main Panel */}
        <div className="flex flex-1 flex-col min-w-0 min-h-0">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border-default px-4 py-3 flex-shrink-0">
            <div className="flex items-center gap-2">
              <Box className="h-5 w-5 text-accent-primary" />
              <h1 className="text-sm font-medium text-text-primary">Extensions</h1>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  refetchMarketplace();
                  refetchInstalled();
                }}
                className="rounded p-1 text-text-muted hover:bg-overlay hover:text-text-secondary"
                title="Refresh"
              >
                <RefreshCw className="h-4 w-4" />
              </button>
              {onClose && (
                <button
                  onClick={onClose}
                  className="rounded p-1 text-text-muted hover:bg-overlay hover:text-text-secondary"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-border-subtle px-4 flex-shrink-0">
            <button
              onClick={() => setTab('marketplace')}
              className={cn(
                'border-b-2 px-4 py-2 text-sm',
                tab === 'marketplace'
                  ? 'border-accent-primary text-accent-primary'
                  : 'border-transparent text-text-muted hover:text-text-secondary'
              )}
            >
              Marketplace
            </button>
            <button
              onClick={() => setTab('installed')}
              className={cn(
                'border-b-2 px-4 py-2 text-sm',
                tab === 'installed'
                  ? 'border-accent-primary text-accent-primary'
                  : 'border-transparent text-text-muted hover:text-text-secondary'
              )}
            >
              Installed ({installedExtensions.length})
            </button>
          </div>

          {/* Search and Filters */}
          <div className="space-y-2 border-b border-border-subtle p-4 flex-shrink-0">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search extensions..."
                className="w-full rounded-md border border-border-default bg-surface py-2 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-primary focus:outline-none"
              />
            </div>

            {/* Filters - only show for marketplace */}
            {tab === 'marketplace' && (
              <div className="flex items-center gap-2">
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value as CategoryType)}
                  className="rounded border border-border-default bg-surface px-2 py-1 text-xs text-text-secondary focus:outline-none"
                >
                  {categories.map((cat) => (
                    <option key={cat.value} value={cat.value}>
                      {cat.label}
                    </option>
                  ))}
                </select>

                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortType)}
                  className="rounded border border-border-default bg-surface px-2 py-1 text-xs text-text-secondary focus:outline-none"
                >
                  <option value="relevance">Relevance</option>
                  <option value="downloadCount">Most Downloads</option>
                  <option value="rating">Highest Rated</option>
                  <option value="timestamp">Recently Updated</option>
                </select>
              </div>
            )}
          </div>

          {/* Extension List */}
          <div className="flex-1 overflow-y-auto p-4 min-h-0">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-accent-primary" />
                <p className="mt-4 text-sm text-text-muted">Loading extensions...</p>
              </div>
            ) : searchError ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <AlertCircle className="h-12 w-12 text-accent-error" />
                <p className="mt-4 text-sm text-accent-error">Failed to load extensions</p>
                <button
                  onClick={() => refetchMarketplace()}
                  className="mt-2 text-sm text-accent-primary hover:underline"
                >
                  Try again
                </button>
              </div>
            ) : filteredExtensions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Box className="h-12 w-12 text-text-muted" />
                <p className="mt-4 text-sm text-text-muted">
                  {searchQuery
                    ? 'No extensions found matching your search'
                    : tab === 'installed'
                      ? 'No extensions installed yet'
                      : 'No extensions available'}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredExtensions.map((ext) => {
                  const extId = createExtensionId(ext.namespace, ext.name);
                  return (
                    <ExtensionCard
                      key={extId}
                      extension={ext}
                      installedInfo={installedMap.get(extId)}
                      onInstall={handleInstallClick}
                      onUninstall={handleUninstall}
                      onToggle={handleToggle}
                      onClick={() => setSelectedExtension(ext)}
                      isInstalling={
                        installMutation.isPending &&
                        installDialog?.namespace === ext.namespace &&
                        installDialog?.name === ext.name
                      }
                      isToggling={toggleMutation.isPending}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Detail Panel */}
        <AnimatePresence>
          {selectedExtension && (
            <div className="flex-shrink-0 min-h-0">
              <ExtensionDetailPanel
                extension={selectedExtension}
                installedInfo={installedMap.get(
                  createExtensionId(selectedExtension.namespace, selectedExtension.name)
                )}
                onClose={() => setSelectedExtension(null)}
                onInstall={handleInstallClick}
                onUninstall={handleUninstall}
                onToggle={handleToggle}
                isInstalling={installMutation.isPending}
                isToggling={toggleMutation.isPending}
              />
            </div>
          )}
        </AnimatePresence>
      </div>

      {/* Install Scope Dialog */}
      <AnimatePresence>
        {installDialog && (
          <InstallScopeDialog
            extension={installDialog}
            workspaceId={workspaceId}
            onInstall={handleInstall}
            onCancel={() => setInstallDialog(null)}
            isInstalling={installMutation.isPending}
          />
        )}
      </AnimatePresence>
    </>
  );
}

// ============================================================================
// Extension Icon Button (for sidebar)
// ============================================================================

interface ExtensionIconButtonProps {
  onClick: () => void;
  className?: string;
  workspaceId?: string;
}

export function ExtensionIconButton({ onClick, className, workspaceId }: ExtensionIconButtonProps) {
  const { data: extensions = [] } = useQuery({
    queryKey: ['extensions-installed', workspaceId],
    queryFn: () => getInstalledExtensions(workspaceId),
    staleTime: 30 * 1000,
  });

  const activeCount = extensions.filter((e) => e.enabled).length;

  return (
    <button
      onClick={onClick}
      className={cn(
        'relative flex h-10 w-10 items-center justify-center rounded-lg text-text-muted hover:bg-overlay hover:text-text-secondary',
        className
      )}
      title="Extensions"
    >
      <Box className="h-5 w-5" />
      {activeCount > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-accent-primary text-[10px] font-medium text-text-inverse">
          {activeCount}
        </span>
      )}
    </button>
  );
}
