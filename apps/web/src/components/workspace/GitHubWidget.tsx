'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Github,
  GitPullRequest,
  Play,
  CircleDot,
  Check,
  X,
  Clock,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Plus,
  ExternalLink,
  Loader2,
  Zap,
} from 'lucide-react';
import { Button } from '@podex/ui';
import { cn } from '@/lib/utils';

// ============================================================================
// Types
// ============================================================================

interface GitHubUser {
  id: number;
  login: string;
  avatar_url: string | null;
}

interface GitHubLabel {
  id: number;
  name: string;
  color: string;
}

interface GitHubPullRequest {
  id: number;
  number: number;
  title: string;
  state: string;
  draft: boolean;
  merged: boolean;
  html_url: string;
  user: GitHubUser;
  head_ref: string;
  base_ref: string;
  labels: GitHubLabel[];
  additions: number;
  deletions: number;
  changed_files: number;
  created_at: string;
  updated_at: string;
}

interface GitHubWorkflowRun {
  id: number;
  name: string;
  workflow_id: number;
  status: string;
  conclusion: string | null;
  html_url: string;
  run_number: number;
  event: string;
  head_branch: string | null;
  created_at: string;
}

interface GitHubWidgetProps {
  repoOwner: string;
  repoName: string;
  sessionId: string;
}

// ============================================================================
// Status Icons
// ============================================================================

function RunStatusIcon({ status, conclusion }: { status: string; conclusion: string | null }) {
  if (status === 'in_progress' || status === 'queued') {
    return <Loader2 className="w-4 h-4 text-yellow-400 animate-spin" />;
  }

  switch (conclusion) {
    case 'success':
      return <Check className="w-4 h-4 text-green-400" />;
    case 'failure':
      return <X className="w-4 h-4 text-red-400" />;
    case 'cancelled':
      return <CircleDot className="w-4 h-4 text-text-muted" />;
    case 'skipped':
      return <CircleDot className="w-4 h-4 text-text-muted" />;
    default:
      return <Clock className="w-4 h-4 text-text-muted" />;
  }
}

function PRStateIcon({ state, draft, merged }: { state: string; draft: boolean; merged: boolean }) {
  if (merged) {
    return <GitPullRequest className="w-4 h-4 text-purple-400" />;
  }
  if (draft) {
    return <GitPullRequest className="w-4 h-4 text-text-muted" />;
  }
  if (state === 'open') {
    return <GitPullRequest className="w-4 h-4 text-green-400" />;
  }
  return <GitPullRequest className="w-4 h-4 text-red-400" />;
}

// ============================================================================
// Collapsible Section
// ============================================================================

