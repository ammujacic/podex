'use client';

import { useState, useMemo, useCallback } from 'react';
import {
  X,
  Check,
  Bot,
  FileCode,
  ChevronLeft,
  ChevronRight,
  SplitSquareVertical,
  AlignJustify,
  Plus,
  Minus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePendingChangesStore } from '@/stores/pendingChanges';
import { useAuthStore } from '@/stores/auth';
import { Button } from '@podex/ui';

// ============================================================================
// Types
// ============================================================================

interface DiffLine {
  type: 'context' | 'add' | 'remove';
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

type ViewMode = 'split' | 'unified';

// ============================================================================
// Diff Computation
// ============================================================================

function computeDiff(original: string | null, proposed: string): DiffLine[] {
  const oldLines = original?.split('\n') ?? [];
  const newLines = proposed.split('\n');

  // Build a map for quick lookup
  const m = oldLines.length;
  const n = newLines.length;

  // LCS DP table
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i]![j] = (dp[i - 1]?.[j - 1] ?? 0) + 1;
      } else {
        dp[i]![j] = Math.max(dp[i - 1]?.[j] ?? 0, dp[i]?.[j - 1] ?? 0);
      }
    }
  }

  // Backtrack to build diff
  let i = m;
  let j = n;
  const result: DiffLine[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.unshift({
        type: 'context',
        content: oldLines[i - 1] ?? '',
        oldLineNumber: i,
        newLineNumber: j,
      });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || (dp[i]?.[j - 1] ?? 0) >= (dp[i - 1]?.[j] ?? 0))) {
      result.unshift({
        type: 'add',
        content: newLines[j - 1] ?? '',
        newLineNumber: j,
      });
      j--;
    } else if (i > 0) {
      result.unshift({
        type: 'remove',
        content: oldLines[i - 1] ?? '',
        oldLineNumber: i,
      });
      i--;
    }
  }

  return result;
}

// ============================================================================
// Line Number Component
// ============================================================================

function LineNumber({ num, className }: { num?: number; className?: string }) {
  return (
    <span className={cn('w-10 text-right pr-2 select-none text-text-muted text-xs', className)}>
      {num ?? ''}
    </span>
  );
}

// ============================================================================
// Unified Diff View
// ============================================================================

