'use client';

import React, { useMemo } from 'react';
import { cn } from '@/lib/utils';

// ============================================================================
// Types
// ============================================================================

interface DiffLine {
  type: 'context' | 'add' | 'remove';
  content: string;
  old_line_number: number | null;
  new_line_number: number | null;
}

interface DiffHunk {
  id: string;
  old_start: number;
  old_lines: number;
  new_start: number;
  new_lines: number;
  status: string;
  lines: DiffLine[];
}

interface AggregatedFileChange {
  change_set_id: string;
  agent_id: string;
  agent_name: string;
  change_type: string;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
}

interface SplitDiffViewProps {
  changes: AggregatedFileChange[];
  className?: string;
}

interface SplitLine {
  left: DiffLine | null;
  right: DiffLine | null;
}

// ============================================================================
// Helper Functions
// ============================================================================

function generateSplitLines(lines: DiffLine[]): SplitLine[] {
  const splitLines: SplitLine[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    if (line.type === 'context') {
      splitLines.push({ left: line, right: line });
      i++;
    } else if (line.type === 'remove') {
      // Look ahead for matching adds
      const removes: DiffLine[] = [];
      while (i < lines.length && lines[i]!.type === 'remove') {
        removes.push(lines[i]!);
        i++;
      }

      const adds: DiffLine[] = [];
      while (i < lines.length && lines[i]!.type === 'add') {
        adds.push(lines[i]!);
        i++;
      }

      // Pair them up
      const maxLen = Math.max(removes.length, adds.length);
      for (let j = 0; j < maxLen; j++) {
        splitLines.push({
          left: removes[j] || null,
          right: adds[j] || null,
        });
      }
    } else if (line.type === 'add') {
      // Pure add without preceding remove
      splitLines.push({ left: null, right: line });
      i++;
    } else {
      i++;
    }
  }

  return splitLines;
}

// ============================================================================
// Split Line Row Component
// ============================================================================

function SplitLineRow({ left, right }: SplitLine) {
  return (
    <div className="flex font-mono text-xs leading-5">
      {/* Left side (old) */}
      <div
        className={cn(
          'flex-1 flex border-r border-border-subtle',
          left?.type === 'remove' && 'bg-red-500/10',
          !left && 'bg-surface-secondary'
        )}
      >
        <span className="w-10 flex-shrink-0 text-right pr-2 text-text-muted select-none border-r border-border-subtle">
          {left?.old_line_number ?? ''}
        </span>
        <span
          className={cn(
            'w-5 flex-shrink-0 text-center select-none',
            left?.type === 'remove' && 'text-red-400',
            left?.type === 'context' && 'text-text-muted'
          )}
        >
          {left?.type === 'remove' ? '-' : left?.type === 'context' ? ' ' : ''}
        </span>
        <pre
          className={cn(
            'flex-1 px-2 whitespace-pre overflow-x-auto',
            left?.type === 'remove' && 'text-red-300',
            left?.type === 'context' && 'text-text-secondary',
            !left && 'text-transparent'
          )}
        >
          {left?.content ?? '\u00A0'}
        </pre>
      </div>

      {/* Right side (new) */}
      <div
        className={cn(
          'flex-1 flex',
          right?.type === 'add' && 'bg-green-500/10',
          !right && 'bg-surface-secondary'
        )}
      >
        <span className="w-10 flex-shrink-0 text-right pr-2 text-text-muted select-none border-r border-border-subtle">
          {right?.new_line_number ?? ''}
        </span>
        <span
          className={cn(
            'w-5 flex-shrink-0 text-center select-none',
            right?.type === 'add' && 'text-green-400',
            right?.type === 'context' && 'text-text-muted'
          )}
        >
          {right?.type === 'add' ? '+' : right?.type === 'context' ? ' ' : ''}
        </span>
        <pre
          className={cn(
            'flex-1 px-2 whitespace-pre overflow-x-auto',
            right?.type === 'add' && 'text-green-300',
            right?.type === 'context' && 'text-text-secondary',
            !right && 'text-transparent'
          )}
        >
          {right?.content ?? '\u00A0'}
        </pre>
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function SplitDiffView({ changes, className }: SplitDiffViewProps) {
  // Flatten all hunks from all changes
  const allLines = useMemo(() => {
    const lines: DiffLine[] = [];
    for (const change of changes) {
      for (const hunk of change.hunks) {
        lines.push(...hunk.lines);
      }
    }
    return lines;
  }, [changes]);

  const splitLines = useMemo(() => generateSplitLines(allLines), [allLines]);

  if (splitLines.length === 0) {
    return (
      <div className={cn('text-center py-4 text-text-muted text-sm', className)}>
        No changes to display
      </div>
    );
  }

  return (
    <div className={cn('border border-border-subtle rounded-lg overflow-hidden', className)}>
      {/* Header */}
      <div className="flex text-xs text-text-muted border-b border-border-subtle bg-surface-secondary">
        <div className="flex-1 px-3 py-1 border-r border-border-subtle">Original</div>
        <div className="flex-1 px-3 py-1">Modified</div>
      </div>

      {/* Lines */}
      <div className="overflow-x-auto">
        {splitLines.map((split, i) => (
          <SplitLineRow key={i} {...split} />
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Standalone Split Diff Component (for single file comparison)
// ============================================================================

interface StandaloneSplitDiffProps {
  contentBefore: string;
  contentAfter: string;
  className?: string;
}

export function StandaloneSplitDiff({
  contentBefore,
  contentAfter,
  className,
}: StandaloneSplitDiffProps) {
  const beforeLines = contentBefore.split('\n');
  const afterLines = contentAfter.split('\n');

  // Simple line-by-line comparison for standalone view
  const splitLines = useMemo(() => {
    const lines: SplitLine[] = [];
    const maxLen = Math.max(beforeLines.length, afterLines.length);

    for (let i = 0; i < maxLen; i++) {
      const before = beforeLines[i];
      const after = afterLines[i];

      if (before === after) {
        // Same line
        lines.push({
          left: {
            type: 'context',
            content: before ?? '',
            old_line_number: i + 1,
            new_line_number: i + 1,
          },
          right: {
            type: 'context',
            content: after ?? '',
            old_line_number: i + 1,
            new_line_number: i + 1,
          },
        });
      } else if (before !== undefined && after !== undefined) {
        // Changed line
        lines.push({
          left: {
            type: 'remove',
            content: before,
            old_line_number: i + 1,
            new_line_number: null,
          },
          right: {
            type: 'add',
            content: after,
            old_line_number: null,
            new_line_number: i + 1,
          },
        });
      } else if (before !== undefined) {
        // Removed line
        lines.push({
          left: {
            type: 'remove',
            content: before,
            old_line_number: i + 1,
            new_line_number: null,
          },
          right: null,
        });
      } else {
        // Added line
        lines.push({
          left: null,
          right: {
            type: 'add',
            content: after ?? '',
            old_line_number: null,
            new_line_number: i + 1,
          },
        });
      }
    }

    return lines;
  }, [beforeLines, afterLines]);

  return (
    <div className={cn('border border-border-subtle rounded-lg overflow-hidden', className)}>
      <div className="flex text-xs text-text-muted border-b border-border-subtle bg-surface-secondary">
        <div className="flex-1 px-3 py-1 border-r border-border-subtle">Original</div>
        <div className="flex-1 px-3 py-1">Modified</div>
      </div>
      <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
        {splitLines.map((split, i) => (
          <SplitLineRow key={i} {...split} />
        ))}
      </div>
    </div>
  );
}
