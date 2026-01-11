'use client';

import { useState, useCallback, useMemo } from 'react';
import {
  AlertTriangle,
  AlertCircle,
  Info,
  X,
  ChevronRight,
  ChevronDown,
  File,
  Filter,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { create } from 'zustand';

// ============================================================================
// Types
// ============================================================================

export enum DiagnosticSeverity {
  Error = 1,
  Warning = 2,
  Information = 3,
  Hint = 4,
}

export interface Diagnostic {
  id: string;
  filePath: string;
  severity: DiagnosticSeverity;
  message: string;
  source?: string;
  code?: string | number;
  range: {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
  };
  relatedInformation?: Array<{
    location: {
      filePath: string;
      range: {
        startLine: number;
        startColumn: number;
        endLine: number;
        endColumn: number;
      };
    };
    message: string;
  }>;
}

export interface FileDiagnostics {
  filePath: string;
  fileName: string;
  diagnostics: Diagnostic[];
  errorCount: number;
  warningCount: number;
  infoCount: number;
}

// ============================================================================
// Diagnostics Store
// ============================================================================

interface DiagnosticsState {
  diagnostics: Record<string, Diagnostic[]>; // keyed by filePath

  setDiagnostics: (filePath: string, diagnostics: Diagnostic[]) => void;
  addDiagnostic: (filePath: string, diagnostic: Diagnostic) => void;
  clearDiagnostics: (filePath: string) => void;
  clearAllDiagnostics: () => void;
  getAllDiagnostics: () => Diagnostic[];
  getFileDiagnostics: (filePath: string) => Diagnostic[];
  getCounts: () => { errors: number; warnings: number; infos: number; hints: number };
}

export const useDiagnosticsStore = create<DiagnosticsState>((set, get) => ({
  diagnostics: {},

  setDiagnostics: (filePath, diagnostics) =>
    set((state) => ({
      diagnostics: { ...state.diagnostics, [filePath]: diagnostics },
    })),

  addDiagnostic: (filePath, diagnostic) =>
    set((state) => ({
      diagnostics: {
        ...state.diagnostics,
        [filePath]: [...(state.diagnostics[filePath] || []), diagnostic],
      },
    })),

  clearDiagnostics: (filePath) =>
    set((state) => {
      const { [filePath]: _, ...rest } = state.diagnostics;
      return { diagnostics: rest };
    }),

  clearAllDiagnostics: () => set({ diagnostics: {} }),

  getAllDiagnostics: () => {
    const all: Diagnostic[] = [];
    Object.values(get().diagnostics).forEach((diags) => all.push(...diags));
    return all;
  },

  getFileDiagnostics: (filePath) => get().diagnostics[filePath] || [],

  getCounts: () => {
    const counts = { errors: 0, warnings: 0, infos: 0, hints: 0 };
    Object.values(get().diagnostics).forEach((diags) => {
      diags.forEach((d) => {
        switch (d.severity) {
          case DiagnosticSeverity.Error:
            counts.errors++;
            break;
          case DiagnosticSeverity.Warning:
            counts.warnings++;
            break;
          case DiagnosticSeverity.Information:
            counts.infos++;
            break;
          case DiagnosticSeverity.Hint:
            counts.hints++;
            break;
        }
      });
    });
    return counts;
  },
}));

// ============================================================================
// Severity Helpers
// ============================================================================

function getSeverityIcon(severity: DiagnosticSeverity): React.ReactNode {
  switch (severity) {
    case DiagnosticSeverity.Error:
      return <AlertCircle className="h-4 w-4 text-accent-error" />;
    case DiagnosticSeverity.Warning:
      return <AlertTriangle className="h-4 w-4 text-accent-warning" />;
    case DiagnosticSeverity.Information:
      return <Info className="h-4 w-4 text-accent-primary" />;
    case DiagnosticSeverity.Hint:
      return <Info className="h-4 w-4 text-text-muted" />;
  }
}

export function getSeverityLabel(severity: DiagnosticSeverity): string {
  switch (severity) {
    case DiagnosticSeverity.Error:
      return 'Error';
    case DiagnosticSeverity.Warning:
      return 'Warning';
    case DiagnosticSeverity.Information:
      return 'Info';
    case DiagnosticSeverity.Hint:
      return 'Hint';
  }
}

// ============================================================================
// Diagnostic Item Component
// ============================================================================

interface DiagnosticItemProps {
  diagnostic: Diagnostic;
  showFile?: boolean;
  onClick: (diagnostic: Diagnostic) => void;
}

function DiagnosticItem({ diagnostic, showFile, onClick }: DiagnosticItemProps) {
  return (
    <button
      onClick={() => onClick(diagnostic)}
      className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-overlay"
    >
      {getSeverityIcon(diagnostic.severity)}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm text-text-primary">{diagnostic.message}</span>
          {diagnostic.code && (
            <span className="shrink-0 rounded bg-overlay px-1.5 py-0.5 text-xs text-text-muted">
              {diagnostic.source ? `${diagnostic.source}(${diagnostic.code})` : diagnostic.code}
            </span>
          )}
        </div>
        {showFile && (
          <div className="mt-0.5 flex items-center gap-1 text-xs text-text-muted">
            <File className="h-3 w-3" />
            <span className="truncate">{diagnostic.filePath}</span>
            <span>
              [{diagnostic.range.startLine}, {diagnostic.range.startColumn}]
            </span>
          </div>
        )}
      </div>
      <span className="shrink-0 text-xs text-text-muted">
        Ln {diagnostic.range.startLine}, Col {diagnostic.range.startColumn}
      </span>
    </button>
  );
}

// ============================================================================
// File Group Component
// ============================================================================

interface FileGroupProps {
  file: FileDiagnostics;
  expanded: boolean;
  onToggle: () => void;
  onDiagnosticClick: (diagnostic: Diagnostic) => void;
}

function FileGroup({ file, expanded, onToggle, onDiagnosticClick }: FileGroupProps) {
  return (
    <div className="border-b border-border-subtle last:border-0">
      {/* File header */}
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-overlay"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-text-muted" />
        ) : (
          <ChevronRight className="h-4 w-4 text-text-muted" />
        )}
        <File className="h-4 w-4 text-text-secondary" />
        <span className="flex-1 truncate text-sm text-text-primary">{file.fileName}</span>
        <div className="flex items-center gap-2">
          {file.errorCount > 0 && (
            <span className="flex items-center gap-1 text-xs text-accent-error">
              <AlertCircle className="h-3 w-3" />
              {file.errorCount}
            </span>
          )}
          {file.warningCount > 0 && (
            <span className="flex items-center gap-1 text-xs text-accent-warning">
              <AlertTriangle className="h-3 w-3" />
              {file.warningCount}
            </span>
          )}
          {file.infoCount > 0 && (
            <span className="flex items-center gap-1 text-xs text-text-muted">
              <Info className="h-3 w-3" />
              {file.infoCount}
            </span>
          )}
        </div>
      </button>

      {/* Diagnostics */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t border-border-subtle bg-surface/50"
          >
            {file.diagnostics.map((diagnostic) => (
              <DiagnosticItem
                key={diagnostic.id}
                diagnostic={diagnostic}
                onClick={onDiagnosticClick}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================================
// Filter Bar Component
// ============================================================================

interface FilterBarProps {
  showErrors: boolean;
  showWarnings: boolean;
  showInfos: boolean;
  onToggleErrors: () => void;
  onToggleWarnings: () => void;
  onToggleInfos: () => void;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  filterText: string;
  onFilterChange: (text: string) => void;
}

function FilterBar({
  showErrors,
  showWarnings,
  showInfos,
  onToggleErrors,
  onToggleWarnings,
  onToggleInfos,
  errorCount,
  warningCount,
  infoCount,
  filterText,
  onFilterChange,
}: FilterBarProps) {
  return (
    <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
      {/* Filter buttons */}
      <button
        onClick={onToggleErrors}
        className={cn(
          'flex items-center gap-1 rounded px-2 py-1 text-xs',
          showErrors ? 'bg-accent-error/20 text-accent-error' : 'text-text-muted hover:bg-overlay'
        )}
      >
        <AlertCircle className="h-3 w-3" />
        {errorCount}
      </button>
      <button
        onClick={onToggleWarnings}
        className={cn(
          'flex items-center gap-1 rounded px-2 py-1 text-xs',
          showWarnings
            ? 'bg-accent-warning/20 text-accent-warning'
            : 'text-text-muted hover:bg-overlay'
        )}
      >
        <AlertTriangle className="h-3 w-3" />
        {warningCount}
      </button>
      <button
        onClick={onToggleInfos}
        className={cn(
          'flex items-center gap-1 rounded px-2 py-1 text-xs',
          showInfos
            ? 'bg-accent-primary/20 text-accent-primary'
            : 'text-text-muted hover:bg-overlay'
        )}
      >
        <Info className="h-3 w-3" />
        {infoCount}
      </button>

      {/* Divider */}
      <div className="h-4 w-px bg-border-subtle" />

      {/* Text filter */}
      <div className="relative flex-1">
        <Filter className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-text-muted" />
        <input
          type="text"
          value={filterText}
          onChange={(e) => onFilterChange(e.target.value)}
          placeholder="Filter problems..."
          className="w-full rounded border border-border-default bg-surface py-1 pl-7 pr-2 text-xs text-text-primary placeholder:text-text-muted focus:border-accent-primary focus:outline-none"
        />
      </div>
    </div>
  );
}

// ============================================================================
// Main Problems Panel Component
// ============================================================================

interface ProblemsPanelProps {
  onDiagnosticClick: (filePath: string, line: number, column: number) => void;
  onClose?: () => void;
  className?: string;
}

export function ProblemsPanel({ onDiagnosticClick, onClose, className }: ProblemsPanelProps) {
  const { diagnostics, getCounts } = useDiagnosticsStore();

  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [showErrors, setShowErrors] = useState(true);
  const [showWarnings, setShowWarnings] = useState(true);
  const [showInfos, setShowInfos] = useState(true);
  const [filterText, setFilterText] = useState('');

  // Get counts
  const counts = getCounts();

  // Group diagnostics by file
  const fileGroups = useMemo(() => {
    const groups: FileDiagnostics[] = [];

    Object.entries(diagnostics).forEach(([filePath, diags]) => {
      // Filter by severity
      let filtered = diags.filter((d) => {
        if (d.severity === DiagnosticSeverity.Error && !showErrors) return false;
        if (d.severity === DiagnosticSeverity.Warning && !showWarnings) return false;
        if (d.severity === DiagnosticSeverity.Information && !showInfos) return false;
        if (d.severity === DiagnosticSeverity.Hint && !showInfos) return false;
        return true;
      });

      // Filter by text
      if (filterText) {
        const lowerFilter = filterText.toLowerCase();
        filtered = filtered.filter(
          (d) =>
            d.message.toLowerCase().includes(lowerFilter) ||
            d.source?.toLowerCase().includes(lowerFilter) ||
            String(d.code).toLowerCase().includes(lowerFilter)
        );
      }

      if (filtered.length > 0) {
        const fileName = filePath.split('/').pop() || filePath;
        groups.push({
          filePath,
          fileName,
          diagnostics: filtered.sort((a, b) => {
            // Sort by severity first, then by line
            if (a.severity !== b.severity) return a.severity - b.severity;
            return a.range.startLine - b.range.startLine;
          }),
          errorCount: filtered.filter((d) => d.severity === DiagnosticSeverity.Error).length,
          warningCount: filtered.filter((d) => d.severity === DiagnosticSeverity.Warning).length,
          infoCount: filtered.filter(
            (d) =>
              d.severity === DiagnosticSeverity.Information ||
              d.severity === DiagnosticSeverity.Hint
          ).length,
        });
      }
    });

    // Sort files by error count (most errors first)
    return groups.sort((a, b) => {
      if (a.errorCount !== b.errorCount) return b.errorCount - a.errorCount;
      if (a.warningCount !== b.warningCount) return b.warningCount - a.warningCount;
      return a.fileName.localeCompare(b.fileName);
    });
  }, [diagnostics, showErrors, showWarnings, showInfos, filterText]);

  // Total filtered count
  const totalCount = fileGroups.reduce((sum, f) => sum + f.diagnostics.length, 0);

  // Toggle file expansion
  const toggleFile = useCallback((filePath: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      return next;
    });
  }, []);

  // Handle diagnostic click
  const handleDiagnosticClick = useCallback(
    (diagnostic: Diagnostic) => {
      onDiagnosticClick(
        diagnostic.filePath,
        diagnostic.range.startLine,
        diagnostic.range.startColumn
      );
    },
    [onDiagnosticClick]
  );

  // Expand/collapse all
  const expandAll = useCallback(() => {
    setExpandedFiles(new Set(fileGroups.map((f) => f.filePath)));
  }, [fileGroups]);

  const collapseAll = useCallback(() => {
    setExpandedFiles(new Set());
  }, []);

  return (
    <div className={cn('flex h-full flex-col bg-elevated', className)}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border-default px-4 py-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-accent-warning" />
          <span className="text-sm font-medium text-text-primary">Problems</span>
          <span className="rounded-full bg-overlay px-2 py-0.5 text-xs text-text-secondary">
            {totalCount}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={expandAll}
            className="rounded px-2 py-1 text-xs text-text-muted hover:bg-overlay hover:text-text-secondary"
          >
            Expand All
          </button>
          <button
            onClick={collapseAll}
            className="rounded px-2 py-1 text-xs text-text-muted hover:bg-overlay hover:text-text-secondary"
          >
            Collapse All
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="ml-2 rounded p-1 text-text-muted hover:bg-overlay hover:text-text-secondary"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Filter bar */}
      <FilterBar
        showErrors={showErrors}
        showWarnings={showWarnings}
        showInfos={showInfos}
        onToggleErrors={() => setShowErrors(!showErrors)}
        onToggleWarnings={() => setShowWarnings(!showWarnings)}
        onToggleInfos={() => setShowInfos(!showInfos)}
        errorCount={counts.errors}
        warningCount={counts.warnings}
        infoCount={counts.infos + counts.hints}
        filterText={filterText}
        onFilterChange={setFilterText}
      />

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {fileGroups.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <AlertCircle className="h-8 w-8 text-accent-success" />
            <p className="mt-2 text-sm text-text-muted">No problems detected</p>
            <p className="text-xs text-text-muted">Your workspace is clean!</p>
          </div>
        ) : (
          fileGroups.map((file) => (
            <FileGroup
              key={file.filePath}
              file={file}
              expanded={expandedFiles.has(file.filePath)}
              onToggle={() => toggleFile(file.filePath)}
              onDiagnosticClick={handleDiagnosticClick}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Status Bar Integration
// ============================================================================

interface ProblemsStatusProps {
  onClick: () => void;
  className?: string;
}

export function ProblemsStatus({ onClick, className }: ProblemsStatusProps) {
  const counts = useDiagnosticsStore((s) => s.getCounts());
  const hasProblems = counts.errors > 0 || counts.warnings > 0;

  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-overlay',
        hasProblems ? 'text-text-secondary' : 'text-text-muted',
        className
      )}
    >
      {counts.errors > 0 && (
        <span className="flex items-center gap-1 text-accent-error">
          <AlertCircle className="h-3 w-3" />
          {counts.errors}
        </span>
      )}
      {counts.warnings > 0 && (
        <span className="flex items-center gap-1 text-accent-warning">
          <AlertTriangle className="h-3 w-3" />
          {counts.warnings}
        </span>
      )}
      {!hasProblems && (
        <span className="flex items-center gap-1">
          <AlertCircle className="h-3 w-3" />
          No problems
        </span>
      )}
    </button>
  );
}

// ============================================================================
// Monaco Integration Hook
// ============================================================================

import type { editor } from 'monaco-editor';

export function useMonacoDiagnostics(
  monacoInstance: typeof import('monaco-editor') | null,
  editorInstance: editor.IStandaloneCodeEditor | null
) {
  const setDiagnostics = useDiagnosticsStore((s) => s.setDiagnostics);

  // Listen to Monaco model markers
  useCallback(() => {
    if (!monacoInstance || !editorInstance) return;

    const model = editorInstance.getModel();
    if (!model) return;

    const uri = model.uri.toString();
    const markers = monacoInstance.editor.getModelMarkers({ resource: model.uri });

    const diagnostics: Diagnostic[] = markers.map((marker, index) => ({
      id: `${uri}-${index}`,
      filePath: uri,
      severity: marker.severity as unknown as DiagnosticSeverity,
      message: marker.message,
      source: marker.source,
      code: marker.code?.toString(),
      range: {
        startLine: marker.startLineNumber,
        startColumn: marker.startColumn,
        endLine: marker.endLineNumber,
        endColumn: marker.endColumn,
      },
    }));

    setDiagnostics(uri, diagnostics);
  }, [monacoInstance, editorInstance, setDiagnostics]);
}
