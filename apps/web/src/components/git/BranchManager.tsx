'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  GitBranch,
  GitMerge,
  Plus,
  Trash2,
  Check,
  RefreshCw,
  Search,
  Globe,
  Laptop,
  ArrowRightLeft,
  Loader2,
  AlertTriangle,
  GitCompare,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ============================================================================
// Types
// ============================================================================

export interface Branch {
  name: string;
  isCurrent: boolean;
  isRemote: boolean;
  lastCommit?: string;
  lastCommitDate?: string;
  lastCommitAuthor?: string;
  ahead?: number;
  behind?: number;
  upstream?: string;
}

interface BranchManagerProps {
  sessionId: string;
  onBranchSwitch?: (branch: string) => void;
  onMerge?: (source: string, target: string) => void;
  className?: string;
}

// ============================================================================
// Create Branch Modal
// ============================================================================

interface CreateBranchModalProps {
  baseBranch: string;
  onConfirm: (name: string, checkout: boolean) => void;
  onCancel: () => void;
}

function CreateBranchModal({ baseBranch, onConfirm, onCancel }: CreateBranchModalProps) {
  const [name, setName] = useState('');
  const [checkout, setCheckout] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Branch name is required');
      return;
    }
    // Validate branch name
    if (!/^[\w\-/]+$/.test(name)) {
      setError('Branch name can only contain letters, numbers, hyphens, underscores, and slashes');
      return;
    }
    onConfirm(name.trim(), checkout);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-void/80 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-full max-w-md rounded-xl border border-border-default bg-surface shadow-2xl overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border-subtle">
          <GitBranch className="h-5 w-5 text-accent-primary" />
          <h3 className="text-lg font-semibold text-text-primary">Create Branch</h3>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="block text-sm text-text-secondary mb-1">Base branch</label>
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-elevated border border-border-subtle">
              <GitBranch className="h-4 w-4 text-text-muted" />
              <span className="text-text-primary">{baseBranch}</span>
            </div>
          </div>

          <div>
            <label className="block text-sm text-text-secondary mb-1">New branch name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              placeholder="feature/my-feature"
              className="w-full px-3 py-2 rounded-lg bg-elevated border border-border-subtle text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent-primary"
              autoFocus
            />
            {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={checkout}
              onChange={(e) => setCheckout(e.target.checked)}
              className="w-4 h-4 rounded border-border-default text-accent-primary focus:ring-accent-primary"
            />
            <span className="text-sm text-text-secondary">Switch to new branch after creation</span>
          </label>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 rounded-lg bg-overlay hover:bg-elevated text-text-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-primary hover:bg-accent-primary/90 text-void font-medium"
            >
              <Plus className="h-4 w-4" />
              Create Branch
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ============================================================================
// Delete Branch Modal
// ============================================================================

interface DeleteBranchModalProps {
  branch: string;
  onConfirm: (force: boolean) => void;
  onCancel: () => void;
}

function DeleteBranchModal({ branch, onConfirm, onCancel }: DeleteBranchModalProps) {
  const [force, setForce] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-void/80 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-full max-w-md rounded-xl border border-border-default bg-surface shadow-2xl overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border-subtle">
          <AlertTriangle className="h-5 w-5 text-red-400" />
          <h3 className="text-lg font-semibold text-text-primary">Delete Branch</h3>
        </div>

        <div className="p-4 space-y-4">
          <p className="text-text-secondary">
            Are you sure you want to delete the branch{' '}
            <code className="px-1.5 py-0.5 rounded bg-elevated text-accent-primary">{branch}</code>?
          </p>

          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300">
            This action cannot be undone. Any unmerged commits will be lost.
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={force}
              onChange={(e) => setForce(e.target.checked)}
              className="w-4 h-4 rounded border-border-default text-red-500 focus:ring-red-500"
            />
            <span className="text-sm text-text-secondary">Force delete (even if unmerged)</span>
          </label>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              onClick={onCancel}
              className="px-4 py-2 rounded-lg bg-overlay hover:bg-elevated text-text-secondary"
            >
              Cancel
            </button>
            <button
              onClick={() => onConfirm(force)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white font-medium"
            >
              <Trash2 className="h-4 w-4" />
              Delete Branch
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Merge Branch Modal
// ============================================================================

interface MergeBranchModalProps {
  sourceBranch: string;
  targetBranch: string;
  onConfirm: (noFastForward: boolean) => void;
  onCancel: () => void;
}

function MergeBranchModal({
  sourceBranch,
  targetBranch,
  onConfirm,
  onCancel,
}: MergeBranchModalProps) {
  const [noFastForward, setNoFastForward] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-void/80 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-full max-w-md rounded-xl border border-border-default bg-surface shadow-2xl overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border-subtle">
          <GitMerge className="h-5 w-5 text-accent-primary" />
          <h3 className="text-lg font-semibold text-text-primary">Merge Branch</h3>
        </div>

        <div className="p-4 space-y-4">
          <div className="flex items-center justify-center gap-3 py-4">
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-elevated border border-border-subtle">
              <GitBranch className="h-4 w-4 text-green-400" />
              <span className="text-text-primary font-mono text-sm">{sourceBranch}</span>
            </div>
            <ArrowRightLeft className="h-5 w-5 text-text-muted" />
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-elevated border border-border-subtle">
              <GitBranch className="h-4 w-4 text-accent-primary" />
              <span className="text-text-primary font-mono text-sm">{targetBranch}</span>
            </div>
          </div>

          <p className="text-sm text-text-secondary text-center">
            Merge <strong>{sourceBranch}</strong> into <strong>{targetBranch}</strong>
          </p>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={noFastForward}
              onChange={(e) => setNoFastForward(e.target.checked)}
              className="w-4 h-4 rounded border-border-default text-accent-primary focus:ring-accent-primary"
            />
            <span className="text-sm text-text-secondary">
              Create merge commit (no fast-forward)
            </span>
          </label>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              onClick={onCancel}
              className="px-4 py-2 rounded-lg bg-overlay hover:bg-elevated text-text-secondary"
            >
              Cancel
            </button>
            <button
              onClick={() => onConfirm(noFastForward)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-primary hover:bg-accent-primary/90 text-void font-medium"
            >
              <GitMerge className="h-4 w-4" />
              Merge
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Branch Item
// ============================================================================

interface BranchItemProps {
  branch: Branch;
  onSwitch: () => void;
  onDelete: () => void;
  onMerge: () => void;
  onCompare: () => void;
}

function BranchItem({ branch, onSwitch, onDelete, onMerge, onCompare }: BranchItemProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 px-3 py-2 hover:bg-overlay rounded-lg group transition-colors',
        branch.isCurrent && 'bg-accent-primary/10'
      )}
    >
      {branch.isRemote ? (
        <Globe className="h-4 w-4 text-text-muted" />
      ) : (
        <Laptop className="h-4 w-4 text-text-muted" />
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'font-mono text-sm truncate',
              branch.isCurrent && 'text-accent-primary font-medium'
            )}
          >
            {branch.name}
          </span>
          {branch.isCurrent && (
            <span className="px-1.5 py-0.5 rounded text-xs bg-accent-primary/20 text-accent-primary">
              current
            </span>
          )}
        </div>
        {branch.lastCommit && (
          <div className="flex items-center gap-2 text-xs text-text-muted mt-0.5">
            <span className="truncate">{branch.lastCommit}</span>
            {branch.lastCommitDate && (
              <>
                <span>•</span>
                <span>{branch.lastCommitDate}</span>
              </>
            )}
          </div>
        )}
      </div>

      {(branch.ahead !== undefined || branch.behind !== undefined) && (
        <div className="flex items-center gap-1 text-xs">
          {branch.ahead !== undefined && branch.ahead > 0 && (
            <span className="text-green-400">↑{branch.ahead}</span>
          )}
          {branch.behind !== undefined && branch.behind > 0 && (
            <span className="text-yellow-400">↓{branch.behind}</span>
          )}
        </div>
      )}

      {!branch.isCurrent && (
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={onSwitch}
            className="p-1 rounded hover:bg-elevated text-text-muted hover:text-text-primary"
            title="Switch to branch"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onMerge}
            className="p-1 rounded hover:bg-elevated text-text-muted hover:text-text-primary"
            title="Merge into current"
          >
            <GitMerge className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onCompare}
            className="p-1 rounded hover:bg-elevated text-text-muted hover:text-text-primary"
            title="Compare with current"
          >
            <GitCompare className="h-3.5 w-3.5" />
          </button>
          {!branch.isRemote && (
            <button
              onClick={onDelete}
              className="p-1 rounded hover:bg-elevated text-text-muted hover:text-red-400"
              title="Delete branch"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function BranchManager({
  sessionId: _sessionId,
  onBranchSwitch,
  onMerge,
  className,
}: BranchManagerProps) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showLocal, setShowLocal] = useState(true);
  const [showRemote, setShowRemote] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [deleteModalBranch, setDeleteModalBranch] = useState<string | null>(null);
  const [mergeModalBranch, setMergeModalBranch] = useState<string | null>(null);

  // Load branches
  const loadBranches = useCallback(async () => {
    setLoading(true);
    try {
      // In real implementation, fetch from API
      // const data = await api.get(`/api/sessions/${sessionId}/git/branches`);

      // Mock data
      const mockBranches: Branch[] = [
        {
          name: 'main',
          isCurrent: true,
          isRemote: false,
          lastCommit: 'Initial project setup',
          lastCommitDate: '2 hours ago',
          lastCommitAuthor: 'John Doe',
          ahead: 0,
          behind: 0,
          upstream: 'origin/main',
        },
        {
          name: 'feature/auth',
          isCurrent: false,
          isRemote: false,
          lastCommit: 'Add login page',
          lastCommitDate: '30 minutes ago',
          ahead: 3,
          behind: 0,
        },
        {
          name: 'feature/dashboard',
          isCurrent: false,
          isRemote: false,
          lastCommit: 'WIP dashboard components',
          lastCommitDate: '1 day ago',
          ahead: 5,
          behind: 2,
        },
        {
          name: 'origin/main',
          isCurrent: false,
          isRemote: true,
          lastCommit: 'Initial project setup',
          lastCommitDate: '2 hours ago',
        },
        {
          name: 'origin/develop',
          isCurrent: false,
          isRemote: true,
          lastCommit: 'Merge feature branches',
          lastCommitDate: '1 day ago',
        },
      ];

      setBranches(mockBranches);
    } catch (error) {
      console.error('Failed to load branches:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBranches();
  }, [loadBranches]);

  // Filter branches
  const filteredBranches = branches.filter((b) => {
    const matchesSearch = b.name.toLowerCase().includes(search.toLowerCase());
    const matchesFilter = (showLocal && !b.isRemote) || (showRemote && b.isRemote);
    return matchesSearch && matchesFilter;
  });

  const currentBranch = branches.find((b) => b.isCurrent);
  const localBranches = filteredBranches.filter((b) => !b.isRemote);
  const remoteBranches = filteredBranches.filter((b) => b.isRemote);

  // Handlers
  const handleCreateBranch = async (_name: string, _checkout: boolean) => {
    try {
      // TODO: Implement API call
      // await api.post(`/api/sessions/${sessionId}/git/branches`, { name, checkout });
      setCreateModalOpen(false);
      await loadBranches();
    } catch (error) {
      console.error('Failed to create branch:', error);
    }
  };

  const handleDeleteBranch = async (_force: boolean) => {
    if (!deleteModalBranch) return;
    try {
      // TODO: Implement API call
      // await api.delete(`/api/sessions/${sessionId}/git/branches/${deleteModalBranch}`, { force });
      setDeleteModalBranch(null);
      await loadBranches();
    } catch (error) {
      console.error('Failed to delete branch:', error);
    }
  };

  const handleMergeBranch = async (_noFastForward: boolean) => {
    if (!mergeModalBranch || !currentBranch) return;
    try {
      // TODO: Implement API call
      // await api.post(`/api/sessions/${sessionId}/git/merge`, { source: mergeModalBranch, noFastForward });
      onMerge?.(mergeModalBranch, currentBranch.name);
      setMergeModalBranch(null);
      await loadBranches();
    } catch (error) {
      console.error('Failed to merge branch:', error);
    }
  };

  const handleSwitchBranch = async (branch: string) => {
    try {
      // TODO: Implement API call
      // await api.post(`/api/sessions/${sessionId}/git/checkout`, { branch });
      onBranchSwitch?.(branch);
      await loadBranches();
    } catch (error) {
      console.error('Failed to switch branch:', error);
    }
  };

  const handleCompare = (_branch: string) => {
    // TODO: Open diff view between branches
  };

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <GitBranch className="h-5 w-5 text-accent-primary" />
          <h2 className="text-lg font-semibold text-text-primary">Branches</h2>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={loadBranches}
            className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-overlay"
            title="Refresh"
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </button>
          <button
            onClick={() => setCreateModalOpen(true)}
            className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-overlay"
            title="Create branch"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Search & Filter */}
      <div className="px-4 py-2 border-b border-border-subtle space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search branches..."
            className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-elevated border border-border-subtle text-text-primary text-sm placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent-primary"
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowLocal(!showLocal)}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded text-xs',
              showLocal
                ? 'bg-accent-primary/20 text-accent-primary'
                : 'bg-overlay text-text-muted hover:text-text-secondary'
            )}
          >
            <Laptop className="h-3 w-3" />
            Local
          </button>
          <button
            onClick={() => setShowRemote(!showRemote)}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded text-xs',
              showRemote
                ? 'bg-accent-primary/20 text-accent-primary'
                : 'bg-overlay text-text-muted hover:text-text-secondary'
            )}
          >
            <Globe className="h-3 w-3" />
            Remote
          </button>
        </div>
      </div>

      {/* Branch list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
          </div>
        ) : filteredBranches.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-text-muted">
            <GitBranch className="h-8 w-8 mb-2 opacity-50" />
            <p className="text-sm">No branches found</p>
          </div>
        ) : (
          <div className="p-2 space-y-4">
            {/* Local branches */}
            {showLocal && localBranches.length > 0 && (
              <div>
                <h3 className="text-xs font-medium text-text-muted px-3 py-1.5 flex items-center gap-1">
                  <Laptop className="h-3 w-3" />
                  Local ({localBranches.length})
                </h3>
                <div className="space-y-0.5">
                  {localBranches.map((branch) => (
                    <BranchItem
                      key={branch.name}
                      branch={branch}
                      onSwitch={() => handleSwitchBranch(branch.name)}
                      onDelete={() => setDeleteModalBranch(branch.name)}
                      onMerge={() => setMergeModalBranch(branch.name)}
                      onCompare={() => handleCompare(branch.name)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Remote branches */}
            {showRemote && remoteBranches.length > 0 && (
              <div>
                <h3 className="text-xs font-medium text-text-muted px-3 py-1.5 flex items-center gap-1">
                  <Globe className="h-3 w-3" />
                  Remote ({remoteBranches.length})
                </h3>
                <div className="space-y-0.5">
                  {remoteBranches.map((branch) => (
                    <BranchItem
                      key={branch.name}
                      branch={branch}
                      onSwitch={() => handleSwitchBranch(branch.name)}
                      onDelete={() => {}}
                      onMerge={() => setMergeModalBranch(branch.name)}
                      onCompare={() => handleCompare(branch.name)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modals */}
      {createModalOpen && currentBranch && (
        <CreateBranchModal
          baseBranch={currentBranch.name}
          onConfirm={handleCreateBranch}
          onCancel={() => setCreateModalOpen(false)}
        />
      )}

      {deleteModalBranch && (
        <DeleteBranchModal
          branch={deleteModalBranch}
          onConfirm={handleDeleteBranch}
          onCancel={() => setDeleteModalBranch(null)}
        />
      )}

      {mergeModalBranch && currentBranch && (
        <MergeBranchModal
          sourceBranch={mergeModalBranch}
          targetBranch={currentBranch.name}
          onConfirm={handleMergeBranch}
          onCancel={() => setMergeModalBranch(null)}
        />
      )}
    </div>
  );
}
