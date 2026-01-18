'use client';

import { useState, useEffect } from 'react';
import {
  GitBranch,
  Plus,
  RefreshCw,
  Trash2,
  CheckCircle,
  XCircle,
  Copy,
  Settings,
  Folder,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';

interface SkillRepository {
  id: string;
  name: string;
  repo_url: string;
  branch: string;
  skills_path: string;
  sync_direction: 'pull' | 'push' | 'bidirectional';
  last_synced_at: string | null;
  last_sync_status: 'success' | 'failed' | 'pending' | null;
  last_sync_error: string | null;
  is_active: boolean;
  created_at: string;
}

interface SyncLog {
  id: string;
  direction: string;
  status: string;
  skills_added: number;
  skills_updated: number;
  skills_removed: number;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
}

export default function SkillRepositoriesPage() {
  const [repositories, setRepositories] = useState<SkillRepository[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState<SkillRepository | null>(null);
  const [syncLogs, setSyncLogs] = useState<SyncLog[]>([]);
  const [isSyncing, setIsSyncing] = useState<string | null>(null);

  useEffect(() => {
    fetchRepositories();
  }, []);

  const fetchRepositories = async () => {
    try {
      const response = await fetch('/api/v1/skill-repositories', {
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        setRepositories(data.repositories);
      }
    } catch (error) {
      console.error('Failed to fetch repositories:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSync = async (repoId: string) => {
    setIsSyncing(repoId);
    try {
      const response = await fetch(`/api/v1/skill-repositories/${repoId}/sync`, {
        method: 'POST',
        credentials: 'include',
      });
      if (response.ok) {
        // Refresh repositories after sync
        await fetchRepositories();
      }
    } catch (error) {
      console.error('Sync failed:', error);
    } finally {
      setIsSyncing(null);
    }
  };

  const handleDelete = async (repoId: string) => {
    if (!confirm('Are you sure you want to disconnect this repository?')) return;

    try {
      const response = await fetch(`/api/v1/skill-repositories/${repoId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (response.ok) {
        setRepositories((prev) => prev.filter((r) => r.id !== repoId));
      }
    } catch (error) {
      console.error('Delete failed:', error);
    }
  };

  const fetchSyncLogs = async (repoId: string) => {
    try {
      const response = await fetch(`/api/v1/skill-repositories/${repoId}/logs`, {
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        setSyncLogs(data.logs);
      }
    } catch (error) {
      console.error('Failed to fetch sync logs:', error);
    }
  };

  const handleViewRepo = (repo: SkillRepository) => {
    setSelectedRepo(repo);
    fetchSyncLogs(repo.id);
  };

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">Git Repositories</h1>
          <p className="text-text-muted mt-1">
            Connect git repositories to sync skills automatically
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-accent-primary hover:bg-accent-primary/80 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="h-4 w-4" />
          Connect Repository
        </button>
      </div>

      {/* Repository List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 border-2 border-accent-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : repositories.length === 0 ? (
        <div className="text-center py-12 bg-surface rounded-xl border border-border-subtle">
          <GitBranch className="h-12 w-12 text-text-muted mx-auto mb-3" />
          <h3 className="text-lg font-medium text-text-primary">No Repositories Connected</h3>
          <p className="text-text-muted mt-1 max-w-md mx-auto">
            Connect a git repository to automatically sync your skills with version control.
          </p>
          <button
            onClick={() => setShowAddModal(true)}
            className="mt-4 px-4 py-2 bg-accent-primary hover:bg-accent-primary/80 text-white rounded-lg text-sm font-medium transition-colors"
          >
            Connect Your First Repository
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {repositories.map((repo) => (
            <div
              key={repo.id}
              className="bg-surface rounded-xl border border-border-subtle p-4 hover:border-border-medium transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-overlay">
                    <GitBranch className="h-5 w-5 text-text-muted" />
                  </div>
                  <div>
                    <h3 className="font-medium text-text-primary">{repo.name}</h3>
                    <p className="text-sm text-text-muted truncate max-w-md">{repo.repo_url}</p>
                    <div className="flex items-center gap-4 mt-2 text-xs text-text-muted">
                      <span className="flex items-center gap-1">
                        <GitBranch className="h-3 w-3" />
                        {repo.branch}
                      </span>
                      <span className="flex items-center gap-1">
                        <Folder className="h-3 w-3" />
                        {repo.skills_path}
                      </span>
                      <span className="capitalize">{repo.sync_direction}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {/* Sync Status */}
                  {repo.last_sync_status && (
                    <div
                      className={cn(
                        'flex items-center gap-1 px-2 py-1 rounded-full text-xs',
                        repo.last_sync_status === 'success' && 'bg-green-500/10 text-green-400',
                        repo.last_sync_status === 'failed' && 'bg-red-500/10 text-red-400',
                        repo.last_sync_status === 'pending' && 'bg-yellow-500/10 text-yellow-400'
                      )}
                    >
                      {repo.last_sync_status === 'success' && <CheckCircle className="h-3 w-3" />}
                      {repo.last_sync_status === 'failed' && <XCircle className="h-3 w-3" />}
                      {repo.last_sync_status === 'pending' && (
                        <RefreshCw className="h-3 w-3 animate-spin" />
                      )}
                      {repo.last_synced_at && (
                        <span>
                          {formatDistanceToNow(new Date(repo.last_synced_at), {
                            addSuffix: true,
                          })}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Actions */}
                  <button
                    onClick={() => handleSync(repo.id)}
                    disabled={isSyncing === repo.id}
                    className="p-2 rounded-lg hover:bg-overlay text-text-muted hover:text-text-primary transition-colors disabled:opacity-50"
                    title="Sync now"
                  >
                    <RefreshCw className={cn('h-4 w-4', isSyncing === repo.id && 'animate-spin')} />
                  </button>
                  <button
                    onClick={() => handleViewRepo(repo)}
                    className="p-2 rounded-lg hover:bg-overlay text-text-muted hover:text-text-primary transition-colors"
                    title="View details"
                  >
                    <Settings className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(repo.id)}
                    className="p-2 rounded-lg hover:bg-overlay text-text-muted hover:text-red-400 transition-colors"
                    title="Disconnect"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Error message */}
              {repo.last_sync_error && (
                <div className="mt-3 p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
                  {repo.last_sync_error}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add Repository Modal */}
      {showAddModal && (
        <AddRepositoryModal
          onClose={() => setShowAddModal(false)}
          onSuccess={() => {
            setShowAddModal(false);
            fetchRepositories();
          }}
        />
      )}

      {/* Repository Details Modal */}
      {selectedRepo && (
        <RepositoryDetailsModal
          repo={selectedRepo}
          logs={syncLogs}
          onClose={() => {
            setSelectedRepo(null);
            setSyncLogs([]);
          }}
        />
      )}
    </div>
  );
}

function AddRepositoryModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [name, setName] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [branch, setBranch] = useState('main');
  const [skillsPath, setSkillsPath] = useState('/skills');
  const [syncDirection, setSyncDirection] = useState<'pull' | 'push' | 'bidirectional'>('pull');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/v1/skill-repositories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name,
          repo_url: repoUrl,
          branch,
          skills_path: skillsPath,
          sync_direction: syncDirection,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || 'Failed to connect repository');
      }

      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect repository');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-surface border border-border-subtle rounded-xl shadow-2xl w-full max-w-lg">
        <div className="px-6 py-4 border-b border-border-subtle">
          <h2 className="text-lg font-semibold text-text-primary">Connect Repository</h2>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="text-sm font-medium text-text-primary block mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Skills Repo"
              required
              className="w-full px-3 py-2 bg-surface border border-border-subtle rounded-lg text-text-primary focus:border-accent-primary outline-none"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-text-primary block mb-1">
              Repository URL
            </label>
            <input
              type="url"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              placeholder="https://github.com/user/skills-repo.git"
              required
              className="w-full px-3 py-2 bg-surface border border-border-subtle rounded-lg text-text-primary focus:border-accent-primary outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-text-primary block mb-1">Branch</label>
              <input
                type="text"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                placeholder="main"
                className="w-full px-3 py-2 bg-surface border border-border-subtle rounded-lg text-text-primary focus:border-accent-primary outline-none"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-text-primary block mb-1">
                Skills Path
              </label>
              <input
                type="text"
                value={skillsPath}
                onChange={(e) => setSkillsPath(e.target.value)}
                placeholder="/skills"
                className="w-full px-3 py-2 bg-surface border border-border-subtle rounded-lg text-text-primary focus:border-accent-primary outline-none"
              />
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-text-primary block mb-1">
              Sync Direction
            </label>
            <select
              value={syncDirection}
              onChange={(e) => setSyncDirection(e.target.value as typeof syncDirection)}
              className="w-full px-3 py-2 bg-surface border border-border-subtle rounded-lg text-text-primary focus:border-accent-primary outline-none"
            >
              <option value="pull">Pull (Repository → Podex)</option>
              <option value="push">Push (Podex → Repository)</option>
              <option value="bidirectional">Bidirectional</option>
            </select>
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-text-secondary hover:text-text-primary transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 bg-accent-primary hover:bg-accent-primary/80 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            >
              {isSubmitting ? 'Connecting...' : 'Connect Repository'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function RepositoryDetailsModal({
  repo,
  logs,
  onClose,
}: {
  repo: SkillRepository;
  logs: SyncLog[];
  onClose: () => void;
}) {
  const [webhookUrl, setWebhookUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const fetchWebhookUrl = async () => {
      try {
        const response = await fetch(`/api/v1/skill-repositories/${repo.id}/webhook-url`, {
          credentials: 'include',
        });
        if (response.ok) {
          const data = await response.json();
          setWebhookUrl(data.webhook_url);
        }
      } catch (error) {
        console.error('Failed to fetch webhook URL:', error);
      }
    };
    fetchWebhookUrl();
  }, [repo.id]);

  const handleCopyWebhook = () => {
    if (webhookUrl) {
      navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-surface border border-border-subtle rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        <div className="px-6 py-4 border-b border-border-subtle flex items-center justify-between">
          <h2 className="text-lg font-semibold text-text-primary">{repo.name}</h2>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary transition-colors"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Webhook URL */}
          {webhookUrl && (
            <div>
              <h3 className="text-sm font-semibold text-text-primary mb-2">Webhook URL</h3>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={webhookUrl}
                  readOnly
                  className="flex-1 px-3 py-2 bg-overlay border border-border-subtle rounded-lg text-text-muted text-sm font-mono"
                />
                <button
                  onClick={handleCopyWebhook}
                  className="p-2 rounded-lg hover:bg-overlay text-text-muted hover:text-text-primary transition-colors"
                >
                  {copied ? (
                    <CheckCircle className="h-4 w-4 text-green-400" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </button>
              </div>
              <p className="text-xs text-text-muted mt-1">
                Add this URL as a webhook in your repository settings to enable automatic syncs.
              </p>
            </div>
          )}

          {/* Sync History */}
          <div>
            <h3 className="text-sm font-semibold text-text-primary mb-3">Sync History</h3>
            {logs.length === 0 ? (
              <p className="text-sm text-text-muted">No sync history yet</p>
            ) : (
              <div className="space-y-2">
                {logs.map((log) => (
                  <div
                    key={log.id}
                    className="p-3 rounded-lg bg-overlay border border-border-subtle"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {log.status === 'success' ? (
                          <CheckCircle className="h-4 w-4 text-green-400" />
                        ) : log.status === 'failed' ? (
                          <XCircle className="h-4 w-4 text-red-400" />
                        ) : (
                          <RefreshCw className="h-4 w-4 text-yellow-400 animate-spin" />
                        )}
                        <span className="text-sm font-medium text-text-primary capitalize">
                          {log.direction} - {log.status}
                        </span>
                      </div>
                      <span className="text-xs text-text-muted">
                        {formatDistanceToNow(new Date(log.started_at), { addSuffix: true })}
                      </span>
                    </div>
                    {log.status === 'success' && (
                      <div className="mt-2 text-xs text-text-muted">
                        Added: {log.skills_added} • Updated: {log.skills_updated} • Removed:{' '}
                        {log.skills_removed}
                      </div>
                    )}
                    {log.error_message && (
                      <div className="mt-2 text-xs text-red-400">{log.error_message}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
