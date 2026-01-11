'use client';

import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import {
  AlertTriangle,
  FileCode,
  GitMerge,
  ChevronDown,
  ChevronRight,
  Users,
  CheckCircle,
  Sparkles,
  AlertCircle,
} from 'lucide-react';

interface Conflict {
  id: string;
  conflictType: 'file_overlap' | 'line_conflict' | 'semantic_conflict' | 'resource_conflict';
  severity: 'low' | 'medium' | 'high' | 'critical';
  filePath: string;
  agentIds: string[];
  description: string;
  affectedLines: number[];
  suggestedResolution: string | null;
  autoResolvable: boolean;
  resolved: boolean;
}

interface ConflictWarningPanelProps {
  sessionId: string;
  conflicts: Conflict[];
  className?: string;
  onResolve?: (conflictId: string, method: string) => void;
  onViewFile?: (filePath: string, line?: number) => void;
}

export function ConflictWarningPanel({
  sessionId: _sessionId,
  conflicts,
  className,
  onResolve,
  onViewFile,
}: ConflictWarningPanelProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const unresolvedConflicts = conflicts.filter((c) => !c.resolved);

  const severityCounts = {
    critical: unresolvedConflicts.filter((c) => c.severity === 'critical').length,
    high: unresolvedConflicts.filter((c) => c.severity === 'high').length,
    medium: unresolvedConflicts.filter((c) => c.severity === 'medium').length,
    low: unresolvedConflicts.filter((c) => c.severity === 'low').length,
  };

  const autoResolvable = unresolvedConflicts.filter((c) => c.autoResolvable);

  if (unresolvedConflicts.length === 0) {
    return (
      <div
        className={cn(
          'flex items-center gap-2 px-3 py-2 rounded-lg bg-green-500/10 text-green-500 text-sm',
          className
        )}
      >
        <CheckCircle className="w-4 h-4" />
        No conflicts detected
      </div>
    );
  }

  return (
    <div className={cn('rounded-lg border border-yellow-500/30 bg-yellow-500/5', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-yellow-500/20">
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-yellow-500" />
          <div>
            <h3 className="font-semibold text-yellow-500">
              {unresolvedConflicts.length} Conflict{unresolvedConflicts.length > 1 ? 's' : ''}{' '}
              Detected
            </h3>
            <p className="text-xs text-text-muted mt-0.5">
              Parallel agents have made conflicting changes
            </p>
          </div>
        </div>

        {autoResolvable.length > 0 && (
          <button
            onClick={() => autoResolvable.forEach((c) => onResolve?.(c.id, 'auto'))}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded bg-yellow-500 text-black font-medium hover:bg-yellow-400"
          >
            <Sparkles className="w-4 h-4" />
            Auto-resolve {autoResolvable.length}
          </button>
        )}
      </div>

      {/* Severity Summary */}
      <div className="flex items-center gap-4 px-4 py-2 border-b border-yellow-500/20 text-xs">
        {severityCounts.critical > 0 && (
          <span className="flex items-center gap-1 text-red-500">
            <span className="w-2 h-2 rounded-full bg-red-500" />
            {severityCounts.critical} critical
          </span>
        )}
        {severityCounts.high > 0 && (
          <span className="flex items-center gap-1 text-orange-500">
            <span className="w-2 h-2 rounded-full bg-orange-500" />
            {severityCounts.high} high
          </span>
        )}
        {severityCounts.medium > 0 && (
          <span className="flex items-center gap-1 text-yellow-500">
            <span className="w-2 h-2 rounded-full bg-yellow-500" />
            {severityCounts.medium} medium
          </span>
        )}
        {severityCounts.low > 0 && (
          <span className="flex items-center gap-1 text-green-500">
            <span className="w-2 h-2 rounded-full bg-green-500" />
            {severityCounts.low} low
          </span>
        )}
      </div>

      {/* Conflict List */}
      <div className="divide-y divide-yellow-500/10 max-h-80 overflow-y-auto">
        {unresolvedConflicts.map((conflict) => (
          <ConflictItem
            key={conflict.id}
            conflict={conflict}
            isExpanded={expandedId === conflict.id}
            onToggleExpand={() => setExpandedId(expandedId === conflict.id ? null : conflict.id)}
            onResolve={(method) => onResolve?.(conflict.id, method)}
            onViewFile={() => onViewFile?.(conflict.filePath, conflict.affectedLines[0])}
          />
        ))}
      </div>
    </div>
  );
}

interface ConflictItemProps {
  conflict: Conflict;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onResolve: (method: string) => void;
  onViewFile: () => void;
}

function ConflictItem({
  conflict,
  isExpanded,
  onToggleExpand,
  onResolve,
  onViewFile,
}: ConflictItemProps) {
  const severityColor = {
    low: 'text-green-500 bg-green-500/10',
    medium: 'text-yellow-500 bg-yellow-500/10',
    high: 'text-orange-500 bg-orange-500/10',
    critical: 'text-red-500 bg-red-500/10',
  }[conflict.severity];

  const typeIcon = {
    file_overlap: FileCode,
    line_conflict: GitMerge,
    semantic_conflict: AlertCircle,
    resource_conflict: Users,
  }[conflict.conflictType];

  const TypeIcon = typeIcon;

  return (
    <div className="group">
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-yellow-500/5 transition-colors"
        onClick={onToggleExpand}
      >
        {isExpanded ? (
          <ChevronDown className="w-4 h-4 text-text-muted" />
        ) : (
          <ChevronRight className="w-4 h-4 text-text-muted" />
        )}

        <TypeIcon className="w-4 h-4 text-yellow-500" />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className="text-sm font-medium truncate cursor-pointer hover:text-accent-primary"
              onClick={(e) => {
                e.stopPropagation();
                onViewFile();
              }}
            >
              {conflict.filePath.split('/').pop()}
            </span>
            <span className={cn('px-1.5 py-0.5 text-xs rounded', severityColor)}>
              {conflict.severity}
            </span>
            {conflict.autoResolvable && (
              <span className="px-1.5 py-0.5 text-xs rounded bg-blue-500/10 text-blue-500">
                auto
              </span>
            )}
          </div>
          <p className="text-xs text-text-muted truncate mt-0.5">{conflict.description}</p>
        </div>

        <div className="flex items-center gap-1 text-xs text-text-muted">
          <Users className="w-3 h-3" />
          {conflict.agentIds.length}
        </div>
      </div>

      {isExpanded && (
        <div className="px-4 pb-4 pl-11 space-y-3">
          {/* File path */}
          <div className="flex items-center gap-2 text-sm">
            <FileCode className="w-4 h-4 text-text-muted" />
            <span className="text-text-muted">File:</span>
            <button onClick={onViewFile} className="text-accent-primary hover:underline">
              {conflict.filePath}
            </button>
          </div>

          {/* Affected lines */}
          {conflict.affectedLines.length > 0 && (
            <div className="flex items-center gap-2 text-sm">
              <GitMerge className="w-4 h-4 text-text-muted" />
              <span className="text-text-muted">Lines:</span>
              <span>
                {conflict.affectedLines.slice(0, 5).join(', ')}
                {conflict.affectedLines.length > 5 &&
                  `, +${conflict.affectedLines.length - 5} more`}
              </span>
            </div>
          )}

          {/* Agents involved */}
          <div className="flex items-center gap-2 text-sm">
            <Users className="w-4 h-4 text-text-muted" />
            <span className="text-text-muted">Agents:</span>
            <div className="flex items-center gap-1">
              {conflict.agentIds.map((id) => (
                <span key={id} className="px-1.5 py-0.5 text-xs rounded bg-surface-secondary">
                  {id.slice(0, 8)}
                </span>
              ))}
            </div>
          </div>

          {/* Suggested resolution */}
          {conflict.suggestedResolution && (
            <div className="p-2 rounded bg-surface-secondary text-sm">
              <p className="text-xs text-text-muted mb-1 flex items-center gap-1">
                <Sparkles className="w-3 h-3" />
                Suggested Resolution
              </p>
              <p className="text-text-secondary">{conflict.suggestedResolution}</p>
            </div>
          )}

          {/* Resolution buttons */}
          <div className="flex items-center gap-2 pt-2">
            {conflict.autoResolvable && (
              <button
                onClick={() => onResolve('auto')}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded bg-accent-primary text-white hover:bg-accent-primary/90"
              >
                <Sparkles className="w-4 h-4" />
                Auto-resolve
              </button>
            )}
            <button
              onClick={() => onResolve('first_wins')}
              className="px-3 py-1.5 text-sm rounded border border-border-subtle hover:bg-surface-hover"
            >
              Use First Agent
            </button>
            <button
              onClick={() => onResolve('last_wins')}
              className="px-3 py-1.5 text-sm rounded border border-border-subtle hover:bg-surface-hover"
            >
              Use Last Agent
            </button>
            <button
              onClick={onViewFile}
              className="px-3 py-1.5 text-sm rounded border border-border-subtle hover:bg-surface-hover"
            >
              Manual Review
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default ConflictWarningPanel;
