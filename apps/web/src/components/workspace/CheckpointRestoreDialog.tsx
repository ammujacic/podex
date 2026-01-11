'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { useCheckpointsStore, type Checkpoint } from '@/stores/checkpoints';
import {
  restoreCheckpoint as restoreCheckpointApi,
  getCheckpointDiff,
  type CheckpointDiff,
} from '@/lib/api';
import {
  RotateCcw,
  X,
  AlertTriangle,
  FileEdit,
  FilePlus,
  FileX,
  ChevronDown,
  ChevronRight,
  Check,
} from 'lucide-react';

interface CheckpointRestoreDialogProps {
  checkpoint: Checkpoint | null;
  sessionId: string;
  isOpen: boolean;
  onClose: () => void;
  onRestoreComplete?: (checkpoint: Checkpoint) => void;
}

/**
 * Dialog for confirming and executing checkpoint restore.
 * Shows the files that will be affected and their diffs.
 */
export function CheckpointRestoreDialog({
  checkpoint,
  sessionId,
  isOpen,
  onClose,
  onRestoreComplete,
}: CheckpointRestoreDialogProps) {
  const { setRestoring, updateCheckpointStatus } = useCheckpointsStore();
  const [diff, setDiff] = useState<CheckpointDiff | null>(null);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [restoring, setRestoringLocal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const loadDiff = useCallback(async () => {
    if (!checkpoint) return;
    setLoadingDiff(true);
    setError(null);
    try {
      const diffData = await getCheckpointDiff(checkpoint.id);
      setDiff(diffData);
    } catch (err) {
      console.error('Failed to load checkpoint diff:', err);
      setError('Failed to load file changes');
    } finally {
      setLoadingDiff(false);
    }
  }, [checkpoint]);

  // Load diff when dialog opens
  useEffect(() => {
    if (isOpen && checkpoint && !diff) {
      loadDiff();
    }
    if (!isOpen) {
      setDiff(null);
      setError(null);
      setSuccess(false);
      setExpandedFiles(new Set());
    }
  }, [isOpen, checkpoint, diff, loadDiff]);

  const handleRestore = useCallback(async () => {
    if (!checkpoint) return;

    setRestoringLocal(true);
    setRestoring(checkpoint.id);
    setError(null);

    try {
      await restoreCheckpointApi(checkpoint.id);
      updateCheckpointStatus(sessionId, checkpoint.id, 'restored');
      setSuccess(true);
      onRestoreComplete?.(checkpoint);

      // Close dialog after short delay
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err) {
      console.error('Failed to restore checkpoint:', err);
      setError('Failed to restore checkpoint. Please try again.');
    } finally {
      setRestoringLocal(false);
      setRestoring(null);
    }
  }, [checkpoint, sessionId, setRestoring, updateCheckpointStatus, onRestoreComplete, onClose]);

  const toggleFileExpanded = (path: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  if (!isOpen || !checkpoint) return null;

  const changeTypeIcons = {
    create: FilePlus,
    modify: FileEdit,
    delete: FileX,
  };

  const changeTypeLabels = {
    create: 'Created',
    modify: 'Modified',
    delete: 'Deleted',
  };

  const changeTypeColors = {
    create: 'text-green-500',
    modify: 'text-yellow-500',
    delete: 'text-red-500',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Dialog */}
      <div className="relative bg-surface-primary border border-border-subtle rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-accent-primary/20 flex items-center justify-center">
              <RotateCcw className="w-4 h-4 text-accent-primary" />
            </div>
            <div>
              <h2 className="text-lg font-medium">
                Restore Checkpoint #{checkpoint.checkpointNumber}
              </h2>
              <p className="text-sm text-text-muted">
                {checkpoint.description || checkpoint.actionType}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-surface-hover transition-colors"
          >
            <X className="w-5 h-5 text-text-muted" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Warning */}
          <div className="flex items-start gap-3 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
            <AlertTriangle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-yellow-500">This action will revert file changes</p>
              <p className="text-text-muted mt-1">
                Files will be restored to their state before checkpoint #
                {checkpoint.checkpointNumber}. Any changes made after this checkpoint will be
                undone.
              </p>
            </div>
          </div>

          {/* Files list */}
          <div>
            <h3 className="text-sm font-medium mb-2">Files to restore ({checkpoint.fileCount})</h3>

            {loadingDiff ? (
              <div className="text-center py-8 text-text-muted">
                <div className="animate-pulse">Loading file changes...</div>
              </div>
            ) : error && !diff ? (
              <div className="text-center py-8 text-red-500">{error}</div>
            ) : (
              <div className="space-y-1 border border-border-subtle rounded-lg overflow-hidden">
                {(diff?.files ?? checkpoint.files).map((file, index) => {
                  // Handle both API response format (snake_case) and store format (camelCase)
                  const fileAny = file as {
                    path?: string;
                    file_path?: string;
                    change_type?: string;
                    changeType?: string;
                  };
                  const path = fileAny.path ?? fileAny.file_path ?? '';
                  const changeType = (fileAny.change_type ??
                    fileAny.changeType ??
                    'modify') as keyof typeof changeTypeIcons;
                  const Icon = changeTypeIcons[changeType] || FileEdit;
                  const label = changeTypeLabels[changeType] || 'Changed';
                  const colorClass = changeTypeColors[changeType] || 'text-text-muted';
                  const isExpanded = expandedFiles.has(path);
                  const hasDiff = diff?.files?.[index] && 'content_before' in diff.files[index];

                  return (
                    <div key={path} className="border-b border-border-subtle last:border-b-0">
                      <div
                        className={cn(
                          'flex items-center gap-2 px-3 py-2 hover:bg-surface-hover cursor-pointer',
                          hasDiff && 'cursor-pointer'
                        )}
                        onClick={() => hasDiff && toggleFileExpanded(path)}
                      >
                        {hasDiff && (
                          <button className="p-0.5 text-text-muted">
                            {isExpanded ? (
                              <ChevronDown className="w-4 h-4" />
                            ) : (
                              <ChevronRight className="w-4 h-4" />
                            )}
                          </button>
                        )}
                        <Icon className={cn('w-4 h-4 flex-shrink-0', colorClass)} />
                        <span className="flex-1 text-sm font-mono truncate">{path}</span>
                        <span
                          className={cn(
                            'text-xs px-1.5 py-0.5 rounded',
                            colorClass,
                            'bg-current/10'
                          )}
                        >
                          {label}
                        </span>
                      </div>

                      {/* Diff view */}
                      {isExpanded && hasDiff && diff?.files?.[index] && (
                        <div className="bg-surface-secondary border-t border-border-subtle p-2 overflow-x-auto">
                          <pre className="text-xs font-mono">
                            {diff.files[index].content_before ? (
                              <div className="space-y-1">
                                <div className="text-text-muted">Before:</div>
                                <div className="bg-red-500/5 p-2 rounded border-l-2 border-red-500">
                                  {diff.files[index].content_before?.slice(0, 500)}
                                  {(diff.files[index].content_before?.length || 0) > 500 && '...'}
                                </div>
                              </div>
                            ) : (
                              <div className="text-text-muted italic">File did not exist</div>
                            )}
                          </pre>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Summary */}
          <div className="flex items-center gap-4 text-sm text-text-muted">
            <span>
              <span className="text-green-500">+{checkpoint.totalLinesAdded}</span> lines added
            </span>
            <span>
              <span className="text-red-500">-{checkpoint.totalLinesRemoved}</span> lines removed
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-border-subtle bg-surface-secondary">
          {error && <p className="text-sm text-red-500">{error}</p>}
          {success && (
            <div className="flex items-center gap-2 text-sm text-green-500">
              <Check className="w-4 h-4" />
              Checkpoint restored successfully
            </div>
          )}
          {!error && !success && <div />}

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={restoring}
              className="px-3 py-1.5 text-sm rounded border border-border-subtle hover:bg-surface-hover transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleRestore}
              disabled={restoring || success}
              className={cn(
                'flex items-center gap-2 px-3 py-1.5 text-sm rounded transition-colors',
                'bg-accent-primary text-white hover:bg-accent-primary/90',
                'disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            >
              <RotateCcw className={cn('w-4 h-4', restoring && 'animate-spin')} />
              {restoring ? 'Restoring...' : 'Restore Files'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
