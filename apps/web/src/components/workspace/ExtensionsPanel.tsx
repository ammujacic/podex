'use client';

import { useState, useMemo } from 'react';
import {
  Box,
  Search,
  Power,
  PowerOff,
  Trash2,
  Settings,
  ExternalLink,
  Check,
  Puzzle,
  Loader2,
  RefreshCw,
  User,
  Briefcase,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import {
  getInstalledExtensions,
  uninstallExtension,
  toggleExtension,
  type InstalledExtension,
} from '@/lib/api/extensions';
import { useUIStore } from '@/stores/ui';
import { useExtensionSync } from '@/hooks/useExtensionSync';
import { useSessionStore } from '@/stores/session';

interface ExtensionsPanelProps {
  sessionId: string;
  workspaceId?: string;
  authToken?: string;
}

function CompactExtensionCard({
  extension,
  onToggle,
  onUninstall,
  isToggling,
}: {
  extension: InstalledExtension;
  onToggle: () => void;
  onUninstall: () => void;
  isToggling?: boolean;
}) {
  const isEnabled = extension.enabled;

  return (
    <div
      className={cn(
        'flex items-center gap-2 px-2 py-1.5 rounded transition-colors group',
        isEnabled ? 'bg-accent-primary/10' : 'hover:bg-overlay'
      )}
    >
      {/* Icon */}
      <div className="w-5 h-5 flex items-center justify-center text-sm flex-shrink-0 rounded overflow-hidden bg-overlay">
        {extension.icon_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={extension.icon_url}
            alt=""
            className="w-full h-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <Puzzle className="h-3 w-3 text-text-muted" />
        )}
      </div>

      {/* Name */}
      <span className="flex-1 text-xs text-text-primary truncate">{extension.display_name}</span>

      {/* Scope indicator */}
      <span
        className={cn(
          'flex-shrink-0 px-1 py-0.5 rounded text-[9px] font-medium',
          extension.scope === 'workspace'
            ? 'bg-accent-warning/10 text-accent-warning'
            : 'bg-accent-primary/10 text-accent-primary'
        )}
        title={extension.scope === 'workspace' ? 'Workspace extension' : 'User extension'}
      >
        {extension.scope === 'workspace' ? (
          <Briefcase className="h-2.5 w-2.5" />
        ) : (
          <User className="h-2.5 w-2.5" />
        )}
      </span>

      {/* Actions (visible on hover) */}
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          disabled={isToggling}
          className={cn(
            'p-0.5 rounded text-text-muted',
            isEnabled ? 'hover:text-accent-warning' : 'hover:text-accent-success'
          )}
          title={isEnabled ? 'Disable' : 'Enable'}
        >
          {isToggling ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : isEnabled ? (
            <PowerOff className="h-3 w-3" />
          ) : (
            <Power className="h-3 w-3" />
          )}
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onUninstall();
          }}
          className="p-0.5 rounded text-text-muted hover:text-accent-error"
          title="Uninstall"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>

      {/* Status dot */}
      <div
        className={cn(
          'w-1.5 h-1.5 rounded-full flex-shrink-0',
          isEnabled ? 'bg-accent-success' : 'bg-text-muted'
        )}
      />
    </div>
  );
}

