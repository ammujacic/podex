'use client';

import { useEffect, useState } from 'react';
import {
  Plug,
  RefreshCw,
  Plus,
  Loader2,
  ChevronDown,
  ChevronRight,
  CheckCircle,
  AlertCircle,
  Zap,
  Settings,
  ExternalLink,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMCPStore, selectIsServerTesting, selectTestResult } from '@/stores/mcp';
import type { MCPDefaultServer, MCPServer } from '@/lib/api';
import { useUIStore } from '@/stores/ui';

interface MCPPanelProps {
  sessionId: string;
}

function CompactServerCard({
  server,
  isDefault,
  onToggle,
  onTest,
}: {
  server: MCPDefaultServer | MCPServer;
  isDefault: boolean;
  onToggle: () => Promise<void>;
  onTest?: () => Promise<void>;
}) {
  const [isLoading, setIsLoading] = useState(false);
  const serverId = isDefault ? (server as MCPDefaultServer).slug : (server as MCPServer).id;
  const isBuiltin = isDefault ? (server as MCPDefaultServer).is_builtin : false;
  const isEnabled =
    isBuiltin ||
    (isDefault ? (server as MCPDefaultServer).is_enabled : (server as MCPServer).is_enabled);
  const isTesting = useMCPStore((s) => selectIsServerTesting(s, serverId));
  const testResult = useMCPStore((s) => selectTestResult(s, serverId));

  // Get tools count and error status from server
  const toolsCount = !isDefault ? (server as MCPServer).discovered_tools?.length || 0 : 0;
  const lastError = !isDefault ? (server as MCPServer).last_error : null;

  const handleToggle = async () => {
    setIsLoading(true);
    try {
      await onToggle();
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className={cn(
        'flex items-center gap-2 px-2 py-1.5 rounded transition-colors',
        isEnabled ? 'bg-accent-primary/10' : 'hover:bg-overlay'
      )}
    >
      <div
        className={cn(
          'w-1.5 h-1.5 rounded-full',
          isEnabled && lastError ? 'bg-error' : isEnabled ? 'bg-success' : 'bg-text-muted'
        )}
        title={lastError || undefined}
      />
      <span className="flex-1 text-xs text-text-primary truncate">{server.name}</span>

      {/* Show tools count for enabled servers */}
      {isEnabled && toolsCount > 0 && (
        <span className="text-[10px] text-text-muted px-1 bg-overlay rounded">
          {toolsCount} tools
        </span>
      )}

      {/* Show error indicator */}
      {isEnabled && lastError && (
        <span className="text-error" title={lastError}>
          <AlertCircle className="h-3 w-3" />
        </span>
      )}

      {testResult && (
        <span className={cn('flex-shrink-0', testResult.success ? 'text-success' : 'text-error')}>
          {testResult.success ? (
            <CheckCircle className="h-3 w-3" />
          ) : (
            <AlertCircle className="h-3 w-3" />
          )}
        </span>
      )}

      {onTest && !isDefault && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onTest();
          }}
          disabled={isTesting}
          className="p-0.5 rounded text-text-muted hover:text-text-primary"
          title="Test connection"
        >
          {isTesting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
        </button>
      )}

      {isBuiltin ? (
        <span className="text-[10px] text-success font-medium px-1.5 py-0.5 rounded bg-success/10 whitespace-nowrap flex-shrink-0">
          On
        </span>
      ) : (
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleToggle();
          }}
          disabled={isLoading}
          className={cn(
            'relative w-7 h-4 rounded-full transition-colors flex-shrink-0',
            isEnabled ? 'bg-accent-primary' : 'bg-overlay',
            isLoading && 'opacity-50'
          )}
        >
          <span
            className={cn(
              'absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-all',
              isEnabled ? 'left-3.5' : 'left-0.5'
            )}
          />
        </button>
      )}
    </div>
  );
}

