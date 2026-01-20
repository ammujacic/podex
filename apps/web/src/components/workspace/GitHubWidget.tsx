'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
  GitBranch,
  Filter,
  XCircle,
} from 'lucide-react';
import { Button } from '@podex/ui';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@podex/ui';
import {
  getGitHubStatus,
  getGitHubPullRequests,
  getGitHubWorkflowRuns,
  getGitHubWorkflowJobs,
  getGitHubBranches,
  getGitHubRepos,
  type GitHubPullRequest,
  type GitHubWorkflowRun,
  type GitHubWorkflowJob,
  type GitHubRepo,
} from '@/lib/api';
import { cn } from '@/lib/utils';
import { useSessionStore } from '@/stores/session';
import { useUIStore } from '@/stores/ui';

// ============================================================================
// Types
// ============================================================================

interface GitHubWidgetProps {
  sessionId: string;
  repoOwner?: string;
  repoName?: string;
}

interface GitHubRepoInfo {
  owner: string;
  repo: string;
}

function parseGitHubRepo(gitUrl: string | null | undefined): GitHubRepoInfo | null {
  if (!gitUrl) return null;

  try {
    if (gitUrl.startsWith('git@')) {
      const match = gitUrl.match(/^git@github\.com:(.+?)\/(.+?)(\.git)?$/);
      if (!match) return null;
      const owner = match[1];
      const repo = match[2];
      return owner && repo ? { owner, repo } : null;
    }

    const url = new URL(gitUrl);
    if (url.hostname !== 'github.com') return null;
    const parts = url.pathname.replace(/^\/+/, '').split('/');
    if (parts.length < 2) return null;
    const owner = parts[0] || '';
    const repo = (parts[1] || '').replace(/\.git$/, '');
    if (!owner || !repo) return null;
    return { owner, repo };
  } catch {
    return null;
  }
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
  isOpen,
  setIsOpen,
}: {
  title: string;
  icon: React.ReactNode;
  count?: number;
  status?: string | null;
  children: React.ReactNode;
  defaultOpen?: boolean;
  onRefresh?: () => void;
  isLoading?: boolean;
  isOpen?: boolean;
  setIsOpen?: (open: boolean) => void;
}) {
  const [localIsOpen, setLocalIsOpen] = useState(defaultOpen);
  const effectiveIsOpen = isOpen !== undefined ? isOpen : localIsOpen;
  const effectiveSetIsOpen = setIsOpen || setLocalIsOpen;

  return (
    <div className="border-b border-border-subtle last:border-b-0">
      <div className="flex items-center">
        <button
          onClick={() => effectiveSetIsOpen(!effectiveIsOpen)}
          className="flex-1 flex items-center justify-between px-3 py-2 hover:bg-surface-hover transition-colors"
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
            {effectiveIsOpen ? (
              <ChevronUp className="w-4 h-4 text-text-muted" />
            ) : (
              <ChevronDown className="w-4 h-4 text-text-muted" />
            )}
          </div>
        </button>
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={isLoading}
            className="p-1 rounded hover:bg-surface-hover text-text-muted shrink-0"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', isLoading && 'animate-spin')} />
          </button>
        )}
      </div>
      {effectiveIsOpen && <div className="px-3 pb-3">{children}</div>}
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

// ============================================================================

