'use client';

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { cn } from '@/lib/utils';
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
  AlertTriangle,
  Columns,
  Rows,
  User,
} from 'lucide-react';
import {
  getAggregatedChanges,
  applyChangeSet,
  rejectChangeSet,
  type AggregatedChangesResponse,
} from '@/lib/api';
import { SplitDiffView } from './SplitDiffView';

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
  selected?: boolean;
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

interface AggregatedDiffModalProps {
  sessionId: string;
  isOpen: boolean;
  onClose: () => void;
  onChangesApplied?: () => void;
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
            {line.old_line_number ?? ''}
          </span>
          <span className="w-10 flex-shrink-0 text-right pr-2 text-text-muted select-none border-r border-border-subtle">
            {line.new_line_number ?? ''}
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

interface HunkViewProps {
  hunk: DiffHunk;
  agentName: string;
  onToggleSelect: (hunkId: string) => void;
  showLineNumbers: boolean;
}

function HunkView({ hunk, agentName, onToggleSelect, showLineNumbers }: HunkViewProps) {
  const [collapsed, setCollapsed] = useState(false);
  const isSelected = hunk.selected ?? hunk.status === 'selected';

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
      <div
        className={cn(
          'flex items-center gap-2 px-3 py-1.5 bg-surface-secondary cursor-pointer',
          isSelected && 'bg-accent-primary/10'
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
            isSelected
              ? 'bg-accent-primary border-accent-primary'
              : 'border-border-default hover:border-accent-primary'
          )}
        >
          {isSelected && <Check className="h-3 w-3 text-white" />}
        </button>

        {collapsed ? (
          <ChevronRight className="h-4 w-4 text-text-muted" />
        ) : (
          <ChevronDown className="h-4 w-4 text-text-muted" />
        )}

        <span className="text-xs text-text-muted font-mono">
          @@ -{hunk.old_start},{hunk.old_lines} +{hunk.new_start},{hunk.new_lines} @@
        </span>

        <span className="text-xs text-text-muted flex items-center gap-1">
          <User className="w-3 h-3" />
          {agentName}
        </span>

        <div className="flex-1" />

        <span className="text-xs text-green-400">+{stats.additions}</span>
        <span className="text-xs text-red-400">-{stats.deletions}</span>
      </div>

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
// File Section Component
// ============================================================================

interface FileSectionProps {
  path: string;
  changes: AggregatedFileChange[];
  selectedHunks: Record<string, Set<string>>;
  onToggleHunk: (changeSetId: string, hunkId: string) => void;
  showLineNumbers: boolean;
  hasConflict: boolean;
  viewMode: 'unified' | 'split';
}

function FileSection({
  path,
  changes,
  selectedHunks,
  onToggleHunk,
  showLineNumbers,
  hasConflict,
  viewMode,
}: FileSectionProps) {
  const [collapsed, setCollapsed] = useState(false);

  const totalStats = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    let totalHunks = 0;
    let selectedCount = 0;

    for (const change of changes) {
      additions += change.additions;
      deletions += change.deletions;
      totalHunks += change.hunks.length;
      selectedCount += change.hunks.filter(
        (h) => selectedHunks[change.change_set_id]?.has(h.id) ?? h.status === 'selected'
      ).length;
    }

    return { additions, deletions, totalHunks, selectedCount };
  }, [changes, selectedHunks]);

  const getFileStatus = () => {
    const types = new Set(changes.map((c) => c.change_type));
    if (types.has('create')) return 'added';
    if (types.has('delete')) return 'deleted';
    return 'modified';
  };

  const status = getFileStatus();

