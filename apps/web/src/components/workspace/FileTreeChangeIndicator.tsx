'use client';

import React, { useMemo } from 'react';
import { cn } from '@/lib/utils';
import {
  File,
  Folder,
  FolderOpen,
  Plus,
  Minus,
  Edit,
  FileCode,
  FileText,
  FileJson,
  Image,
  ChevronRight,
  ChevronDown,
  GitBranch,
  AlertCircle,
} from 'lucide-react';

export type ChangeType = 'added' | 'modified' | 'deleted' | 'renamed';

export interface FileChange {
  path: string;
  changeType: ChangeType;
  linesAdded?: number;
  linesRemoved?: number;
  oldPath?: string; // For renamed files
  isConflict?: boolean;
}

interface FileTreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children: FileTreeNode[];
  change?: FileChange;
  hasChangedChildren: boolean;
}

interface FileTreeChangeIndicatorProps {
  changes: FileChange[];
  className?: string;
  showLineStats?: boolean;
  onFileClick?: (change: FileChange) => void;
  expandedByDefault?: boolean;
  showUnchangedFolders?: boolean;
}

// File extension to icon mapping
const FILE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  ts: FileCode,
  tsx: FileCode,
  js: FileCode,
  jsx: FileCode,
  py: FileCode,
  go: FileCode,
  rs: FileCode,
  java: FileCode,
  cpp: FileCode,
  c: FileCode,
  h: FileCode,
  json: FileJson,
  yaml: FileText,
  yml: FileText,
  md: FileText,
  txt: FileText,
  png: Image,
  jpg: Image,
  jpeg: Image,
  gif: Image,
  svg: Image,
};

function getFileIcon(fileName: string): React.ComponentType<{ className?: string }> {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  return FILE_ICONS[ext] || File;
}

function buildFileTree(changes: FileChange[]): FileTreeNode[] {
  const root: FileTreeNode[] = [];
  const nodeMap = new Map<string, FileTreeNode>();

  // Sort changes by path for consistent ordering
  const sortedChanges = [...changes].sort((a, b) => a.path.localeCompare(b.path));

  for (const change of sortedChanges) {
    const parts = change.path.split('/');
    let currentPath = '';

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      const parentPath = currentPath;
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const isFile = i === parts.length - 1;

      if (!nodeMap.has(currentPath)) {
        const node: FileTreeNode = {
          name: part,
          path: currentPath,
          isDirectory: !isFile,
          children: [],
          change: isFile ? change : undefined,
          hasChangedChildren: false,
        };

        nodeMap.set(currentPath, node);

        if (parentPath) {
          const parent = nodeMap.get(parentPath);
          if (parent) {
            parent.children.push(node);
            parent.hasChangedChildren = true;
          }
        } else {
          root.push(node);
        }
      } else if (isFile) {
        // Update existing node with change info
        const node = nodeMap.get(currentPath)!;
        node.change = change;
      }
    }

    // Mark all ancestors as having changed children
    let ancestorPath = '';
    for (let i = 0; i < parts.length - 1; i++) {
      ancestorPath = ancestorPath ? `${ancestorPath}/${parts[i]!}` : parts[i]!;
      const ancestor = nodeMap.get(ancestorPath);
      if (ancestor) {
        ancestor.hasChangedChildren = true;
      }
    }
  }

  // Sort children: directories first, then alphabetically
  const sortNodes = (nodes: FileTreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });
    nodes.forEach((node) => sortNodes(node.children));
  };

  sortNodes(root);
  return root;
}

