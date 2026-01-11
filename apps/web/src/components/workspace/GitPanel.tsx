'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  GitBranch,
  GitCommit,
  Plus,
  Minus,
  Check,
  Upload,
  Download,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  File,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  getGitStatus,
  getGitBranches,
  stageFiles,
  unstageFiles,
  commitChanges,
  pushChanges,
  pullChanges,
  type GitStatus,
  type GitBranch as GitBranchType,
} from '@/lib/api';

export interface GitPanelProps {
  sessionId: string;
}

const statusIcons: Record<string, { icon: string; color: string }> = {
  added: { icon: 'A', color: 'text-green-400' },
  modified: { icon: 'M', color: 'text-yellow-400' },
  deleted: { icon: 'D', color: 'text-red-400' },
  renamed: { icon: 'R', color: 'text-blue-400' },
  copied: { icon: 'C', color: 'text-purple-400' },
  untracked: { icon: 'U', color: 'text-gray-400' },
};

export function GitPanel({ sessionId }: GitPanelProps) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [branches, setBranches] = useState<GitBranchType[]>([]);
  const [loading, setLoading] = useState(true);
  const [committing, setCommitting] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');
  const [showStagedSection, setShowStagedSection] = useState(true);
  const [showUnstagedSection, setShowUnstagedSection] = useState(true);
  const [showUntrackedSection, setShowUntrackedSection] = useState(true);
  const [showBranchSelector, setShowBranchSelector] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadGitData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statusData, branchesData] = await Promise.all([
        getGitStatus(sessionId),
        getGitBranches(sessionId),
      ]);
      setStatus(statusData);
      setBranches(branchesData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Git data');
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    loadGitData();
  }, [loadGitData]);

  const handleStageFile = async (path: string) => {
    try {
      await stageFiles(sessionId, [path]);
      await loadGitData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stage file');
    }
  };

  const handleUnstageFile = async (path: string) => {
    try {
      await unstageFiles(sessionId, [path]);
      await loadGitData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unstage file');
    }
  };

  const handleStageAll = async () => {
    if (!status) return;
    const files = [...status.unstaged.map((f) => f.path), ...status.untracked];
    try {
      await stageFiles(sessionId, files);
      await loadGitData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stage files');
    }
  };

  const handleUnstageAll = async () => {
    if (!status) return;
    const files = status.staged.map((f) => f.path);
    try {
      await unstageFiles(sessionId, files);
      await loadGitData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unstage files');
    }
  };

  const handleCommit = async () => {
    if (!commitMessage.trim()) return;
    setCommitting(true);
    try {
      await commitChanges(sessionId, commitMessage.trim());
      setCommitMessage('');
      await loadGitData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to commit');
    } finally {
      setCommitting(false);
    }
  };

  const handlePush = async () => {
    setPushing(true);
    try {
      await pushChanges(sessionId);
      await loadGitData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to push');
    } finally {
      setPushing(false);
    }
  };

  const handlePull = async () => {
    setPulling(true);
    try {
      await pullChanges(sessionId);
      await loadGitData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to pull');
    } finally {
      setPulling(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-center">
        <p className="text-accent-error text-sm mb-2">{error}</p>
        <button onClick={loadGitData} className="text-sm text-accent-primary hover:underline">
          Retry
        </button>
      </div>
    );
  }

  if (!status) return null;

  const totalChanges = status.staged.length + status.unstaged.length + status.untracked.length;

  return (
    <div className="flex flex-col h-full">
      {/* Branch selector */}
      <div className="px-3 py-2 border-b border-border-subtle">
        <button
          onClick={() => setShowBranchSelector(!showBranchSelector)}
          className="flex items-center gap-2 w-full text-left"
        >
          <GitBranch className="h-4 w-4 text-accent-primary" />
          <span className="text-sm font-medium text-text-primary flex-1">{status.branch}</span>
          {(status.ahead > 0 || status.behind > 0) && (
            <span className="text-xs text-text-muted">
              {status.ahead > 0 && <span className="text-accent-success">+{status.ahead}</span>}
              {status.ahead > 0 && status.behind > 0 && ' '}
              {status.behind > 0 && <span className="text-accent-warning">-{status.behind}</span>}
            </span>
          )}
          <ChevronDown
            className={cn(
              'h-3 w-3 text-text-muted transition-transform',
              showBranchSelector && 'rotate-180'
            )}
          />
        </button>

        {showBranchSelector && (
          <div className="mt-2 bg-elevated rounded border border-border-default max-h-40 overflow-y-auto">
            {branches
              .filter((b) => !b.is_remote)
              .map((branch) => (
                <button
                  key={branch.name}
                  className={cn(
                    'w-full flex items-center gap-2 px-2 py-1.5 text-xs text-left hover:bg-overlay',
                    branch.is_current && 'bg-overlay'
                  )}
                >
                  <GitBranch className="h-3 w-3" />
                  {branch.name}
                  {branch.is_current && <Check className="h-3 w-3 ml-auto text-accent-success" />}
                </button>
              ))}
          </div>
        )}
      </div>

      {/* Actions bar */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-border-subtle">
        <button
          onClick={loadGitData}
          className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-overlay"
          title="Refresh"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
        <button
          onClick={handlePull}
          disabled={pulling}
          className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-overlay disabled:opacity-50"
          title="Pull"
        >
          {pulling ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
        </button>
        <button
          onClick={handlePush}
          disabled={pushing || status.ahead === 0}
          className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-overlay disabled:opacity-50"
          title="Push"
        >
          {pushing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        </button>
      </div>

      {/* Changes */}
      <div className="flex-1 overflow-y-auto">
        {totalChanges === 0 ? (
          <div className="p-4 text-center text-text-muted text-sm">
            <GitCommit className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>No changes</p>
            <p className="text-xs mt-1">Your working directory is clean</p>
          </div>
        ) : (
          <>
            {/* Staged changes */}
            {status.staged.length > 0 && (
              <div>
                <div
                  onClick={() => setShowStagedSection(!showStagedSection)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-text-secondary hover:bg-overlay cursor-pointer"
                >
                  {showStagedSection ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                  Staged Changes ({status.staged.length})
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleUnstageAll();
                    }}
                    className="ml-auto p-0.5 rounded hover:bg-elevated"
                    title="Unstage all"
                  >
                    <Minus className="h-3 w-3" />
                  </button>
                </div>
                {showStagedSection && (
                  <div className="px-2">
                    {status.staged.map((file) => (
                      <div
                        key={file.path}
                        className="flex items-center gap-2 px-2 py-1 text-xs rounded hover:bg-overlay group"
                      >
                        <span
                          className={cn(
                            'font-mono',
                            statusIcons[file.status]?.color || 'text-text-muted'
                          )}
                        >
                          {statusIcons[file.status]?.icon || '?'}
                        </span>
                        <File className="h-3 w-3 text-text-muted" />
                        <span className="flex-1 truncate text-text-secondary">{file.path}</span>
                        <button
                          onClick={() => handleUnstageFile(file.path)}
                          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-elevated"
                          title="Unstage"
                        >
                          <Minus className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Unstaged changes */}
            {status.unstaged.length > 0 && (
              <div>
                <div
                  onClick={() => setShowUnstagedSection(!showUnstagedSection)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-text-secondary hover:bg-overlay cursor-pointer"
                >
                  {showUnstagedSection ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                  Changes ({status.unstaged.length})
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleStageAll();
                    }}
                    className="ml-auto p-0.5 rounded hover:bg-elevated"
                    title="Stage all"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </div>
                {showUnstagedSection && (
                  <div className="px-2">
                    {status.unstaged.map((file) => (
                      <div
                        key={file.path}
                        className="flex items-center gap-2 px-2 py-1 text-xs rounded hover:bg-overlay group"
                      >
                        <span
                          className={cn(
                            'font-mono',
                            statusIcons[file.status]?.color || 'text-text-muted'
                          )}
                        >
                          {statusIcons[file.status]?.icon || '?'}
                        </span>
                        <File className="h-3 w-3 text-text-muted" />
                        <span className="flex-1 truncate text-text-secondary">{file.path}</span>
                        <button
                          onClick={() => handleStageFile(file.path)}
                          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-elevated"
                          title="Stage"
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Untracked files */}
            {status.untracked.length > 0 && (
              <div>
                <button
                  onClick={() => setShowUntrackedSection(!showUntrackedSection)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-text-secondary hover:bg-overlay"
                >
                  {showUntrackedSection ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                  Untracked ({status.untracked.length})
                </button>
                {showUntrackedSection && (
                  <div className="px-2">
                    {status.untracked.map((path) => (
                      <div
                        key={path}
                        className="flex items-center gap-2 px-2 py-1 text-xs rounded hover:bg-overlay group"
                      >
                        <span className="font-mono text-gray-400">U</span>
                        <File className="h-3 w-3 text-text-muted" />
                        <span className="flex-1 truncate text-text-secondary">{path}</span>
                        <button
                          onClick={() => handleStageFile(path)}
                          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-elevated"
                          title="Stage"
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Commit section */}
      {status.staged.length > 0 && (
        <div className="border-t border-border-subtle p-3">
          <textarea
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            placeholder="Commit message..."
            className="w-full bg-elevated border border-border-default rounded px-2 py-1.5 text-sm text-text-primary placeholder:text-text-muted resize-none focus:border-accent-primary focus:outline-none"
            rows={2}
          />
          <button
            onClick={handleCommit}
            disabled={!commitMessage.trim() || committing}
            className="mt-2 w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded bg-accent-primary text-text-inverse text-sm font-medium hover:bg-opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {committing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            Commit
          </button>
        </div>
      )}
    </div>
  );
}
