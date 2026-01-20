'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Plug,
  X,
  RefreshCw,
  Plus,
  Trash2,
  Edit2,
  AlertCircle,
  CheckCircle,
  Loader2,
  ChevronDown,
  ChevronRight,
  FolderGit,
  Database,
  Globe,
  MessageSquare,
  Container,
  Brain,
  Settings2,
  ExternalLink,
  Zap,
  Bug,
  Key,
  Eye,
  EyeOff,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMCPStore, selectIsServerTesting, selectTestResult } from '@/stores/mcp';
import type { MCPDefaultServer, MCPServer, CreateMCPServerRequest } from '@/lib/api';
import { getGitHubStatus } from '@/lib/api';

// ============================================================================
// ICONS
// ============================================================================

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  version_control: <FolderGit className="h-4 w-4" />,
  database: <Database className="h-4 w-4" />,
  web: <Globe className="h-4 w-4" />,
  communication: <MessageSquare className="h-4 w-4" />,
  containers: <Container className="h-4 w-4" />,
  memory: <Brain className="h-4 w-4" />,
  monitoring: <Bug className="h-4 w-4" />,
  productivity: <Zap className="h-4 w-4" />,
};

const SERVER_ICONS: Record<string, React.ReactNode> = {
  github: <FolderGit className="h-5 w-5" />,
  fetch: <Globe className="h-5 w-5" />,
  memory: <Brain className="h-5 w-5" />,
  'brave-search': <Globe className="h-5 w-5" />,
  puppeteer: <Globe className="h-5 w-5" />,
  slack: <MessageSquare className="h-5 w-5" />,
  postgres: <Database className="h-5 w-5" />,
  sqlite: <Database className="h-5 w-5" />,
  docker: <Container className="h-5 w-5" />,
  kubernetes: <Container className="h-5 w-5" />,
  sentry: <Bug className="h-5 w-5" />,
  'podex-skills': <Zap className="h-5 w-5" />,
};

// Environment variable hints for better UX
const ENV_VAR_HINTS: Record<string, { placeholder: string; hint: string; link?: string }> = {
  GITHUB_TOKEN: {
    placeholder: 'ghp_xxxxxxxxxxxxxxxxxxxx',
    hint: 'Personal access token with repo scope',
    link: 'https://github.com/settings/tokens',
  },
  BRAVE_API_KEY: {
    placeholder: 'BSAxxxxxxxxxxxxxxxxxxxxx',
    hint: 'Brave Search API key',
    link: 'https://brave.com/search/api/',
  },
  SLACK_BOT_TOKEN: {
    placeholder: 'xoxb-xxxxxxxxxxxxx-xxxxxxxxxxxxx',
    hint: 'Slack Bot User OAuth Token',
    link: 'https://api.slack.com/apps',
  },
  SLACK_TEAM_ID: {
    placeholder: 'T0XXXXXXXXX',
    hint: 'Your Slack workspace ID',
  },
  POSTGRES_CONNECTION_STRING: {
    placeholder: 'postgresql://user:pass@host:5432/db',
    hint: 'Full PostgreSQL connection string',
  },
  SENTRY_AUTH_TOKEN: {
    placeholder: 'sntrys_xxxxxxxxxxxxxxxxxx',
    hint: 'Sentry authentication token',
    link: 'https://sentry.io/settings/account/api/auth-tokens/',
  },
  SENTRY_ORG: {
    placeholder: 'my-organization',
    hint: 'Your Sentry organization slug',
  },
  SENTRY_PROJECT: {
    placeholder: 'my-project',
    hint: 'Your Sentry project slug',
  },
};

// ============================================================================
// DEFAULT SERVER CARD
// ============================================================================

interface DefaultServerCardProps {
  server: MCPDefaultServer;
  githubConnected?: boolean | null;
  onEnable: (slug: string, envVars?: Record<string, string>) => Promise<void>;
  onDisable: (slug: string) => Promise<void>;
  onTest: (serverId: string) => Promise<void>;
}

