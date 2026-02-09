'use client';

import { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import {
  Github,
  Link2,
  Unlink,
  Shield,
  GitBranch,
  Clock,
  Check,
  AlertTriangle,
  Loader2,
  ExternalLink,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@podex/ui';
import { cn } from '@/lib/utils';
import { getGitHubLinkURL, getGitHubStatus, getGitHubRepos, disconnectGitHub } from '@/lib/api';

// ============================================================================
// Types
// ============================================================================

interface GitHubConnectionStatus {
  connected: boolean;
  username: string | null;
  avatar_url: string | null;
  scopes: string[] | null;
  connected_at: string | null;
  last_used_at: string | null;
}

interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
  default_branch: string;
}

// ============================================================================
// Scope Badge
// ============================================================================

function ScopeBadge({ scope }: { scope: string }) {
  const scopeInfo: Record<string, { label: string; description: string }> = {
    repo: { label: 'Repositories', description: 'Full control of repositories' },
    'repo:status': { label: 'Commit Status', description: 'Access commit status' },
    'repo:invite': { label: 'Invitations', description: 'Access repository invitations' },
    public_repo: { label: 'Public Repos', description: 'Access public repositories' },
    workflow: { label: 'Workflows', description: 'Update GitHub Action workflows' },
    'write:packages': { label: 'Packages', description: 'Write packages' },
    'read:packages': { label: 'Read Packages', description: 'Read packages' },
    'delete:packages': { label: 'Delete Packages', description: 'Delete packages' },
    'admin:org': { label: 'Org Admin', description: 'Full control of orgs' },
    'read:org': { label: 'Read Org', description: 'Read org membership' },
    'admin:repo_hook': { label: 'Webhooks', description: 'Manage repository webhooks' },
    'read:repo_hook': { label: 'Read Hooks', description: 'Read repository hooks' },
    user: { label: 'User', description: 'Update user profile' },
    'read:user': { label: 'Read User', description: 'Read user profile data' },
    'user:email': { label: 'Email', description: 'Access user email addresses' },
    'user:follow': { label: 'Follow', description: 'Follow and unfollow users' },
    notifications: { label: 'Notifications', description: 'Access notifications' },
    gist: { label: 'Gists', description: 'Create gists' },
  };

  const info = scopeInfo[scope] || { label: scope, description: scope };

  return (
    <span
      className="px-2 py-1 text-xs rounded bg-surface-hover text-text-secondary"
      title={info.description}
    >
      {info.label}
    </span>
  );
}

// ============================================================================
// Connected State
// ============================================================================

function ConnectedState({
  status,
  onDisconnect,
  isDisconnecting,
}: {
  status: GitHubConnectionStatus;
  onDisconnect: () => void;
  isDisconnecting: boolean;
}) {
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [isLoadingRepos, setIsLoadingRepos] = useState(false);

  const fetchRepos = useCallback(async () => {
    setIsLoadingRepos(true);
    try {
      const data = await getGitHubRepos({ per_page: 10 });
      setRepos(data);
    } catch (err) {
      console.error('Failed to fetch repos:', err);
    } finally {
      setIsLoadingRepos(false);
    }
  }, []);

  useEffect(() => {
    fetchRepos();
  }, [fetchRepos]);

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'Never';
    return new Date(dateStr).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="space-y-6">
      {/* Connection Info */}
      <div className="bg-surface border border-border-default rounded-xl p-5">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            {status.avatar_url ? (
              <Image
                src={status.avatar_url}
                alt={status.username || 'GitHub user'}
                width={56}
                height={56}
                className="w-14 h-14 rounded-full border-2 border-green-500"
              />
            ) : (
              <div className="w-14 h-14 rounded-full bg-surface-hover flex items-center justify-center">
                <Github className="w-6 h-6 text-text-muted" />
              </div>
            )}
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-semibold text-text-primary">@{status.username}</h3>
                <Check className="w-5 h-5 text-green-400" />
              </div>
              <p className="text-sm text-text-muted">Connected to GitHub</p>
            </div>
          </div>
          <Button variant="danger" size="sm" onClick={onDisconnect} disabled={isDisconnecting}>
            {isDisconnecting ? (
              <Loader2 className="w-4 h-4 animate-spin mr-1" />
            ) : (
              <Unlink className="w-4 h-4 mr-1" />
            )}
            Disconnect
          </Button>
        </div>

        {/* Connection details */}
        <div className="grid grid-cols-2 gap-4 mt-4 pt-4 border-t border-border-subtle">
          <div className="flex items-center gap-2 text-sm text-text-muted">
            <Clock className="w-4 h-4" />
            <span>Connected: {formatDate(status.connected_at)}</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-text-muted">
            <Clock className="w-4 h-4" />
            <span>Last used: {formatDate(status.last_used_at)}</span>
          </div>
        </div>
      </div>

      {/* Scopes */}
      {status.scopes && status.scopes.length > 0 && (
        <div className="bg-surface border border-border-default rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Shield className="w-5 h-5 text-text-muted" />
            <h3 className="text-base font-medium text-text-primary">Permissions</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {status.scopes.map((scope) => (
              <ScopeBadge key={scope} scope={scope} />
            ))}
          </div>
          <p className="text-xs text-text-muted mt-3">
            These are the permissions granted to Podex. You can revoke access at any time from your{' '}
            <a
              href="https://github.com/settings/applications"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-primary hover:underline"
            >
              GitHub settings
            </a>
            .
          </p>
        </div>
      )}

      {/* Recent Repositories */}
      <div className="bg-surface border border-border-default rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <GitBranch className="w-5 h-5 text-text-muted" />
            <h3 className="text-base font-medium text-text-primary">Recent Repositories</h3>
          </div>
          <button
            onClick={fetchRepos}
            disabled={isLoadingRepos}
            className="p-1 rounded hover:bg-surface-hover text-text-muted"
          >
            <RefreshCw className={cn('w-4 h-4', isLoadingRepos && 'animate-spin')} />
          </button>
        </div>

        {isLoadingRepos ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-text-muted" />
          </div>
        ) : repos.length === 0 ? (
          <p className="text-sm text-text-muted text-center py-4">No repositories found</p>
        ) : (
          <div className="space-y-2">
            {repos.map((repo) => (
              <a
                key={repo.id}
                href={repo.html_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between p-3 rounded-lg hover:bg-surface-hover transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Github className="w-5 h-5 text-text-muted" />
                  <div>
                    <span className="text-sm font-medium text-text-primary">{repo.full_name}</span>
                    {repo.private && (
                      <span className="ml-2 px-1.5 py-0.5 text-xs rounded bg-yellow-500/20 text-yellow-400">
                        Private
                      </span>
                    )}
                  </div>
                </div>
                <ExternalLink className="w-4 h-4 text-text-muted" />
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Disconnected State
// ============================================================================

function DisconnectedState({
  onConnect,
  isConnecting,
}: {
  onConnect: () => void;
  isConnecting?: boolean;
}) {
  return (
    <div className="bg-surface border border-border-default rounded-xl p-8 text-center">
      <div className="w-16 h-16 rounded-full bg-surface-hover flex items-center justify-center mx-auto mb-4">
        <Github className="w-8 h-8 text-text-muted" />
      </div>
      <h3 className="text-lg font-semibold text-text-primary mb-2">Connect GitHub</h3>
      <p className="text-sm text-text-muted mb-6 max-w-md mx-auto">
        Connect your GitHub account to access pull requests, run GitHub Actions, and manage
        repositories directly from Podex.
      </p>

      <Button onClick={onConnect} disabled={isConnecting} className="gap-2">
        {isConnecting ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Connecting...
          </>
        ) : (
          <>
            <Link2 className="w-4 h-4" />
            Connect GitHub Account
          </>
        )}
      </Button>

      <div className="mt-8 pt-6 border-t border-border-subtle">
        <h4 className="text-sm font-medium text-text-primary mb-4">What you'll get:</h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-left max-w-2xl mx-auto">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-green-500/10 flex items-center justify-center shrink-0">
              <Check className="w-4 h-4 text-green-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-text-primary">Pull Requests</p>
              <p className="text-xs text-text-muted">View, create, and merge PRs</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-yellow-500/10 flex items-center justify-center shrink-0">
              <Check className="w-4 h-4 text-yellow-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-text-primary">GitHub Actions</p>
              <p className="text-xs text-text-muted">Trigger and monitor workflows</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center shrink-0">
              <Check className="w-4 h-4 text-purple-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-text-primary">Code Review</p>
              <p className="text-xs text-text-muted">Review and comment on code</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Main Page
// ============================================================================

export default function GitHubSettingsPage() {
  const [status, setStatus] = useState<GitHubConnectionStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await getGitHubStatus();
      setStatus(data);
    } catch {
      setError('Failed to fetch connection status');
      setStatus({
        connected: false,
        username: null,
        avatar_url: null,
        scopes: null,
        connected_at: null,
        last_used_at: null,
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleConnect = useCallback(async () => {
    setIsConnecting(true);
    setError(null);
    try {
      // Use the link URL instead of OAuth login URL
      // This ensures GitHub gets linked to the current user, not creates a new account
      const url = await getGitHubLinkURL();
      window.location.href = url;
    } catch {
      setIsConnecting(false);
      setError('Failed to start GitHub connection');
    }
  }, []);

  const handleDisconnect = useCallback(async () => {
    setIsDisconnecting(true);
    try {
      await disconnectGitHub();
      setStatus({
        connected: false,
        username: null,
        avatar_url: null,
        scopes: null,
        connected_at: null,
        last_used_at: null,
      });
    } catch {
      setError('Failed to disconnect GitHub');
    } finally {
      setIsDisconnecting(false);
    }
  }, []);

  return (
    <div className="max-w-3xl mx-auto px-8 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-text-primary flex items-center gap-2">
          <Github className="w-6 h-6" />
          GitHub Integration
        </h1>
        <p className="text-text-muted mt-1">
          Connect your GitHub account to manage pull requests and workflows
        </p>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-red-400" />
          <span className="text-sm text-red-400">{error}</span>
          <button
            onClick={() => setError(null)}
            className="ml-auto text-red-400 hover:text-red-300"
          >
            <span className="sr-only">Dismiss</span>
            &times;
          </button>
        </div>
      )}

      {/* Loading */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-text-muted" />
          <span className="ml-2 text-text-muted">Loading...</span>
        </div>
      ) : status?.connected ? (
        <ConnectedState
          status={status}
          onDisconnect={handleDisconnect}
          isDisconnecting={isDisconnecting}
        />
      ) : (
        <DisconnectedState onConnect={handleConnect} isConnecting={isConnecting} />
      )}
    </div>
  );
}
