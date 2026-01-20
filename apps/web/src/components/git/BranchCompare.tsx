'use client';

import { useState, useCallback, useMemo } from 'react';
import {
  GitBranch,
  GitCommit,
  FileCode,
  AlertTriangle,
  RefreshCw,
  ArrowRight,
  Plus,
  Minus,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@podex/ui';
import { compareBranches, previewMerge } from '@/lib/api';

// ============================================================================
// Types
// ============================================================================

interface BranchCompareCommit {
  sha: string;
  message: string;
  author: string;
  date: string;
}

interface BranchCompareFile {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
}

interface BranchCompareResult {
  base: string;
  compare: string;
  commits: BranchCompareCommit[];
  files: BranchCompareFile[];
  ahead: number;
  stat: string;
}

interface MergePreviewResult {
  can_merge: boolean;
  has_conflicts: boolean;
  conflicts: string[];
  files_changed: { path: string; status: string }[];
  error?: string;
}

interface Branch {
  name: string;
  current: boolean;
  remote?: string;
}

// ============================================================================
// File Status Badge
// ============================================================================

function FileStatusBadge({ status }: { status: string }) {
  const statusConfig = {
    added: { label: 'A', className: 'bg-green-500/20 text-green-400' },
    modified: { label: 'M', className: 'bg-yellow-500/20 text-yellow-400' },
    deleted: { label: 'D', className: 'bg-red-500/20 text-red-400' },
    renamed: { label: 'R', className: 'bg-blue-500/20 text-blue-400' },
  } as const;

  const config = statusConfig[status as keyof typeof statusConfig] ?? statusConfig.modified;

  return (
    <span className={cn('px-1.5 py-0.5 text-xs font-medium rounded', config.className)}>
      {config.label}
    </span>
  );
}

// ============================================================================
// Commit List
// ============================================================================

function CommitList({ commits }: { commits: BranchCompareCommit[] }) {
  if (commits.length === 0) {
    return (
      <div className="text-center text-text-muted py-4 text-sm">
        No commits between these branches
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {commits.map((commit) => (
        <div
          key={commit.sha}
          className="flex items-start gap-3 p-2 rounded bg-overlay/30 hover:bg-overlay/50"
        >
          <GitCommit className="h-4 w-4 text-text-muted mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-text-primary truncate">{commit.message}</p>
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <span className="font-mono">{commit.sha.slice(0, 7)}</span>
              <span>{commit.author}</span>
              <span>
                {new Date(commit.date).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                })}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// File List
// ============================================================================

function FileList({ files }: { files: BranchCompareFile[] }) {
  const stats = useMemo(() => {
    const added = files.filter((f) => f.status === 'added').length;
    const modified = files.filter((f) => f.status === 'modified').length;
    const deleted = files.filter((f) => f.status === 'deleted').length;
    return { added, modified, deleted };
  }, [files]);

  if (files.length === 0) {
    return (
      <div className="text-center text-text-muted py-4 text-sm">
        No files changed between these branches
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Stats */}
      <div className="flex items-center gap-4 text-xs">
        <span className="text-text-secondary">{files.length} files changed</span>
        {stats.added > 0 && (
          <span className="flex items-center gap-1 text-green-400">
            <Plus className="h-3 w-3" /> {stats.added} added
          </span>
        )}
        {stats.modified > 0 && (
          <span className="flex items-center gap-1 text-yellow-400">
            <FileCode className="h-3 w-3" /> {stats.modified} modified
          </span>
        )}
        {stats.deleted > 0 && (
          <span className="flex items-center gap-1 text-red-400">
            <Minus className="h-3 w-3" /> {stats.deleted} deleted
          </span>
        )}
      </div>

      {/* File list */}
      <div className="space-y-1">
        {files.map((file) => (
          <div key={file.path} className="flex items-center gap-2 p-2 rounded hover:bg-overlay/30">
            <FileStatusBadge status={file.status} />
            <span className="text-sm font-mono text-text-primary truncate">{file.path}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Merge Preview
// ============================================================================

function MergePreview({
  result,
  isLoading,
}: {
  result: MergePreviewResult | null;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
        <span className="ml-2 text-sm text-text-muted">Checking for conflicts...</span>
      </div>
    );
  }

  if (!result) return null;

  if (result.error) {
    return (
      <div className="flex items-start gap-2 p-3 rounded bg-yellow-500/10 border border-yellow-500/30">
        <AlertTriangle className="h-4 w-4 text-yellow-400 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-yellow-400">Cannot preview merge</p>
          <p className="text-xs text-text-muted mt-1">{result.error}</p>
        </div>
      </div>
    );
  }

  if (result.has_conflicts) {
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-2 p-3 rounded bg-red-500/10 border border-red-500/30">
          <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-red-400">Merge conflicts detected</p>
            <p className="text-xs text-text-muted mt-1">
              {result.conflicts.length} file(s) have conflicts that need to be resolved
            </p>
          </div>
        </div>

        <div className="space-y-1">
          <p className="text-xs text-text-muted font-medium uppercase">Conflicting files</p>
          {result.conflicts.map((file) => (
            <div key={file} className="flex items-center gap-2 p-2 rounded bg-red-500/5">
              <AlertTriangle className="h-3 w-3 text-red-400" />
              <span className="text-sm font-mono text-text-primary">{file}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2 p-3 rounded bg-green-500/10 border border-green-500/30">
      <GitBranch className="h-4 w-4 text-green-400 shrink-0 mt-0.5" />
      <div>
        <p className="text-sm font-medium text-green-400">Ready to merge</p>
        <p className="text-xs text-text-muted mt-1">
          No conflicts detected. {result.files_changed.length} file(s) will be changed.
        </p>
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

interface BranchCompareProps {
  sessionId: string;
  branches: Branch[];
  className?: string;
  onClose?: () => void;
}

export function BranchCompare({ sessionId, branches, className, onClose }: BranchCompareProps) {
  const [baseBranch, setBaseBranch] = useState<string>('main');
  const [compareBranch, setCompareBranch] = useState<string>('');
  const [compareResult, setCompareResult] = useState<BranchCompareResult | null>(null);
  const [mergePreview, setMergePreview] = useState<MergePreviewResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isMergeLoading, setIsMergeLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'commits' | 'files'>('commits');

  // Set initial compare branch to current branch if not main
  useState(() => {
    const currentBranch = branches.find((b) => b.current);
    if (currentBranch && currentBranch.name !== 'main') {
      setCompareBranch(currentBranch.name);
    }
  });

  const handleCompare = useCallback(async () => {
    if (!baseBranch || !compareBranch) return;

    setIsLoading(true);
    setError(null);
    setCompareResult(null);
    setMergePreview(null);

    try {
      const data = await compareBranches(sessionId, baseBranch, compareBranch);
      setCompareResult(data as BranchCompareResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to compare branches');
    } finally {
      setIsLoading(false);
    }
  }, [baseBranch, compareBranch, sessionId]);

  const handlePreviewMerge = useCallback(async () => {
    if (!baseBranch || !compareBranch) return;

    setIsMergeLoading(true);

    try {
      const data = await previewMerge(sessionId, compareBranch, baseBranch);
      setMergePreview(data as MergePreviewResult);
    } catch (err) {
      setMergePreview({
        can_merge: false,
        has_conflicts: false,
        conflicts: [],
        files_changed: [],
        error: err instanceof Error ? err.message : 'Failed to preview merge',
      });
    } finally {
      setIsMergeLoading(false);
    }
  }, [baseBranch, compareBranch, sessionId]);

  const swapBranches = useCallback(() => {
    const temp = baseBranch;
    setBaseBranch(compareBranch);
    setCompareBranch(temp);
    setCompareResult(null);
    setMergePreview(null);
  }, [baseBranch, compareBranch]);

  return (
    <div className={cn('flex flex-col h-full bg-surface', className)}>
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-brand-500" />
          <h2 className="text-sm font-medium text-text-primary">Compare Branches</h2>
        </div>
        {onClose && (
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        )}
      </div>

      {/* Branch Selection */}
      <div className="p-4 border-b border-border-subtle bg-elevated">
        <div className="flex items-center gap-3">
          <select
            value={baseBranch}
            onChange={(e) => setBaseBranch(e.target.value)}
            className="w-40 px-3 py-1.5 text-sm rounded bg-elevated border border-border-subtle text-text-primary focus:outline-none focus:ring-2 focus:ring-brand-500/50"
          >
            <option value="" disabled>
              Base branch
            </option>
            {branches.map((branch) => (
              <option key={branch.name} value={branch.name}>
                {branch.name}
              </option>
            ))}
          </select>

          <button
            onClick={swapBranches}
            className="p-1.5 rounded hover:bg-overlay text-text-muted"
            title="Swap branches"
          >
            <ArrowRight className="h-4 w-4" />
          </button>

          <select
            value={compareBranch}
            onChange={(e) => setCompareBranch(e.target.value)}
            className="w-40 px-3 py-1.5 text-sm rounded bg-elevated border border-border-subtle text-text-primary focus:outline-none focus:ring-2 focus:ring-brand-500/50"
          >
            <option value="" disabled>
              Compare branch
            </option>
            {branches
              .filter((b) => b.name !== baseBranch)
              .map((branch) => (
                <option key={branch.name} value={branch.name}>
                  {branch.name}
                </option>
              ))}
          </select>

          <Button
            onClick={handleCompare}
            disabled={!baseBranch || !compareBranch || isLoading}
            size="sm"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            <span className="ml-1">Compare</span>
          </Button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="m-4 p-3 rounded bg-red-500/10 border border-red-500/30 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Results */}
      {compareResult && (
        <div className="flex-1 overflow-auto">
          {/* Stats bar */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-border-subtle bg-overlay/30">
            <div className="flex items-center gap-4 text-sm">
              <span className="text-text-secondary">
                <strong className="text-text-primary">{compareResult.ahead}</strong> commits ahead
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handlePreviewMerge}
              disabled={isMergeLoading}
            >
              {isMergeLoading ? (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              ) : (
                <AlertTriangle className="h-3 w-3 mr-1" />
              )}
              Preview Merge
            </Button>
          </div>

          {/* Merge preview */}
          {(mergePreview || isMergeLoading) && (
            <div className="p-4 border-b border-border-subtle">
              <MergePreview result={mergePreview} isLoading={isMergeLoading} />
            </div>
          )}

          {/* Tabs */}
          <div className="flex border-b border-border-subtle">
            <button
              onClick={() => setActiveTab('commits')}
              className={cn(
                'flex items-center gap-2 px-4 py-2 text-sm border-b-2 -mb-px',
                activeTab === 'commits'
                  ? 'border-brand-500 text-text-primary'
                  : 'border-transparent text-text-muted hover:text-text-secondary'
              )}
            >
              <GitCommit className="h-4 w-4" />
              Commits ({compareResult.commits.length})
            </button>
            <button
              onClick={() => setActiveTab('files')}
              className={cn(
                'flex items-center gap-2 px-4 py-2 text-sm border-b-2 -mb-px',
                activeTab === 'files'
                  ? 'border-brand-500 text-text-primary'
                  : 'border-transparent text-text-muted hover:text-text-secondary'
              )}
            >
              <FileCode className="h-4 w-4" />
              Files ({compareResult.files.length})
            </button>
          </div>

          {/* Tab content */}
          <div className="p-4">
            {activeTab === 'commits' ? (
              <CommitList commits={compareResult.commits} />
            ) : (
              <FileList files={compareResult.files} />
            )}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!compareResult && !isLoading && !error && (
        <div className="flex-1 flex items-center justify-center text-center text-text-muted p-8">
          <div>
            <GitBranch className="h-12 w-12 mx-auto mb-4 opacity-30" />
            <p className="text-sm">Select two branches to compare</p>
            <p className="text-xs mt-1">See commits and files that differ between branches</p>
          </div>
        </div>
      )}
    </div>
  );
}
