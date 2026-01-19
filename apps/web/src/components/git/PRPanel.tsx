'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  GitPullRequest,
  GitMerge,
  Check,
  User,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Loader2,
  Plus,
  RefreshCw,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  GitBranch,
  Eye,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ============================================================================
// Types
// ============================================================================

export type PRStatus = 'open' | 'closed' | 'merged' | 'draft';
export type ReviewStatus = 'pending' | 'approved' | 'changes_requested' | 'commented';
export type CheckStatus = 'pending' | 'success' | 'failure' | 'neutral';

export interface PRCheck {
  id: string;
  name: string;
  status: CheckStatus;
  conclusion?: string;
  url?: string;
}

export interface PRReview {
  id: string;
  author: string;
  authorAvatar?: string;
  status: ReviewStatus;
  body?: string;
  submittedAt: Date;
}

export interface PullRequest {
  id: number;
  number: number;
  title: string;
  body?: string;
  author: string;
  authorAvatar?: string;
  status: PRStatus;
  sourceBranch: string;
  targetBranch: string;
  createdAt: Date;
  updatedAt: Date;
  additions: number;
  deletions: number;
  changedFiles: number;
  checks: PRCheck[];
  reviews: PRReview[];
  labels: { name: string; color: string }[];
  url: string;
  mergeable?: boolean;
  conflicted?: boolean;
}

interface PRPanelProps {
  sessionId: string;
  onViewDiff?: (pr: PullRequest) => void;
  onCreatePR?: () => void;
  className?: string;
}

// ============================================================================
// Status Icons
// ============================================================================

function PRStatusIcon({ status }: { status: PRStatus }) {
  switch (status) {
    case 'open':
      return <GitPullRequest className="h-4 w-4 text-green-400" />;
    case 'closed':
      return <GitPullRequest className="h-4 w-4 text-red-400" />;
    case 'merged':
      return <GitMerge className="h-4 w-4 text-purple-400" />;
    case 'draft':
      return <GitPullRequest className="h-4 w-4 text-text-muted" />;
  }
}

function CheckStatusIcon({ status }: { status: CheckStatus }) {
  switch (status) {
    case 'pending':
      return <Loader2 className="h-3.5 w-3.5 text-yellow-400 animate-spin" />;
    case 'success':
      return <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />;
    case 'failure':
      return <XCircle className="h-3.5 w-3.5 text-red-400" />;
    case 'neutral':
      return <AlertCircle className="h-3.5 w-3.5 text-text-muted" />;
  }
}

function ReviewStatusBadge({ status }: { status: ReviewStatus }) {
  const config = {
    pending: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', label: 'Pending' },
    approved: { bg: 'bg-green-500/20', text: 'text-green-400', label: 'Approved' },
    changes_requested: { bg: 'bg-red-500/20', text: 'text-red-400', label: 'Changes Requested' },
    commented: { bg: 'bg-blue-500/20', text: 'text-blue-400', label: 'Commented' },
  };

  const { bg, text, label } = config[status];

  return <span className={cn('px-1.5 py-0.5 rounded text-xs font-medium', bg, text)}>{label}</span>;
}

// ============================================================================
// Create PR Modal
// ============================================================================

interface CreatePRModalProps {
  sourceBranch: string;
  targetBranch: string;
  onConfirm: (title: string, body: string, draft: boolean) => void;
  onCancel: () => void;
  onGenerateDescription?: () => Promise<string>;
}

