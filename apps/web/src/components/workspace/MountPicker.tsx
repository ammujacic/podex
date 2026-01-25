'use client';

import { useState, useMemo } from 'react';
import {
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  Lock,
  HardDrive,
  AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MountConfig, LocalPod } from '@/lib/api';

interface MountPickerProps {
  pod: LocalPod;
  selectedPath: string | null;
  onSelect: (path: string | null) => void;
}

interface FolderNode {
  name: string;
  path: string;
  mode: 'rw' | 'ro';
  label: string | null;
  isMount: boolean;
  children: FolderNode[];
}

function buildFolderTree(mounts: MountConfig[]): FolderNode[] {
  return mounts.map((mount) => ({
    name: mount.path.split('/').pop() || mount.path,
    path: mount.path,
    mode: mount.mode,
    label: mount.label,
    isMount: true,
    children: [], // In a real implementation, we'd fetch subfolders via API
  }));
}

function FolderItem({
  node,
  depth,
  selectedPath,
  expandedPaths,
  onToggleExpand,
  onSelect,
}: {
  node: FolderNode;
  depth: number;
  selectedPath: string | null;
  expandedPaths: Set<string>;
  onToggleExpand: (path: string) => void;
  onSelect: (path: string) => void;
}) {
  const isExpanded = expandedPaths.has(node.path);
  const isSelected = selectedPath === node.path;
  const hasChildren = node.children.length > 0;
  const isReadOnly = node.mode === 'ro';

  return (
    <div>
      <button
        onClick={() => onSelect(node.path)}
        className={cn(
          'w-full flex items-center gap-2 px-3 py-2 text-left text-sm rounded-lg transition-colors',
          isSelected
            ? 'bg-accent-primary/20 text-accent-primary border border-accent-primary/30'
            : 'hover:bg-overlay text-text-primary'
        )}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
      >
        {/* Expand/collapse button */}
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(node.path);
            }}
            className="p-0.5 hover:bg-overlay rounded"
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4 text-text-muted" />
            ) : (
              <ChevronRight className="h-4 w-4 text-text-muted" />
            )}
          </button>
        ) : (
          <span className="w-5" />
        )}

        {/* Folder icon */}
        {isExpanded ? (
          <FolderOpen className="h-4 w-4 text-accent-primary" />
        ) : (
          <Folder className="h-4 w-4 text-text-muted" />
        )}

        {/* Label and path */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium truncate">{node.label || node.name}</span>
            {isReadOnly && (
              <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-warning/20 text-warning text-[10px]">
                <Lock className="h-2.5 w-2.5" />
                read-only
              </span>
            )}
          </div>
          {node.isMount && <div className="text-xs text-text-muted truncate">{node.path}</div>}
        </div>
      </button>

      {/* Children */}
      {isExpanded && hasChildren && (
        <div>
          {node.children.map((child) => (
            <FolderItem
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              expandedPaths={expandedPaths}
              onToggleExpand={onToggleExpand}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function MountPicker({ pod, selectedPath, onSelect }: MountPickerProps) {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

  const folderTree = useMemo(() => {
    return pod.mounts ? buildFolderTree(pod.mounts) : [];
  }, [pod.mounts]);

  const handleToggleExpand = (path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const handleSelect = (path: string) => {
    // Toggle selection
    if (selectedPath === path) {
      onSelect(null);
    } else {
      onSelect(path);
    }
  };

  if (!pod.mounts || pod.mounts.length === 0) {
    return (
      <div className="p-4 rounded-lg border border-border-subtle bg-elevated">
        <div className="flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-warning mt-0.5" />
          <div>
            <h4 className="text-sm font-medium text-text-primary">No Mounts Configured</h4>
            <p className="text-xs text-text-muted mt-1">
              This pod has no allowed mounts configured. The workspace will run in an isolated
              environment.
            </p>
            <p className="text-xs text-text-muted mt-2">
              Configure mounts on your local pod with:
              <code className="block mt-1 p-2 rounded bg-void font-mono text-[11px]">
                podex-local-pod mounts add /path/to/folder
              </code>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border-subtle bg-elevated overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border-subtle bg-surface">
        <div className="flex items-center gap-2">
          <HardDrive className="h-4 w-4 text-accent-primary" />
          <h4 className="text-sm font-medium text-text-primary">Workspace Mount</h4>
        </div>
        <p className="text-xs text-text-muted mt-1">
          Select a folder to mount as your workspace, or leave empty for an isolated environment.
        </p>
      </div>

      {/* None option */}
      <div className="p-2 border-b border-border-subtle">
        <button
          onClick={() => onSelect(null)}
          className={cn(
            'w-full flex items-center gap-2 px-3 py-2 text-left text-sm rounded-lg transition-colors',
            selectedPath === null
              ? 'bg-accent-primary/20 text-accent-primary border border-accent-primary/30'
              : 'hover:bg-overlay text-text-muted'
          )}
        >
          <span className="w-5" />
          <Folder className="h-4 w-4" />
          <div>
            <span className="font-medium">None (isolated workspace)</span>
            <div className="text-xs opacity-70">
              {pod.mode === 'native' ? 'Uses workspace directory' : 'No host mount'}
            </div>
          </div>
        </button>
      </div>

      {/* Mount tree */}
      <div className="p-2 max-h-64 overflow-y-auto">
        {folderTree.map((node) => (
          <FolderItem
            key={node.path}
            node={node}
            depth={0}
            selectedPath={selectedPath}
            expandedPaths={expandedPaths}
            onToggleExpand={handleToggleExpand}
            onSelect={handleSelect}
          />
        ))}
      </div>

      {/* Selected path display */}
      {selectedPath && (
        <div className="px-4 py-2 border-t border-border-subtle bg-surface">
          <div className="text-xs text-text-muted">
            Selected: <code className="px-1 py-0.5 rounded bg-void font-mono">{selectedPath}</code>
          </div>
        </div>
      )}
    </div>
  );
}

export default MountPicker;
