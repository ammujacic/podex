'use client';

import { useState, useMemo } from 'react';
import { Clock, User, GitCommit, Copy, ExternalLink, X, FileCode, History } from 'lucide-react';
import { cn } from '@/lib/utils';

// ============================================================================
// Types
// ============================================================================

export interface BlameInfo {
  commitHash: string;
  shortHash: string;
  author: string;
  authorEmail: string;
  date: Date;
  message: string;
  lineNumber: number;
  originalLineNumber: number;
  content: string;
}

export interface BlameGroup {
  commitHash: string;
  shortHash: string;
  author: string;
  authorEmail: string;
  date: Date;
  message: string;
  startLine: number;
  endLine: number;
  lines: BlameInfo[];
}

export interface CommitDetail {
  hash: string;
  shortHash: string;
  author: string;
  authorEmail: string;
  date: Date;
  message: string;
  body?: string;
  parents: string[];
  files: { path: string; additions: number; deletions: number }[];
}

interface BlameViewProps {
  filePath: string;
  blameData: BlameInfo[];
  onCommitClick?: (hash: string) => void;
  onShowHistory?: () => void;
  className?: string;
}

// ============================================================================
// Utilities
// ============================================================================

function groupBlameByCommit(blameData: BlameInfo[]): BlameGroup[] {
  const groups: BlameGroup[] = [];
  let currentGroup: BlameGroup | null = null;

  for (const line of blameData) {
    if (!currentGroup || currentGroup.commitHash !== line.commitHash) {
      if (currentGroup) {
        groups.push(currentGroup);
      }
      currentGroup = {
        commitHash: line.commitHash,
        shortHash: line.shortHash,
        author: line.author,
        authorEmail: line.authorEmail,
        date: line.date,
        message: line.message,
        startLine: line.lineNumber,
        endLine: line.lineNumber,
        lines: [line],
      };
    } else {
      currentGroup.endLine = line.lineNumber;
      currentGroup.lines.push(line);
    }
  }

  if (currentGroup) {
    groups.push(currentGroup);
  }

  return groups;
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
}

