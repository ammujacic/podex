'use client';

import { useState, useCallback, useMemo } from 'react';
import {
  AlertTriangle,
  AlertCircle,
  Info,
  ChevronRight,
  ChevronDown,
  File,
  RefreshCw,
  Check,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDiagnosticsStore, DiagnosticSeverity, type Diagnostic } from './ProblemsPanel';

interface DiagnosticsSidebarPanelProps {
  sessionId: string;
  onNavigate?: (filePath: string, line: number, column: number) => void;
}

function getSeverityIcon(severity: DiagnosticSeverity, className?: string) {
  switch (severity) {
    case DiagnosticSeverity.Error:
      return <AlertCircle className={cn('h-3 w-3 text-error', className)} />;
    case DiagnosticSeverity.Warning:
      return <AlertTriangle className={cn('h-3 w-3 text-warning', className)} />;
    case DiagnosticSeverity.Information:
    case DiagnosticSeverity.Hint:
      return <Info className={cn('h-3 w-3 text-info', className)} />;
  }
}

export function DiagnosticsSidebarPanel({
  sessionId: _sessionId,
  onNavigate,
}: DiagnosticsSidebarPanelProps) {
  const { diagnostics, getCounts, clearAllDiagnostics } = useDiagnosticsStore();
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<'all' | 'errors' | 'warnings'>('all');

  const counts = getCounts();
  const hasProblems = counts.errors > 0 || counts.warnings > 0;

  // Group diagnostics by file
  const fileGroups = useMemo(() => {
    const groups: { filePath: string; fileName: string; diagnostics: Diagnostic[] }[] = [];

    Object.entries(diagnostics).forEach(([filePath, diags]) => {
      let filtered = diags;

      if (filter === 'errors') {
        filtered = diags.filter((d) => d.severity === DiagnosticSeverity.Error);
      } else if (filter === 'warnings') {
        filtered = diags.filter((d) => d.severity === DiagnosticSeverity.Warning);
      }

      if (filtered.length > 0) {
        const fileName = filePath.split('/').pop() || filePath;
        groups.push({
          filePath,
          fileName,
          diagnostics: filtered.sort((a, b) => a.severity - b.severity),
        });
      }
    });

    // Sort by error count (most errors first)
    return groups.sort((a, b) => {
      const aErrors = a.diagnostics.filter((d) => d.severity === DiagnosticSeverity.Error).length;
      const bErrors = b.diagnostics.filter((d) => d.severity === DiagnosticSeverity.Error).length;
      return bErrors - aErrors;
    });
  }, [diagnostics, filter]);

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

  const handleDiagnosticClick = useCallback(
    (diagnostic: Diagnostic) => {
      onNavigate?.(diagnostic.filePath, diagnostic.range.startLine, diagnostic.range.startColumn);
    },
    [onNavigate]
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Quick stats */}
      <div className="px-3 py-2 border-b border-border-subtle flex items-center justify-between">
        <div className="flex items-center gap-3">
          {counts.errors > 0 && (
            <button
              onClick={() => setFilter(filter === 'errors' ? 'all' : 'errors')}
              className={cn(
                'flex items-center gap-1 text-xs',
                filter === 'errors' ? 'text-error' : 'text-error/70 hover:text-error'
              )}
            >
              <AlertCircle className="h-3.5 w-3.5" />
              {counts.errors}
            </button>
          )}
          {counts.warnings > 0 && (
            <button
              onClick={() => setFilter(filter === 'warnings' ? 'all' : 'warnings')}
              className={cn(
                'flex items-center gap-1 text-xs',
                filter === 'warnings' ? 'text-warning' : 'text-warning/70 hover:text-warning'
              )}
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              {counts.warnings}
            </button>
          )}
          {!hasProblems && (
            <span className="flex items-center gap-1 text-xs text-success">
              <Check className="h-3.5 w-3.5" />
              No problems
            </span>
          )}
        </div>
        {hasProblems && (
          <button
            onClick={clearAllDiagnostics}
            className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-overlay"
            title="Clear all"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {!hasProblems ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <Check className="h-8 w-8 text-success mb-2" />
            <p className="text-xs text-text-muted">No problems detected</p>
            <p className="text-[10px] text-text-muted mt-1">Your workspace is clean!</p>
          </div>
        ) : fileGroups.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <AlertCircle className="h-8 w-8 text-text-muted mb-2" />
            <p className="text-xs text-text-muted">No {filter} found</p>
          </div>
        ) : (
          fileGroups.map((group) => {
            const errorCount = group.diagnostics.filter(
              (d) => d.severity === DiagnosticSeverity.Error
            ).length;
            const warningCount = group.diagnostics.filter(
              (d) => d.severity === DiagnosticSeverity.Warning
            ).length;
            const isExpanded = expandedFiles.has(group.filePath);

            return (
              <div key={group.filePath} className="border-b border-border-subtle last:border-0">
                <button
                  onClick={() => toggleFile(group.filePath)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-overlay"
                >
                  {isExpanded ? (
                    <ChevronDown className="h-3 w-3 text-text-muted shrink-0" />
                  ) : (
                    <ChevronRight className="h-3 w-3 text-text-muted shrink-0" />
                  )}
                  <File className="h-3.5 w-3.5 text-text-secondary shrink-0" />
                  <span className="text-xs text-text-primary truncate flex-1">
                    {group.fileName}
                  </span>
                  <div className="flex items-center gap-1">
                    {errorCount > 0 && <span className="text-[10px] text-error">{errorCount}</span>}
                    {warningCount > 0 && (
                      <span className="text-[10px] text-warning">{warningCount}</span>
                    )}
                  </div>
                </button>

                {isExpanded && (
                  <div className="bg-surface/50">
                    {group.diagnostics.map((diagnostic) => (
                      <button
                        key={diagnostic.id}
                        onClick={() => handleDiagnosticClick(diagnostic)}
                        className="w-full flex items-start gap-2 px-3 py-1.5 text-left hover:bg-overlay"
                      >
                        {getSeverityIcon(diagnostic.severity)}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-text-primary line-clamp-2">
                            {diagnostic.message}
                          </p>
                          <p className="text-[10px] text-text-muted">
                            Ln {diagnostic.range.startLine}, Col {diagnostic.range.startColumn}
                            {diagnostic.source && ` • ${diagnostic.source}`}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