export function FileTreeChangeIndicator({
  changes,
  className,
  showLineStats = true,
  onFileClick,
  expandedByDefault = true,
  showUnchangedFolders = false,
}: FileTreeChangeIndicatorProps) {
  const tree = useMemo(() => buildFileTree(changes), [changes]);

  // Summary stats
  const stats = useMemo(() => {
    const summary = {
      added: 0,
      modified: 0,
      deleted: 0,
      renamed: 0,
      totalLinesAdded: 0,
      totalLinesRemoved: 0,
      conflicts: 0,
    };

    for (const change of changes) {
      summary[change.changeType]++;
      summary.totalLinesAdded += change.linesAdded || 0;
      summary.totalLinesRemoved += change.linesRemoved || 0;
      if (change.isConflict) summary.conflicts++;
    }

    return summary;
  }, [changes]);

  if (changes.length === 0) {
    return (
      <div className={cn('text-sm text-text-muted p-4 text-center', className)}>
        No file changes
      </div>
    );
  }

  return (
    <div className={cn('text-sm', className)}>
      {/* Summary Header */}
      <div className="flex items-center gap-3 px-3 py-2 border-b border-border-subtle bg-surface-secondary/50">
        <div className="flex items-center gap-1">
          <GitBranch className="w-4 h-4 text-text-muted" />
          <span className="font-medium">{changes.length} changed files</span>
        </div>

        <div className="flex items-center gap-3 text-xs">
          {stats.added > 0 && (
            <span className="flex items-center gap-1 text-green-500">
              <Plus className="w-3 h-3" />
              {stats.added}
            </span>
          )}
          {stats.modified > 0 && (
            <span className="flex items-center gap-1 text-yellow-500">
              <Edit className="w-3 h-3" />
              {stats.modified}
            </span>
          )}
          {stats.deleted > 0 && (
            <span className="flex items-center gap-1 text-red-500">
              <Minus className="w-3 h-3" />
              {stats.deleted}
            </span>
          )}
          {stats.conflicts > 0 && (
            <span className="flex items-center gap-1 text-orange-500">
              <AlertCircle className="w-3 h-3" />
              {stats.conflicts}
            </span>
          )}
        </div>

        {showLineStats && (stats.totalLinesAdded > 0 || stats.totalLinesRemoved > 0) && (
          <div className="ml-auto flex items-center gap-2 text-xs">
            <span className="text-green-500">+{stats.totalLinesAdded}</span>
            <span className="text-red-500">-{stats.totalLinesRemoved}</span>
          </div>
        )}
      </div>

      {/* Tree View */}
      <div className="py-1">
        {tree.map((node) => (
          <FileTreeNodeComponent
            key={node.path}
            node={node}
            depth={0}
            showLineStats={showLineStats}
            onFileClick={onFileClick}
            expandedByDefault={expandedByDefault}
            showUnchangedFolders={showUnchangedFolders}
          />
        ))}
      </div>
    </div>
  );
}

interface FileTreeNodeComponentProps {
  node: FileTreeNode;
  depth: number;
  showLineStats: boolean;
  onFileClick?: (change: FileChange) => void;
  expandedByDefault: boolean;
  showUnchangedFolders: boolean;
}

