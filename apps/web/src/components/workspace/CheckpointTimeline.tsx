'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { useCheckpointsStore, type Checkpoint } from '@/stores/checkpoints';
import { getSessionCheckpoints } from '@/lib/api';
import {
  RotateCcw,
  FileEdit,
  FilePlus,
  FileX,
  Clock,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';

interface CheckpointTimelineProps {
  sessionId: string;
  agentId?: string;
  className?: string;
  onRestoreClick?: (checkpoint: Checkpoint) => void;
  compact?: boolean;
}

const changeTypeIcons = {
  create: FilePlus,
  modify: FileEdit,
  delete: FileX,
};

const changeTypeColors = {
  create: 'text-green-500',
  modify: 'text-yellow-500',
  delete: 'text-red-500',
};

/**
 * Timeline view showing checkpoints for a session or agent.
 * Allows viewing and restoring to previous states.
 */
export function CheckpointTimeline({
  sessionId,
  agentId,
  className,
  onRestoreClick,
  compact = false,
}: CheckpointTimelineProps) {
  const { setCheckpoints, getCheckpoints, loading, setLoading, restoringCheckpointId } =
    useCheckpointsStore();
  const [expandedCheckpoints, setExpandedCheckpoints] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const checkpoints = getCheckpoints(sessionId);
  const isLoading = loading[sessionId];

  // Fetch checkpoints on mount
  useEffect(() => {
    const fetchCheckpoints = async () => {
      setLoading(sessionId, true);
      setError(null);
      try {
        const data = await getSessionCheckpoints(sessionId, { agentId, limit: 50 });
        // Transform API response to store format
        const transformed = data.map((cp) => ({
          id: cp.id,
          checkpointNumber: cp.checkpoint_number,
          description: cp.description,
          actionType: cp.action_type,
          agentId: cp.agent_id,
          status: cp.status,
          createdAt: new Date(cp.created_at),
          files: cp.files.map((f) => ({
            path: f.path,
            changeType: f.change_type,
            linesAdded: f.lines_added,
            linesRemoved: f.lines_removed,
          })),
          fileCount: cp.file_count,
          totalLinesAdded: cp.total_lines_added,
          totalLinesRemoved: cp.total_lines_removed,
        }));
        setCheckpoints(sessionId, transformed);
      } catch (err) {
        console.error('Failed to fetch checkpoints:', err);
        setError('Failed to load checkpoints');
      } finally {
        setLoading(sessionId, false);
      }
    };

    fetchCheckpoints();
  }, [sessionId, agentId, setCheckpoints, setLoading]);

  const toggleExpanded = useCallback((checkpointId: string) => {
    setExpandedCheckpoints((prev) => {
      const next = new Set(prev);
      if (next.has(checkpointId)) {
        next.delete(checkpointId);
      } else {
        next.add(checkpointId);
      }
      return next;
    });
  }, []);

  const formatTime = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return date.toLocaleDateString();
  };

  if (isLoading) {
    return (
      <div className={cn('p-4 text-center text-text-muted', className)}>
        <div className="animate-pulse">Loading checkpoints...</div>
      </div>
    );
  }

  if (error) {
    return <div className={cn('p-4 text-center text-red-500', className)}>{error}</div>;
  }

  if (checkpoints.length === 0) {
    return (
      <div className={cn('p-4 text-center text-text-muted', className)}>
        <Clock className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No checkpoints yet</p>
        <p className="text-xs mt-1">Checkpoints are created when agents modify files</p>
      </div>
    );
  }

  return (
    <div className={cn('space-y-1', className)}>
      {checkpoints.map((checkpoint, index) => {
        const isExpanded = expandedCheckpoints.has(checkpoint.id);
        const isRestoring = restoringCheckpointId === checkpoint.id;
        const isSuperseded = checkpoint.status === 'superseded';
        const isRestored = checkpoint.status === 'restored';

        return (
          <div
            key={checkpoint.id}
            className={cn(
              'border border-border-subtle rounded-lg overflow-hidden transition-colors',
              isSuperseded && 'opacity-50',
              isRestored && 'border-green-500/50 bg-green-500/5'
            )}
          >
            {/* Header */}
            <div
              className={cn(
                'flex items-center gap-2 p-2 cursor-pointer hover:bg-surface-hover transition-colors',
                compact && 'p-1.5'
              )}
              onClick={() => toggleExpanded(checkpoint.id)}
            >
              {/* Expand/Collapse icon */}
              <button className="text-text-muted hover:text-text-primary p-0.5">
                {isExpanded ? (
                  <ChevronDown className="w-4 h-4" />
                ) : (
                  <ChevronRight className="w-4 h-4" />
                )}
              </button>

              {/* Checkpoint number */}
              <span
                className={cn(
                  'flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-mono',
                  isRestored
                    ? 'bg-green-500/20 text-green-500'
                    : 'bg-accent-primary/20 text-accent-primary'
                )}
              >
                {checkpoint.checkpointNumber}
              </span>

              {/* Description */}
              <div className="flex-1 min-w-0">
                <p className={cn('text-sm truncate', compact && 'text-xs')}>
                  {checkpoint.description || checkpoint.actionType}
                </p>
                <p className="text-xs text-text-muted">
                  {formatTime(checkpoint.createdAt)} • {checkpoint.fileCount} file
                  {checkpoint.fileCount !== 1 ? 's' : ''}
                  {checkpoint.totalLinesAdded > 0 && (
                    <span className="text-green-500 ml-1">+{checkpoint.totalLinesAdded}</span>
                  )}
                  {checkpoint.totalLinesRemoved > 0 && (
                    <span className="text-red-500 ml-1">-{checkpoint.totalLinesRemoved}</span>
                  )}
                </p>
              </div>

              {/* Status badge */}
              {isRestored && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-green-500/20 text-green-500">
                  Restored
                </span>
              )}
              {isSuperseded && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-border-subtle text-text-muted">
                  Superseded
                </span>
              )}

              {/* Restore button */}
              {onRestoreClick && !isSuperseded && checkpoint.status !== 'restored' && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRestoreClick(checkpoint);
                  }}
                  disabled={isRestoring}
                  className={cn(
                    'flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors',
                    'bg-accent-primary/10 text-accent-primary hover:bg-accent-primary/20',
                    isRestoring && 'opacity-50 cursor-not-allowed'
                  )}
                  title="Restore to this checkpoint"
                >
                  <RotateCcw className={cn('w-3 h-3', isRestoring && 'animate-spin')} />
                  {isRestoring ? 'Restoring...' : 'Restore'}
                </button>
              )}
            </div>

            {/* Expanded file list */}
            {isExpanded && (
              <div className="border-t border-border-subtle bg-surface-secondary/50">
                <div className="p-2 space-y-1">
                  {checkpoint.files.map((file, fileIndex) => {
                    const Icon = changeTypeIcons[file.changeType] || FileEdit;
                    const colorClass = changeTypeColors[file.changeType] || 'text-text-muted';

                    return (
                      <div
                        key={fileIndex}
                        className="flex items-center gap-2 text-xs py-1 px-2 rounded hover:bg-surface-hover"
                      >
                        <Icon className={cn('w-3.5 h-3.5 flex-shrink-0', colorClass)} />
                        <span className="flex-1 truncate font-mono">{file.path}</span>
                        <span className="flex items-center gap-1 text-text-muted">
                          {file.linesAdded > 0 && (
                            <span className="text-green-500">+{file.linesAdded}</span>
                          )}
                          {file.linesRemoved > 0 && (
                            <span className="text-red-500">-{file.linesRemoved}</span>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Timeline connector */}
            {index < checkpoints.length - 1 && !compact && (
              <div className="h-4 w-px bg-border-subtle mx-auto" />
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Compact version for use in sidebars
 */
export function CheckpointTimelineCompact({
  sessionId,
  agentId,
  onRestoreClick,
}: {
  sessionId: string;
  agentId?: string;
  onRestoreClick?: (checkpoint: Checkpoint) => void;
}) {
  return (
    <CheckpointTimeline
      sessionId={sessionId}
      agentId={agentId}
      onRestoreClick={onRestoreClick}
      compact
    />
  );
}