export function MCPPanel({ sessionId: _sessionId }: MCPPanelProps) {
  const {
    categories,
    userServers,
    isLoading,
    isSyncing,
    loadAll,
    enableDefault,
    disableDefault,
    updateServer,
    testConnection,
    syncFromEnv,
  } = useMCPStore();

  const { openModal } = useUIStore();
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(['filesystem', 'version_control'])
  );

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const toggleCategory = (categoryId: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      return next;
    });
  };

  // Count active servers: built-in servers always count, plus user-enabled non-builtin
  const allDefaults = categories.flatMap((c) => c.servers);
  const builtinSlugs = new Set(allDefaults.filter((s) => s.is_builtin).map((s) => s.slug));
  const enabledCount =
    builtinSlugs.size + allDefaults.filter((s) => !s.is_builtin && s.is_enabled).length;
  const customServers = userServers.filter((s) => !s.is_default);

  // Count total tools from all enabled servers
  const totalTools = userServers
    .filter((s) => s.is_enabled)
    .reduce((acc, s) => acc + (s.discovered_tools?.length || 0), 0);

  // Check if any servers have errors
  const serversWithErrors = userServers.filter((s) => s.is_enabled && s.last_error);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Quick stats */}
      <div className="px-3 py-2 border-b border-border-subtle flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Plug className="h-4 w-4 text-accent-primary" />
          <span className="text-xs text-text-secondary">
            {enabledCount} active
            {totalTools > 0 && <span className="text-text-muted"> · {totalTools} tools</span>}
          </span>
          {serversWithErrors.length > 0 && (
            <span
              className="flex items-center gap-1 text-xs text-warning"
              title={`${serversWithErrors.length} server(s) have errors`}
            >
              <AlertCircle className="h-3 w-3" />
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => syncFromEnv()}
            disabled={isSyncing}
            className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-overlay"
            title="Sync from environment"
          >
            {isSyncing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            onClick={() => openModal('mcp-settings')}
            className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-overlay"
            title="MCP Settings"
          >
            <Settings className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
          </div>
        ) : (
          <div className="py-2">
            {/* Default servers by category */}
            {categories.map((category) => {
              const enabledInCategory = category.servers.filter(
                (s) => s.is_builtin || s.is_enabled
              ).length;
              return (
                <div key={category.id} className="px-2">
                  <button
                    onClick={() => toggleCategory(category.id)}
                    className="w-full flex items-center gap-1 px-1 py-1 text-xs font-medium text-text-secondary hover:text-text-primary"
                  >
                    {expandedCategories.has(category.id) ? (
                      <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronRight className="h-3 w-3" />
                    )}
                    <span className="flex-1 text-left">{category.name}</span>
                    <span className="text-text-muted">
                      {enabledInCategory}/{category.servers.length}
                    </span>
                  </button>

                  {expandedCategories.has(category.id) && (
                    <div className="ml-2 space-y-0.5 pb-2">
                      {category.servers.map((server) => (
                        <CompactServerCard
                          key={server.slug}
                          server={server}
                          isDefault={true}
                          onToggle={async () => {
                            if (server.is_enabled) {
                              await disableDefault(server.slug);
                            } else {
                              await enableDefault(server.slug);
                            }
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Custom servers */}
            {customServers.length > 0 && (
              <div className="px-2 mt-2 pt-2 border-t border-border-subtle">
                <div className="px-1 py-1 text-xs font-medium text-text-secondary flex items-center gap-1">
                  <Plus className="h-3 w-3" />
                  Custom Servers
                </div>
                <div className="space-y-0.5">
                  {customServers.map((server) => (
                    <CompactServerCard
                      key={server.id}
                      server={server}
                      isDefault={false}
                      onToggle={async () => {
                        await updateServer(server.id, { is_enabled: !server.is_enabled });
                      }}
                      onTest={async () => {
                        await testConnection(server.id);
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-border-subtle">
        <a
          href="https://modelcontextprotocol.io"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-1 text-[10px] text-text-muted hover:text-accent-primary"
        >
          Learn about MCP
          <ExternalLink className="h-2.5 w-2.5" />
        </a>
      </div>
    </div>
  );
}