function getAuthorColor(email: string): string {
  // Generate a consistent color based on email hash
  let hash = 0;
  for (let i = 0; i < email.length; i++) {
    hash = email.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colors = [
    'text-blue-400',
    'text-green-400',
    'text-yellow-400',
    'text-purple-400',
    'text-pink-400',
    'text-orange-400',
    'text-cyan-400',
    'text-indigo-400',
  ];
  return colors[Math.abs(hash) % colors.length] ?? 'text-blue-400';
}

// ============================================================================
// Commit Tooltip
// ============================================================================

interface CommitTooltipProps {
  group: BlameGroup;
  onCommitClick?: (hash: string) => void;
}

function CommitTooltip({ group, onCommitClick }: CommitTooltipProps) {
  const handleCopyHash = () => {
    navigator.clipboard.writeText(group.commitHash);
  };

  return (
    <div className="absolute left-0 top-full mt-1 z-50 w-80 rounded-lg border border-border-default bg-surface shadow-xl overflow-hidden">
      <div className="p-3 border-b border-border-subtle">
        <div className="flex items-center gap-2 mb-2">
          <GitCommit className="h-4 w-4 text-accent-primary" />
          <code className="text-xs text-accent-primary">{group.shortHash}</code>
          <button
            onClick={handleCopyHash}
            className="p-1 rounded hover:bg-overlay text-text-muted hover:text-text-primary"
            title="Copy full hash"
          >
            <Copy className="h-3 w-3" />
          </button>
        </div>
        <p className="text-sm text-text-primary">{group.message}</p>
      </div>
      <div className="p-3 text-xs text-text-muted space-y-1">
        <div className="flex items-center gap-2">
          <User className="h-3 w-3" />
          <span>{group.author}</span>
          <span className="text-text-muted">
            {'<'}
            {group.authorEmail}
            {'>'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Clock className="h-3 w-3" />
          <span>{group.date.toLocaleString()}</span>
          <span className="text-text-muted">({formatRelativeTime(group.date)})</span>
        </div>
      </div>
      {onCommitClick && (
        <div className="p-2 border-t border-border-subtle">
          <button
            onClick={() => onCommitClick(group.commitHash)}
            className="w-full flex items-center justify-center gap-1 px-3 py-1.5 rounded text-xs bg-overlay hover:bg-elevated text-text-secondary"
          >
            <ExternalLink className="h-3 w-3" />
            View full commit
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Blame Gutter
// ============================================================================

interface BlameGutterProps {
  groups: BlameGroup[];
  hoveredLine: number | null;
  onLineHover: (line: number | null) => void;
  onCommitClick?: (hash: string) => void;
}

function BlameGutter({ groups, hoveredLine, onLineHover, onCommitClick }: BlameGutterProps) {
  const [tooltipGroup, setTooltipGroup] = useState<BlameGroup | null>(null);

  return (
    <div className="flex flex-col text-xs font-mono select-none">
      {groups.map((group) => {
        const isHovered = group.lines.some((l) => l.lineNumber === hoveredLine);
        const showTooltip = tooltipGroup?.commitHash === group.commitHash;

        return (
          <div
            key={`${group.commitHash}-${group.startLine}`}
            className={cn(
              'relative flex items-start border-r border-border-subtle transition-colors',
              isHovered && 'bg-overlay/50'
            )}
            style={{ height: `${group.lines.length * 20}px` }}
            onMouseEnter={() => {
              onLineHover(group.startLine);
              setTooltipGroup(group);
            }}
            onMouseLeave={() => {
              onLineHover(null);
              setTooltipGroup(null);
            }}
          >
            <div className="flex items-start gap-2 px-2 py-0.5 w-full cursor-pointer">
              <code
                className={cn(
                  'text-accent-primary hover:underline',
                  getAuthorColor(group.authorEmail)
                )}
                onClick={() => onCommitClick?.(group.commitHash)}
              >
                {group.shortHash}
              </code>
              <span className="flex-1 truncate text-text-muted">{group.author}</span>
              <span className="text-text-muted whitespace-nowrap">
                {formatRelativeTime(group.date)}
              </span>
            </div>

            {showTooltip && <CommitTooltip group={group} onCommitClick={onCommitClick} />}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function BlameView({
  filePath,
  blameData,
  onCommitClick,
  onShowHistory,
  className,
}: BlameViewProps) {
  const [hoveredLine, setHoveredLine] = useState<number | null>(null);

  // Group blame data by commit
  const groups = useMemo(() => groupBlameByCommit(blameData), [blameData]);

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border-subtle bg-elevated">
        <div className="flex items-center gap-2">
          <FileCode className="h-4 w-4 text-text-muted" />
          <span className="font-mono text-sm text-text-primary">{filePath}</span>
        </div>
        {onShowHistory && (
          <button
            onClick={onShowHistory}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-overlay hover:bg-surface text-text-secondary"
          >
            <History className="h-3 w-3" />
            View History
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        <div className="flex">
          {/* Blame gutter */}
          <div className="flex-shrink-0 w-80 bg-elevated/50">
            <BlameGutter
              groups={groups}
              hoveredLine={hoveredLine}
              onLineHover={setHoveredLine}
              onCommitClick={onCommitClick}
            />
          </div>

          {/* Line numbers */}
          <div className="flex-shrink-0 bg-surface border-r border-border-subtle">
            {blameData.map((line) => (
              <div
                key={line.lineNumber}
                className={cn(
                  'h-5 px-3 text-right text-xs leading-5 text-text-muted select-none',
                  hoveredLine === line.lineNumber && 'bg-overlay/50'
                )}
                onMouseEnter={() => setHoveredLine(line.lineNumber)}
                onMouseLeave={() => setHoveredLine(null)}
              >
                {line.lineNumber}
              </div>
            ))}
          </div>

          {/* Code content */}
          <div className="flex-1 min-w-0">
            {blameData.map((line) => (
              <div
                key={line.lineNumber}
                className={cn(
                  'h-5 px-3 font-mono text-xs leading-5 whitespace-pre overflow-x-auto',
                  hoveredLine === line.lineNumber && 'bg-overlay/50'
                )}
                onMouseEnter={() => setHoveredLine(line.lineNumber)}
                onMouseLeave={() => setHoveredLine(null)}
              >
                <span className="text-text-secondary">{line.content}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="px-4 py-2 border-t border-border-subtle bg-elevated text-xs text-text-muted">
        <span className="font-medium">{blameData.length}</span> lines,{' '}
        <span className="font-medium">{new Set(blameData.map((l) => l.commitHash)).size}</span>{' '}
        commits, <span className="font-medium">{new Set(blameData.map((l) => l.author)).size}</span>{' '}
        authors
      </div>
    </div>
  );
}

// ============================================================================
// File History Component
// ============================================================================

export interface FileHistoryEntry {
  commitHash: string;
  shortHash: string;
  author: string;
  authorEmail: string;
  date: Date;
  message: string;
  additions: number;
  deletions: number;
}

interface FileHistoryProps {
  filePath: string;
  history: FileHistoryEntry[];
  onCommitClick?: (hash: string) => void;
  onCompare?: (hash1: string, hash2: string) => void;
  onClose?: () => void;
  className?: string;
}

export function FileHistory({
  filePath,
  history,
  onCommitClick,
  onCompare,
  onClose,
  className,
}: FileHistoryProps) {
  const [selectedCommits, setSelectedCommits] = useState<string[]>([]);

  const toggleSelection = (hash: string) => {
    setSelectedCommits((prev) => {
      if (prev.includes(hash)) {
        return prev.filter((h) => h !== hash);
      }
      if (prev.length >= 2 && prev[1]) {
        return [prev[1], hash];
      }
      return [...prev, hash];
    });
  };

  const handleCompare = () => {
    const first = selectedCommits[0];
    const second = selectedCommits[1];
    if (selectedCommits.length === 2 && onCompare && first && second) {
      onCompare(first, second);
    }
  };

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <History className="h-5 w-5 text-accent-primary" />
          <div>
            <h2 className="text-lg font-semibold text-text-primary">File History</h2>
            <p className="text-xs text-text-muted font-mono">{filePath}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {selectedCommits.length === 2 && onCompare && (
            <button
              onClick={handleCompare}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-accent-primary hover:bg-accent-primary/90 text-void text-sm font-medium"
            >
              Compare Selected
            </button>
          )}
          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 rounded hover:bg-overlay text-text-muted hover:text-text-primary"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>

      {/* Selection hint */}
      {onCompare && (
        <div className="px-4 py-2 border-b border-border-subtle bg-elevated text-xs text-text-muted">
          {selectedCommits.length === 0 && 'Select two commits to compare'}
          {selectedCommits.length === 1 && 'Select one more commit to compare'}
          {selectedCommits.length === 2 && (
            <span className="text-accent-primary">Ready to compare</span>
          )}
        </div>
      )}

      {/* History list */}
      <div className="flex-1 overflow-y-auto">
        {history.map((entry, index) => {
          const isSelected = selectedCommits.includes(entry.commitHash);
          const isFirst = index === 0;

          return (
            <div
              key={entry.commitHash}
              className={cn(
                'flex items-start gap-3 px-4 py-3 border-b border-border-subtle hover:bg-overlay/50 cursor-pointer',
                isSelected && 'bg-accent-primary/10'
              )}
              onClick={() =>
                onCompare ? toggleSelection(entry.commitHash) : onCommitClick?.(entry.commitHash)
              }
            >
              {/* Timeline indicator */}
              <div className="flex flex-col items-center pt-1">
                <div
                  className={cn(
                    'w-3 h-3 rounded-full border-2',
                    isFirst
                      ? 'bg-accent-primary border-accent-primary'
                      : 'bg-void border-text-muted'
                  )}
                />
                {index < history.length - 1 && (
                  <div className="w-0.5 flex-1 bg-border-subtle mt-1" />
                )}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <code
                    className="text-xs text-accent-primary hover:underline"
                    onClick={(e) => {
                      e.stopPropagation();
                      onCommitClick?.(entry.commitHash);
                    }}
                  >
                    {entry.shortHash}
                  </code>
                  {isFirst && (
                    <span className="px-1.5 py-0.5 rounded text-xs bg-accent-primary/20 text-accent-primary">
                      Latest
                    </span>
                  )}
                </div>
                <p className="text-sm text-text-primary mb-1">{entry.message}</p>
                <div className="flex items-center gap-3 text-xs text-text-muted">
                  <span className={getAuthorColor(entry.authorEmail)}>{entry.author}</span>
                  <span>{formatRelativeTime(entry.date)}</span>
                  <span className="text-green-400">+{entry.additions}</span>
                  <span className="text-red-400">-{entry.deletions}</span>
                </div>
              </div>

              {/* Selection checkbox */}
              {onCompare && (
                <div
                  className={cn(
                    'w-5 h-5 rounded border flex items-center justify-center',
                    isSelected
                      ? 'bg-accent-primary border-accent-primary'
                      : 'border-border-default hover:border-accent-primary'
                  )}
                >
                  {isSelected && (
                    <span className="text-void text-xs font-bold">
                      {selectedCommits.indexOf(entry.commitHash) + 1}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Stats */}
      <div className="px-4 py-2 border-t border-border-subtle bg-elevated text-xs text-text-muted">
        <span className="font-medium">{history.length}</span> commits
      </div>
    </div>
  );
}