function WorkflowRunItem({
  run,
  jobs,
  isLoadingJobs,
  onClick,
  onLoadJobs,
}: {
  run: GitHubWorkflowRun;
  jobs?: GitHubWorkflowJob[];
  isLoadingJobs?: boolean;
  onClick?: () => void;
  onLoadJobs?: () => void;
}) {
  const timeAgo = (date: string) => {
    const diff = Date.now() - new Date(date).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  const getStatusColor = () => {
    return 'border-border-subtle bg-surface-hover';
  };

  // Calculate job stats
  const jobStats = jobs
    ? jobs.reduce(
        (acc, job) => {
          if (job.conclusion === 'success') acc.passed++;
          else if (job.conclusion === 'failure') acc.failed++;
          else if (job.status === 'in_progress') acc.running++;
          else if (job.status === 'queued') acc.queued++;
          return acc;
        },
        { passed: 0, failed: 0, running: 0, queued: 0 }
      )
    : null;

  const totalJobs = jobs?.length || 0;

  return (
    <div
      className={cn(
        'w-full rounded-lg border transition-all cursor-pointer',
        'hover:shadow-md',
        getStatusColor()
      )}
      onClick={onClick}
    >
      <div className="w-full flex items-center gap-3 p-3 text-left group">
        <div className="shrink-0">
          <RunStatusIcon status={run.status} conclusion={run.conclusion} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-semibold text-text-primary truncate">{run.name}</span>
            <span className="text-xs text-text-tertiary font-mono">#{run.run_number}</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <span className="px-2 py-0.5 text-xs rounded-md bg-surface-hover/80 text-text-muted font-medium">
              {run.event}
            </span>
            {run.head_branch && (
              <span className="flex items-center gap-1 px-2 py-0.5 text-xs rounded-md bg-surface-hover/80 text-text-muted">
                <GitBranch className="w-3 h-3" />
                {run.head_branch}
              </span>
            )}
            <span className="text-xs text-text-tertiary">{timeAgo(run.created_at)}</span>
          </div>

          {/* Job Stats */}
          {jobStats && totalJobs > 0 && (
            <div className="flex items-center gap-2 text-xs">
              {jobStats.passed > 0 && (
                <span className="flex items-center gap-1 px-2 py-1 rounded-md bg-green-50 dark:bg-green-950/20 text-green-700 dark:text-green-400 font-medium">
                  <Check className="w-3 h-3" />
                  {jobStats.passed}
                </span>
              )}
              {jobStats.failed > 0 && (
                <span className="flex items-center gap-1 px-2 py-1 rounded-md bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-400 font-semibold border border-red-200 dark:border-red-800">
                  <X className="w-3 h-3" />
                  {jobStats.failed}
                </span>
              )}
              {jobStats.running > 0 && (
                <span className="flex items-center gap-1 px-2 py-1 rounded-md bg-yellow-50 dark:bg-yellow-950/20 text-yellow-700 dark:text-yellow-400 font-medium">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  {jobStats.running}
                </span>
              )}
              {jobStats.queued > 0 && (
                <span className="flex items-center gap-1 px-2 py-1 rounded-md bg-surface-hover text-text-muted font-medium">
                  <Clock className="w-3 h-3" />
                  {jobStats.queued}
                </span>
              )}
              <span className="text-text-tertiary ml-1">of {totalJobs} jobs</span>
            </div>
          )}

          {/* Failed Jobs List */}
          {jobs && jobs.some((job) => job.conclusion === 'failure') && (
            <div className="mt-3 p-2 rounded-md bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800">
              <div className="text-xs font-medium text-red-700 dark:text-red-400 mb-2">
                Failed Jobs:
              </div>
              <div className="space-y-1">
                {jobs
                  .filter((job) => job.conclusion === 'failure')
                  .slice(0, 3)
                  .map((job) => (
                    <div key={job.id} className="flex items-center gap-2 text-xs">
                      <X className="w-3 h-3 text-red-500 flex-shrink-0" />
                      <span className="text-red-700 dark:text-red-300 truncate font-medium">
                        {job.name}
                      </span>
                    </div>
                  ))}
                {jobs.filter((job) => job.conclusion === 'failure').length > 3 && (
                  <div className="text-xs text-red-600 dark:text-red-400 pl-5 font-medium">
                    +{jobs.filter((job) => job.conclusion === 'failure').length - 3} more failed
                    jobs
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {onLoadJobs && !jobs && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onLoadJobs();
              }}
              disabled={isLoadingJobs}
              className="p-1.5 rounded hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors"
              title="Load job details"
            >
              {isLoadingJobs ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Zap className="w-3.5 h-3.5" />
              )}
            </button>
          )}
          <ExternalLink className="w-4 h-4 text-text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Main Widget
// ============================================================================

export function GitHubWidget({ repoOwner, repoName, sessionId }: GitHubWidgetProps) {
  const session = useSessionStore((state) => state.sessions[sessionId]);
  const derivedRepo = useMemo(() => parseGitHubRepo(session?.gitUrl), [session?.gitUrl]);
  const storedRepo = useUIStore((state) => state.githubWidgetRepoBySession[sessionId]);
  const setGitHubWidgetRepo = useUIStore((state) => state.setGitHubWidgetRepo);

  // Use stored repo, then prop repo, then derived repo
  const resolvedOwner = repoOwner ?? storedRepo?.owner ?? derivedRepo?.owner;
  const resolvedRepo = repoName ?? storedRepo?.repo ?? derivedRepo?.repo;
  const [isConnected, setIsConnected] = useState<boolean | null>(null);
  const [pullRequests, setPullRequests] = useState<GitHubPullRequest[]>([]);
  const [workflowRuns, setWorkflowRuns] = useState<GitHubWorkflowRun[]>([]);
  const [isLoadingPRs, setIsLoadingPRs] = useState(false);
  const [isLoadingRuns, setIsLoadingRuns] = useState(false);
  const [_error, _setError] = useState<string | null>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);
  const widgetFilters = useUIStore((state) => state.githubWidgetFiltersBySession[sessionId]);
  const selectedBranch = widgetFilters?.branch ?? null;
  const selectedStatus = widgetFilters?.status ?? null;
  const setGitHubWidgetFilters = useUIStore((state) => state.setGitHubWidgetFilters);
  const panelStates = useUIStore((state) => state.githubWidgetPanelStatesBySession[sessionId]);
  const setGitHubWidgetPanelState = useUIStore((state) => state.setGitHubWidgetPanelState);
  const hasInitialFetch = useRef(false);
  const [workflowJobs, setWorkflowJobs] = useState<Record<number, GitHubWorkflowJob[]>>({});
  const [loadingJobs, setLoadingJobs] = useState<Set<number>>(new Set());
  const [availableRepos, setAvailableRepos] = useState<GitHubRepo[]>([]);
  const [isLoadingRepos, setIsLoadingRepos] = useState(false);
  const [showRepoSelector, setShowRepoSelector] = useState(false);

  // Check connection status
  const checkConnection = useCallback(async () => {
    try {
      const data = await getGitHubStatus();
      setIsConnected(data.connected);
      // Fetch repos if connected
      if (data.connected) {
        setIsLoadingRepos(true);
        try {
          const repos = await getGitHubRepos({ per_page: 100 });
          setAvailableRepos(repos);
        } catch {
          // Silently fail - repos list is optional
        } finally {
          setIsLoadingRepos(false);
        }
      }
    } catch {
      setIsConnected(false);
    }
  }, []);

  // Fetch PRs
  const fetchPRs = useCallback(async () => {
    if (!isConnected || !resolvedOwner || !resolvedRepo) return;

    setIsLoadingPRs(true);
    try {
      const data = await getGitHubPullRequests(resolvedOwner, resolvedRepo, {
        state: 'open',
        per_page: 5,
      });
      setPullRequests(data);
    } catch (err) {
      console.error('Failed to fetch PRs:', err);
    } finally {
      setIsLoadingPRs(false);
    }
  }, [resolvedOwner, resolvedRepo, isConnected]);

  // Fetch branches
  const fetchBranches = useCallback(
    async (workflowRunsData?: GitHubWorkflowRun[]) => {
      if (!isConnected || !resolvedOwner || !resolvedRepo) return;

      setIsLoadingBranches(true);
      try {
        const data = await getGitHubBranches(resolvedOwner, resolvedRepo);
        // Extract unique branch names from branches
        const branchSet = new Set<string>();
        data.forEach((branch) => branchSet.add(branch.name));

        // Also add branches from workflow runs if provided
        if (workflowRunsData) {
          workflowRunsData.forEach((run) => {
            if (run.head_branch) branchSet.add(run.head_branch);
          });
        }

        setBranches(Array.from(branchSet).sort());
      } catch (err) {
        console.error('Failed to fetch branches:', err);
      } finally {
        setIsLoadingBranches(false);
      }
    },
    [resolvedOwner, resolvedRepo, isConnected]
  );

  // Fetch workflow runs
  const fetchRuns = useCallback(async () => {
    if (!isConnected || !resolvedOwner || !resolvedRepo) return;

    setIsLoadingRuns(true);
    try {
      const params: { per_page?: number; branch?: string; status?: string } = {
        per_page: 10,
      };
      if (selectedBranch) {
        params.branch = selectedBranch;
      }
      if (selectedStatus) {
        params.status = selectedStatus;
      }
      const data = await getGitHubWorkflowRuns(resolvedOwner, resolvedRepo, params);
      setWorkflowRuns(data);

      // Update branches list with new runs using functional update (no dependency on branches)
      setBranches((currentBranches) => {
        const branchSet = new Set(currentBranches);
        data.forEach((run) => {
          if (run.head_branch) branchSet.add(run.head_branch);
        });
        return Array.from(branchSet).sort();
      });
    } catch (err) {
      console.error('Failed to fetch runs:', err);
    } finally {
      setIsLoadingRuns(false);
    }
  }, [resolvedOwner, resolvedRepo, isConnected, selectedBranch, selectedStatus]);

  // Fetch jobs for a specific workflow run
  const fetchWorkflowJobs = useCallback(
    async (runId: number) => {
      if (!isConnected || !resolvedOwner || !resolvedRepo || loadingJobs.has(runId)) return;

      setLoadingJobs((prev) => new Set(prev).add(runId));
      try {
        const data = await getGitHubWorkflowJobs(resolvedOwner, resolvedRepo, runId);
        setWorkflowJobs((prev) => ({ ...prev, [runId]: data }));
      } catch (err) {
        console.error('Failed to fetch workflow jobs:', err);
      } finally {
        setLoadingJobs((prev) => {
          const newSet = new Set(prev);
          newSet.delete(runId);
          return newSet;
        });
      }
    },
    [resolvedOwner, resolvedRepo, isConnected, loadingJobs]
  );

  useEffect(() => {
    checkConnection();
  }, [checkConnection]);

  useEffect(() => {
    setPullRequests([]);
    setWorkflowRuns([]);
    setBranches([]);
    // Clear filters when repo changes
    setGitHubWidgetFilters(sessionId, { branch: null, status: null });
  }, [resolvedOwner, resolvedRepo, sessionId, setGitHubWidgetFilters]);

  // Fetch PRs and runs when repo/connection changes
  useEffect(() => {
    if (isConnected && resolvedOwner && resolvedRepo) {
      hasInitialFetch.current = false;
      fetchPRs();
      fetchRuns();
      // Set flag after a short delay to allow initial fetch to complete
      setTimeout(() => {
        hasInitialFetch.current = true;
      }, 100);
    }
  }, [isConnected, resolvedOwner, resolvedRepo, fetchPRs, fetchRuns]);

  // Refetch runs when filters change (but not on initial load)
  useEffect(() => {
    if (isConnected && resolvedOwner && resolvedRepo && hasInitialFetch.current) {
      fetchRuns();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBranch, selectedStatus]); // Only depend on filters, not fetchRuns

  // Fetch branches initially when repo is set
  useEffect(() => {
    if (isConnected && resolvedOwner && resolvedRepo) {
      fetchBranches();
    }
  }, [resolvedOwner, resolvedRepo, isConnected, fetchBranches]);

  // Get latest run status
  const latestRunStatus = workflowRuns[0]?.conclusion || workflowRuns[0]?.status || null;

  // Not connected state
  if (isConnected === false) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-4 text-center">
        <Github className="w-8 h-8 text-text-muted opacity-50 mb-2" />
        <p className="text-sm text-text-muted mb-3">Connect GitHub to view PRs and Actions</p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => (window.location.href = '/settings/integrations/github')}
        >
          Connect GitHub
        </Button>
      </div>
    );
  }

  // Loading state
  if (isConnected === null) {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <Loader2 className="w-5 h-5 animate-spin text-text-muted" />
      </div>
    );
  }

  if (!resolvedOwner || !resolvedRepo) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-4 text-center">
        <GitPullRequest className="w-8 h-8 text-text-muted opacity-50 mb-2" />
        <p className="text-sm text-text-muted mb-1">No GitHub repo linked to this pod</p>
        <p className="text-xs text-text-tertiary">
          Add a GitHub repo when creating a pod or set the remote manually.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Repo info bar */}
      <div className="flex items-center justify-between px-3 py-2 bg-surface-hover/50 border-b border-border-subtle shrink-0 gap-2">
        <DropdownMenu open={showRepoSelector} onOpenChange={setShowRepoSelector}>
          <DropdownMenuTrigger asChild>
            <button
              className="flex items-center gap-1.5 flex-1 min-w-0 hover:bg-surface-hover rounded px-1.5 py-1 transition-colors group"
              title="Change repository"
            >
              <Github className="w-3.5 h-3.5 text-text-muted shrink-0" />
              <span className="text-xs text-text-secondary truncate">
                {resolvedOwner}/{resolvedRepo}
              </span>
              <ChevronDown className="w-3 h-3 text-text-muted shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="min-w-[280px] max-h-[300px] overflow-y-auto"
          >
            <DropdownMenuLabel className="font-semibold">Select Repository</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {isLoadingRepos ? (
              <DropdownMenuItem disabled className="text-text-muted">
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Loading repositories...
              </DropdownMenuItem>
            ) : availableRepos.length === 0 ? (
              <DropdownMenuItem disabled className="text-text-muted">
                No repositories available
              </DropdownMenuItem>
            ) : (
              availableRepos.map((repo) => {
                const parts = repo.full_name.split('/');
                const owner = parts[0];
                const repoName = parts[1];
                if (!owner || !repoName) return null;
                const isSelected = owner === resolvedOwner && repoName === resolvedRepo;
                return (
                  <DropdownMenuItem
                    key={repo.id}
                    onClick={() => {
                      setGitHubWidgetRepo(sessionId, { owner, repo: repoName });
                      setShowRepoSelector(false);
                    }}
                    className={cn(
                      'font-medium',
                      isSelected && 'bg-accent-primary/20 text-accent-primary'
                    )}
                  >
                    {repo.full_name}
                    {isSelected && <Check className="w-4 h-4 ml-auto" />}
                  </DropdownMenuItem>
                );
              })
            )}
            {derivedRepo && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => {
                    setGitHubWidgetRepo(sessionId, null);
                    setShowRepoSelector(false);
                  }}
                  className="font-medium"
                >
                  Use default ({derivedRepo.owner}/{derivedRepo.repo})
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <a
          href={`https://github.com/${resolvedOwner}/${resolvedRepo}`}
          target="_blank"
          rel="noopener noreferrer"
          className="p-1 rounded hover:bg-surface-hover text-text-muted shrink-0"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {/* Pull Requests Section */}
        <CollapsibleSection
          title="Pull Requests"
          icon={<GitPullRequest className="w-4 h-4 text-green-400" />}
          count={pullRequests.length}
          onRefresh={fetchPRs}
          isLoading={isLoadingPRs}
          isOpen={panelStates?.pullRequestsOpen ?? true}
          setIsOpen={(open) => setGitHubWidgetPanelState(sessionId, 'pullRequests', open)}
        >
          {pullRequests.length === 0 ? (
            <p className="text-xs text-text-muted text-center py-2">No open pull requests</p>
          ) : (
            <div className="space-y-1">
              {pullRequests.map((pr) => (
                <PRListItem
                  key={pr.id}
                  pr={pr}
                  onClick={() => window.open(pr.html_url, '_blank')}
                />
              ))}
            </div>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="w-full mt-2 gap-1"
            onClick={() =>
              window.open(`https://github.com/${resolvedOwner}/${resolvedRepo}/compare`, '_blank')
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
          defaultOpen={true}
          isOpen={panelStates?.actionsOpen ?? true}
          setIsOpen={(open) => setGitHubWidgetPanelState(sessionId, 'actions', open)}
        >
          {/* Filter Controls - Compact */}
          <div className="flex items-center gap-1.5 mb-3 pb-3 border-b border-border-subtle flex-wrap">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className={cn(
                    'flex items-center gap-1 px-2 py-1 text-xs rounded border transition-all',
                    'border-border-subtle hover:border-border-default hover:bg-surface-hover',
                    selectedBranch && 'border-accent-primary/60 bg-accent-primary/8'
                  )}
                  disabled={isLoadingBranches}
                  title={selectedBranch || 'Filter by branch'}
                >
                  <GitBranch className="w-3 h-3 shrink-0" />
                  <span className="max-w-[80px] truncate">{selectedBranch || 'Branch'}</span>
                  <ChevronDown className="w-3 h-3 shrink-0" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="min-w-[200px] max-h-[240px] overflow-y-auto"
              >
                <DropdownMenuLabel className="font-semibold">Filter by Branch</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => {
                    setGitHubWidgetFilters(sessionId, { branch: null });
                  }}
                  className={cn(
                    'font-medium',
                    !selectedBranch && 'bg-accent-primary/20 text-accent-primary'
                  )}
                >
                  All branches
                </DropdownMenuItem>
                {branches.map((branch) => (
                  <DropdownMenuItem
                    key={branch}
                    onClick={() => {
                      setGitHubWidgetFilters(sessionId, { branch });
                    }}
                    className={cn(
                      'font-medium',
                      selectedBranch === branch && 'bg-accent-primary/20 text-accent-primary'
                    )}
                  >
                    {branch}
                  </DropdownMenuItem>
                ))}
                {branches.length === 0 && !isLoadingBranches && (
                  <DropdownMenuItem disabled className="text-text-muted">
                    No branches found
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className={cn(
                    'flex items-center gap-1 px-2 py-1 text-xs rounded border transition-all',
                    'border-border-subtle hover:border-border-default hover:bg-surface-hover',
                    selectedStatus && 'border-accent-primary/60 bg-accent-primary/8'
                  )}
                  title={selectedStatus ? `Status: ${selectedStatus}` : 'Filter by status'}
                >
                  <Filter className="w-3 h-3 shrink-0" />
                  <span className="capitalize">
                    {selectedStatus ? selectedStatus.replace('_', ' ') : 'Status'}
                  </span>
                  <ChevronDown className="w-3 h-3 shrink-0" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[160px]">
                <DropdownMenuLabel className="font-semibold">Filter by Status</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => {
                    setGitHubWidgetFilters(sessionId, { status: null });
                  }}
                  className={cn(
                    'font-medium',
                    !selectedStatus && 'bg-accent-primary/20 text-accent-primary'
                  )}
                >
                  All statuses
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    setGitHubWidgetFilters(sessionId, { status: 'success' });
                  }}
                  className={cn(
                    'font-medium',
                    selectedStatus === 'success' && 'bg-accent-primary/20 text-accent-primary'
                  )}
                >
                  <Check className="w-4 h-4 text-green-500 mr-2" />
                  Success
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    setGitHubWidgetFilters(sessionId, { status: 'failure' });
                  }}
                  className={cn(
                    'font-medium',
                    selectedStatus === 'failure' && 'bg-accent-primary/20 text-accent-primary'
                  )}
                >
                  <X className="w-4 h-4 text-red-500 mr-2" />
                  Failure
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    setGitHubWidgetFilters(sessionId, { status: 'in_progress' });
                  }}
                  className={cn(
                    'font-medium',
                    selectedStatus === 'in_progress' && 'bg-accent-primary/20 text-accent-primary'
                  )}
                >
                  <Loader2 className="w-4 h-4 text-yellow-500 mr-2" />
                  In Progress
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    setGitHubWidgetFilters(sessionId, { status: 'queued' });
                  }}
                  className={cn(
                    'font-medium',
                    selectedStatus === 'queued' && 'bg-accent-primary/20 text-accent-primary'
                  )}
                >
                  <Clock className="w-4 h-4 text-text-muted mr-2" />
                  Queued
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    setGitHubWidgetFilters(sessionId, { status: 'cancelled' });
                  }}
                  className={cn(
                    'font-medium',
                    selectedStatus === 'cancelled' && 'bg-accent-primary/20 text-accent-primary'
                  )}
                >
                  <CircleDot className="w-4 h-4 text-text-muted mr-2" />
                  Cancelled
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {(selectedBranch || selectedStatus) && (
              <button
                onClick={() => {
                  setGitHubWidgetFilters(sessionId, { branch: null, status: null });
                }}
                className="p-1 rounded hover:bg-surface-hover text-text-muted hover:text-text-primary transition-all"
                title="Clear filters"
              >
                <XCircle className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Workflow Runs List */}
          {isLoadingRuns && workflowRuns.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <Loader2 className="w-6 h-6 animate-spin text-text-muted mx-auto mb-3" />
                <p className="text-sm text-text-muted">Loading workflow runs...</p>
              </div>
            </div>
          ) : workflowRuns.length === 0 ? (
            <div className="text-center py-12">
              <Zap className="w-12 h-12 text-text-muted opacity-50 mx-auto mb-4" />
              <p className="text-sm text-text-muted mb-1">
                {selectedBranch || selectedStatus
                  ? 'No workflow runs match your filters'
                  : 'No recent workflow runs'}
              </p>
              <p className="text-xs text-text-tertiary">
                Workflow runs will appear here when available
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {workflowRuns.map((run) => (
                <WorkflowRunItem
                  key={run.id}
                  run={run}
                  jobs={workflowJobs[run.id]}
                  isLoadingJobs={loadingJobs.has(run.id)}
                  onClick={() => window.open(run.html_url, '_blank')}
                  onLoadJobs={() => fetchWorkflowJobs(run.id)}
                />
              ))}
            </div>
          )}

          <Button
            size="sm"
            variant="ghost"
            className="w-full mt-4 gap-2 py-3 text-sm font-medium border-2 border-border-subtle hover:border-border-default hover:shadow-sm transition-all"
            onClick={() =>
              window.open(`https://github.com/${resolvedOwner}/${resolvedRepo}/actions`, '_blank')
            }
          >
            <Play className="w-4 h-4" />
            View All Actions
          </Button>
        </CollapsibleSection>
      </div>
    </div>
  );
}