export function ExtensionsPanel({
  sessionId: _sessionId,
  workspaceId: propWorkspaceId,
  authToken,
}: ExtensionsPanelProps) {
  const queryClient = useQueryClient();
  const sessionWorkspaceId = useSessionStore((s) => {
    const session = s.currentSessionId ? s.sessions[s.currentSessionId] : null;
    return session?.workspaceId;
  });
  const workspaceId = propWorkspaceId || sessionWorkspaceId;

  const { openModal } = useUIStore();
  const [searchQuery, setSearchQuery] = useState('');

  // Enable extension sync via WebSocket
  useExtensionSync({
    authToken,
    enabled: !!authToken,
    workspaceId,
    showNotifications: false, // Don't show toasts in the panel
  });

  // Fetch installed extensions
  const {
    data: extensions = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['extensions-installed', workspaceId],
    queryFn: () => getInstalledExtensions(workspaceId),
    staleTime: 30 * 1000,
  });

  // Toggle mutation
  const toggleMutation = useMutation({
    mutationFn: async ({ ext }: { ext: InstalledExtension }) => {
      return toggleExtension(
        ext.extension_id,
        !ext.enabled,
        ext.scope,
        ext.scope === 'workspace' ? workspaceId : undefined
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['extensions-installed'] });
    },
  });

  // Uninstall mutation
  const uninstallMutation = useMutation({
    mutationFn: async ({ ext }: { ext: InstalledExtension }) => {
      return uninstallExtension(
        ext.extension_id,
        ext.scope,
        ext.scope === 'workspace' ? workspaceId : undefined
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['extensions-installed'] });
    },
  });

  // Filter extensions by search
  const filteredExtensions = useMemo(() => {
    if (!searchQuery) return extensions;
    const query = searchQuery.toLowerCase();
    return extensions.filter(
      (ext) =>
        ext.display_name.toLowerCase().includes(query) ||
        ext.namespace.toLowerCase().includes(query) ||
        ext.name.toLowerCase().includes(query)
    );
  }, [extensions, searchQuery]);

  // Group by state
  const activeExtensions = filteredExtensions.filter((e) => e.enabled);
  const disabledExtensions = filteredExtensions.filter((e) => !e.enabled);

  const handleUninstall = async (ext: InstalledExtension) => {
    if (confirm(`Uninstall "${ext.display_name}"?`)) {
      uninstallMutation.mutate({ ext });
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Search */}
      <div className="px-3 py-2 border-b border-border-subtle">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-text-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search extensions..."
            className="w-full pl-7 pr-2 py-1 text-xs rounded bg-void border border-border-default text-text-primary placeholder:text-text-muted focus:border-accent-primary focus:outline-none"
          />
        </div>
      </div>

      {/* Quick stats */}
      <div className="px-3 py-2 border-b border-border-subtle flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Box className="h-4 w-4 text-accent-primary" />
          <span className="text-xs text-text-secondary">{activeExtensions.length} active</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => refetch()}
            className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-overlay"
            title="Refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => openModal('extensions-marketplace')}
            className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-overlay"
            title="Extension Marketplace"
          >
            <Settings className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-8 px-4">
            <Loader2 className="h-6 w-6 text-accent-primary animate-spin" />
            <p className="mt-2 text-xs text-text-muted">Loading extensions...</p>
          </div>
        ) : extensions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
            <Box className="h-8 w-8 text-text-muted mb-2" />
            <p className="text-xs text-text-muted">No extensions installed</p>
            <button
              onClick={() => openModal('extensions-marketplace')}
              className="mt-2 text-xs text-accent-primary hover:underline"
            >
              Browse Marketplace
            </button>
          </div>
        ) : (
          <div className="py-2">
            {/* Active extensions */}
            {activeExtensions.length > 0 && (
              <div className="px-2 mb-2">
                <div className="px-1 py-1 text-xs font-medium text-text-secondary flex items-center gap-1">
                  <Check className="h-3 w-3 text-accent-success" />
                  Active ({activeExtensions.length})
                </div>
                <div className="space-y-0.5">
                  {activeExtensions.map((ext) => (
                    <CompactExtensionCard
                      key={ext.id}
                      extension={ext}
                      onToggle={() => toggleMutation.mutate({ ext })}
                      onUninstall={() => handleUninstall(ext)}
                      isToggling={toggleMutation.isPending}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Disabled extensions */}
            {disabledExtensions.length > 0 && (
              <div className="px-2 mb-2">
                <div className="px-1 py-1 text-xs font-medium text-text-secondary flex items-center gap-1">
                  <PowerOff className="h-3 w-3" />
                  Disabled ({disabledExtensions.length})
                </div>
                <div className="space-y-0.5">
                  {disabledExtensions.map((ext) => (
                    <CompactExtensionCard
                      key={ext.id}
                      extension={ext}
                      onToggle={() => toggleMutation.mutate({ ext })}
                      onUninstall={() => handleUninstall(ext)}
                      isToggling={toggleMutation.isPending}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* No results */}
            {filteredExtensions.length === 0 && searchQuery && (
              <div className="px-4 py-4 text-center text-xs text-text-muted">
                No extensions match &quot;{searchQuery}&quot;
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-border-subtle flex items-center justify-between">
        <button
          onClick={() => openModal('extensions-marketplace')}
          className="text-[10px] text-accent-primary hover:underline"
        >
          Browse Marketplace
        </button>
        <a
          href="https://open-vsx.org"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-[10px] text-text-muted hover:text-accent-primary"
        >
          Open VSX
          <ExternalLink className="h-2.5 w-2.5" />
        </a>
      </div>
    </div>
  );
}
