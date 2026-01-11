'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  FileCode,
  Plus,
  ChevronDown,
  ChevronRight,
  Maximize2,
  Minimize2,
  SplitSquareVertical,
  AlignJustify,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ============================================================================
// Types
// ============================================================================

export interface DiffLine {
  type: 'context' | 'add' | 'remove';
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export interface DiffHunk {
  id: string;
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

export interface FileDiff {
  path: string;
  oldPath?: string; // For renames
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  binary: boolean;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
}

export type DiffViewMode = 'split' | 'unified';

// ============================================================================
// Utility Functions
// ============================================================================

function parseDiffOutput(diffText: string): FileDiff[] {
  const files: FileDiff[] = [];
  const fileRegex = /^diff --git a\/(.+) b\/(.+)$/gm;
  const hunkRegex = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/gm;

  const fileMatches = [...diffText.matchAll(fileRegex)];

  for (let i = 0; i < fileMatches.length; i++) {
    const match = fileMatches[i];
    if (!match) continue;
    const startIndex = match.index ?? 0;
    const endIndex = fileMatches[i + 1]?.index ?? diffText.length;
    const fileSection = diffText.slice(startIndex, endIndex);

    const oldPath = match[1] ?? '';
    const newPath = match[2] ?? '';

    // Determine status
    let status: FileDiff['status'] = 'modified';
    if (fileSection.includes('new file mode')) {
      status = 'added';
    } else if (fileSection.includes('deleted file mode')) {
      status = 'deleted';
    } else if (oldPath !== newPath) {
      status = 'renamed';
    }

    // Check for binary
    const binary = fileSection.includes('Binary files');

    // Parse hunks
    const hunks: DiffHunk[] = [];
    const hunkMatches = [...fileSection.matchAll(hunkRegex)];
    let additions = 0;
    let deletions = 0;

    for (let j = 0; j < hunkMatches.length; j++) {
      const hunkMatch = hunkMatches[j];
      if (!hunkMatch) continue;
      const hunkStart = hunkMatch.index ?? 0;
      const hunkEnd = hunkMatches[j + 1]?.index ?? fileSection.length;
      const hunkText = fileSection.slice(hunkStart, hunkEnd);

      const oldStart = parseInt(hunkMatch[1] ?? '1', 10);
      const oldCount = parseInt(hunkMatch[2] ?? '1', 10);
      const newStart = parseInt(hunkMatch[3] ?? '1', 10);
      const newCount = parseInt(hunkMatch[4] ?? '1', 10);
      const header = hunkMatch[5]?.trim() ?? '';

      const lines: DiffLine[] = [];
      const lineTexts = hunkText.split('\n').slice(1);

      let oldLine = oldStart;
      let newLine = newStart;

      for (const lineText of lineTexts) {
        if (lineText.startsWith('+')) {
          lines.push({
            type: 'add',
            content: lineText.slice(1),
            newLineNumber: newLine++,
          });
          additions++;
        } else if (lineText.startsWith('-')) {
          lines.push({
            type: 'remove',
            content: lineText.slice(1),
            oldLineNumber: oldLine++,
          });
          deletions++;
        } else if (lineText.startsWith(' ') || lineText === '') {
          lines.push({
            type: 'context',
            content: lineText.slice(1) || '',
            oldLineNumber: oldLine++,
            newLineNumber: newLine++,
          });
        }
      }

      hunks.push({
        id: `hunk-${j}`,
        header,
        oldStart,
        oldCount,
        newStart,
        newCount,
        lines,
      });
    }

    files.push({
      path: newPath,
      oldPath: oldPath !== newPath ? oldPath : undefined,
      status,
      binary,
      hunks,
      additions,
      deletions,
    });
  }

  return files;
}

// ============================================================================
// Line Number Component
// ============================================================================

function LineNumber({ num, className }: { num?: number; className?: string }) {
  return (
    <span className={cn('w-12 text-right pr-2 select-none text-text-muted text-xs', className)}>
      {num ?? ''}
    </span>
  );
}

// ============================================================================
// Unified Diff View
// ============================================================================

interface UnifiedDiffViewProps {
  hunk: DiffHunk;
  showLineNumbers: boolean;
}

function UnifiedDiffView({ hunk, showLineNumbers }: UnifiedDiffViewProps) {
  return (
    <div className="font-mono text-xs">
      {/* Hunk header */}
      <div className="bg-blue-500/10 px-3 py-1 text-blue-400 border-b border-border-subtle">
        @@ -{hunk.oldStart},{hunk.oldCount} +{hunk.newStart},{hunk.newCount} @@
        {hunk.header && <span className="ml-2 text-text-muted">{hunk.header}</span>}
      </div>

      {/* Lines */}
      {hunk.lines.map((line, i) => (
        <div
          key={i}
          className={cn(
            'flex leading-5',
            line.type === 'add' && 'bg-green-500/10',
            line.type === 'remove' && 'bg-red-500/10'
          )}
        >
          {showLineNumbers && (
            <>
              <LineNumber num={line.oldLineNumber} className="border-r border-border-subtle" />
              <LineNumber num={line.newLineNumber} className="border-r border-border-subtle" />
            </>
          )}
          <span
            className={cn(
              'w-6 text-center select-none',
              line.type === 'add' && 'text-green-400 bg-green-500/20',
              line.type === 'remove' && 'text-red-400 bg-red-500/20',
              line.type === 'context' && 'text-text-muted'
            )}
          >
            {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}
          </span>
          <pre
            className={cn(
              'flex-1 px-2 whitespace-pre overflow-x-auto',
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

interface SplitDiffViewProps {
  hunk: DiffHunk;
  showLineNumbers: boolean;
}

function SplitDiffView({ hunk, showLineNumbers }: SplitDiffViewProps) {
  // Build parallel lines for left (old) and right (new) sides
  const { leftLines, rightLines } = useMemo(() => {
    const left: (DiffLine | null)[] = [];
    const right: (DiffLine | null)[] = [];

    let i = 0;
    while (i < hunk.lines.length) {
      const line = hunk.lines[i];
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
        while (i < hunk.lines.length && hunk.lines[i]?.type === 'remove') {
          const removeLine = hunk.lines[i];
          if (removeLine) removes.push(removeLine);
          i++;
        }
        // Collect consecutive adds
        const adds: DiffLine[] = [];
        while (i < hunk.lines.length && hunk.lines[i]?.type === 'add') {
          const addLine = hunk.lines[i];
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
  }, [hunk.lines]);

  return (
    <div className="font-mono text-xs">
      {/* Hunk header */}
      <div className="bg-blue-500/10 px-3 py-1 text-blue-400 border-b border-border-subtle">
        @@ -{hunk.oldStart},{hunk.oldCount} +{hunk.newStart},{hunk.newCount} @@
        {hunk.header && <span className="ml-2 text-text-muted">{hunk.header}</span>}
      </div>

      {/* Split view */}
      <div className="flex">
        {/* Left side (old) */}
        <div className="flex-1 border-r border-border-default">
          {leftLines.map((line, i) => (
            <div
              key={i}
              className={cn(
                'flex leading-5 min-h-[20px]',
                line?.type === 'remove' && 'bg-red-500/10'
              )}
            >
              {showLineNumbers && (
                <LineNumber num={line?.oldLineNumber} className="border-r border-border-subtle" />
              )}
              <span
                className={cn(
                  'w-6 text-center select-none',
                  line?.type === 'remove' && 'text-red-400 bg-red-500/20',
                  line?.type === 'context' && 'text-text-muted'
                )}
              >
                {line?.type === 'remove' ? '-' : line?.type === 'context' ? ' ' : ''}
              </span>
              <pre
                className={cn(
                  'flex-1 px-2 whitespace-pre overflow-x-auto',
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
        <div className="flex-1">
          {rightLines.map((line, i) => (
            <div
              key={i}
              className={cn(
                'flex leading-5 min-h-[20px]',
                line?.type === 'add' && 'bg-green-500/10'
              )}
            >
              {showLineNumbers && (
                <LineNumber num={line?.newLineNumber} className="border-r border-border-subtle" />
              )}
              <span
                className={cn(
                  'w-6 text-center select-none',
                  line?.type === 'add' && 'text-green-400 bg-green-500/20',
                  line?.type === 'context' && 'text-text-muted'
                )}
              >
                {line?.type === 'add' ? '+' : line?.type === 'context' ? ' ' : ''}
              </span>
              <pre
                className={cn(
                  'flex-1 px-2 whitespace-pre overflow-x-auto',
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
    </div>
  );
}

// ============================================================================
// File Diff Card
// ============================================================================

interface FileDiffCardProps {
  file: FileDiff;
  viewMode: DiffViewMode;
  showLineNumbers: boolean;
  expanded: boolean;
  onToggle: () => void;
  onStageHunk?: (hunkId: string) => void;
}

function FileDiffCard({
  file,
  viewMode,
  showLineNumbers,
  expanded,
  onToggle,
  onStageHunk,
}: FileDiffCardProps) {
  const statusColors = {
    added: 'bg-green-500/20 text-green-400',
    modified: 'bg-yellow-500/20 text-yellow-400',
    deleted: 'bg-red-500/20 text-red-400',
    renamed: 'bg-blue-500/20 text-blue-400',
  };

  const statusLabels = {
    added: 'A',
    modified: 'M',
    deleted: 'D',
    renamed: 'R',
  };

  return (
    <div className="rounded-lg border border-border-default overflow-hidden">
      {/* File header */}
      <div
        className="flex items-center gap-2 px-3 py-2 bg-surface cursor-pointer hover:bg-overlay/50"
        onClick={onToggle}
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-text-muted" />
        ) : (
          <ChevronRight className="h-4 w-4 text-text-muted" />
        )}

        <span
          className={cn('px-1.5 py-0.5 rounded text-xs font-medium', statusColors[file.status])}
        >
          {statusLabels[file.status]}
        </span>

        <FileCode className="h-4 w-4 text-text-muted" />
        <span className="text-sm text-text-primary font-mono flex-1">
          {file.oldPath && file.status === 'renamed' ? (
            <>
              <span className="text-text-muted">{file.oldPath}</span>
              <span className="mx-2 text-text-muted">→</span>
              {file.path}
            </>
          ) : (
            file.path
          )}
        </span>

        <div className="flex items-center gap-2 text-xs">
          {file.additions > 0 && <span className="text-green-400">+{file.additions}</span>}
          {file.deletions > 0 && <span className="text-red-400">-{file.deletions}</span>}
        </div>
      </div>

      {/* File content */}
      {expanded && !file.binary && (
        <div className="border-t border-border-subtle bg-void overflow-x-auto">
          {file.hunks.map((hunk) => (
            <div key={hunk.id} className="border-b border-border-subtle last:border-b-0">
              {onStageHunk && (
                <div className="flex items-center justify-end px-2 py-1 bg-elevated/50 border-b border-border-subtle">
                  <button
                    onClick={() => onStageHunk(hunk.id)}
                    className="flex items-center gap-1 px-2 py-0.5 text-xs rounded bg-overlay hover:bg-surface text-text-secondary"
                  >
                    <Plus className="h-3 w-3" />
                    Stage Hunk
                  </button>
                </div>
              )}
              {viewMode === 'unified' ? (
                <UnifiedDiffView hunk={hunk} showLineNumbers={showLineNumbers} />
              ) : (
                <SplitDiffView hunk={hunk} showLineNumbers={showLineNumbers} />
              )}
            </div>
          ))}
        </div>
      )}

      {expanded && file.binary && (
        <div className="border-t border-border-subtle p-4 text-center text-text-muted text-sm">
          Binary file (cannot display diff)
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main Diff Viewer Component
// ============================================================================

interface DiffViewerProps {
  diff: string | FileDiff[];
  viewMode?: DiffViewMode;
  showLineNumbers?: boolean;
  className?: string;
  onStageHunk?: (filePath: string, hunkId: string) => void;
}

export function DiffViewer({
  diff,
  viewMode: initialViewMode = 'unified',
  showLineNumbers: initialShowLineNumbers = true,
  className,
  onStageHunk,
}: DiffViewerProps) {
  const [viewMode, setViewMode] = useState<DiffViewMode>(initialViewMode);
  const [showLineNumbers, setShowLineNumbers] = useState(initialShowLineNumbers);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [expandAll, setExpandAll] = useState(true);

  // Parse diff if string
  const files = useMemo(() => {
    if (typeof diff === 'string') {
      return parseDiffOutput(diff);
    }
    return diff;
  }, [diff]);

  // Toggle file expansion
  const toggleFile = useCallback((path: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  // Toggle all files
  const handleToggleAll = useCallback(() => {
    if (expandAll) {
      setExpandedFiles(new Set());
    } else {
      setExpandedFiles(new Set(files.map((f) => f.path)));
    }
    setExpandAll(!expandAll);
  }, [expandAll, files]);

  // Calculate totals
  const totals = useMemo(() => {
    return files.reduce(
      (acc, file) => ({
        additions: acc.additions + file.additions,
        deletions: acc.deletions + file.deletions,
      }),
      { additions: 0, deletions: 0 }
    );
  }, [files]);

  // Track whether we've set initial expansion
  const hasSetInitialExpansion = useRef(false);

  // Default expand first file on initial load
  useEffect(() => {
    const firstFile = files[0];
    if (files.length > 0 && !hasSetInitialExpansion.current && firstFile) {
      setExpandedFiles(new Set([firstFile.path]));
      hasSetInitialExpansion.current = true;
    }
  }, [files]);

  if (files.length === 0) {
    return (
      <div className={cn('flex items-center justify-center h-32 text-text-muted', className)}>
        No changes to display
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col', className)}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle bg-elevated">
        <div className="flex items-center gap-3 text-sm">
          <span className="text-text-secondary">
            {files.length} file{files.length !== 1 ? 's' : ''} changed
          </span>
          <span className="text-green-400">+{totals.additions}</span>
          <span className="text-red-400">-{totals.deletions}</span>
        </div>

        <div className="flex items-center gap-2">
          {/* View mode toggle */}
          <div className="flex rounded-lg border border-border-subtle overflow-hidden">
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
              Unified
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
              Split
            </button>
          </div>

          {/* Line numbers toggle */}
          <button
            onClick={() => setShowLineNumbers(!showLineNumbers)}
            className={cn(
              'p-1.5 rounded text-xs',
              showLineNumbers
                ? 'bg-overlay text-text-primary'
                : 'text-text-muted hover:text-text-secondary'
            )}
            title="Toggle line numbers"
          >
            #
          </button>

          {/* Expand/collapse all */}
          <button
            onClick={handleToggleAll}
            className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-overlay"
            title={expandAll ? 'Collapse all' : 'Expand all'}
          >
            {expandAll ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Files */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {files.map((file) => (
          <FileDiffCard
            key={file.path}
            file={file}
            viewMode={viewMode}
            showLineNumbers={showLineNumbers}
            expanded={expandedFiles.has(file.path)}
            onToggle={() => toggleFile(file.path)}
            onStageHunk={onStageHunk ? (hunkId) => onStageHunk(file.path, hunkId) : undefined}
          />
        ))}
      </div>
    </div>
  );
}

export { parseDiffOutput };