function UnifiedDiffView({ lines }: { lines: DiffLine[] }) {
  return (
    <div className="font-mono text-xs overflow-x-auto">
      {lines.map((line, i) => (
        <div
          key={i}
          className={cn(
            'flex leading-5',
            line.type === 'add' && 'bg-green-500/10',
            line.type === 'remove' && 'bg-red-500/10'
          )}
        >
          <LineNumber num={line.oldLineNumber} className="border-r border-border-subtle" />
          <LineNumber num={line.newLineNumber} className="border-r border-border-subtle" />
          <span
            className={cn(
              'w-5 text-center select-none',
              line.type === 'add' && 'text-green-400 bg-green-500/20',
              line.type === 'remove' && 'text-red-400 bg-red-500/20',
              line.type === 'context' && 'text-text-muted'
            )}
          >
            {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}
          </span>
          <pre
            className={cn(
              'flex-1 px-2 whitespace-pre',
              line.type === 'add' && 'text-green-300',
              line.type === 'remove' && 'text-red-300',
              line.type === 'context' && 'text-text-secondary'
            )}
          >
            {line.content}
          </pre>
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// Split Diff View
// ============================================================================

function SplitDiffView({ lines }: { lines: DiffLine[] }) {
  // Build parallel lines for left (old) and right (new) sides
  const { leftLines, rightLines } = useMemo(() => {
    const left: (DiffLine | null)[] = [];
    const right: (DiffLine | null)[] = [];

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line) {
        i++;
        continue;
      }

      if (line.type === 'context') {
        left.push(line);
        right.push(line);
        i++;
      } else if (line.type === 'remove') {
        // Collect consecutive removes
        const removes: DiffLine[] = [];
        while (i < lines.length && lines[i]?.type === 'remove') {
          const removeLine = lines[i];
          if (removeLine) removes.push(removeLine);
          i++;
        }
        // Collect consecutive adds
        const adds: DiffLine[] = [];
        while (i < lines.length && lines[i]?.type === 'add') {
          const addLine = lines[i];
          if (addLine) adds.push(addLine);
          i++;
        }
        // Pair them up
        const maxLen = Math.max(removes.length, adds.length);
        for (let j = 0; j < maxLen; j++) {
          left.push(removes[j] ?? null);
          right.push(adds[j] ?? null);
        }
      } else if (line.type === 'add') {
        left.push(null);
        right.push(line);
        i++;
      }
    }

    return { leftLines: left, rightLines: right };
  }, [lines]);

  return (
    <div className="font-mono text-xs flex">
      {/* Left side (old) */}
      <div className="flex-1 border-r border-border-default overflow-x-auto">
        {leftLines.map((line, i) => (
          <div
            key={i}
            className={cn(
              'flex leading-5 min-h-[20px]',
              line?.type === 'remove' && 'bg-red-500/10'
            )}
          >
            <LineNumber num={line?.oldLineNumber} className="border-r border-border-subtle" />
            <span
              className={cn(
                'w-5 text-center select-none',
                line?.type === 'remove' && 'text-red-400 bg-red-500/20',
                line?.type === 'context' && 'text-text-muted'
              )}
            >
              {line?.type === 'remove' ? '-' : line?.type === 'context' ? ' ' : ''}
            </span>
            <pre
              className={cn(
                'flex-1 px-2 whitespace-pre',
                line?.type === 'remove' && 'text-red-300',
                line?.type === 'context' && 'text-text-secondary'
              )}
            >
              {line?.content ?? ''}
            </pre>
          </div>
        ))}
      </div>

      {/* Right side (new) */}
      <div className="flex-1 overflow-x-auto">
        {rightLines.map((line, i) => (
          <div
            key={i}
            className={cn('flex leading-5 min-h-[20px]', line?.type === 'add' && 'bg-green-500/10')}
          >
            <LineNumber num={line?.newLineNumber} className="border-r border-border-subtle" />
            <span
              className={cn(
                'w-5 text-center select-none',
                line?.type === 'add' && 'text-green-400 bg-green-500/20',
                line?.type === 'context' && 'text-text-muted'
              )}
            >
              {line?.type === 'add' ? '+' : line?.type === 'context' ? ' ' : ''}
            </span>
            <pre
              className={cn(
                'flex-1 px-2 whitespace-pre',
                line?.type === 'add' && 'text-green-300',
                line?.type === 'context' && 'text-text-secondary'
              )}
            >
              {line?.content ?? ''}
            </pre>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Stats Bar
// ============================================================================

function DiffStats({ lines }: { lines: DiffLine[] }) {
  const additions = lines.filter((l) => l.type === 'add').length;
  const deletions = lines.filter((l) => l.type === 'remove').length;

  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="flex items-center gap-1 text-green-400">
        <Plus className="h-3 w-3" />
        {additions}
      </span>
      <span className="flex items-center gap-1 text-red-400">
        <Minus className="h-3 w-3" />
        {deletions}
      </span>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

interface AgentDiffReviewProps {
  className?: string;
}

export function AgentDiffReview({ className }: AgentDiffReviewProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('split');
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const activeChange = usePendingChangesStore((state) => state.getActiveChange());
  const updateStatus = usePendingChangesStore((state) => state.updateChangeStatus);
  const closeReview = usePendingChangesStore((state) => state.closeReview);
  const sessionChanges = usePendingChangesStore((state) =>
    activeChange ? state.getSessionChanges(activeChange.sessionId) : []
  );
  const openReview = usePendingChangesStore((state) => state.openReview);
  const activeToken = useAuthStore((state) => state.tokens?.accessToken);

  // Compute diff lines
  const diffLines = useMemo(() => {
    if (!activeChange) return [];
    return computeDiff(activeChange.originalContent, activeChange.proposedContent);
  }, [activeChange]);

  // Get current index in pending changes
  const pendingChanges = sessionChanges.filter((c) => c.status === 'pending');
  const currentIndex = pendingChanges.findIndex((c) => c.id === activeChange?.id);
  const totalPending = pendingChanges.length;

  // Navigation
  const goToChange = useCallback(
    (index: number) => {
      const change = pendingChanges[index];
      if (change) {
        openReview(change.sessionId, change.id);
      }
    },
    [pendingChanges, openReview]
  );

  const handleAccept = useCallback(async () => {
    if (!activeChange || !activeToken) return;

    setIsSubmitting(true);
    try {
      const response = await fetch(
        `/api/v1/sessions/${activeChange.sessionId}/pending-changes/${activeChange.id}/accept`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${activeToken}`,
          },
        }
      );

      if (response.ok) {
        updateStatus(activeChange.sessionId, activeChange.id, 'accepted');
      }
    } catch (error) {
      console.error('Failed to accept change:', error);
    } finally {
      setIsSubmitting(false);
    }
  }, [activeChange, activeToken, updateStatus]);

  const handleReject = useCallback(async () => {
    if (!activeChange || !activeToken) return;

    setIsSubmitting(true);
    try {
      const response = await fetch(
        `/api/v1/sessions/${activeChange.sessionId}/pending-changes/${activeChange.id}/reject`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${activeToken}`,
          },
          body: JSON.stringify({ feedback: feedback || null }),
        }
      );

      if (response.ok) {
        updateStatus(activeChange.sessionId, activeChange.id, 'rejected');
        setFeedback('');
        setShowFeedback(false);
      }
    } catch (error) {
      console.error('Failed to reject change:', error);
    } finally {
      setIsSubmitting(false);
    }
  }, [activeChange, activeToken, feedback, updateStatus]);

  if (!activeChange) {
    return null;
  }

  const isNewFile = activeChange.originalContent === null;

  return (
    <div
      className={cn('flex flex-col h-full bg-surface border-l border-border-default', className)}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-border-subtle bg-elevated">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-brand-500" />
            <span className="text-sm text-text-secondary">{activeChange.agentName}</span>
          </div>

          <div className="flex items-center gap-2">
            <FileCode className="h-4 w-4 text-text-muted" />
            <span className="text-sm font-mono text-text-primary">{activeChange.filePath}</span>
            {isNewFile && (
              <span className="px-1.5 py-0.5 text-xs rounded bg-green-500/20 text-green-400">
                New
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Navigation */}
          {totalPending > 1 && (
            <div className="flex items-center gap-1 mr-2">
              <button
                onClick={() => goToChange(currentIndex - 1)}
                disabled={currentIndex <= 0}
                className="p-1 rounded hover:bg-overlay disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-xs text-text-muted">
                {currentIndex + 1} / {totalPending}
              </span>
              <button
                onClick={() => goToChange(currentIndex + 1)}
                disabled={currentIndex >= totalPending - 1}
                className="p-1 rounded hover:bg-overlay disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}

          <DiffStats lines={diffLines} />

          {/* View mode toggle */}
          <div className="flex rounded-lg border border-border-subtle overflow-hidden ml-2">
            <button
              onClick={() => setViewMode('unified')}
              className={cn(
                'flex items-center gap-1 px-2 py-1 text-xs',
                viewMode === 'unified'
                  ? 'bg-overlay text-text-primary'
                  : 'text-text-muted hover:text-text-secondary'
              )}
              title="Unified view"
            >
              <AlignJustify className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setViewMode('split')}
              className={cn(
                'flex items-center gap-1 px-2 py-1 text-xs border-l border-border-subtle',
                viewMode === 'split'
                  ? 'bg-overlay text-text-primary'
                  : 'text-text-muted hover:text-text-secondary'
              )}
              title="Split view"
            >
              <SplitSquareVertical className="h-3.5 w-3.5" />
            </button>
          </div>

          <button onClick={closeReview} className="p-1 rounded hover:bg-overlay text-text-muted">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Description */}
      {activeChange.description && (
        <div className="px-3 py-2 text-sm text-text-secondary bg-overlay/50 border-b border-border-subtle">
          {activeChange.description}
        </div>
      )}

      {/* Diff content */}
      <div className="flex-1 overflow-auto bg-void">
        {viewMode === 'unified' ? (
          <UnifiedDiffView lines={diffLines} />
        ) : (
          <SplitDiffView lines={diffLines} />
        )}
      </div>

      {/* Feedback input (shown when rejecting) */}
      {showFeedback && (
        <div className="p-3 border-t border-border-subtle bg-elevated">
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Why are you rejecting this change? (optional)"
            className="w-full px-3 py-2 text-sm rounded-md bg-surface border border-border-subtle focus:outline-none focus:ring-2 focus:ring-accent-primary resize-none"
            rows={2}
          />
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between gap-3 p-3 border-t border-border-subtle bg-elevated">
        <div className="text-xs text-text-muted">
          {isNewFile ? 'Creating new file' : 'Modifying existing file'}
        </div>

        <div className="flex items-center gap-2">
          {showFeedback ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowFeedback(false);
                  setFeedback('');
                }}
              >
                Cancel
              </Button>
              <Button variant="danger" size="sm" onClick={handleReject} disabled={isSubmitting}>
                <X className="h-4 w-4 mr-1" />
                Confirm Reject
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowFeedback(true)}
                disabled={isSubmitting}
              >
                <X className="h-4 w-4 mr-1" />
                Reject
              </Button>
              <Button size="sm" onClick={handleAccept} disabled={isSubmitting}>
                <Check className="h-4 w-4 mr-1" />
                Accept Changes
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
