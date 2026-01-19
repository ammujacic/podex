/**
 * Result displays for git tools.
 */

import React from 'react';
import { GitBranch, GitCommit, GitPullRequest, Upload, Code, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ResultComponentProps } from './types';

export const GitStatusResult = React.memo<ResultComponentProps>(function GitStatusResult({
  result,
}) {
  const branch = result.branch as string;
  const changes = (result.changes as Array<Record<string, unknown>>) || [];
  const hasChanges = result.has_changes as boolean;

  return (
    <div className="mt-2 p-2 rounded-md bg-elevated border border-border-subtle">
      <div className="flex items-center gap-2">
        <GitBranch className="h-4 w-4 text-accent-primary" />
        <span className="text-sm font-medium text-text-primary">{branch}</span>
        <span
          className={cn(
            'text-xs ml-auto',
            hasChanges ? 'text-accent-warning' : 'text-accent-success'
          )}
        >
          {hasChanges ? `${changes.length} changes` : 'Clean'}
        </span>
      </div>
      {changes.length > 0 && (
        <div className="mt-1 space-y-0.5 max-h-24 overflow-y-auto">
          {changes.slice(0, 5).map((change, i) => (
            <div key={i} className="flex items-center gap-1 text-xs font-mono">
              <span
                className={cn(
                  'w-4',
                  change.status === 'M' && 'text-accent-warning',
                  change.status === 'A' && 'text-accent-success',
                  change.status === 'D' && 'text-accent-error',
                  change.status === '?' && 'text-text-muted'
                )}
              >
                {change.status as string}
              </span>
              <span className="text-text-secondary truncate">{change.file as string}</span>
            </div>
          ))}
          {changes.length > 5 && (
            <div className="text-xs text-text-muted">+{changes.length - 5} more</div>
          )}
        </div>
      )}
    </div>
  );
});

export const GitCommitResult = React.memo<ResultComponentProps>(function GitCommitResult({
  result,
}) {
  const hash = result.commit_hash as string;
  const message = result.message as string;

  return (
    <div className="mt-2 p-2 rounded-md bg-accent-success/10 border border-accent-success/20">
      <div className="flex items-center gap-2">
        <GitCommit className="h-4 w-4 text-accent-success" />
        <span className="text-sm font-medium text-text-primary">Committed</span>
        <span className="text-xs text-accent-success font-mono ml-auto">{hash?.slice(0, 7)}</span>
      </div>
      {message && <div className="mt-1 text-xs text-text-secondary truncate">{message}</div>}
    </div>
  );
});

export const GitPushResult = React.memo<ResultComponentProps>(function GitPushResult({ result }) {
  const remote = result.remote as string;
  const branch = result.branch as string;

  return (
    <div className="mt-2 p-2 rounded-md bg-accent-success/10 border border-accent-success/20">
      <div className="flex items-center gap-2">
        <Upload className="h-4 w-4 text-accent-success" />
        <span className="text-sm font-medium text-text-primary">Pushed</span>
        <span className="text-xs text-accent-success ml-auto">
          {remote}/{branch}
        </span>
      </div>
    </div>
  );
});

export const GitDiffResult = React.memo<ResultComponentProps>(function GitDiffResult({ result }) {
  const diff = result.diff as string;
  const hasChanges = result.has_changes as boolean;

  return (
    <div className="mt-2 p-2 rounded-md bg-elevated border border-border-subtle">
      <div className="flex items-center gap-2">
        <Code className="h-4 w-4 text-accent-primary" />
        <span className="text-sm font-medium text-text-primary">Diff</span>
        <span
          className={cn(
            'text-xs ml-auto',
            hasChanges ? 'text-accent-warning' : 'text-accent-success'
          )}
        >
          {hasChanges ? 'Changes found' : 'No changes'}
        </span>
      </div>
      {diff && (
        <details className="mt-1">
          <summary className="text-xs text-text-muted cursor-pointer hover:text-text-secondary">
            View diff
          </summary>
          <pre className="mt-1 p-2 rounded bg-void/50 text-text-secondary text-xs overflow-x-auto max-h-40 overflow-y-auto font-mono">
            {diff.slice(0, 2000)}
            {diff.length > 2000 ? '...' : ''}
          </pre>
        </details>
      )}
    </div>
  );
});

export const GitBranchResult = React.memo<ResultComponentProps>(function GitBranchResult({
  result,
}) {
  const action = result.action as string;
  const branch = result.branch as string;
  const current = result.current as string;
  const branches = (result.branches as string[]) || [];

  return (
    <div className="mt-2 p-2 rounded-md bg-elevated border border-border-subtle">
      <div className="flex items-center gap-2">
        <GitBranch className="h-4 w-4 text-accent-primary" />
        <span className="text-sm font-medium text-text-primary">
          {action === 'list' ? 'Branches' : `Branch ${action}d`}
        </span>
        {branch && <span className="text-xs text-accent-primary ml-auto">{branch}</span>}
      </div>
      {action === 'list' && branches.length > 0 && (
        <div className="mt-1 space-y-0.5">
          {branches.slice(0, 5).map((b, i) => (
            <div key={i} className="text-xs text-text-secondary flex items-center gap-1">
              {b === current && <span className="text-accent-success">*</span>}
              {b}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

export const GitLogResult = React.memo<ResultComponentProps>(function GitLogResult({ result }) {
  const commits = (result.commits as Array<Record<string, unknown>>) || [];

  return (
    <div className="mt-2 p-2 rounded-md bg-elevated border border-border-subtle">
      <div className="flex items-center gap-2">
        <GitCommit className="h-4 w-4 text-text-secondary" />
        <span className="text-sm font-medium text-text-primary">Commit History</span>
        <span className="text-xs text-text-muted ml-auto">{commits.length} commits</span>
      </div>
      {commits.length > 0 && (
        <div className="mt-1 space-y-1 max-h-32 overflow-y-auto">
          {commits.slice(0, 5).map((commit, i) => (
            <div key={i} className="text-xs flex items-start gap-2">
              <span className="text-accent-primary font-mono shrink-0">
                {(commit.hash as string)?.slice(0, 7)}
              </span>
              <span className="text-text-secondary truncate">{commit.message as string}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

export const CreatePRResult = React.memo<ResultComponentProps>(function CreatePRResult({ result }) {
  const title = result.title as string;
  const url = result.url as string;
  const draft = result.draft as boolean;

  return (
    <div className="mt-2 p-2 rounded-md bg-accent-success/10 border border-accent-success/20">
      <div className="flex items-center gap-2">
        <GitPullRequest className="h-4 w-4 text-accent-success" />
        <span className="text-sm font-medium text-text-primary truncate flex-1">{title}</span>
        {draft && <span className="text-xs text-text-muted">Draft</span>}
      </div>
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 text-xs text-accent-primary hover:underline flex items-center gap-1"
        >
          <ExternalLink className="h-3 w-3" />
          View PR
        </a>
      )}
    </div>
  );
});
