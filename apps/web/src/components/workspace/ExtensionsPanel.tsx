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
  AlertCircle,
  Puzzle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useExtensionHost } from '@/lib/extensions/ExtensionHost';
import type { ExtensionInfo } from '@/lib/extensions/types';
import { useUIStore } from '@/stores/ui';

interface ExtensionsPanelProps {
  sessionId: string;
}

function CompactExtensionCard({
  extension,
  onEnable,
  onDisable,
  onUninstall,
}: {
  extension: ExtensionInfo;
  onEnable: () => void;
  onDisable: () => void;
  onUninstall: () => void;
}) {
  const isEnabled = extension.state === 'enabled' || extension.state === 'active';
  const hasError = extension.state === 'error';

  return (
    <div
      className={cn(
        'flex items-center gap-2 px-2 py-1.5 rounded transition-colors group',
        isEnabled ? 'bg-accent-primary/10' : 'hover:bg-overlay'
      )}
    >
      {/* Icon */}
      <div className="w-5 h-5 flex items-center justify-center text-sm flex-shrink-0">
        {extension.manifest.icon || <Puzzle className="h-3.5 w-3.5 text-text-muted" />}
      </div>

      {/* Name */}
      <span className="flex-1 text-xs text-text-primary truncate">
        {extension.manifest.displayName}
      </span>

      {/* Status indicators */}
      {hasError && (
        <span title={extension.error}>
          <AlertCircle className="h-3 w-3 text-error flex-shrink-0" />
        </span>
      )}

      {/* Actions (visible on hover) */}
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        {isEnabled ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDisable();
            }}
            className="p-0.5 rounded text-text-muted hover:text-warning"
            title="Disable"
          >
            <PowerOff className="h-3 w-3" />
          </button>
        ) : (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEnable();
            }}
            className="p-0.5 rounded text-text-muted hover:text-success"
            title="Enable"
          >
            <Power className="h-3 w-3" />
          </button>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onUninstall();
          }}
          className="p-0.5 rounded text-text-muted hover:text-error"
          title="Uninstall"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>

      {/* Status dot */}
      <div
        className={cn(
          'w-1.5 h-1.5 rounded-full flex-shrink-0',
          isEnabled ? 'bg-success' : 'bg-text-muted'
        )}
      />
    </div>
  );
}

export function ExtensionsPanel({ sessionId: _sessionId }: ExtensionsPanelProps) {
  const { extensions, enableExtension, disableExtension, uninstallExtension } = useExtensionHost();

  const { openModal } = useUIStore();
  const [searchQuery, setSearchQuery] = useState('');

  // Filter extensions by search
  const filteredExtensions = useMemo(() => {
    if (!searchQuery) return extensions;
    const query = searchQuery.toLowerCase();
    return extensions.filter(
      (ext) =>
        ext.manifest.displayName.toLowerCase().includes(query) ||
        ext.manifest.description.toLowerCase().includes(query)
    );
  }, [extensions, searchQuery]);

  // Group by state
  const activeExtensions = filteredExtensions.filter(
    (e) => e.state === 'enabled' || e.state === 'active'
  );
  const disabledExtensions = filteredExtensions.filter(
    (e) => e.state === 'disabled' || e.state === 'installed'
  );
  const errorExtensions = filteredExtensions.filter((e) => e.state === 'error');

  const handleUninstall = async (extensionId: string) => {
    if (confirm('Uninstall this extension?')) {
      await uninstallExtension(extensionId);
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
        <button
          onClick={() => openModal('extensions-marketplace')}
          className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-overlay"
          title="Extension Marketplace"
        >
          <Settings className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {extensions.length === 0 ? (
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
                  <Check className="h-3 w-3 text-success" />
                  Active ({activeExtensions.length})
                </div>
                <div className="space-y-0.5">
                  {activeExtensions.map((ext) => (
                    <CompactExtensionCard
                      key={ext.manifest.id}
                      extension={ext}
                      onEnable={() => enableExtension(ext.manifest.id)}
                      onDisable={() => disableExtension(ext.manifest.id)}
                      onUninstall={() => handleUninstall(ext.manifest.id)}
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
                      key={ext.manifest.id}
                      extension={ext}
                      onEnable={() => enableExtension(ext.manifest.id)}
                      onDisable={() => disableExtension(ext.manifest.id)}
                      onUninstall={() => handleUninstall(ext.manifest.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Error extensions */}
            {errorExtensions.length > 0 && (
              <div className="px-2">
                <div className="px-1 py-1 text-xs font-medium text-error flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  Errors ({errorExtensions.length})
                </div>
                <div className="space-y-0.5">
                  {errorExtensions.map((ext) => (
                    <CompactExtensionCard
                      key={ext.manifest.id}
                      extension={ext}
                      onEnable={() => enableExtension(ext.manifest.id)}
                      onDisable={() => disableExtension(ext.manifest.id)}
                      onUninstall={() => handleUninstall(ext.manifest.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* No results */}
            {filteredExtensions.length === 0 && searchQuery && (
              <div className="px-4 py-4 text-center text-xs text-text-muted">
                No extensions match "{searchQuery}"
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
          href="#"
          className="flex items-center gap-1 text-[10px] text-text-muted hover:text-accent-primary"
        >
          Docs
          <ExternalLink className="h-2.5 w-2.5" />
        </a>
      </div>
    </div>
  );
}