function FileTreeNodeComponent({
  node,
  depth,
  showLineStats,
  onFileClick,
  expandedByDefault,
  showUnchangedFolders,
}: FileTreeNodeComponentProps) {
  const [isExpanded, setIsExpanded] = React.useState(expandedByDefault);

  // Skip unchanged folders if not showing them
  if (!showUnchangedFolders && node.isDirectory && !node.hasChangedChildren) {
    return null;
  }

  const FileIcon = getFileIcon(node.name);

  const changeColor = {
    added: 'text-green-500',
    modified: 'text-yellow-500',
    deleted: 'text-red-500',
    renamed: 'text-blue-500',
  };

  const changeBg = {
    added: 'bg-green-500/10',
    modified: 'bg-yellow-500/10',
    deleted: 'bg-red-500/10',
    renamed: 'bg-blue-500/10',
  };

  const changeIcon = {
    added: <Plus className="w-3 h-3" />,
    modified: <Edit className="w-3 h-3" />,
    deleted: <Minus className="w-3 h-3" />,
    renamed: <GitBranch className="w-3 h-3" />,
  };

  if (node.isDirectory) {
    return (
      <div>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className={cn(
            'w-full flex items-center gap-1 px-2 py-1 hover:bg-surface-hover text-left',
            node.hasChangedChildren && 'text-text-primary'
          )}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
        >
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-text-muted" />
          ) : (
            <ChevronRight className="w-4 h-4 text-text-muted" />
          )}
          {isExpanded ? (
            <FolderOpen className="w-4 h-4 text-yellow-500" />
          ) : (
            <Folder className="w-4 h-4 text-yellow-500" />
          )}
          <span className="truncate">{node.name}</span>
          {node.hasChangedChildren && (
            <span className="ml-auto text-xs text-text-muted">{countChanges(node)} changes</span>
          )}
        </button>

        {isExpanded && (
          <div>
            {node.children.map((child) => (
              <FileTreeNodeComponent
                key={child.path}
                node={child}
                depth={depth + 1}
                showLineStats={showLineStats}
                onFileClick={onFileClick}
                expandedByDefault={expandedByDefault}
                showUnchangedFolders={showUnchangedFolders}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  const change = node.change;
  if (!change) return null;

  return (
    <button
      onClick={() => onFileClick?.(change)}
      className={cn(
        'w-full flex items-center gap-1.5 px-2 py-1 hover:bg-surface-hover text-left group',
        change.isConflict && 'bg-orange-500/5'
      )}
      style={{ paddingLeft: `${depth * 16 + 28}px` }}
    >
      <FileIcon className={cn('w-4 h-4 flex-shrink-0', changeColor[change.changeType])} />

      <span
        className={cn(
          'truncate flex-1',
          change.changeType === 'deleted' && 'line-through text-text-muted'
        )}
      >
        {node.name}
      </span>

      {change.oldPath && (
        <span className="text-xs text-text-muted truncate max-w-[100px]" title={change.oldPath}>
          ← {change.oldPath.split('/').pop()}
        </span>
      )}

      {change.isConflict && (
        <span title="Conflict detected">
          <AlertCircle className="w-3 h-3 text-orange-500 flex-shrink-0" />
        </span>
      )}

      {showLineStats && (change.linesAdded || change.linesRemoved) && (
        <div className="flex items-center gap-1 text-xs opacity-0 group-hover:opacity-100 transition-opacity">
          {change.linesAdded ? <span className="text-green-500">+{change.linesAdded}</span> : null}
          {change.linesRemoved ? (
            <span className="text-red-500">-{change.linesRemoved}</span>
          ) : null}
        </div>
      )}

      <span
        className={cn(
          'px-1.5 py-0.5 rounded text-xs flex items-center gap-1 flex-shrink-0',
          changeBg[change.changeType],
          changeColor[change.changeType]
        )}
      >
        {changeIcon[change.changeType]}
      </span>
    </button>
  );
}

function countChanges(node: FileTreeNode): number {
  let count = 0;
  if (node.change) count++;
  for (const child of node.children) {
    count += countChanges(child);
  }
  return count;
}

// Compact badge version for file tree integration
interface ChangeIndicatorBadgeProps {
  changeType: ChangeType;
  linesAdded?: number;
  linesRemoved?: number;
  isConflict?: boolean;
  compact?: boolean;
}

export function ChangeIndicatorBadge({
  changeType,
  linesAdded,
  linesRemoved,
  isConflict,
  compact = false,
}: ChangeIndicatorBadgeProps) {
  const colors = {
    added: 'bg-green-500 text-white',
    modified: 'bg-yellow-500 text-black',
    deleted: 'bg-red-500 text-white',
    renamed: 'bg-blue-500 text-white',
  };

  const labels = {
    added: 'A',
    modified: 'M',
    deleted: 'D',
    renamed: 'R',
  };

  if (compact) {
    return (
      <span className={cn('px-1 rounded text-[10px] font-bold', colors[changeType])}>
        {labels[changeType]}
        {isConflict && '!'}
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1">
      <span className={cn('px-1.5 py-0.5 rounded text-xs font-medium', colors[changeType])}>
        {labels[changeType]}
      </span>
      {(linesAdded || linesRemoved) && (
        <span className="text-xs">
          {linesAdded ? <span className="text-green-500">+{linesAdded}</span> : null}
          {linesAdded && linesRemoved ? ' ' : null}
          {linesRemoved ? <span className="text-red-500">-{linesRemoved}</span> : null}
        </span>
      )}
      {isConflict && <AlertCircle className="w-3 h-3 text-orange-500" />}
    </span>
  );
}

// Inline indicator for single files
interface InlineChangeIndicatorProps {
  changeType: ChangeType;
  className?: string;
}

export function InlineChangeIndicator({ changeType, className }: InlineChangeIndicatorProps) {
  const indicators = {
    added: { icon: Plus, color: 'text-green-500', label: 'Added' },
    modified: { icon: Edit, color: 'text-yellow-500', label: 'Modified' },
    deleted: { icon: Minus, color: 'text-red-500', label: 'Deleted' },
    renamed: { icon: GitBranch, color: 'text-blue-500', label: 'Renamed' },
  };

  const { icon: Icon, color, label } = indicators[changeType];

  return (
    <span className={cn('inline-flex items-center gap-1', color, className)} title={label}>
      <Icon className="w-3 h-3" />
    </span>
  );
}

export default FileTreeChangeIndicator;
