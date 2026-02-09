'use client';

import { useState, useMemo, useCallback } from 'react';
import {
  X,
  Check,
  ChevronDown,
  ChevronRight,
  FileCode,
  Plus,
  Minus,
  Edit3,
  Eye,
  EyeOff,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ============================================================================
// Types
// ============================================================================

export interface FileDiff {
  path: string;
  status: 'added' | 'modified' | 'deleted';
  hunks: DiffHunk[];
  originalContent?: string;
  newContent?: string;
}

export interface DiffHunk {
  id: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
  selected: boolean;
}

export interface DiffLine {
  type: 'context' | 'add' | 'remove';
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export interface PendingChange {
  id: string;
  agentId: string;
  agentName: string;
  timestamp: Date;
  description: string;
  files: FileDiff[];
  status: 'pending' | 'applied' | 'rejected';
}

// ============================================================================
// Diff Line Component
// ============================================================================

function DiffLineRow({ line, showLineNumbers }: { line: DiffLine; showLineNumbers: boolean }) {
  return (
    <div
      className={cn(
        'flex font-mono text-xs leading-5',
        line.type === 'add' && 'bg-green-500/10',
        line.type === 'remove' && 'bg-red-500/10'
      )}
    >
      {showLineNumbers && (
        <>
          <span className="w-10 flex-shrink-0 text-right pr-2 text-text-muted select-none border-r border-border-subtle">
            {line.oldLineNumber ?? ''}
          </span>
          <span className="w-10 flex-shrink-0 text-right pr-2 text-text-muted select-none border-r border-border-subtle">
            {line.newLineNumber ?? ''}
          </span>
        </>
      )}
      <span
        className={cn(
          'w-6 flex-shrink-0 text-center select-none',
          line.type === 'add' && 'text-green-400',
          line.type === 'remove' && 'text-red-400',
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
  );
}

// ============================================================================
// Hunk Component
// ============================================================================

interface DiffHunkViewProps {
  hunk: DiffHunk;
  onToggleSelect: (hunkId: string) => void;
  showLineNumbers: boolean;
}

function DiffHunkView({ hunk, onToggleSelect, showLineNumbers }: DiffHunkViewProps) {
  const [collapsed, setCollapsed] = useState(false);

  const stats = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    for (const line of hunk.lines) {
      if (line.type === 'add') additions++;
      if (line.type === 'remove') deletions++;
    }
    return { additions, deletions };
  }, [hunk.lines]);

  return (
    <div className="border border-border-subtle rounded-lg overflow-hidden">
      {/* Hunk header */}
      <div
        className={cn(
          'flex items-center gap-2 px-3 py-1.5 bg-elevated cursor-pointer',
          hunk.selected && 'bg-accent-primary/10'
        )}
        onClick={() => setCollapsed(!collapsed)}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect(hunk.id);
          }}
          className={cn(
            'w-4 h-4 rounded border flex items-center justify-center',
            hunk.selected
              ? 'bg-accent-primary border-accent-primary'
              : 'border-border-default hover:border-accent-primary'
          )}
        >
          {hunk.selected && <Check className="h-3 w-3 text-void" />}
        </button>

        {collapsed ? (
          <ChevronRight className="h-4 w-4 text-text-muted" />
        ) : (
          <ChevronDown className="h-4 w-4 text-text-muted" />
        )}

        <span className="text-xs text-text-muted font-mono">
          @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
        </span>

        <div className="flex-1" />

        <span className="text-xs text-green-400">+{stats.additions}</span>
        <span className="text-xs text-red-400">-{stats.deletions}</span>
      </div>

      {/* Hunk content */}
      {!collapsed && (
        <div className="overflow-x-auto">
          {hunk.lines.map((line, i) => (
            <DiffLineRow key={i} line={line} showLineNumbers={showLineNumbers} />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// File Diff Component
// ============================================================================

interface FileDiffViewProps {
  file: FileDiff;
  onToggleHunk: (path: string, hunkId: string) => void;
  showLineNumbers: boolean;
}

function FileDiffView({ file, onToggleHunk, showLineNumbers }: FileDiffViewProps) {
  const [collapsed, setCollapsed] = useState(false);

  const stats = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        if (line.type === 'add') additions++;
        if (line.type === 'remove') deletions++;
      }
    }
    return { additions, deletions };
  }, [file.hunks]);

  const selectedHunks = file.hunks.filter((h) => h.selected).length;

  return (
    <div className="border border-border-default rounded-lg overflow-hidden">
      {/* File header */}
      <div
        className="flex items-center gap-2 px-3 py-2 bg-surface cursor-pointer border-b border-border-subtle"
        onClick={() => setCollapsed(!collapsed)}
      >
        {collapsed ? (
          <ChevronRight className="h-4 w-4 text-text-muted" />
        ) : (
          <ChevronDown className="h-4 w-4 text-text-muted" />
        )}

        <span
          className={cn(
            'px-1.5 py-0.5 rounded text-xs font-medium',
            file.status === 'added' && 'bg-green-500/20 text-green-400',
            file.status === 'modified' && 'bg-yellow-500/20 text-yellow-400',
            file.status === 'deleted' && 'bg-red-500/20 text-red-400'
          )}
        >
          {file.status === 'added' && <Plus className="h-3 w-3" />}
          {file.status === 'modified' && <Edit3 className="h-3 w-3" />}
          {file.status === 'deleted' && <Minus className="h-3 w-3" />}
        </span>

        <FileCode className="h-4 w-4 text-text-muted" />
        <span className="text-sm text-text-primary font-mono">{file.path}</span>

        <div className="flex-1" />

        <span className="text-xs text-text-muted">
          {selectedHunks}/{file.hunks.length} hunks
        </span>
        <span className="text-xs text-green-400">+{stats.additions}</span>
        <span className="text-xs text-red-400">-{stats.deletions}</span>
      </div>

      {/* Hunks */}
      {!collapsed && (
        <div className="p-3 space-y-2 bg-void">
          {file.hunks.map((hunk) => (
            <DiffHunkView
              key={hunk.id}
              hunk={hunk}
              onToggleSelect={(id) => onToggleHunk(file.path, id)}
              showLineNumbers={showLineNumbers}
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

interface DiffPreviewProps {
  change: PendingChange;
  onApply: (changeId: string, selectedHunks: Record<string, string[]>) => void;
  onReject: (changeId: string) => void;
  onClose: () => void;
}

export function DiffPreview({ change, onApply, onReject, onClose }: DiffPreviewProps) {
  const [files, setFiles] = useState<FileDiff[]>(change.files);
  const [showLineNumbers, setShowLineNumbers] = useState(true);

  // Toggle hunk selection
  const handleToggleHunk = useCallback((path: string, hunkId: string) => {
    setFiles((prev) =>
      prev.map((file) =>
        file.path === path
          ? {
              ...file,
              hunks: file.hunks.map((hunk) =>
                hunk.id === hunkId ? { ...hunk, selected: !hunk.selected } : hunk
              ),
            }
          : file
      )
    );
  }, []);

  // Select all hunks
  const handleSelectAll = useCallback(() => {
    setFiles((prev) =>
      prev.map((file) => ({
        ...file,
        hunks: file.hunks.map((hunk) => ({ ...hunk, selected: true })),
      }))
    );
  }, []);

  // Deselect all hunks
  const handleDeselectAll = useCallback(() => {
    setFiles((prev) =>
      prev.map((file) => ({
        ...file,
        hunks: file.hunks.map((hunk) => ({ ...hunk, selected: false })),
      }))
    );
  }, []);

  // Apply selected hunks
  const handleApply = useCallback(() => {
    const selectedHunks: Record<string, string[]> = {};
    for (const file of files) {
      const selected = file.hunks.filter((h) => h.selected).map((h) => h.id);
      if (selected.length > 0) {
        selectedHunks[file.path] = selected;
      }
    }
    onApply(change.id, selectedHunks);
  }, [files, change.id, onApply]);

  // Stats
  const stats = useMemo(() => {
    let totalAdditions = 0;
    let totalDeletions = 0;
    let totalHunks = 0;
    let selectedHunks = 0;

    for (const file of files) {
      for (const hunk of file.hunks) {
        totalHunks++;
        if (hunk.selected) selectedHunks++;
        for (const line of hunk.lines) {
          if (line.type === 'add') totalAdditions++;
          if (line.type === 'remove') totalDeletions++;
        }
      }
    }

    return { totalAdditions, totalDeletions, totalHunks, selectedHunks };
  }, [files]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-void/90 backdrop-blur-sm" onClick={onClose} />

      {/* Dialog */}
      <div className="relative w-full max-w-4xl max-h-[90vh] rounded-xl border border-border-default bg-surface shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
          <div className="flex items-center gap-3">
            <Edit3 className="h-5 w-5 text-accent-primary" />
            <div>
              <h2 className="text-lg font-semibold text-text-primary">Review Changes</h2>
              <p className="text-sm text-text-muted">
                from <span className="text-accent-primary">{change.agentName}</span>
                {' · '}
                {change.description}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-overlay text-text-muted hover:text-text-primary"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-border-subtle bg-elevated">
          <div className="flex items-center gap-4">
            <span className="text-sm text-text-secondary">
              {files.length} file{files.length !== 1 ? 's' : ''} changed
            </span>
            <span className="text-sm text-green-400">+{stats.totalAdditions}</span>
            <span className="text-sm text-red-400">-{stats.totalDeletions}</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowLineNumbers(!showLineNumbers)}
              className={cn(
                'flex items-center gap-1.5 px-2 py-1 rounded text-xs',
                showLineNumbers
                  ? 'bg-overlay text-text-primary'
                  : 'text-text-muted hover:text-text-primary'
              )}
            >
              {showLineNumbers ? (
                <Eye className="h-3.5 w-3.5" />
              ) : (
                <EyeOff className="h-3.5 w-3.5" />
              )}
              Line #
            </button>
            <button
              onClick={handleSelectAll}
              className="px-2 py-1 rounded text-xs text-text-muted hover:text-text-primary hover:bg-overlay"
            >
              Select All
            </button>
            <button
              onClick={handleDeselectAll}
              className="px-2 py-1 rounded text-xs text-text-muted hover:text-text-primary hover:bg-overlay"
            >
              Deselect All
            </button>
          </div>
        </div>

        {/* Files */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {files.map((file) => (
            <FileDiffView
              key={file.path}
              file={file}
              onToggleHunk={handleToggleHunk}
              showLineNumbers={showLineNumbers}
            />
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-border-subtle bg-elevated">
          <div className="text-sm text-text-muted">
            {stats.selectedHunks} of {stats.totalHunks} hunks selected
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => onReject(change.id)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400"
            >
              <X className="h-4 w-4" />
              Reject All
            </button>
            <button
              onClick={handleApply}
              disabled={stats.selectedHunks === 0}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-lg',
                stats.selectedHunks > 0
                  ? 'bg-accent-primary hover:bg-accent-primary/90 text-void'
                  : 'bg-elevated text-text-muted cursor-not-allowed'
              )}
            >
              <Check className="h-4 w-4" />
              Apply Selected
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Store for pending changes
// ============================================================================

import { create } from 'zustand';

interface PendingChangesState {
  changes: PendingChange[];
  activeChangeId: string | null;

  addChange: (change: PendingChange) => void;
  removeChange: (changeId: string) => void;
  setActiveChange: (changeId: string | null) => void;
  updateChangeStatus: (changeId: string, status: PendingChange['status']) => void;
  getChange: (changeId: string) => PendingChange | undefined;
}

export const usePendingChangesStore = create<PendingChangesState>((set, get) => ({
  changes: [],
  activeChangeId: null,

  addChange: (change) =>
    set((state) => ({
      changes: [...state.changes, change],
    })),

  removeChange: (changeId) =>
    set((state) => ({
      changes: state.changes.filter((c) => c.id !== changeId),
      activeChangeId: state.activeChangeId === changeId ? null : state.activeChangeId,
    })),

  setActiveChange: (changeId) => set({ activeChangeId: changeId }),

  updateChangeStatus: (changeId, status) =>
    set((state) => ({
      changes: state.changes.map((c) => (c.id === changeId ? { ...c, status } : c)),
    })),

  getChange: (changeId) => get().changes.find((c) => c.id === changeId),
}));