function DefaultServerCard({
  server,
  githubConnected,
  onEnable,
  onDisable,
  onTest: _onTest,
}: DefaultServerCardProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [showEnvVars, setShowEnvVars] = useState(false);
  const [envVars, setEnvVars] = useState<Record<string, string>>({});
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const handleToggle = async () => {
    setIsLoading(true);
    setError(null);
    try {
      if (server.is_enabled) {
        await onDisable(server.slug);
      } else {
        // If server requires env vars and they're not provided from system
        if (server.required_env.length > 0 && !server.has_required_env) {
          setShowEnvVars(true);
          setIsLoading(false);
          return;
        }
        await onEnable(server.slug, envVars);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update server');
    } finally {
      setIsLoading(false);
      if (!showEnvVars) {
        setShowEnvVars(false);
      }
    }
  };

  const handleEnableWithEnvVars = async () => {
    setIsLoading(true);
    setError(null);
    try {
      await onEnable(server.slug, envVars);
      setShowEnvVars(false);
      setEnvVars({});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to enable server');
    } finally {
      setIsLoading(false);
    }
  };

  const togglePasswordVisibility = (envVar: string) => {
    setShowPasswords((prev) => ({ ...prev, [envVar]: !prev[envVar] }));
  };

  const getEnvVarHint = (envVar: string) => {
    return ENV_VAR_HINTS[envVar] || { placeholder: `Enter ${envVar}`, hint: '' };
  };

  const allEnvVarsFilled = server.required_env.every((v) => envVars[v]?.trim());

  const isGitHub = server.slug === 'github';
  const isActive = isGitHub ? !!githubConnected : server.is_builtin || server.is_enabled;
  const githubButtonLabel = githubConnected ? 'Manage GitHub' : 'Connect GitHub';
  const githubButtonClass = githubConnected
    ? 'bg-overlay text-text-secondary hover:text-text-primary'
    : 'bg-accent-primary text-void hover:bg-accent-primary/90';

  return (
    <div
      className={cn(
        'p-4 rounded-lg border transition-all',
        isActive
          ? 'border-accent-primary/50 bg-accent-primary/5'
          : 'border-border-subtle hover:border-border-default bg-elevated'
      )}
    >
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div
          className={cn(
            'p-2 rounded-lg',
            isActive ? 'bg-accent-primary/20 text-accent-primary' : 'bg-overlay text-text-muted'
          )}
        >
          {SERVER_ICONS[server.slug] || <Plug className="h-5 w-5" />}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-medium text-text-primary">{server.name}</h4>
            {server.is_builtin && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-success/20 text-success">
                Built-in
              </span>
            )}
          </div>
          <p className="text-xs text-text-muted mt-0.5 line-clamp-2">{server.description}</p>

          {/* Required env vars indicator */}
          {server.required_env.length > 0 && !showEnvVars && (
            <div className="mt-2 flex items-center gap-1 text-xs">
              {server.has_required_env ? (
                <span className="flex items-center gap-1 text-success">
                  <CheckCircle className="h-3 w-3" />
                  Environment configured
                </span>
              ) : (
                <span className="flex items-center gap-1 text-warning">
                  <Key className="h-3 w-3" />
                  Requires: {server.required_env.join(', ')}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Toggle or Always On indicator */}
        {isGitHub ? (
          <Link
            href="/settings/integrations/github"
            className={cn(
              'px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap',
              githubButtonClass
            )}
          >
            {githubButtonLabel}
          </Link>
        ) : server.is_builtin ? (
          <span className="text-xs text-success font-medium px-2 py-1 rounded bg-success/10 whitespace-nowrap">
            Always On
          </span>
        ) : (
          <button
            onClick={handleToggle}
            disabled={isLoading}
            className={cn(
              'relative w-10 h-6 rounded-full transition-colors',
              server.is_enabled ? 'bg-accent-primary' : 'bg-overlay',
              isLoading && 'opacity-50'
            )}
          >
            <span
              className={cn(
                'absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all',
                server.is_enabled ? 'left-5' : 'left-1'
              )}
            />
            {isLoading && (
              <Loader2 className="absolute inset-0 m-auto h-4 w-4 animate-spin text-text-primary" />
            )}
          </button>
        )}
      </div>

      {/* Enhanced Env vars form */}
      {showEnvVars && (
        <div className="mt-4 pt-4 border-t border-border-subtle">
          <div className="flex items-center gap-2 mb-3">
            <Key className="h-4 w-4 text-accent-primary" />
            <h5 className="text-sm font-medium text-text-primary">Configure API Keys</h5>
          </div>

          {error && (
            <div className="mb-3 p-2 rounded bg-error/10 border border-error/30 text-error text-xs flex items-center gap-2">
              <AlertCircle className="h-3 w-3" />
              {error}
            </div>
          )}

          <div className="space-y-3">
            {server.required_env.map((envVar) => {
              const hint = getEnvVarHint(envVar);
              const isFilled = !!envVars[envVar]?.trim();
              const isVisible = showPasswords[envVar];

              return (
                <div key={envVar} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-text-secondary flex items-center gap-1.5">
                      {envVar}
                      {isFilled && <CheckCircle className="h-3 w-3 text-success" />}
                    </label>
                    {hint.link && (
                      <a
                        href={hint.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] text-accent-primary hover:underline flex items-center gap-0.5"
                      >
                        Get API key
                        <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    )}
                  </div>
                  <div className="relative">
                    <input
                      type={isVisible ? 'text' : 'password'}
                      value={envVars[envVar] || ''}
                      onChange={(e) => setEnvVars({ ...envVars, [envVar]: e.target.value })}
                      placeholder={hint.placeholder}
                      className={cn(
                        'w-full px-3 py-2 pr-10 text-sm rounded-lg bg-void border text-text-primary placeholder:text-text-muted font-mono transition-colors',
                        isFilled
                          ? 'border-success/50'
                          : 'border-border-default focus:border-accent-primary'
                      )}
                    />
                    <button
                      type="button"
                      onClick={() => togglePasswordVisibility(envVar)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-text-muted hover:text-text-primary transition-colors"
                    >
                      {isVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {hint.hint && <p className="text-[10px] text-text-muted">{hint.hint}</p>}
                </div>
              );
            })}
          </div>

          <div className="flex gap-2 mt-4">
            <button
              onClick={handleEnableWithEnvVars}
              disabled={isLoading || !allEnvVarsFilled}
              className={cn(
                'flex-1 px-4 py-2 text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2',
                allEnvVarsFilled
                  ? 'bg-accent-primary text-void hover:bg-accent-primary/90'
                  : 'bg-overlay text-text-muted cursor-not-allowed'
              )}
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <CheckCircle className="h-4 w-4" />
                  Enable Integration
                </>
              )}
            </button>
            <button
              onClick={() => {
                setShowEnvVars(false);
                setEnvVars({});
                setError(null);
              }}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-overlay text-text-secondary hover:text-text-primary transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// USER SERVER CARD
// ============================================================================

interface UserServerCardProps {
  server: MCPServer;
  onEdit: (server: MCPServer) => void;
  onDelete: (serverId: string) => Promise<void>;
  onTest: (serverId: string) => Promise<void>;
  onToggle: (serverId: string, enabled: boolean) => Promise<void>;
}

function UserServerCard({ server, onEdit, onDelete, onTest, onToggle }: UserServerCardProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [isToggling, setIsToggling] = useState(false);

  const isTesting = useMCPStore((s) => selectIsServerTesting(s, server.id));
  const testResult = useMCPStore((s) => selectTestResult(s, server.id));

  const handleDelete = async () => {
    if (!confirm(`Delete server "${server.name}"?`)) return;
    setIsDeleting(true);
    try {
      await onDelete(server.id);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleToggle = async () => {
    setIsToggling(true);
    try {
      await onToggle(server.id, !server.is_enabled);
    } finally {
      setIsToggling(false);
    }
  };

  return (
    <div
      className={cn(
        'p-4 rounded-lg border transition-all',
        server.is_enabled
          ? 'border-accent-primary/50 bg-accent-primary/5'
          : 'border-border-subtle bg-elevated'
      )}
    >
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div
          className={cn(
            'p-2 rounded-lg',
            server.is_enabled
              ? 'bg-accent-primary/20 text-accent-primary'
              : 'bg-overlay text-text-muted'
          )}
        >
          {SERVER_ICONS[server.source_slug || ''] || <Plug className="h-5 w-5" />}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-medium text-text-primary">{server.name}</h4>
            {server.is_default && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-info/20 text-info">
                Default
              </span>
            )}
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-overlay text-text-muted">
              {server.transport}
            </span>
          </div>
          {server.description && (
            <p className="text-xs text-text-muted mt-0.5 line-clamp-1">{server.description}</p>
          )}

          {/* Test result */}
          {testResult && (
            <div
              className={cn(
                'mt-2 flex items-center gap-1 text-xs',
                testResult.success ? 'text-success' : 'text-error'
              )}
            >
              {testResult.success ? (
                <>
                  <CheckCircle className="h-3 w-3" />
                  Connected ({testResult.toolsCount} tools)
                </>
              ) : (
                <>
                  <AlertCircle className="h-3 w-3" />
                  {testResult.message}
                </>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => onTest(server.id)}
            disabled={isTesting}
            className="p-1.5 rounded hover:bg-overlay text-text-muted hover:text-text-primary transition-colors"
            title="Test connection"
          >
            {isTesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
          </button>
          {!server.is_default && (
            <>
              <button
                onClick={() => onEdit(server)}
                className="p-1.5 rounded hover:bg-overlay text-text-muted hover:text-text-primary transition-colors"
                title="Edit"
              >
                <Edit2 className="h-4 w-4" />
              </button>
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="p-1.5 rounded hover:bg-error/20 text-text-muted hover:text-error transition-colors"
                title="Delete"
              >
                {isDeleting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
              </button>
            </>
          )}
          <button
            onClick={handleToggle}
            disabled={isToggling}
            className={cn(
              'relative w-10 h-6 rounded-full transition-colors ml-2',
              server.is_enabled ? 'bg-accent-primary' : 'bg-overlay',
              isToggling && 'opacity-50'
            )}
          >
            <span
              className={cn(
                'absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all',
                server.is_enabled ? 'left-5' : 'left-1'
              )}
            />
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// SERVER EDITOR MODAL
// ============================================================================

interface ServerEditorProps {
  server?: MCPServer | null;
  onSave: (data: CreateMCPServerRequest) => Promise<void>;
  onClose: () => void;
}

function ServerEditor({ server, onSave, onClose }: ServerEditorProps) {
  const [formData, setFormData] = useState<CreateMCPServerRequest>({
    name: server?.name || '',
    description: server?.description || '',
    transport: server?.transport || 'stdio',
    command: server?.command || '',
    args: server?.args || [],
    url: server?.url || '',
    env_vars: server?.env_vars || {},
    is_enabled: server?.is_enabled ?? true,
  });
  const [argsString, setArgsString] = useState((server?.args || []).join(' '));
  const [envVarsString, setEnvVarsString] = useState(
    Object.entries(server?.env_vars || {})
      .map(([k, v]) => `${k}=${v}`)
      .join('\n')
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!formData.name) {
      setError('Name is required');
      return;
    }

    if (formData.transport === 'stdio' && !formData.command) {
      setError('Command is required for stdio transport');
      return;
    }

    if ((formData.transport === 'sse' || formData.transport === 'http') && !formData.url) {
      setError('URL is required for SSE/HTTP transport');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      // Parse args and env vars
      const args = argsString.split(/\s+/).filter(Boolean);
      const env_vars: Record<string, string> = {};
      envVarsString.split('\n').forEach((line) => {
        const [key, ...rest] = line.split('=');
        if (key && rest.length > 0) {
          env_vars[key.trim()] = rest.join('=').trim();
        }
      });

      await onSave({
        ...formData,
        args,
        env_vars,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save server');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-void/80">
      <div className="w-full max-w-lg mx-4 rounded-lg border border-border-default bg-surface shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
          <h3 className="text-lg font-semibold text-text-primary">
            {server ? 'Edit MCP Server' : 'Add Custom MCP Server'}
          </h3>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-overlay text-text-muted hover:text-text-primary"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form */}
        <div className="p-4 space-y-4 max-h-[60vh] overflow-y-auto">
          {error && (
            <div className="p-3 rounded bg-error/10 border border-error/30 text-error text-sm">
              {error}
            </div>
          )}

          <div>
            <label className="text-sm font-medium text-text-secondary">Name *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="My Custom Server"
              className="w-full mt-1 px-3 py-2 text-sm rounded bg-void border border-border-default text-text-primary placeholder:text-text-muted focus:border-accent-primary focus:ring-1 focus:ring-accent-primary"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-text-secondary">Description</label>
            <input
              type="text"
              value={formData.description || ''}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="What this server does"
              className="w-full mt-1 px-3 py-2 text-sm rounded bg-void border border-border-default text-text-primary placeholder:text-text-muted"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-text-secondary">Transport *</label>
            <select
              value={formData.transport}
              onChange={(e) =>
                setFormData({ ...formData, transport: e.target.value as 'stdio' | 'sse' | 'http' })
              }
              className="w-full mt-1 px-3 py-2 text-sm rounded bg-void border border-border-default text-text-primary"
            >
              <option value="stdio">stdio (subprocess)</option>
              <option value="sse">SSE (Server-Sent Events)</option>
              <option value="http">HTTP (REST)</option>
            </select>
          </div>

          {formData.transport === 'stdio' && (
            <>
              <div>
                <label className="text-sm font-medium text-text-secondary">Command *</label>
                <input
                  type="text"
                  value={formData.command || ''}
                  onChange={(e) => setFormData({ ...formData, command: e.target.value })}
                  placeholder="npx -y @modelcontextprotocol/server-xyz"
                  className="w-full mt-1 px-3 py-2 text-sm rounded bg-void border border-border-default text-text-primary placeholder:text-text-muted font-mono text-xs"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-text-secondary">Arguments</label>
                <input
                  type="text"
                  value={argsString}
                  onChange={(e) => setArgsString(e.target.value)}
                  placeholder="--flag value"
                  className="w-full mt-1 px-3 py-2 text-sm rounded bg-void border border-border-default text-text-primary placeholder:text-text-muted font-mono text-xs"
                />
                <p className="text-xs text-text-muted mt-1">Space-separated arguments</p>
              </div>
            </>
          )}

          {(formData.transport === 'sse' || formData.transport === 'http') && (
            <div>
              <label className="text-sm font-medium text-text-secondary">URL *</label>
              <input
                type="url"
                value={formData.url || ''}
                onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                placeholder={
                  formData.transport === 'sse'
                    ? 'http://localhost:3000/sse'
                    : 'http://localhost:3000/mcp'
                }
                className="w-full mt-1 px-3 py-2 text-sm rounded bg-void border border-border-default text-text-primary placeholder:text-text-muted font-mono text-xs"
              />
            </div>
          )}

          <div>
            <label className="text-sm font-medium text-text-secondary">Environment Variables</label>
            <textarea
              value={envVarsString}
              onChange={(e) => setEnvVarsString(e.target.value)}
              placeholder="KEY=value&#10;ANOTHER_KEY=another_value"
              rows={3}
              className="w-full mt-1 px-3 py-2 text-sm rounded bg-void border border-border-default text-text-primary placeholder:text-text-muted font-mono text-xs"
            />
            <p className="text-xs text-text-muted mt-1">One per line: KEY=value</p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border-subtle">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium rounded bg-overlay text-text-secondary hover:text-text-primary"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-4 py-2 text-sm font-medium rounded bg-accent-primary text-void hover:bg-accent-primary/90 disabled:opacity-50"
          >
            {isSaving ? 'Saving...' : server ? 'Save Changes' : 'Add Server'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// MAIN MCP SETTINGS COMPONENT
// ============================================================================

interface MCPSettingsProps {
  className?: string;
}

export function MCPSettings({ className }: MCPSettingsProps) {
  const {
    categories,
    userServers,
    isLoading,
    isSyncing,
    error,
    loadAll,
    enableDefault,
    disableDefault,
    createServer,
    updateServer,
    deleteServer,
    testConnection,
    syncFromEnv,
    setError,
  } = useMCPStore();

  const [editingServer, setEditingServer] = useState<MCPServer | null>(null);
  const [isAddingServer, setIsAddingServer] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(['version_control', 'web'])
  );
  const [githubConnected, setGithubConnected] = useState<boolean | null>(null);

  const fetchGitHubStatus = useCallback(async () => {
    try {
      const data = await getGitHubStatus();
      setGithubConnected(Boolean(data?.connected));
    } catch {
      setGithubConnected(null);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    fetchGitHubStatus();
  }, [fetchGitHubStatus]);

  const isDefaultServerActive = (server: MCPDefaultServer) => {
    if (server.slug === 'github') {
      return !!githubConnected;
    }
    return server.is_builtin || server.is_enabled;
  };

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

  const handleSaveServer = async (data: CreateMCPServerRequest) => {
    if (editingServer) {
      await updateServer(editingServer.id, data);
    } else {
      await createServer(data);
    }
    setEditingServer(null);
    setIsAddingServer(false);
  };

  const handleToggleUserServer = async (serverId: string, enabled: boolean) => {
    await updateServer(serverId, { is_enabled: enabled });
  };

  const customServers = userServers.filter((s) => !s.is_default);

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <Plug className="h-5 w-5 text-accent-primary" />
          <h2 className="text-lg font-semibold text-text-primary">Integrations (MCP)</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => syncFromEnv()}
            disabled={isSyncing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded bg-overlay text-text-secondary hover:text-text-primary"
            title="Sync from environment variables"
          >
            {isSyncing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Sync Env
          </button>
          <button
            onClick={() => setIsAddingServer(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded bg-accent-primary text-void hover:bg-accent-primary/90"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Custom
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-4 mt-4 p-3 rounded bg-error/10 border border-error/30 text-error text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-error hover:text-error/80">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Loading state */}
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-accent-primary" />
          </div>
        )}

        {!isLoading && (
          <>
            {/* Default servers by category */}
            {categories.map((category) => (
              <div
                key={category.id}
                className="border border-border-subtle rounded-lg overflow-hidden"
              >
                {/* Category header */}
                <button
                  onClick={() => toggleCategory(category.id)}
                  className="w-full flex items-center gap-2 px-4 py-3 bg-elevated hover:bg-overlay transition-colors"
                >
                  <span className="text-text-muted">
                    {CATEGORY_ICONS[category.id] || <Settings2 className="h-4 w-4" />}
                  </span>
                  <span className="flex-1 text-left text-sm font-medium text-text-primary">
                    {category.name}
                  </span>
                  <span className="text-xs text-text-muted">
                    {category.servers.filter((s) => isDefaultServerActive(s)).length}/
                    {category.servers.length}
                  </span>
                  {expandedCategories.has(category.id) ? (
                    <ChevronDown className="h-4 w-4 text-text-muted" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-text-muted" />
                  )}
                </button>

                {/* Category servers */}
                {expandedCategories.has(category.id) && (
                  <div className="p-4 space-y-3 border-t border-border-subtle">
                    {category.servers.map((server) => (
                      <DefaultServerCard
                        key={server.slug}
                        server={server}
                        githubConnected={githubConnected}
                        onEnable={async (slug, envVars) => {
                          await enableDefault(slug, envVars);
                        }}
                        onDisable={async (slug) => {
                          await disableDefault(slug);
                        }}
                        onTest={async (serverId) => {
                          await testConnection(serverId);
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}

            {/* Custom servers */}
            {customServers.length > 0 && (
              <div className="border border-border-subtle rounded-lg overflow-hidden">
                <div className="px-4 py-3 bg-elevated border-b border-border-subtle">
                  <h3 className="text-sm font-medium text-text-primary">Custom Servers</h3>
                </div>
                <div className="p-4 space-y-3">
                  {customServers.map((server) => (
                    <UserServerCard
                      key={server.id}
                      server={server}
                      onEdit={setEditingServer}
                      onDelete={deleteServer}
                      onTest={async (serverId) => {
                        await testConnection(serverId);
                      }}
                      onToggle={handleToggleUserServer}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Documentation link */}
            <div className="flex items-center justify-center pt-4">
              <a
                href="https://modelcontextprotocol.io"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs text-text-muted hover:text-accent-primary"
              >
                Learn more about MCP
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </>
        )}
      </div>

      {/* Server editor modal */}
      {(isAddingServer || editingServer) && (
        <ServerEditor
          server={editingServer}
          onSave={handleSaveServer}
          onClose={() => {
            setIsAddingServer(false);
            setEditingServer(null);
          }}
        />
      )}
    </div>
  );
}
