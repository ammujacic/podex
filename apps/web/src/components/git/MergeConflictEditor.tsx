'use client';

import { useState, useMemo, useCallback } from 'react';
import {
  GitMerge,
  AlertTriangle,
  Check,
  X,
  ChevronDown,
  ChevronRight,
  ArrowLeft,
  ArrowRight,
  ArrowLeftRight,
  FileCode,
  Edit3,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ============================================================================
// Types
// ============================================================================

export interface ConflictHunk {
  id: string;
  startLine: number;
  oursStart: number;
  oursEnd: number;
  theirsStart: number;
  theirsEnd: number;
  oursContent: string[];
  theirsContent: string[];
  baseContent?: string[];
  resolved: boolean;
  resolution?: 'ours' | 'theirs' | 'both' | 'custom';
  customContent?: string[];
}

export interface ConflictFile {
  path: string;
  hunks: ConflictHunk[];
  resolved: boolean;
}

interface MergeConflictEditorProps {
  sessionId: string;
  sourceBranch: string;
  targetBranch: string;
  files: ConflictFile[];
  onResolve: (
    path: string,
    hunkId: string,
    resolution: 'ours' | 'theirs' | 'both' | 'custom',
    customContent?: string[]
  ) => void;
  onMarkResolved: (path: string) => void;
  onAbort: () => void;
  onComplete: () => void;
  className?: string;
}

// ============================================================================
// Conflict Hunk Component
// ============================================================================

interface ConflictHunkViewProps {
  hunk: ConflictHunk;
  sourceBranch: string;
  targetBranch: string;
  onResolve: (resolution: 'ours' | 'theirs' | 'both' | 'custom', customContent?: string[]) => void;
}

function ConflictHunkView({ hunk, sourceBranch, targetBranch, onResolve }: ConflictHunkViewProps) {
  const [showCustomEditor, setShowCustomEditor] = useState(false);
  const [customContent, setCustomContent] = useState(
    [...hunk.oursContent, ...hunk.theirsContent].join('\n')
  );

  const handleCustomResolve = () => {
    onResolve('custom', customContent.split('\n'));
    setShowCustomEditor(false);
  };

  return (
    <div
      className={cn(
        'rounded-lg border overflow-hidden',
        hunk.resolved ? 'border-green-500/50' : 'border-red-500/50'
      )}
    >
      {/* Hunk header */}
      <div
        className={cn(
          'flex items-center justify-between px-3 py-2',
          hunk.resolved ? 'bg-green-500/10' : 'bg-red-500/10'
        )}
      >
        <div className="flex items-center gap-2">
          {hunk.resolved ? (
            <Check className="h-4 w-4 text-green-400" />
          ) : (
            <AlertTriangle className="h-4 w-4 text-red-400" />
          )}
          <span className="text-sm font-mono text-text-muted">
            Lines {hunk.startLine} -{' '}
            {hunk.startLine + hunk.oursContent.length + hunk.theirsContent.length}
          </span>
          {hunk.resolved && hunk.resolution && (
            <span className="px-1.5 py-0.5 rounded text-xs bg-green-500/20 text-green-400">
              {hunk.resolution === 'ours'
                ? 'Accepted Current'
                : hunk.resolution === 'theirs'
                  ? 'Accepted Incoming'
                  : hunk.resolution === 'both'
                    ? 'Accepted Both'
                    : 'Custom Edit'}
            </span>
          )}
        </div>

        {!hunk.resolved && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => onResolve('ours')}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-blue-500/20 hover:bg-blue-500/30 text-blue-400"
              title={`Accept Current (${targetBranch})`}
            >
              <ArrowLeft className="h-3 w-3" />
              Current
            </button>
            <button
              onClick={() => onResolve('both')}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-purple-500/20 hover:bg-purple-500/30 text-purple-400"
              title="Accept Both"
            >
              <ArrowLeftRight className="h-3 w-3" />
              Both
            </button>
            <button
              onClick={() => onResolve('theirs')}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-green-500/20 hover:bg-green-500/30 text-green-400"
              title={`Accept Incoming (${sourceBranch})`}
            >
              Incoming
              <ArrowRight className="h-3 w-3" />
            </button>
            <button
              onClick={() => setShowCustomEditor(!showCustomEditor)}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-overlay hover:bg-elevated text-text-muted hover:text-text-secondary"
              title="Edit manually"
            >
              <Edit3 className="h-3 w-3" />
              Edit
            </button>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex">
        {/* Ours (current) side */}
        <div className="flex-1 border-r border-border-default">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-500/10 border-b border-border-subtle">
            <span className="text-xs font-medium text-blue-400">Current ({targetBranch})</span>
          </div>
          <div className="font-mono text-xs">
            {hunk.oursContent.map((line, i) => (
              <div key={i} className="flex leading-5 bg-blue-500/5">
                <span className="w-10 text-right pr-2 text-text-muted select-none border-r border-border-subtle">
                  {hunk.oursStart + i}
                </span>
                <pre className="flex-1 px-2 text-text-secondary whitespace-pre overflow-x-auto">
                  {line}
                </pre>
              </div>
            ))}
            {hunk.oursContent.length === 0 && (
              <div className="px-3 py-2 text-text-muted italic text-xs">
                (no changes on this side)
              </div>
            )}
          </div>
        </div>

        {/* Theirs (incoming) side */}
        <div className="flex-1">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-green-500/10 border-b border-border-subtle">
            <span className="text-xs font-medium text-green-400">Incoming ({sourceBranch})</span>
          </div>
          <div className="font-mono text-xs">
            {hunk.theirsContent.map((line, i) => (
              <div key={i} className="flex leading-5 bg-green-500/5">
                <span className="w-10 text-right pr-2 text-text-muted select-none border-r border-border-subtle">
                  {hunk.theirsStart + i}
                </span>
                <pre className="flex-1 px-2 text-text-secondary whitespace-pre overflow-x-auto">
                  {line}
                </pre>
              </div>
            ))}
            {hunk.theirsContent.length === 0 && (
              <div className="px-3 py-2 text-text-muted italic text-xs">
                (no changes on this side)
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Custom editor */}
      {showCustomEditor && (
        <div className="border-t border-border-subtle p-3 bg-elevated">
          <label className="block text-xs text-text-muted mb-2">Edit the resolved content:</label>
          <textarea
            value={customContent}
            onChange={(e) => setCustomContent(e.target.value)}
            className="w-full h-40 px-3 py-2 rounded-lg bg-void border border-border-subtle text-text-primary font-mono text-xs resize-none focus:outline-none focus:ring-1 focus:ring-accent-primary"
          />
          <div className="flex items-center justify-end gap-2 mt-2">
            <button
              onClick={() => setShowCustomEditor(false)}
              className="px-3 py-1.5 rounded text-xs bg-overlay hover:bg-surface text-text-secondary"
            >
              Cancel
            </button>
            <button
              onClick={handleCustomResolve}
              className="px-3 py-1.5 rounded text-xs bg-accent-primary hover:bg-accent-primary/90 text-void font-medium"
            >
              Apply
            </button>
          </div>
        </div>
      )}

      {/* Resolution preview */}
      {hunk.resolved && hunk.customContent && (
        <div className="border-t border-border-subtle">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-green-500/10 border-b border-border-subtle">
            <span className="text-xs font-medium text-green-400">Resolved Content</span>
          </div>
          <div className="font-mono text-xs">
            {hunk.customContent.map((line, i) => (
              <div key={i} className="flex leading-5">
                <span className="w-10 text-right pr-2 text-text-muted select-none border-r border-border-subtle">
                  {i + 1}
                </span>
                <pre className="flex-1 px-2 text-text-secondary whitespace-pre overflow-x-auto">
                  {line}
                </pre>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Conflict File Card
// ============================================================================

interface ConflictFileCardProps {
  file: ConflictFile;
  sourceBranch: string;
  targetBranch: string;
  expanded: boolean;
  onToggle: () => void;
  onResolveHunk: (
    hunkId: string,
    resolution: 'ours' | 'theirs' | 'both' | 'custom',
    customContent?: string[]
  ) => void;
  onMarkResolved: () => void;
}

function ConflictFileCard({
  file,
  sourceBranch,
  targetBranch,
  expanded,
  onToggle,
  onResolveHunk,
  onMarkResolved,
}: ConflictFileCardProps) {
  const unresolvedCount = file.hunks.filter((h) => !h.resolved).length;
  const allResolved = unresolvedCount === 0;

  return (
    <div
      className={cn(
        'rounded-lg border overflow-hidden',
        allResolved ? 'border-green-500/50' : 'border-border-default'
      )}
    >
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

        <FileCode className="h-4 w-4 text-text-muted" />

        <span className="text-sm text-text-primary font-mono flex-1">{file.path}</span>

        {allResolved ? (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-green-500/20 text-green-400">
            <Check className="h-3 w-3" />
            Resolved
          </span>
        ) : (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-red-500/20 text-red-400">
            <AlertTriangle className="h-3 w-3" />
            {unresolvedCount} conflict{unresolvedCount !== 1 ? 's' : ''}
          </span>
        )}

        {allResolved && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onMarkResolved();
            }}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-accent-primary hover:bg-accent-primary/90 text-void font-medium"
          >
            <Check className="h-3 w-3" />
            Mark as Resolved
          </button>
        )}
      </div>

      {/* Hunks */}
      {expanded && (
        <div className="p-3 space-y-3 bg-void border-t border-border-subtle">
          {file.hunks.map((hunk) => (
            <ConflictHunkView
              key={hunk.id}
              hunk={hunk}
              sourceBranch={sourceBranch}
              targetBranch={targetBranch}
              onResolve={(resolution, customContent) =>
                onResolveHunk(hunk.id, resolution, customContent)
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function MergeConflictEditor({
  sessionId: _sessionId,
  sourceBranch,
  targetBranch,
  files,
  onResolve,
  onMarkResolved,
  onAbort,
  onComplete,
  className,
}: MergeConflictEditorProps) {
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(() => {
    // Expand first unresolved file by default
    const firstUnresolved = files.find((f) => !f.resolved);
    return new Set(firstUnresolved ? [firstUnresolved.path] : []);
  });

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

  // Stats
  const stats = useMemo(() => {
    const totalFiles = files.length;
    const resolvedFiles = files.filter((f) => f.resolved).length;
    const totalHunks = files.reduce((acc, f) => acc + f.hunks.length, 0);
    const resolvedHunks = files.reduce(
      (acc, f) => acc + f.hunks.filter((h) => h.resolved).length,
      0
    );
    return { totalFiles, resolvedFiles, totalHunks, resolvedHunks };
  }, [files]);

  const allResolved = stats.resolvedFiles === stats.totalFiles;

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle bg-red-500/5">
        <div className="flex items-center gap-3">
          <GitMerge className="h-5 w-5 text-red-400" />
          <div>
            <h2 className="text-lg font-semibold text-text-primary">Merge Conflicts</h2>
            <p className="text-sm text-text-muted">
              Merging <span className="text-green-400">{sourceBranch}</span> into{' '}
              <span className="text-accent-primary">{targetBranch}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onAbort}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-overlay hover:bg-elevated text-text-secondary text-sm"
          >
            <X className="h-4 w-4" />
            Abort Merge
          </button>
          {allResolved && (
            <button
              onClick={onComplete}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-green-500 hover:bg-green-600 text-white text-sm font-medium"
            >
              <Check className="h-4 w-4" />
              Complete Merge
            </button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="px-4 py-2 border-b border-border-subtle bg-elevated">
        <div className="flex items-center justify-between text-xs text-text-muted mb-1">
          <span>
            {stats.resolvedHunks} of {stats.totalHunks} conflicts resolved
          </span>
          <span>
            {stats.resolvedFiles} of {stats.totalFiles} files
          </span>
        </div>
        <div className="h-1.5 bg-overlay rounded-full overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all',
              allResolved ? 'bg-green-500' : 'bg-accent-primary'
            )}
            style={{ width: `${(stats.resolvedHunks / stats.totalHunks) * 100}%` }}
          />
        </div>
      </div>

      {/* Files */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {files.map((file) => (
          <ConflictFileCard
            key={file.path}
            file={file}
            sourceBranch={sourceBranch}
            targetBranch={targetBranch}
            expanded={expandedFiles.has(file.path)}
            onToggle={() => toggleFile(file.path)}
            onResolveHunk={(hunkId, resolution, customContent) =>
              onResolve(file.path, hunkId, resolution, customContent)
            }
            onMarkResolved={() => onMarkResolved(file.path)}
          />
        ))}
      </div>

      {/* Keyboard shortcuts hint */}
      <div className="px-4 py-2 border-t border-border-subtle bg-elevated text-xs text-text-muted">
        <span className="font-medium">Tip:</span> Use keyboard shortcuts:{' '}
        <kbd className="px-1.5 py-0.5 rounded bg-overlay">1</kbd> Accept Current,{' '}
        <kbd className="px-1.5 py-0.5 rounded bg-overlay">2</kbd> Accept Both,{' '}
        <kbd className="px-1.5 py-0.5 rounded bg-overlay">3</kbd> Accept Incoming
      </div>
    </div>
  );
}
