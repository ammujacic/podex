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
  Key,
  Eye,
  EyeOff,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMCPStore, selectIsServerTesting, selectTestResult } from '@/stores/mcp';
import type { MCPDefaultServer, MCPServer } from '@/lib/api';
import { useUIStore } from '@/stores/ui';

interface MCPPanelProps {
  sessionId: string;
}

// Environment variable placeholders for compact form
const ENV_VAR_PLACEHOLDERS: Record<string, string> = {
  GITHUB_TOKEN: 'ghp_xxx...',
  BRAVE_API_KEY: 'BSAxxx...',
  SLACK_BOT_TOKEN: 'xoxb-xxx...',
  SLACK_TEAM_ID: 'T0XXX...',
  POSTGRES_CONNECTION_STRING: 'postgresql://...',
  SENTRY_AUTH_TOKEN: 'sntrys_xxx...',
  SENTRY_ORG: 'org-slug',
  SENTRY_PROJECT: 'project-slug',
};

function CompactServerCard({
  server,
  isDefault,
  onToggle,
  onToggleWithEnv,
  onTest,
}: {
  server: MCPDefaultServer | MCPServer;
  isDefault: boolean;
  onToggle: () => Promise<void>;
  onToggleWithEnv?: (envVars: Record<string, string>) => Promise<void>;
  onTest?: () => Promise<void>;
}) {
  const [isLoading, setIsLoading] = useState(false);
  const [showEnvForm, setShowEnvForm] = useState(false);
  const [envVars, setEnvVars] = useState<Record<string, string>>({});
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});

  const serverId = isDefault ? (server as MCPDefaultServer).slug : (server as MCPServer).id;
  const isBuiltin = isDefault ? (server as MCPDefaultServer).is_builtin : false;
  const isEnabled =
    isBuiltin ||
    (isDefault ? (server as MCPDefaultServer).is_enabled : (server as MCPServer).is_enabled);
  const isTesting = useMCPStore((s) => selectIsServerTesting(s, serverId));
  const testResult = useMCPStore((s) => selectTestResult(s, serverId));

  // Get required env vars for default servers
  const requiredEnv = isDefault ? (server as MCPDefaultServer).required_env || [] : [];
  const hasRequiredEnv = isDefault ? (server as MCPDefaultServer).has_required_env : true;

  // Get tools count and error status from server
  const toolsCount = !isDefault ? (server as MCPServer).discovered_tools?.length || 0 : 0;
  const lastError = !isDefault ? (server as MCPServer).last_error : null;

  const allEnvVarsFilled = requiredEnv.every((v) => envVars[v]?.trim());

  const handleToggle = async () => {
    // If needs env vars and doesn't have them, show form
    if (!isEnabled && requiredEnv.length > 0 && !hasRequiredEnv && onToggleWithEnv) {
      setShowEnvForm(true);
      return;
    }

    setIsLoading(true);
    try {
      await onToggle();
    } finally {
      setIsLoading(false);
    }
  };

  const handleEnableWithEnv = async () => {
    if (!onToggleWithEnv) return;
    setIsLoading(true);
    try {
      await onToggleWithEnv(envVars);
      setShowEnvForm(false);
      setEnvVars({});
    } finally {
      setIsLoading(false);
    }
  };

  const togglePasswordVisibility = (envVar: string) => {
    setShowPasswords((prev) => ({ ...prev, [envVar]: !prev[envVar] }));
  };

  return (
    <div className="rounded transition-colors">
      <div
        className={cn(
          'flex items-center gap-2 px-2 py-1.5',
          isEnabled ? 'bg-accent-primary/10' : 'hover:bg-overlay',
          showEnvForm && 'rounded-t'
        )}
      >
        <div
          className={cn(
            'w-1.5 h-1.5 rounded-full flex-shrink-0',
            isEnabled && lastError ? 'bg-error' : isEnabled ? 'bg-success' : 'bg-text-muted'
          )}
          title={lastError || undefined}
        />
        <span className="flex-1 text-xs text-text-primary truncate">{server.name}</span>

        {/* Show required env indicator for servers needing config */}
        {!isEnabled && requiredEnv.length > 0 && !hasRequiredEnv && (
          <span className="text-warning flex-shrink-0" title="Requires API key">
            <Key className="h-3 w-3" />
          </span>
        )}

        {/* Show tools count for enabled servers */}
        {isEnabled && toolsCount > 0 && (
          <span className="text-[10px] text-text-muted px-1 bg-overlay rounded flex-shrink-0">
            {toolsCount} tools
          </span>
        )}

        {/* Show error indicator */}
        {isEnabled && lastError && (
          <span className="text-error flex-shrink-0" title={lastError}>
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
            className="p-0.5 rounded text-text-muted hover:text-text-primary flex-shrink-0"
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

      {/* Inline env var form */}
      {showEnvForm && (
        <div className="px-2 pb-2 pt-1 bg-elevated rounded-b border-t border-border-subtle">
          <div className="space-y-2">
            {requiredEnv.map((envVar) => {
              const isVisible = showPasswords[envVar];
              const isFilled = !!envVars[envVar]?.trim();
              const placeholder = ENV_VAR_PLACEHOLDERS[envVar] || envVar;

              return (
                <div key={envVar} className="relative">
                  <input
                    type={isVisible ? 'text' : 'password'}
                    value={envVars[envVar] || ''}
                    onChange={(e) => setEnvVars({ ...envVars, [envVar]: e.target.value })}
                    placeholder={placeholder}
                    className={cn(
                      'w-full px-2 py-1 pr-7 text-[11px] rounded bg-void border text-text-primary placeholder:text-text-muted font-mono',
                      isFilled ? 'border-success/50' : 'border-border-default'
                    )}
                  />
                  <button
                    type="button"
                    onClick={() => togglePasswordVisibility(envVar)}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                  >
                    {isVisible ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                  </button>
                </div>
              );
            })}
          </div>
          <div className="flex gap-1.5 mt-2">
            <button
              onClick={handleEnableWithEnv}
              disabled={isLoading || !allEnvVarsFilled}
              className={cn(
                'flex-1 px-2 py-1 text-[10px] font-medium rounded flex items-center justify-center gap-1',
                allEnvVarsFilled
                  ? 'bg-accent-primary text-void hover:bg-accent-primary/90'
                  : 'bg-overlay text-text-muted cursor-not-allowed'
              )}
            >
              {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Enable'}
            </button>
            <button
              onClick={() => {
                setShowEnvForm(false);
                setEnvVars({});
              }}
              className="px-2 py-1 text-[10px] rounded text-text-muted hover:text-text-primary hover:bg-overlay"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>
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
  const [showAvailable, setShowAvailable] = useState(false);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Separate active vs available servers
  const allDefaults = categories.flatMap((c) => c.servers);
  const activeDefaults = allDefaults.filter((s) => s.is_builtin || s.is_enabled);
  const availableDefaults = allDefaults.filter((s) => !s.is_builtin && !s.is_enabled);
  const customServers = userServers.filter((s) => !s.is_default);
  const activeCustom = customServers.filter((s) => s.is_enabled);
  const availableCustom = customServers.filter((s) => !s.is_enabled);

  // Count active servers
  const enabledCount = activeDefaults.length + activeCustom.length;

  // Count total tools from all enabled servers
  const totalTools = userServers
    .filter((s) => s.is_enabled)
    .reduce((acc, s) => acc + (s.discovered_tools?.length || 0), 0);

  // Check if any servers have errors
  const serversWithErrors = userServers.filter((s) => s.is_enabled && s.last_error);

  // Total available count
  const availableCount = availableDefaults.length + availableCustom.length;

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
            className="p-1 rounded text-text-muted hover:text-accent-primary hover:bg-overlay"
            title="Add custom server"
          >
            <Plus className="h-3.5 w-3.5" />
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
            {/* Active Integrations - Always visible */}
            {enabledCount > 0 ? (
              <div className="px-2">
                <div className="px-1 py-1 text-xs font-medium text-text-secondary flex items-center gap-1">
                  <Plug className="h-3 w-3 text-success" />
                  Active
                  <span className="text-text-muted ml-auto">{enabledCount}</span>
                </div>
                <div className="space-y-0.5">
                  {activeDefaults.map((server) => (
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
                      onToggleWithEnv={async (envVars) => {
                        await enableDefault(server.slug, envVars);
                      }}
                    />
                  ))}
                  {activeCustom.map((server) => (
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
            ) : (
              <div className="px-4 py-6 text-center">
                <Plug className="h-8 w-8 mx-auto mb-2 text-text-muted opacity-50" />
                <p className="text-xs text-text-muted">No active integrations</p>
                <p className="text-[10px] text-text-muted mt-1">
                  Enable integrations below to get started
                </p>
              </div>
            )}

            {/* Available Integrations - Collapsible */}
            {availableCount > 0 && (
              <div className="px-2 mt-2 pt-2 border-t border-border-subtle">
                <button
                  onClick={() => setShowAvailable(!showAvailable)}
                  className="w-full flex items-center gap-1 px-1 py-1 text-xs font-medium text-text-secondary hover:text-text-primary"
                >
                  {showAvailable ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                  <span className="flex-1 text-left">Available</span>
                  <span className="text-text-muted">{availableCount}</span>
                </button>

                {showAvailable && (
                  <div className="space-y-0.5 mt-1">
                    {availableDefaults.map((server) => (
                      <CompactServerCard
                        key={server.slug}
                        server={server}
                        isDefault={true}
                        onToggle={async () => {
                          await enableDefault(server.slug);
                        }}
                        onToggleWithEnv={async (envVars) => {
                          await enableDefault(server.slug, envVars);
                        }}
                      />
                    ))}
                    {availableCustom.map((server) => (
                      <CompactServerCard
                        key={server.id}
                        server={server}
                        isDefault={false}
                        onToggle={async () => {
                          await updateServer(server.id, { is_enabled: true });
                        }}
                        onTest={async () => {
                          await testConnection(server.id);
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-border-subtle space-y-2">
        <button
          onClick={() => openModal('mcp-settings')}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-accent-primary hover:bg-accent-primary/10 rounded-md border border-accent-primary/30 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Custom Server
        </button>
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
