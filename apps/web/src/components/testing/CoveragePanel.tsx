'use client';

import { useState } from 'react';
import {
  BarChart3,
  FileCode,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  CheckCircle2,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  Minus,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ============================================================================
// Types
// ============================================================================

export interface FileCoverage {
  path: string;
  lines: { covered: number; total: number; percentage: number };
  branches: { covered: number; total: number; percentage: number };
  functions: { covered: number; total: number; percentage: number };
  statements: { covered: number; total: number; percentage: number };
  uncoveredLines: number[];
  trend?: 'up' | 'down' | 'same';
}

export interface FolderCoverage {
  path: string;
  name: string;
  files: FileCoverage[];
  folders: FolderCoverage[];
  aggregated: {
    lines: { covered: number; total: number; percentage: number };
    branches: { covered: number; total: number; percentage: number };
    functions: { covered: number; total: number; percentage: number };
    statements: { covered: number; total: number; percentage: number };
  };
}

export interface CoverageSummary {
  timestamp: Date;
  root: FolderCoverage;
  thresholds: {
    lines: number;
    branches: number;
    functions: number;
    statements: number;
  };
}

// ============================================================================
// Coverage Bar
// ============================================================================

interface CoverageBarProps {
  percentage: number;
  threshold?: number;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
}

function CoverageBar({
  percentage,
  threshold = 80,
  size = 'sm',
  showLabel = true,
}: CoverageBarProps) {
  const heights = { sm: 'h-1.5', md: 'h-2', lg: 'h-3' };
  const isGood = percentage >= threshold;
  const isWarning = percentage >= threshold * 0.7 && percentage < threshold;

  return (
    <div className="flex items-center gap-2">
      <div className={cn('flex-1 bg-overlay rounded-full overflow-hidden', heights[size])}>
        <div
          className={cn(
            'h-full rounded-full transition-all',
            isGood && 'bg-green-400',
            isWarning && 'bg-yellow-400',
            !isGood && !isWarning && 'bg-red-400'
          )}
          style={{ width: `${Math.min(100, percentage)}%` }}
        />
      </div>
      {showLabel && (
        <span
          className={cn(
            'text-xs font-mono w-12 text-right',
            isGood && 'text-green-400',
            isWarning && 'text-yellow-400',
            !isGood && !isWarning && 'text-red-400'
          )}
        >
          {percentage.toFixed(1)}%
        </span>
      )}
    </div>
  );
}

// ============================================================================
// Coverage Stats Card
// ============================================================================

interface CoverageStatsCardProps {
  label: string;
  covered: number;
  total: number;
  percentage: number;
  threshold: number;
}

function CoverageStatsCard({
  label,
  covered,
  total,
  percentage,
  threshold,
}: CoverageStatsCardProps) {
  const isGood = percentage >= threshold;

  return (
    <div className="p-3 rounded-lg bg-elevated border border-border-subtle">
      <div className="text-xs text-text-muted mb-1">{label}</div>
      <div className="flex items-end gap-2 mb-2">
        <span className={cn('text-2xl font-bold', isGood ? 'text-green-400' : 'text-red-400')}>
          {percentage.toFixed(1)}%
        </span>
        <span className="text-xs text-text-muted mb-1">
          {covered}/{total}
        </span>
      </div>
      <CoverageBar percentage={percentage} threshold={threshold} size="md" showLabel={false} />
    </div>
  );
}

// ============================================================================
// File Coverage Row
// ============================================================================

interface FileCoverageRowProps {
  file: FileCoverage;
  threshold: number;
  onSelect: () => void;
}

function FileCoverageRow({ file, threshold, onSelect }: FileCoverageRowProps) {
  const fileName = file.path.split('/').pop() || file.path;
  const isGood = file.lines.percentage >= threshold;

  return (
    <div
      className="flex items-center gap-3 px-3 py-2 hover:bg-overlay cursor-pointer group"
      onClick={onSelect}
    >
      <FileCode className="h-4 w-4 text-text-muted flex-shrink-0" />
      <span className="text-sm text-text-secondary truncate flex-1">{fileName}</span>

      {/* Trend indicator */}
      {file.trend && (
        <span className="flex-shrink-0">
          {file.trend === 'up' && <TrendingUp className="h-3 w-3 text-green-400" />}
          {file.trend === 'down' && <TrendingDown className="h-3 w-3 text-red-400" />}
          {file.trend === 'same' && <Minus className="h-3 w-3 text-text-muted" />}
        </span>
      )}

      {/* Coverage bars */}
      <div className="w-20 flex-shrink-0">
        <CoverageBar percentage={file.lines.percentage} threshold={threshold} />
      </div>
      <div className="w-20 flex-shrink-0 opacity-0 group-hover:opacity-100">
        <CoverageBar percentage={file.branches.percentage} threshold={threshold} />
      </div>

      {/* Status icon */}
      <span className="flex-shrink-0">
        {isGood ? (
          <CheckCircle2 className="h-4 w-4 text-green-400" />
        ) : (
          <AlertCircle className="h-4 w-4 text-red-400" />
        )}
      </span>
    </div>
  );
}

// ============================================================================
// Folder Coverage Row
// ============================================================================

interface FolderCoverageRowProps {
  folder: FolderCoverage;
  threshold: number;
  depth: number;
  expanded: boolean;
  onToggle: () => void;
  onSelectFile: (file: FileCoverage) => void;
  expandedFolders: Set<string>;
  onToggleFolder: (path: string) => void;
}

function FolderCoverageRow({
  folder,
  threshold,
  depth,
  expanded,
  onToggle,
  onSelectFile,
  expandedFolders,
  onToggleFolder,
}: FolderCoverageRowProps) {
  const isGood = folder.aggregated.lines.percentage >= threshold;

  return (
    <div>
      <div
        className="flex items-center gap-3 px-3 py-2 hover:bg-overlay cursor-pointer"
        style={{ paddingLeft: `${depth * 16 + 12}px` }}
        onClick={onToggle}
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-text-muted flex-shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-text-muted flex-shrink-0" />
        )}
        <FolderOpen className="h-4 w-4 text-yellow-400 flex-shrink-0" />
        <span className="text-sm font-medium text-text-primary truncate flex-1">{folder.name}</span>

        <div className="w-20 flex-shrink-0">
          <CoverageBar percentage={folder.aggregated.lines.percentage} threshold={threshold} />
        </div>

        <span className="flex-shrink-0">
          {isGood ? (
            <CheckCircle2 className="h-4 w-4 text-green-400" />
          ) : (
            <AlertCircle className="h-4 w-4 text-red-400" />
          )}
        </span>
      </div>

      {expanded && (
        <>
          {folder.folders.map((subFolder) => (
            <FolderCoverageRow
              key={subFolder.path}
              folder={subFolder}
              threshold={threshold}
              depth={depth + 1}
              expanded={expandedFolders.has(subFolder.path)}
              onToggle={() => onToggleFolder(subFolder.path)}
              onSelectFile={onSelectFile}
              expandedFolders={expandedFolders}
              onToggleFolder={onToggleFolder}
            />
          ))}
          {folder.files.map((file) => (
            <div key={file.path} style={{ paddingLeft: `${(depth + 1) * 16}px` }}>
              <FileCoverageRow
                file={file}
                threshold={threshold}
                onSelect={() => onSelectFile(file)}
              />
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// ============================================================================
// File Coverage Details
// ============================================================================

interface FileCoverageDetailsProps {
  file: FileCoverage;
  onClose: () => void;
  onGoToLine: (line: number) => void;
}

function FileCoverageDetails({ file, onClose, onGoToLine }: FileCoverageDetailsProps) {
  return (
    <div className="flex flex-col h-full border-l border-border-subtle">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
        <div>
          <h3 className="text-sm font-medium text-text-primary">{file.path.split('/').pop()}</h3>
          <p className="text-xs text-text-muted">{file.path}</p>
        </div>
        <button onClick={onClose} className="text-text-muted hover:text-text-primary">
          ×
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 p-4 border-b border-border-subtle">
        <CoverageStatsCard
          label="Lines"
          covered={file.lines.covered}
          total={file.lines.total}
          percentage={file.lines.percentage}
          threshold={80}
        />
        <CoverageStatsCard
          label="Branches"
          covered={file.branches.covered}
          total={file.branches.total}
          percentage={file.branches.percentage}
          threshold={80}
        />
        <CoverageStatsCard
          label="Functions"
          covered={file.functions.covered}
          total={file.functions.total}
          percentage={file.functions.percentage}
          threshold={80}
        />
        <CoverageStatsCard
          label="Statements"
          covered={file.statements.covered}
          total={file.statements.total}
          percentage={file.statements.percentage}
          threshold={80}
        />
      </div>

      {file.uncoveredLines.length > 0 && (
        <div className="flex-1 overflow-y-auto p-4">
          <h4 className="text-xs font-medium text-text-muted mb-2">
            Uncovered Lines ({file.uncoveredLines.length})
          </h4>
          <div className="flex flex-wrap gap-1">
            {file.uncoveredLines.map((line) => (
              <button
                key={line}
                onClick={() => onGoToLine(line)}
                className="px-2 py-0.5 rounded text-xs font-mono bg-red-500/20 text-red-400 hover:bg-red-500/30"
              >
                {line}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main Coverage Panel
// ============================================================================

interface CoveragePanelProps {
  coverage: CoverageSummary;
  onGoToFile?: (file: string, line?: number) => void;
  className?: string;
}

export function CoveragePanel({ coverage, onGoToFile, className }: CoveragePanelProps) {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set([coverage.root.path])
  );
  const [selectedFile, setSelectedFile] = useState<FileCoverage | null>(null);

  const toggleFolder = (path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const handleGoToLine = (line: number) => {
    if (selectedFile) {
      onGoToFile?.(selectedFile.path, line);
    }
  };

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle">
        <BarChart3 className="h-5 w-5 text-accent-primary" />
        <h2 className="text-lg font-semibold text-text-primary">Coverage</h2>
        <span className="text-xs text-text-muted ml-auto">
          {coverage.timestamp.toLocaleString()}
        </span>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-4 gap-2 p-4 border-b border-border-subtle bg-elevated">
        <CoverageStatsCard
          label="Lines"
          covered={coverage.root.aggregated.lines.covered}
          total={coverage.root.aggregated.lines.total}
          percentage={coverage.root.aggregated.lines.percentage}
          threshold={coverage.thresholds.lines}
        />
        <CoverageStatsCard
          label="Branches"
          covered={coverage.root.aggregated.branches.covered}
          total={coverage.root.aggregated.branches.total}
          percentage={coverage.root.aggregated.branches.percentage}
          threshold={coverage.thresholds.branches}
        />
        <CoverageStatsCard
          label="Functions"
          covered={coverage.root.aggregated.functions.covered}
          total={coverage.root.aggregated.functions.total}
          percentage={coverage.root.aggregated.functions.percentage}
          threshold={coverage.thresholds.functions}
        />
        <CoverageStatsCard
          label="Statements"
          covered={coverage.root.aggregated.statements.covered}
          total={coverage.root.aggregated.statements.total}
          percentage={coverage.root.aggregated.statements.percentage}
          threshold={coverage.thresholds.statements}
        />
      </div>

      {/* File tree and details */}
      <div className="flex-1 flex min-h-0">
        {/* File tree */}
        <div className="flex-1 overflow-y-auto">
          <div className="py-2">
            <FolderCoverageRow
              folder={coverage.root}
              threshold={coverage.thresholds.lines}
              depth={0}
              expanded={expandedFolders.has(coverage.root.path)}
              onToggle={() => toggleFolder(coverage.root.path)}
              onSelectFile={setSelectedFile}
              expandedFolders={expandedFolders}
              onToggleFolder={toggleFolder}
            />
          </div>
        </div>

        {/* File details */}
        {selectedFile && (
          <div className="w-80 flex-shrink-0">
            <FileCoverageDetails
              file={selectedFile}
              onClose={() => setSelectedFile(null)}
              onGoToLine={handleGoToLine}
            />
          </div>
        )}
      </div>
    </div>
  );
}