function CreatePRModal({
  sourceBranch,
  targetBranch,
  onConfirm,
  onCancel,
  onGenerateDescription,
}: CreatePRModalProps) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [isDraft, setIsDraft] = useState(false);
  const [generating, setGenerating] = useState(false);

  const handleGenerateDescription = async () => {
    if (!onGenerateDescription) return;
    setGenerating(true);
    try {
      const description = await onGenerateDescription();
      setBody(description);
    } catch (error) {
      console.error('Failed to generate description:', error);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-void/80 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-full max-w-2xl rounded-xl border border-border-default bg-surface shadow-2xl overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border-subtle">
          <GitPullRequest className="h-5 w-5 text-accent-primary" />
          <h3 className="text-lg font-semibold text-text-primary">Create Pull Request</h3>
        </div>

        <div className="p-4 space-y-4">
          {/* Branch info */}
          <div className="flex items-center gap-3 p-3 rounded-lg bg-elevated border border-border-subtle">
            <div className="flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-green-400" />
              <span className="font-mono text-sm text-text-primary">{sourceBranch}</span>
            </div>
            <span className="text-text-muted">→</span>
            <div className="flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-accent-primary" />
              <span className="font-mono text-sm text-text-primary">{targetBranch}</span>
            </div>
          </div>

          {/* Title */}
          <div>
            <label className="block text-sm text-text-secondary mb-1">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Enter a descriptive title..."
              className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent-primary"
              autoFocus
            />
          </div>

          {/* Body */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-sm text-text-secondary">Description</label>
              {onGenerateDescription && (
                <button
                  onClick={handleGenerateDescription}
                  disabled={generating}
                  className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-accent-primary/20 hover:bg-accent-primary/30 text-accent-primary"
                >
                  {generating ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Sparkles className="h-3 w-3" />
                  )}
                  Generate with AI
                </button>
              )}
            </div>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Describe the changes in this PR..."
              rows={8}
              className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent-primary resize-none"
            />
          </div>

          {/* Draft toggle */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isDraft}
              onChange={(e) => setIsDraft(e.target.checked)}
              className="w-4 h-4 rounded border-border-default text-accent-primary focus:ring-accent-primary"
            />
            <span className="text-sm text-text-secondary">Create as draft</span>
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border-subtle bg-elevated">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg bg-overlay hover:bg-surface text-text-secondary"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(title, body, isDraft)}
            disabled={!title.trim()}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-primary hover:bg-accent-primary/90 text-void font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <GitPullRequest className="h-4 w-4" />
            Create Pull Request
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// PR Card
// ============================================================================

interface PRCardProps {
  pr: PullRequest;
  expanded: boolean;
  onToggle: () => void;
  onViewDiff?: () => void;
}

function PRCard({ pr, expanded, onToggle, onViewDiff }: PRCardProps) {
  const allChecksPass = pr.checks.every((c) => c.status === 'success');
  const hasApproval = pr.reviews.some((r) => r.status === 'approved');
  const hasChangesRequested = pr.reviews.some((r) => r.status === 'changes_requested');

  return (
    <div className="rounded-lg border border-border-default overflow-hidden">
      {/* Header */}
      <div
        className="flex items-start gap-3 px-4 py-3 bg-surface cursor-pointer hover:bg-overlay/50"
        onClick={onToggle}
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-text-muted mt-1" />
        ) : (
          <ChevronRight className="h-4 w-4 text-text-muted mt-1" />
        )}

        <PRStatusIcon status={pr.status} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-text-primary">{pr.title}</span>
            <span className="text-text-muted text-sm">#{pr.number}</span>
            {pr.status === 'draft' && (
              <span className="px-1.5 py-0.5 rounded text-xs bg-overlay text-text-muted">
                Draft
              </span>
            )}
            {pr.labels.map((label) => (
              <span
                key={label.name}
                className="px-1.5 py-0.5 rounded text-xs"
                style={{
                  backgroundColor: `${label.color}20`,
                  color: label.color,
                }}
              >
                {label.name}
              </span>
            ))}
          </div>
          <div className="flex items-center gap-3 text-xs text-text-muted mt-1">
            <span>{pr.author}</span>
            <span>•</span>
            <span>
              {pr.sourceBranch} → {pr.targetBranch}
            </span>
            <span>•</span>
            <span className="text-green-400">+{pr.additions}</span>
            <span className="text-red-400">-{pr.deletions}</span>
          </div>
        </div>

        {/* Status indicators */}
        <div className="flex items-center gap-2">
          {pr.conflicted && (
            <span className="px-1.5 py-0.5 rounded text-xs bg-red-500/20 text-red-400">
              Conflicts
            </span>
          )}
          {allChecksPass && pr.checks.length > 0 && (
            <CheckCircle2 className="h-4 w-4 text-green-400" />
          )}
          {hasApproval && <Check className="h-4 w-4 text-green-400" />}
          {hasChangesRequested && <AlertCircle className="h-4 w-4 text-red-400" />}
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-border-subtle bg-elevated">
          {/* Description */}
          {pr.body && (
            <div className="px-4 py-3 border-b border-border-subtle">
              <p className="text-sm text-text-secondary whitespace-pre-wrap">{pr.body}</p>
            </div>
          )}

          {/* Checks */}
          {pr.checks.length > 0 && (
            <div className="px-4 py-3 border-b border-border-subtle">
              <h4 className="text-xs font-medium text-text-muted mb-2">Checks</h4>
              <div className="space-y-1">
                {pr.checks.map((check) => (
                  <div key={check.id} className="flex items-center gap-2 text-sm">
                    <CheckStatusIcon status={check.status} />
                    <span className="text-text-secondary">{check.name}</span>
                    {check.url && (
                      <a
                        href={check.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent-primary hover:underline text-xs"
                      >
                        Details
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Reviews */}
          {pr.reviews.length > 0 && (
            <div className="px-4 py-3 border-b border-border-subtle">
              <h4 className="text-xs font-medium text-text-muted mb-2">Reviews</h4>
              <div className="space-y-2">
                {pr.reviews.map((review) => (
                  <div key={review.id} className="flex items-center gap-2">
                    <User className="h-4 w-4 text-text-muted" />
                    <span className="text-sm text-text-secondary">{review.author}</span>
                    <ReviewStatusBadge status={review.status} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 px-4 py-3">
            {onViewDiff && (
              <button
                onClick={onViewDiff}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-overlay hover:bg-surface text-text-secondary text-sm"
              >
                <Eye className="h-4 w-4" />
                View Changes
              </button>
            )}
            <a
              href={pr.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-overlay hover:bg-surface text-text-secondary text-sm"
            >
              <ExternalLink className="h-4 w-4" />
              Open on GitHub
            </a>
            {pr.status === 'open' && pr.mergeable && !pr.conflicted && (
              <button className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-green-500 hover:bg-green-600 text-white text-sm font-medium">
                <GitMerge className="h-4 w-4" />
                Merge
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function PRPanel({
  sessionId: _sessionId,
  onViewDiff,
  onCreatePR: _onCreatePR,
  className,
}: PRPanelProps) {
  const [pullRequests, setPullRequests] = useState<PullRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedPRs, setExpandedPRs] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState<'all' | 'open' | 'closed'>('open');
  const [createModalOpen, setCreateModalOpen] = useState(false);

  // Load PRs
  const loadPRs = useCallback(async () => {
    setLoading(true);
    try {
      // In real implementation, fetch from API
      // const data = await api.get(`/api/sessions/${sessionId}/git/prs`);

      // Mock data
      const mockPRs: PullRequest[] = [
        {
          id: 1,
          number: 42,
          title: 'Add user authentication system',
          body: 'This PR adds a complete authentication system with login, signup, and session management.',
          author: 'john-doe',
          status: 'open',
          sourceBranch: 'feature/auth',
          targetBranch: 'main',
          createdAt: new Date(Date.now() - 86400000),
          updatedAt: new Date(Date.now() - 3600000),
          additions: 450,
          deletions: 50,
          changedFiles: 12,
          checks: [
            { id: '1', name: 'CI / Build', status: 'success' },
            { id: '2', name: 'CI / Test', status: 'success' },
            { id: '3', name: 'CI / Lint', status: 'pending' },
          ],
          reviews: [{ id: '1', author: 'jane-smith', status: 'approved', submittedAt: new Date() }],
          labels: [
            { name: 'feature', color: '#7c3aed' },
            { name: 'auth', color: '#059669' },
          ],
          url: 'https://github.com/example/repo/pull/42',
          mergeable: true,
          conflicted: false,
        },
        {
          id: 2,
          number: 41,
          title: 'Fix dashboard loading issue',
          author: 'jane-smith',
          status: 'merged',
          sourceBranch: 'fix/dashboard',
          targetBranch: 'main',
          createdAt: new Date(Date.now() - 172800000),
          updatedAt: new Date(Date.now() - 86400000),
          additions: 25,
          deletions: 10,
          changedFiles: 3,
          checks: [
            { id: '1', name: 'CI / Build', status: 'success' },
            { id: '2', name: 'CI / Test', status: 'success' },
          ],
          reviews: [],
          labels: [{ name: 'bug', color: '#dc2626' }],
          url: 'https://github.com/example/repo/pull/41',
        },
      ];

      setPullRequests(mockPRs);
    } catch (error) {
      console.error('Failed to load PRs:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPRs();
  }, [loadPRs]);

  // Filter PRs
  const filteredPRs = pullRequests.filter((pr) => {
    if (filter === 'all') return true;
    if (filter === 'open') return pr.status === 'open' || pr.status === 'draft';
    if (filter === 'closed') return pr.status === 'closed' || pr.status === 'merged';
    return true;
  });

  // Toggle PR expansion
  const togglePR = useCallback((prNumber: number) => {
    setExpandedPRs((prev) => {
      const next = new Set(prev);
      if (next.has(prNumber)) {
        next.delete(prNumber);
      } else {
        next.add(prNumber);
      }
      return next;
    });
  }, []);

  const handleCreatePR = async (_title: string, _body: string, _draft: boolean) => {
    // TODO: Implement API call to create PR - would require GitHub API integration
    // await api.post(`/api/sessions/${sessionId}/git/pr`, {
    //   title: _title,
    //   body: _body,
    //   draft: _draft,
    // });
    console.warn('Creating PR:', { title: _title, body: _body, draft: _draft });
    setCreateModalOpen(false);
    loadPRs();
  };

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <GitPullRequest className="h-5 w-5 text-accent-primary" />
          <h2 className="text-lg font-semibold text-text-primary">Pull Requests</h2>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={loadPRs}
            className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-overlay"
            title="Refresh"
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </button>
          <button
            onClick={() => setCreateModalOpen(true)}
            className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-overlay"
            title="Create PR"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border-subtle">
        {(['all', 'open', 'closed'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              'px-2 py-1 rounded text-xs capitalize',
              filter === f
                ? 'bg-accent-primary/20 text-accent-primary'
                : 'bg-overlay text-text-muted hover:text-text-secondary'
            )}
          >
            {f}
          </button>
        ))}
      </div>

      {/* PR list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
          </div>
        ) : filteredPRs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-text-muted">
            <GitPullRequest className="h-8 w-8 mb-2 opacity-50" />
            <p className="text-sm">No pull requests found</p>
          </div>
        ) : (
          filteredPRs.map((pr) => (
            <PRCard
              key={pr.id}
              pr={pr}
              expanded={expandedPRs.has(pr.number)}
              onToggle={() => togglePR(pr.number)}
              onViewDiff={onViewDiff ? () => onViewDiff(pr) : undefined}
            />
          ))
        )}
      </div>

      {/* Create PR modal */}
      {createModalOpen && (
        <CreatePRModal
          sourceBranch="feature/new-feature"
          targetBranch="main"
          onConfirm={handleCreatePR}
          onCancel={() => setCreateModalOpen(false)}
          onGenerateDescription={async () => {
            // In real implementation, call AI to generate description
            return '## Summary\n\nThis PR implements...\n\n## Changes\n\n- Added...\n- Fixed...\n\n## Testing\n\n- [ ] Unit tests\n- [ ] Integration tests';
          }}
        />
      )}
    </div>
  );
}