function CollapsibleSection({
  title,
  icon,
  count,
  status,
  children,
  defaultOpen = true,
  onRefresh,
  isLoading,
}: {
  title: string;
  icon: React.ReactNode;
  count?: number;
  status?: string | null;
  children: React.ReactNode;
  defaultOpen?: boolean;
  onRefresh?: () => void;
  isLoading?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-border-subtle last:border-b-0">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-surface-hover transition-colors"
      >
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-sm font-medium text-text-primary">{title}</span>
          {count !== undefined && (
            <span className="px-1.5 py-0.5 text-xs rounded-full bg-surface-hover text-text-muted">
              {count}
            </span>
          )}
          {status && (
            <span
              className={cn(
                'px-1.5 py-0.5 text-xs rounded',
                status === 'success' && 'bg-green-500/20 text-green-400',
                status === 'failure' && 'bg-red-500/20 text-red-400',
                status === 'in_progress' && 'bg-yellow-500/20 text-yellow-400',
                !['success', 'failure', 'in_progress'].includes(status) &&
                  'bg-surface-hover text-text-muted'
              )}
            >
              {status}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {onRefresh && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRefresh();
              }}
              disabled={isLoading}
              className="p-1 rounded hover:bg-surface-hover text-text-muted"
            >
              <RefreshCw className={cn('w-3.5 h-3.5', isLoading && 'animate-spin')} />
            </button>
          )}
          {isOpen ? (
            <ChevronUp className="w-4 h-4 text-text-muted" />
          ) : (
            <ChevronDown className="w-4 h-4 text-text-muted" />
          )}
        </div>
      </button>
      {isOpen && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

// ============================================================================
// PR List Item
// ============================================================================

function PRListItem({ pr, onClick }: { pr: GitHubPullRequest; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-start gap-2 p-2 rounded-lg hover:bg-surface-hover transition-colors text-left"
    >
      <PRStateIcon state={pr.state} draft={pr.draft} merged={pr.merged} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-text-primary truncate">{pr.title}</span>
          <span className="text-xs text-text-muted">#{pr.number}</span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-text-muted">
            {pr.head_ref} → {pr.base_ref}
          </span>
          <span className="text-xs text-text-muted">
            +{pr.additions} -{pr.deletions}
          </span>
        </div>
        {pr.labels.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {pr.labels.slice(0, 3).map((label) => (
              <span
                key={label.id}
                className="px-1.5 py-0.5 text-xs rounded"
                style={{
                  backgroundColor: `#${label.color}20`,
                  color: `#${label.color}`,
                }}
              >
                {label.name}
              </span>
            ))}
          </div>
        )}
      </div>
      <ExternalLink className="w-3.5 h-3.5 text-text-muted shrink-0" />
    </button>
  );
}

// ============================================================================
// Workflow Run Item
// ============================================================================

function WorkflowRunItem({ run, onClick }: { run: GitHubWorkflowRun; onClick?: () => void }) {
  const timeAgo = (date: string) => {
    const diff = Date.now() - new Date(date).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2 p-2 rounded-lg hover:bg-surface-hover transition-colors text-left"
    >
      <RunStatusIcon status={run.status} conclusion={run.conclusion} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-text-primary truncate">{run.name}</div>
        <div className="flex items-center gap-2 text-xs text-text-muted">
          <span>#{run.run_number}</span>
          <span>{run.event}</span>
          {run.head_branch && <span>{run.head_branch}</span>}
          <span>{timeAgo(run.created_at)}</span>
        </div>
      </div>
      <ExternalLink className="w-3.5 h-3.5 text-text-muted shrink-0" />
    </button>
  );
}

// ============================================================================
// Main Widget
// ============================================================================

export function GitHubWidget({ repoOwner, repoName, sessionId: _sessionId }: GitHubWidgetProps) {
  const [isConnected, setIsConnected] = useState<boolean | null>(null);
  const [pullRequests, setPullRequests] = useState<GitHubPullRequest[]>([]);
  const [workflowRuns, setWorkflowRuns] = useState<GitHubWorkflowRun[]>([]);
  const [isLoadingPRs, setIsLoadingPRs] = useState(false);
  const [isLoadingRuns, setIsLoadingRuns] = useState(false);
  const [_error, _setError] = useState<string | null>(null);

  // Check connection status
  const checkConnection = useCallback(async () => {
    try {
      const response = await fetch('/api/v1/github/status');
      if (response.ok) {
        const data = await response.json();
        setIsConnected(data.connected);
      } else {
        setIsConnected(false);
      }
    } catch {
      setIsConnected(false);
    }
  }, []);

  // Fetch PRs
  const fetchPRs = useCallback(async () => {
    if (!isConnected) return;

    setIsLoadingPRs(true);
    try {
      const response = await fetch(
        `/api/v1/github/repos/${repoOwner}/${repoName}/pulls?state=open&per_page=5`
      );
      if (response.ok) {
        const data = await response.json();
        setPullRequests(data);
      }
    } catch (err) {
      console.error('Failed to fetch PRs:', err);
    } finally {
      setIsLoadingPRs(false);
    }
  }, [repoOwner, repoName, isConnected]);

  // Fetch workflow runs
  const fetchRuns = useCallback(async () => {
    if (!isConnected) return;

    setIsLoadingRuns(true);
    try {
      const response = await fetch(
        `/api/v1/github/repos/${repoOwner}/${repoName}/actions/runs?per_page=5`
      );
      if (response.ok) {
        const data = await response.json();
        setWorkflowRuns(data);
      }
    } catch (err) {
      console.error('Failed to fetch runs:', err);
    } finally {
      setIsLoadingRuns(false);
    }
  }, [repoOwner, repoName, isConnected]);

  useEffect(() => {
    checkConnection();
  }, [checkConnection]);

  useEffect(() => {
    if (isConnected) {
      fetchPRs();
      fetchRuns();
    }
  }, [isConnected, fetchPRs, fetchRuns]);

  // Get latest run status
  const latestRunStatus = workflowRuns[0]?.conclusion || workflowRuns[0]?.status || null;

  // Not connected state
  if (isConnected === false) {
    return (
      <div className="border border-border-default rounded-lg">
        <div className="flex items-center gap-2 p-3 border-b border-border-subtle">
          <Github className="w-4 h-4 text-text-muted" />
          <span className="text-sm font-medium text-text-primary">GitHub</span>
        </div>
        <div className="p-4 text-center">
          <Github className="w-8 h-8 mx-auto text-text-muted opacity-50 mb-2" />
          <p className="text-sm text-text-muted mb-3">Connect GitHub to view PRs and Actions</p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => (window.location.href = '/settings/integrations/github')}
          >
            Connect GitHub
          </Button>
        </div>
      </div>
    );
  }

  // Loading state
  if (isConnected === null) {
    return (
      <div className="border border-border-default rounded-lg">
        <div className="flex items-center gap-2 p-3 border-b border-border-subtle">
          <Github className="w-4 h-4 text-text-muted" />
          <span className="text-sm font-medium text-text-primary">GitHub</span>
        </div>
        <div className="p-4 flex items-center justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-text-muted" />
        </div>
      </div>
    );
  }

  return (
    <div className="border border-border-default rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-surface-hover/50 border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <Github className="w-4 h-4 text-text-muted" />
          <span className="text-sm font-medium text-text-primary">
            {repoOwner}/{repoName}
          </span>
        </div>
        <a
          href={`https://github.com/${repoOwner}/${repoName}`}
          target="_blank"
          rel="noopener noreferrer"
          className="p-1 rounded hover:bg-surface-hover text-text-muted"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>

      {/* Pull Requests Section */}
      <CollapsibleSection
        title="Pull Requests"
        icon={<GitPullRequest className="w-4 h-4 text-green-400" />}
        count={pullRequests.length}
        onRefresh={fetchPRs}
        isLoading={isLoadingPRs}
      >
        {pullRequests.length === 0 ? (
          <p className="text-xs text-text-muted text-center py-2">No open pull requests</p>
        ) : (
          <div className="space-y-1">
            {pullRequests.map((pr) => (
              <PRListItem key={pr.id} pr={pr} onClick={() => window.open(pr.html_url, '_blank')} />
            ))}
          </div>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="w-full mt-2 gap-1"
          onClick={() =>
            window.open(`https://github.com/${repoOwner}/${repoName}/compare`, '_blank')
          }
        >
          <Plus className="w-3.5 h-3.5" />
          Create PR
        </Button>
      </CollapsibleSection>

      {/* Actions Section */}
      <CollapsibleSection
        title="Actions"
        icon={<Zap className="w-4 h-4 text-yellow-400" />}
        status={latestRunStatus}
        onRefresh={fetchRuns}
        isLoading={isLoadingRuns}
      >
        {workflowRuns.length === 0 ? (
          <p className="text-xs text-text-muted text-center py-2">No recent workflow runs</p>
        ) : (
          <div className="space-y-1">
            {workflowRuns.map((run) => (
              <WorkflowRunItem
                key={run.id}
                run={run}
                onClick={() => window.open(run.html_url, '_blank')}
              />
            ))}
          </div>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="w-full mt-2 gap-1"
          onClick={() =>
            window.open(`https://github.com/${repoOwner}/${repoName}/actions`, '_blank')
          }
        >
          <Play className="w-3.5 h-3.5" />
          View All Actions
        </Button>
      </CollapsibleSection>
    </div>
  );
}