  return (
    <div className="border border-border-default rounded-lg overflow-hidden">
      <div
        className={cn(
          'flex items-center gap-2 px-3 py-2 bg-surface-primary cursor-pointer border-b border-border-subtle',
          hasConflict && 'border-l-2 border-l-yellow-500'
        )}
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
            status === 'added' && 'bg-green-500/20 text-green-400',
            status === 'modified' && 'bg-yellow-500/20 text-yellow-400',
            status === 'deleted' && 'bg-red-500/20 text-red-400'
          )}
        >
          {status === 'added' && <Plus className="h-3 w-3" />}
          {status === 'modified' && <Edit3 className="h-3 w-3" />}
          {status === 'deleted' && <Minus className="h-3 w-3" />}
        </span>

        <FileCode className="h-4 w-4 text-text-muted" />
        <span className="text-sm text-text-primary font-mono flex-1 truncate">{path}</span>

        {hasConflict && (
          <span className="flex items-center gap-1 text-xs text-yellow-500">
            <AlertTriangle className="w-3 h-3" />
            Conflict
          </span>
        )}

        {changes.length > 1 && (
          <span className="text-xs text-text-muted">{changes.length} agents</span>
        )}

        <span className="text-xs text-text-muted">
          {totalStats.selectedCount}/{totalStats.totalHunks} hunks
        </span>
        <span className="text-xs text-green-400">+{totalStats.additions}</span>
        <span className="text-xs text-red-400">-{totalStats.deletions}</span>
      </div>

      {!collapsed && (
        <div className="p-3 space-y-3 bg-surface-secondary">
          {viewMode === 'split' ? (
            <SplitDiffView changes={changes} />
          ) : (
            changes.map((change) => (
              <div key={`${change.change_set_id}-${path}`} className="space-y-2">
                {changes.length > 1 && (
                  <div className="text-xs text-text-muted flex items-center gap-1 px-2">
                    <User className="w-3 h-3" />
                    {change.agent_name}
                  </div>
                )}
                {change.hunks.map((hunk) => (
                  <HunkView
                    key={hunk.id}
                    hunk={{
                      ...hunk,
                      selected: selectedHunks[change.change_set_id]?.has(hunk.id),
                    }}
                    agentName={change.agent_name}
                    onToggleSelect={(hunkId) => onToggleHunk(change.change_set_id, hunkId)}
                    showLineNumbers={showLineNumbers}
                  />
                ))}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function AggregatedDiffModal({
  sessionId,
  isOpen,
  onClose,
  onChangesApplied,
}: AggregatedDiffModalProps) {
  const [data, setData] = useState<AggregatedChangesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  // Track selected hunks: { changeSetId: Set<hunkId> }
  const [selectedHunks, setSelectedHunks] = useState<Record<string, Set<string>>>({});
  const [showLineNumbers, setShowLineNumbers] = useState(true);
  const [viewMode, setViewMode] = useState<'unified' | 'split'>('unified');

  const fetchChanges = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await getAggregatedChanges(sessionId);
      setData(response);

      // Initialize selected hunks from data
      const initial: Record<string, Set<string>> = {};
      for (const changes of Object.values(response.files)) {
        for (const change of changes) {
          if (!initial[change.change_set_id]) {
            initial[change.change_set_id] = new Set();
          }
          const changeSet = initial[change.change_set_id]!;
          for (const hunk of change.hunks) {
            if (hunk.status === 'selected') {
              changeSet.add(hunk.id);
            }
          }
        }
      }
      setSelectedHunks(initial);
    } catch (err) {
      console.error('Failed to fetch changes:', err);
      setError('Failed to load pending changes');
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  // Fetch data when modal opens
  useEffect(() => {
    if (isOpen) {
      fetchChanges();
    }
  }, [isOpen, fetchChanges]);

  const toggleHunk = useCallback((changeSetId: string, hunkId: string) => {
    setSelectedHunks((prev) => {
      const next = { ...prev };
      if (!next[changeSetId]) {
        next[changeSetId] = new Set();
      } else {
        next[changeSetId] = new Set(next[changeSetId]);
      }

      if (next[changeSetId].has(hunkId)) {
        next[changeSetId].delete(hunkId);
      } else {
        next[changeSetId].add(hunkId);
      }

      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    if (!data) return;
    const newSelected: Record<string, Set<string>> = {};
    for (const changes of Object.values(data.files)) {
      for (const change of changes) {
        if (!newSelected[change.change_set_id]) {
          newSelected[change.change_set_id] = new Set();
        }
        const changeSet = newSelected[change.change_set_id]!;
        for (const hunk of change.hunks) {
          changeSet.add(hunk.id);
        }
      }
    }
    setSelectedHunks(newSelected);
  }, [data]);

  const deselectAll = useCallback(() => {
    setSelectedHunks({});
  }, []);

  const handleApplySelected = async () => {
    if (!data) return;

    setApplying(true);
    try {
      // Build selection map per change set
      const changeSetHunks: Record<string, Record<string, string[]>> = {};

      for (const [changeSetId, hunkIds] of Object.entries(selectedHunks)) {
        if (hunkIds.size > 0) {
          const hunksPerFile: Record<string, string[]> = {};

          for (const changes of Object.values(data.files)) {
            for (const change of changes) {
              if (change.change_set_id === changeSetId) {
                const selectedInFile = change.hunks
                  .filter((h) => hunkIds.has(h.id))
                  .map((h) => h.id);
                if (selectedInFile.length > 0) {
                  // Use the file path from context
                  for (const [path, fileChanges] of Object.entries(data.files)) {
                    if (fileChanges.some((c) => c.change_set_id === changeSetId)) {
                      hunksPerFile[path] = selectedInFile;
                    }
                  }
                }
              }
            }
          }

          changeSetHunks[changeSetId] = hunksPerFile;
        }
      }

      // Apply each change set
      for (const [changeSetId, hunksPerFile] of Object.entries(changeSetHunks)) {
        await applyChangeSet(changeSetId, hunksPerFile);
      }

      onChangesApplied?.();
      onClose();
    } catch (err) {
      console.error('Failed to apply changes:', err);
      setError('Failed to apply changes');
    } finally {
      setApplying(false);
    }
  };

  const handleRejectAll = async () => {
    if (!data) return;

    setApplying(true);
    try {
      const changeSetIds = new Set<string>();
      for (const changes of Object.values(data.files)) {
        for (const change of changes) {
          changeSetIds.add(change.change_set_id);
        }
      }

      for (const changeSetId of changeSetIds) {
        await rejectChangeSet(changeSetId);
      }

      onChangesApplied?.();
      onClose();
    } catch (err) {
      console.error('Failed to reject changes:', err);
      setError('Failed to reject changes');
    } finally {
      setApplying(false);
    }
  };

  // Stats
  const stats = useMemo(() => {
    if (!data)
      return { totalFiles: 0, totalHunks: 0, selectedHunks: 0, additions: 0, deletions: 0 };

    let totalHunks = 0;
    let selected = 0;
    let additions = 0;
    let deletions = 0;

    for (const changes of Object.values(data.files)) {
      for (const change of changes) {
        totalHunks += change.hunks.length;
        additions += change.additions;
        deletions += change.deletions;
        selected += change.hunks.filter((h) =>
          selectedHunks[change.change_set_id]?.has(h.id)
        ).length;
      }
    }

    return {
      totalFiles: data.total_files,
      totalHunks,
      selectedHunks: selected,
      additions,
      deletions,
    };
  }, [data, selectedHunks]);

  const conflictPaths = useMemo(() => {
    if (!data) return new Set<string>();
    return new Set(data.conflicts.map((c) => c.file_path));
  }, [data]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Dialog */}
      <div className="relative w-full max-w-5xl max-h-[90vh] rounded-xl border border-border-default bg-surface-primary shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
          <div className="flex items-center gap-3">
            <Edit3 className="h-5 w-5 text-accent-primary" />
            <div>
              <h2 className="text-lg font-semibold">Review All Changes</h2>
              <p className="text-sm text-text-muted">
                {stats.totalFiles} file{stats.totalFiles !== 1 ? 's' : ''} changed from{' '}
                {data?.total_change_sets ?? 0} agent
                {(data?.total_change_sets ?? 0) !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-surface-hover text-text-muted hover:text-text-primary"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-border-subtle bg-surface-secondary">
          <div className="flex items-center gap-4">
            <span className="text-sm text-text-secondary">
              {stats.totalFiles} file{stats.totalFiles !== 1 ? 's' : ''}
            </span>
            <span className="text-sm text-green-400">+{stats.additions}</span>
            <span className="text-sm text-red-400">-{stats.deletions}</span>
            {data && data.conflicts.length > 0 && (
              <span className="flex items-center gap-1 text-sm text-yellow-500">
                <AlertTriangle className="w-4 h-4" />
                {data.conflicts.length} conflict{data.conflicts.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* View mode toggle */}
            <div className="flex items-center rounded border border-border-subtle overflow-hidden">
              <button
                onClick={() => setViewMode('unified')}
                className={cn(
                  'flex items-center gap-1 px-2 py-1 text-xs',
                  viewMode === 'unified'
                    ? 'bg-accent-primary/20 text-accent-primary'
                    : 'text-text-muted hover:text-text-primary'
                )}
              >
                <Rows className="h-3.5 w-3.5" />
                Unified
              </button>
              <button
                onClick={() => setViewMode('split')}
                className={cn(
                  'flex items-center gap-1 px-2 py-1 text-xs',
                  viewMode === 'split'
                    ? 'bg-accent-primary/20 text-accent-primary'
                    : 'text-text-muted hover:text-text-primary'
                )}
              >
                <Columns className="h-3.5 w-3.5" />
                Split
              </button>
            </div>

            <button
              onClick={() => setShowLineNumbers(!showLineNumbers)}
              className={cn(
                'flex items-center gap-1.5 px-2 py-1 rounded text-xs',
                showLineNumbers
                  ? 'bg-surface-hover text-text-primary'
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
              onClick={selectAll}
              className="px-2 py-1 rounded text-xs text-text-muted hover:text-text-primary hover:bg-surface-hover"
            >
              Select All
            </button>
            <button
              onClick={deselectAll}
              className="px-2 py-1 rounded text-xs text-text-muted hover:text-text-primary hover:bg-surface-hover"
            >
              Deselect All
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {loading ? (
            <div className="text-center py-8 text-text-muted">
              <div className="animate-pulse">Loading changes...</div>
            </div>
          ) : error ? (
            <div className="text-center py-8 text-red-500">{error}</div>
          ) : data && Object.keys(data.files).length > 0 ? (
            Object.entries(data.files).map(([path, changes]) => (
              <FileSection
                key={path}
                path={path}
                changes={changes as unknown as AggregatedFileChange[]}
                selectedHunks={selectedHunks}
                onToggleHunk={toggleHunk}
                showLineNumbers={showLineNumbers}
                hasConflict={conflictPaths.has(path)}
                viewMode={viewMode}
              />
            ))
          ) : (
            <div className="text-center py-8 text-text-muted">No pending changes to review</div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-border-subtle bg-surface-secondary">
          <div className="text-sm text-text-muted">
            {stats.selectedHunks} of {stats.totalHunks} hunks selected
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleRejectAll}
              disabled={applying}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 disabled:opacity-50"
            >
              <X className="h-4 w-4" />
              Reject All
            </button>
            <button
              onClick={handleApplySelected}
              disabled={applying || stats.selectedHunks === 0}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-lg',
                stats.selectedHunks > 0
                  ? 'bg-accent-primary hover:bg-accent-primary/90 text-white'
                  : 'bg-surface-hover text-text-muted cursor-not-allowed'
              )}
            >
              <Check className="h-4 w-4" />
              {applying ? 'Applying...' : 'Apply Selected'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
