'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  History,
  Undo2,
  RotateCcw,
  FileCode,
  Bot,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Eye,
  RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ============================================================================
// Types
// ============================================================================

export interface FileChange {
  path: string;
  type: 'add' | 'modify' | 'delete';
  additions: number;
  deletions: number;
  previousContent?: string;
  newContent?: string;
}

export interface ChangeSnapshot {
  id: string;
  timestamp: Date;
  agentId: string;
  agentName: string;
  description: string;
  files: FileChange[];
  commitHash?: string;
  canRevert: boolean;
  reverted: boolean;
}

// ============================================================================
// Change Card Component
// ============================================================================

interface ChangeCardProps {
  snapshot: ChangeSnapshot;
  expanded: boolean;
  onToggle: () => void;
  onRevert: (snapshotId: string) => void;
  onPreview: (snapshot: ChangeSnapshot) => void;
}

function ChangeCard({ snapshot, expanded, onToggle, onRevert, onPreview }: ChangeCardProps) {
  const totalChanges = snapshot.files.reduce(
    (acc, f) => ({
      additions: acc.additions + f.additions,
      deletions: acc.deletions + f.deletions,
    }),
    { additions: 0, deletions: 0 }
  );

  return (
    <div
      className={cn(
        'rounded-lg border overflow-hidden transition-colors',
        snapshot.reverted
          ? 'border-text-muted/30 opacity-60'
          : 'border-border-subtle hover:border-border-default'
      )}
    >
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-3 bg-surface cursor-pointer"
        onClick={onToggle}
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-text-muted" />
        ) : (
          <ChevronRight className="h-4 w-4 text-text-muted" />
        )}

        <Bot className="h-4 w-4 text-accent-primary" />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-text-primary truncate">
              {snapshot.description}
            </span>
            {snapshot.reverted && (
              <span className="px-1.5 py-0.5 rounded text-xs bg-text-muted/20 text-text-muted">
                Reverted
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <span>{snapshot.agentName}</span>
            <span>•</span>
            <span>{new Date(snapshot.timestamp).toLocaleTimeString()}</span>
            <span>•</span>
            <span>{snapshot.files.length} files</span>
            {snapshot.commitHash && (
              <>
                <span>•</span>
                <code className="text-accent-primary">{snapshot.commitHash.slice(0, 7)}</code>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="text-green-400">+{totalChanges.additions}</span>
          <span className="text-red-400">-{totalChanges.deletions}</span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onPreview(snapshot);
            }}
            className="p-1.5 rounded hover:bg-overlay text-text-muted hover:text-text-primary"
            title="Preview changes"
          >
            <Eye className="h-4 w-4" />
          </button>

          {snapshot.canRevert && !snapshot.reverted && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRevert(snapshot.id);
              }}
              className="p-1.5 rounded hover:bg-overlay text-text-muted hover:text-orange-400"
              title="Revert these changes"
            >
              <Undo2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Files list */}
      {expanded && (
        <div className="border-t border-border-subtle bg-elevated">
          {snapshot.files.map((file, i) => (
            <div
              key={i}
              className="flex items-center gap-3 px-4 py-2 text-sm border-b border-border-subtle last:border-b-0"
            >
              <span
                className={cn(
                  'px-1.5 py-0.5 rounded text-xs font-medium',
                  file.type === 'add' && 'bg-green-500/20 text-green-400',
                  file.type === 'modify' && 'bg-yellow-500/20 text-yellow-400',
                  file.type === 'delete' && 'bg-red-500/20 text-red-400'
                )}
              >
                {file.type === 'add' ? 'A' : file.type === 'modify' ? 'M' : 'D'}
              </span>

              <FileCode className="h-4 w-4 text-text-muted" />

              <span className="flex-1 text-text-secondary font-mono truncate">{file.path}</span>

              <span className="text-xs text-green-400">+{file.additions}</span>
              <span className="text-xs text-red-400">-{file.deletions}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Revert Confirmation Modal
// ============================================================================

interface RevertModalProps {
  snapshot: ChangeSnapshot;
  onConfirm: () => void;
  onCancel: () => void;
}

function RevertModal({ snapshot, onConfirm, onCancel }: RevertModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-void/80 backdrop-blur-sm" onClick={onCancel} />

      <div className="relative w-full max-w-md rounded-xl border border-border-default bg-surface shadow-2xl overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border-subtle">
          <AlertTriangle className="h-5 w-5 text-orange-400" />
          <h3 className="text-lg font-semibold text-text-primary">Revert Changes</h3>
        </div>

        <div className="p-4">
          <p className="text-text-secondary mb-4">
            Are you sure you want to revert the following changes?
          </p>

          <div className="rounded-lg border border-border-subtle bg-elevated p-3 mb-4">
            <div className="flex items-center gap-2 mb-2">
              <Bot className="h-4 w-4 text-accent-primary" />
              <span className="text-sm font-medium text-text-primary">{snapshot.description}</span>
            </div>
            <div className="text-xs text-text-muted">
              {snapshot.files.length} file(s) will be restored to their previous state
            </div>
          </div>

          <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-3 text-sm text-orange-300">
            This action will create a new commit reverting these changes. This cannot be undone.
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border-subtle bg-elevated">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg bg-overlay hover:bg-elevated text-text-secondary"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white"
          >
            <Undo2 className="h-4 w-4" />
            Revert Changes
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

interface ChangeHistoryProps {
  sessionId: string;
  className?: string;
}

export function ChangeHistory({ sessionId, className }: ChangeHistoryProps) {
  const [snapshots, setSnapshots] = useState<ChangeSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedSnapshots, setExpandedSnapshots] = useState<Set<string>>(new Set());
  const [revertingSnapshot, setRevertingSnapshot] = useState<ChangeSnapshot | null>(null);
  const [_previewSnapshot, setPreviewSnapshot] = useState<ChangeSnapshot | null>(null);

  // Load snapshots
  useEffect(() => {
    async function loadSnapshots() {
      setLoading(true);
      try {
        // In real implementation, fetch from API
        // const data = await api.get(`/api/sessions/${sessionId}/history`);

        // Mock data
        const mockSnapshots: ChangeSnapshot[] = [
          {
            id: '1',
            timestamp: new Date(Date.now() - 300000),
            agentId: 'coder-1',
            agentName: 'Coder',
            description: 'Add Button component with variants',
            commitHash: 'abc1234',
            canRevert: true,
            reverted: false,
            files: [
              { path: 'src/components/Button.tsx', type: 'add', additions: 85, deletions: 0 },
              { path: 'src/components/index.ts', type: 'modify', additions: 1, deletions: 0 },
            ],
          },
          {
            id: '2',
            timestamp: new Date(Date.now() - 600000),
            agentId: 'coder-1',
            agentName: 'Coder',
            description: 'Refactor authentication flow',
            commitHash: 'def5678',
            canRevert: true,
            reverted: false,
            files: [
              { path: 'src/lib/auth.ts', type: 'modify', additions: 45, deletions: 30 },
              { path: 'src/hooks/useAuth.ts', type: 'modify', additions: 20, deletions: 15 },
              { path: 'src/middleware.ts', type: 'modify', additions: 10, deletions: 5 },
            ],
          },
          {
            id: '3',
            timestamp: new Date(Date.now() - 900000),
            agentId: 'architect-1',
            agentName: 'Architect',
            description: 'Initial project setup',
            commitHash: 'ghi9012',
            canRevert: false,
            reverted: false,
            files: [
              { path: 'package.json', type: 'add', additions: 50, deletions: 0 },
              { path: 'tsconfig.json', type: 'add', additions: 25, deletions: 0 },
              { path: 'src/index.ts', type: 'add', additions: 10, deletions: 0 },
            ],
          },
        ];

        setSnapshots(mockSnapshots);
      } catch (error) {
        console.error('Failed to load history:', error);
      } finally {
        setLoading(false);
      }
    }

    loadSnapshots();
  }, [sessionId]);

  // Toggle snapshot expansion
  const toggleSnapshot = useCallback((snapshotId: string) => {
    setExpandedSnapshots((prev) => {
      const next = new Set(prev);
      if (next.has(snapshotId)) {
        next.delete(snapshotId);
      } else {
        next.add(snapshotId);
      }
      return next;
    });
  }, []);

  // Handle revert
  const handleRevert = useCallback(
    (snapshotId: string) => {
      const snapshot = snapshots.find((s) => s.id === snapshotId);
      if (snapshot) {
        setRevertingSnapshot(snapshot);
      }
    },
    [snapshots]
  );

  // Confirm revert
  const confirmRevert = useCallback(async () => {
    if (!revertingSnapshot) return;

    try {
      // In real implementation, call API to revert
      // await api.post(`/api/sessions/${sessionId}/history/${revertingSnapshot.id}/revert`);

      // Mark as reverted
      setSnapshots((prev) =>
        prev.map((s) => (s.id === revertingSnapshot.id ? { ...s, reverted: true } : s))
      );
    } catch (error) {
      console.error('Failed to revert:', error);
    } finally {
      setRevertingSnapshot(null);
    }
  }, [revertingSnapshot]);

  // Stats
  const stats = useMemo(() => {
    let totalAdditions = 0;
    let totalDeletions = 0;

    for (const snapshot of snapshots) {
      if (!snapshot.reverted) {
        for (const file of snapshot.files) {
          totalAdditions += file.additions;
          totalDeletions += file.deletions;
        }
      }
    }

    return {
      snapshots: snapshots.filter((s) => !s.reverted).length,
      totalAdditions,
      totalDeletions,
    };
  }, [snapshots]);

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <History className="h-5 w-5 text-accent-primary" />
          <h2 className="text-lg font-semibold text-text-primary">Change History</h2>
        </div>
        <div className="flex items-center gap-3 text-sm text-text-muted">
          <span>{stats.snapshots} changes</span>
          <span className="text-green-400">+{stats.totalAdditions}</span>
          <span className="text-red-400">-{stats.totalDeletions}</span>
        </div>
      </div>

      {/* Info bar */}
      <div className="px-4 py-2 border-b border-border-subtle bg-elevated">
        <p className="text-xs text-text-muted flex items-center gap-2">
          <RotateCcw className="h-3.5 w-3.5" />
          Click the undo button on any change to revert it
        </p>
      </div>

      {/* Snapshots list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-text-muted">
            <RefreshCw className="h-5 w-5 animate-spin mr-2" />
            Loading history...
          </div>
        ) : snapshots.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-text-muted">
            <History className="h-8 w-8 mb-2 opacity-50" />
            <p>No changes recorded yet</p>
          </div>
        ) : (
          snapshots.map((snapshot) => (
            <ChangeCard
              key={snapshot.id}
              snapshot={snapshot}
              expanded={expandedSnapshots.has(snapshot.id)}
              onToggle={() => toggleSnapshot(snapshot.id)}
              onRevert={handleRevert}
              onPreview={setPreviewSnapshot}
            />
          ))
        )}
      </div>

      {/* Revert confirmation modal */}
      {revertingSnapshot && (
        <RevertModal
          snapshot={revertingSnapshot}
          onConfirm={confirmRevert}
          onCancel={() => setRevertingSnapshot(null)}
        />
      )}
    </div>
  );
}
