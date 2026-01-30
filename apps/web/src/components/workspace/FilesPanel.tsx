'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  ChevronRight,
  ChevronDown,
  Download,
  File,
  Folder,
  FolderOpen,
  Loader2,
  RefreshCw,
  Eye,
  EyeOff,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@podex/ui';
import { useSessionStore } from '@/stores/session';
import { useEditorStore } from '@/stores/editor';
import { useUIStore } from '@/stores/ui';
import { cn } from '@/lib/utils';
import { NoFilesEmptyState, ErrorEmptyState } from '@/components/ui/EmptyState';
import { useIsMobile } from '@/hooks/useIsMobile';
import { getLanguageFromPath } from '@/lib/vscode/languageUtils';
import {
  listFiles,
  getFileContent,
  deleteFile,
  moveFile,
  downloadFile,
  downloadFolder,
  handleWorkspaceError,
  clearWorkspaceError,
  type FileNode,
} from '@/lib/api';
import { MobileFileItem } from './MobileFileItem';
import { MobileFileActionsSheet } from './MobileFileActionsSheet';
import { DirectoryBrowser } from './DirectoryBrowser';
import { updateWorkspaceConfig, getWorkspaceInfo } from '@/lib/api';

interface FilesPanelProps {
  sessionId: string;
  /** If set, this is a local pod workspace */
  localPodId?: string | null;
  /** Current working directory for local pods */
  workingDir?: string | null;
}

interface SyncInfo {
  isSynced: boolean;
  syncType: 'user' | 'session' | null;
}

interface FileTreeNodeProps {
  item: FileNode;
  depth: number;
  sessionId: string;
  onFileClick: (path: string) => void;
  expandedFolders: Set<string>;
  onToggleFolder: (path: string) => void;
  loadedFolders: Map<string, FileNode[]>;
  loadingFolders: Set<string>;
  onLoadFolder: (path: string) => void;
  emptyFolders: Set<string>;
  showHiddenFiles: boolean;
  getSyncInfo: (path: string) => SyncInfo;
  onToggleSync?: (path: string) => void;
}

// Match backend FileSync.exclude_patterns for what is *not* auto-synced.
const NON_SYNCED_SEGMENTS = [
  'node_modules',
  '.git',
  '__pycache__',
  '.venv',
  'venv',
  '.next',
  'dist',
  'build',
  '.cache',
];

// Paths that are always synced regardless of user settings
const SYNCED_PREFIXES = ['projects/', 'projects'];

/**
 * Create a sync info function for project files.
 * Projects directory is always synced, other files are workspace-local.
 */
function createSyncInfoGetter(): (path: string) => SyncInfo {
  return (path: string): SyncInfo => {
    const segments = path.split('/').filter(Boolean);

    // Check if path contains excluded segments
    if (segments.some((segment) => NON_SYNCED_SEGMENTS.includes(segment))) {
      return { isSynced: false, syncType: null };
    }

    // Check if path is under a synced prefix (projects directory)
    const isUnderSyncedPrefix = SYNCED_PREFIXES.some(
      (prefix) => path === prefix || path.startsWith(prefix)
    );

    if (isUnderSyncedPrefix) {
      return { isSynced: true, syncType: 'session' };
    }

    // All other files are workspace-local (not synced)
    return { isSynced: false, syncType: null };
  };
}

function isHiddenFile(name: string): boolean {
  return name.startsWith('.');
}

function sortNodes(items: FileNode[]): FileNode[] {
  return [...items].sort((a, b) => {
    const aIsDir = a.type === 'directory';
    const bIsDir = b.type === 'directory';

    if (aIsDir !== bIsDir) {
      return aIsDir ? -1 : 1;
    }

    return a.name.localeCompare(b.name);
  });
}

function filterFiles(files: FileNode[], showHidden: boolean): FileNode[] {
  const visibleFiles = showHidden ? files : files.filter((file) => !isHiddenFile(file.name));
  return sortNodes(visibleFiles);
}

function FileTreeNode({
  item,
  depth,
  sessionId,
  onFileClick,
  expandedFolders,
  onToggleFolder,
  loadedFolders,
  loadingFolders,
  onLoadFolder,
  emptyFolders,
  showHiddenFiles,
  getSyncInfo,
  onToggleSync,
}: FileTreeNodeProps) {
  const isExpanded = expandedFolders.has(item.path);
  const isLoading = loadingFolders.has(item.path);
  const rawChildren = loadedFolders.get(item.path);
  const children = rawChildren ? filterFiles(rawChildren, showHiddenFiles) : undefined;
  const paddingLeft = 8 + depth * 12; // Base padding + indentation per level
  const isEmptyFolder = emptyFolders.has(item.path);
  const [menuOpen, setMenuOpen] = useState(false);
  const shouldOpenMenuRef = useRef(false);
  const openModal = useUIStore((state) => state.openModal);

  const handleFolderClick = useCallback(() => {
    // Do nothing for folders known to be empty
    if (isEmptyFolder) {
      return;
    }

    if (!isExpanded && !loadedFolders.has(item.path)) {
      // Load folder contents when first expanding
      onLoadFolder(item.path);
    }
    onToggleFolder(item.path);
  }, [isExpanded, isEmptyFolder, item.path, loadedFolders, onLoadFolder, onToggleFolder]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    shouldOpenMenuRef.current = true;
    setMenuOpen(true);
  }, []);

  const handleTriggerPointerDown = useCallback((e: React.PointerEvent) => {
    // Only prevent menu opening on left click, allow right click to open
    if (e.button === 0) {
      // Left click - prevent menu from opening so onClick can toggle folder
      e.preventDefault();
      shouldOpenMenuRef.current = false;
    } else {
      // Right click or other button - allow menu to open
      shouldOpenMenuRef.current = true;
    }
  }, []);

  const handleOpenChange = useCallback((open: boolean) => {
    if (open && !shouldOpenMenuRef.current) {
      // Prevent opening if it wasn't triggered by right click
      return;
    }
    setMenuOpen(open);
    if (!open) {
      // Reset the flag when menu closes
      shouldOpenMenuRef.current = false;
    }
  }, []);

  const handleButtonClick = useCallback(
    (e: React.MouseEvent) => {
      // Prevent menu from opening on left click
      if (e.button === 0 || e.detail > 0) {
        e.preventDefault();
        e.stopPropagation();
        handleFolderClick();
      }
    },
    [handleFolderClick]
  );

  if (item.type === 'directory') {
    const isHidden = isHiddenFile(item.name);
    return (
      <div>
        <DropdownMenu open={menuOpen} onOpenChange={handleOpenChange}>
          <DropdownMenuTrigger asChild>
            <button
              onClick={handleButtonClick}
              onPointerDown={handleTriggerPointerDown}
              onContextMenu={handleContextMenu}
              className={cn(
                'flex w-full items-center gap-1 rounded py-1 pr-2 text-left text-sm hover:bg-overlay',
                isHidden ? 'text-text-secondary hover:text-text-primary' : 'text-text-primary'
              )}
              style={{ paddingLeft }}
              data-file-node="true"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin text-text-muted shrink-0" />
              ) : (
                <span className="shrink-0 w-4 h-4 flex items-center justify-center">
                  {!isEmptyFolder &&
                    (isExpanded ? (
                      <ChevronDown className="h-3.5 w-3.5 text-text-muted" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 text-text-muted" />
                    ))}
                </span>
              )}
              {isExpanded ? (
                <FolderOpen className="h-4 w-4 text-accent-primary shrink-0" />
              ) : (
                <Folder className="h-4 w-4 text-accent-primary shrink-0" />
              )}
              <span
                className={cn(
                  'truncate flex-1 ml-1',
                  isHidden ? 'text-text-secondary' : 'text-text-primary'
                )}
              >
                {item.name}
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuItem onClick={handleFolderClick}>
              {isExpanded ? 'Collapse' : 'Expand'} Folder
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                openModal('new-file', {
                  initialPath: item.path ? `${item.path}/` : '',
                })
              }
            >
              New File...
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                openModal('new-folder', {
                  initialPath: item.path ? `${item.path}/` : '',
                })
              }
            >
              New Folder...
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                downloadFolder(sessionId, item.path).catch((err) => {
                  console.error('Failed to download folder:', err);
                });
              }}
            >
              <Download className="mr-2 h-4 w-4" />
              Download as ZIP
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {isExpanded && children && children.length > 0 && (
          <div>
            {children
              .filter((child) => child.path || child.name)
              .map((child, index) => (
                <FileTreeNode
                  key={child.path || `${item.path}-${index}-${child.name}`}
                  item={child}
                  depth={depth + 1}
                  sessionId={sessionId}
                  onFileClick={onFileClick}
                  expandedFolders={expandedFolders}
                  onToggleFolder={onToggleFolder}
                  loadedFolders={loadedFolders}
                  loadingFolders={loadingFolders}
                  onLoadFolder={onLoadFolder}
                  emptyFolders={emptyFolders}
                  showHiddenFiles={showHiddenFiles}
                  getSyncInfo={getSyncInfo}
                  onToggleSync={onToggleSync}
                />
              ))}
          </div>
        )}
      </div>
    );
  }

  const isHidden = isHiddenFile(item.name);
  return (
    <DropdownMenu open={menuOpen} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          onClick={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            onFileClick(item.path);
          }}
          onPointerDown={(e) => {
            if (e.button === 0) {
              e.preventDefault();
              shouldOpenMenuRef.current = false;
            }
          }}
          onContextMenu={handleContextMenu}
          className={cn(
            'flex w-full items-center gap-1 rounded py-1 pr-2 text-left text-sm hover:bg-overlay',
            isHidden ? 'text-text-secondary hover:text-text-primary' : 'text-text-primary'
          )}
          style={{ paddingLeft: paddingLeft + 20 }} // Extra indent for files (no chevron)
          data-file-node="true"
        >
          <File className="h-4 w-4 text-text-muted shrink-0" />
          <span
            className={cn(
              'truncate flex-1 ml-1',
              isHidden ? 'text-text-secondary' : 'text-text-primary'
            )}
          >
            {item.name}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuItem onClick={() => onFileClick(item.path)}>Open File</DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            const newPath = window.prompt('Rename file', item.path);
            if (!newPath || newPath === item.path) return;
            moveFile(sessionId, item.path, newPath).catch((err) => {
              console.error('Failed to rename file:', err);
            });
          }}
        >
          Rename...
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            const confirmed = window.confirm(`Delete ${item.path}? This cannot be undone.`);
            if (!confirmed) return;
            deleteFile(sessionId, item.path).catch((err) => {
              console.error('Failed to delete file:', err);
            });
          }}
        >
          Delete
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => {
            downloadFile(sessionId, item.path).catch((err) => {
              console.error('Failed to download file:', err);
            });
          }}
        >
          <Download className="mr-2 h-4 w-4" />
          Download
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Mobile-specific file tree node that uses MobileFileItem with swipe gestures
interface MobileFileTreeNodeProps {
  item: FileNode;
  depth: number;
  sessionId: string;
  onFileClick: (path: string) => void;
  onCopyPath: (path: string) => void;
  expandedFolders: Set<string>;
  onToggleFolder: (path: string) => void;
  loadedFolders: Map<string, FileNode[]>;
  loadingFolders: Set<string>;
  onLoadFolder: (path: string) => void;
  emptyFolders: Set<string>;
  showHiddenFiles: boolean;
  getSyncInfo: (path: string) => SyncInfo;
  onToggleSync?: (path: string) => void;
}

function MobileFileTreeNode({
  item,
  depth,
  sessionId,
  onFileClick,
  onCopyPath,
  expandedFolders,
  onToggleFolder,
  loadedFolders,
  loadingFolders,
  onLoadFolder,
  emptyFolders,
  showHiddenFiles,
  getSyncInfo,
  onToggleSync,
}: MobileFileTreeNodeProps) {
  const isExpanded = expandedFolders.has(item.path);
  const isLoading = loadingFolders.has(item.path);
  const rawChildren = loadedFolders.get(item.path);
  const children = rawChildren ? filterFiles(rawChildren, showHiddenFiles) : undefined;
  const isEmptyFolder = emptyFolders.has(item.path);

  const handleToggleFolder = useCallback(() => {
    // Don't attempt to load or expand folders known to be empty
    if (isEmptyFolder) {
      return;
    }

    if (!isExpanded && !loadedFolders.has(item.path)) {
      onLoadFolder(item.path);
    }
    onToggleFolder(item.path);
  }, [isExpanded, isEmptyFolder, item.path, loadedFolders, onLoadFolder, onToggleFolder]);

  return (
    <MobileFileItem
      item={item}
      depth={depth}
      sessionId={sessionId}
      onFileClick={onFileClick}
      onCopyPath={onCopyPath}
      isExpanded={isExpanded}
      isLoading={isLoading}
      onToggleFolder={isEmptyFolder ? undefined : handleToggleFolder}
      getSyncInfo={getSyncInfo}
      onToggleSync={onToggleSync}
    >
      {item.type === 'directory' && isExpanded && children && children.length > 0 && (
        <>
          {children
            .filter((child) => child.path || child.name)
            .map((child, index) => (
              <MobileFileTreeNode
                key={child.path || `${item.path}-${index}-${child.name}`}
                item={child}
                depth={depth + 1}
                sessionId={sessionId}
                onFileClick={onFileClick}
                onCopyPath={onCopyPath}
                expandedFolders={expandedFolders}
                onToggleFolder={onToggleFolder}
                loadedFolders={loadedFolders}
                loadingFolders={loadingFolders}
                onLoadFolder={onLoadFolder}
                emptyFolders={emptyFolders}
                showHiddenFiles={showHiddenFiles}
                getSyncInfo={getSyncInfo}
              />
            ))}
        </>
      )}
    </MobileFileItem>
  );
}

export function FilesPanel({ sessionId, localPodId, workingDir }: FilesPanelProps) {
  const { sessions, createEditorGridCard } = useSessionStore();
  const openTab = useEditorStore((s) => s.openTab);
  const openMobileFile = useUIStore((state) => state.openMobileFile);
  const closeMobileWidget = useUIStore((state) => state.closeMobileWidget);
  const isMobile = useIsMobile();
  const session = sessions[sessionId];
  const editorGridCardId = session?.editorGridCardId;
  const [rootFiles, setRootFiles] = useState<FileNode[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);

  // Local pod directory selector state
  const isLocalPod = !!localPodId;
  const [showDirSelector, setShowDirSelector] = useState(false);
  const [currentWorkingDir, setCurrentWorkingDir] = useState<string | null>(workingDir ?? null);
  const [changingDir, setChangingDir] = useState(false);
  const updateSessionInfo = useSessionStore((state) => state.updateSessionInfo);

  // Sync currentWorkingDir from prop if it changes externally
  useEffect(() => {
    if (workingDir && workingDir !== currentWorkingDir) {
      setCurrentWorkingDir(workingDir);
    }
  }, [workingDir, currentWorkingDir]);

  // Fetch workspace info on mount if local pod and no working dir
  useEffect(() => {
    if (isLocalPod && !workingDir && !currentWorkingDir) {
      getWorkspaceInfo(sessionId)
        .then((info) => {
          const dir = info.working_dir || info.mount_path;
          if (dir) {
            setCurrentWorkingDir(dir);
            // Also update session store so it persists
            updateSessionInfo(sessionId, { mount_path: dir });
          }
        })
        .catch((err) => {
          console.error('Failed to fetch workspace info:', err);
        });
    }
  }, [isLocalPod, workingDir, currentWorkingDir, sessionId, updateSessionInfo]);

  // Tree expansion state
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [loadedFolders, setLoadedFolders] = useState<Map<string, FileNode[]>>(new Map());
  const [loadingFolders, setLoadingFolders] = useState<Set<string>>(new Set());
  const [emptyFolders, setEmptyFolders] = useState<Set<string>>(new Set());
  const showHiddenFiles = useUIStore((state) => state.showHiddenFiles);
  const setShowHiddenFiles = useUIStore((state) => state.setShowHiddenFiles);
  const openModal = useUIStore((state) => state.openModal);
  const [rootMenuOpen, setRootMenuOpen] = useState(false);
  const [rootMenuPosition, setRootMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const rootContainerRef = useRef<HTMLDivElement | null>(null);

  // Create sync info getter (projects directory is always synced)
  const getSyncInfo = useMemo(() => createSyncInfoGetter(), []);

  const loadRootFiles = useCallback(async () => {
    setFilesLoading(true);
    setFilesError(null);
    try {
      const fileTree = await listFiles(sessionId, '.');
      setRootFiles(fileTree);
      // Clear any previous workspace error on success
      clearWorkspaceError(sessionId);
    } catch (err) {
      // Check if this is a workspace unavailability error (503/500)
      if (handleWorkspaceError(err, sessionId)) {
        setFilesError('Workspace unavailable');
      } else {
        setFilesError(err instanceof Error ? err.message : 'Failed to load files');
      }
    } finally {
      setFilesLoading(false);
      setHasLoaded(true);
    }
  }, [sessionId]);

  const loadFolder = useCallback(
    async (path: string) => {
      setLoadingFolders((prev) => new Set(prev).add(path));
      try {
        const folderContents = await listFiles(sessionId, path);
        setLoadedFolders((prev) => new Map(prev).set(path, folderContents));

        setEmptyFolders((prev) => {
          const next = new Set(prev);
          if (folderContents.length === 0) {
            next.add(path);
          } else {
            next.delete(path);
          }
          return next;
        });

        if (folderContents.length === 0) {
          // Ensure empty folders are not left expanded
          setExpandedFolders((prev) => {
            const next = new Set(prev);
            next.delete(path);
            return next;
          });
        }
      } catch (err) {
        console.error(`Failed to load folder ${path}:`, err);
        // Set empty array on error so user can try again
        setLoadedFolders((prev) => new Map(prev).set(path, []));
      } finally {
        setLoadingFolders((prev) => {
          const next = new Set(prev);
          next.delete(path);
          return next;
        });
      }
    },
    [sessionId]
  );

  const handleToggleFolder = useCallback((path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const handleRefresh = useCallback(async () => {
    // Preserve expanded folders while refreshing contents
    const currentlyExpanded = new Set(expandedFolders);

    // Clear loaded folder contents but keep expanded state
    setLoadedFolders(new Map());
    setLoadingFolders(new Set());

    // Reload root files
    setFilesLoading(true);
    setFilesError(null);
    try {
      const fileTree = await listFiles(sessionId, '.');
      setRootFiles(fileTree);

      // Reload contents for all expanded folders
      for (const path of currentlyExpanded) {
        try {
          const folderContents = await listFiles(sessionId, path);
          setLoadedFolders((prev) => new Map(prev).set(path, folderContents));
        } catch (err) {
          console.error(`Failed to reload folder ${path}:`, err);
          // Remove from expanded if we can't load it
          setExpandedFolders((prev) => {
            const next = new Set(prev);
            next.delete(path);
            return next;
          });
        }
      }
    } catch (err) {
      setFilesError(err instanceof Error ? err.message : 'Failed to load files');
    } finally {
      setFilesLoading(false);
    }
  }, [expandedFolders, sessionId]);

  useEffect(() => {
    if (!hasLoaded && !filesLoading) {
      loadRootFiles();
    }
  }, [hasLoaded, filesLoading, loadRootFiles]);

  const handleFileClick = useCallback(
    async (path: string) => {
      try {
        const fileContent = await getFileContent(sessionId, path);

        if (isMobile) {
          // On mobile, use the mobile file viewer
          closeMobileWidget(); // Close the files widget first
          openMobileFile(fileContent.path, fileContent.content, fileContent.language);
        } else {
          // On desktop, open file as a tab in the consolidated editor
          // Create the editor grid card if it doesn't exist
          if (!editorGridCardId) {
            createEditorGridCard(sessionId);
          }

          // Open file as a tab in the editor store
          const fileName = fileContent.path.split('/').pop() || fileContent.path;
          openTab({
            path: fileContent.path,
            name: fileName,
            language: fileContent.language,
            isDirty: false,
            isPreview: true, // Single-click opens as preview
            paneId: 'main',
          });
        }
      } catch (err) {
        console.error('Failed to load file content:', err);
        const errorContent = `// Failed to load content for ${path}`;
        const language = getLanguageFromPath(path);

        if (isMobile) {
          closeMobileWidget();
          openMobileFile(path, errorContent, language);
        } else {
          // Still try to open in editor even on error
          if (!editorGridCardId) {
            createEditorGridCard(sessionId);
          }

          const fileName = path.split('/').pop() || path;
          openTab({
            path,
            name: fileName,
            language,
            isDirty: false,
            isPreview: true,
            paneId: 'main',
          });
        }
      }
    },
    [
      sessionId,
      editorGridCardId,
      createEditorGridCard,
      openTab,
      isMobile,
      openMobileFile,
      closeMobileWidget,
    ]
  );

  // Copy file path to clipboard
  const handleCopyPath = useCallback(async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
    } catch (err) {
      console.error('Failed to copy path:', err);
    }
  }, []);

  // Handle open from actions sheet
  const handleOpenFromSheet = useCallback(
    (path: string) => {
      handleFileClick(path);
    },
    [handleFileClick]
  );

  // Handle working directory change for local pods
  const handleWorkingDirChange = useCallback(
    async (newPath: string | null) => {
      if (!newPath || !isLocalPod) return;

      setChangingDir(true);
      try {
        const result = await updateWorkspaceConfig(sessionId, newPath);
        if (result.success) {
          const updatedPath = result.working_dir ?? newPath;
          setCurrentWorkingDir(updatedPath);
          setShowDirSelector(false);
          // Update session store so mount_path is persisted
          updateSessionInfo(sessionId, { mount_path: updatedPath });
          // Clear loaded data and reload
          setExpandedFolders(new Set());
          setLoadedFolders(new Map());
          setHasLoaded(false);
          await loadRootFiles();
        } else {
          setFilesError(result.error ?? 'Failed to change directory');
        }
      } catch (err) {
        setFilesError(err instanceof Error ? err.message : 'Failed to change directory');
      } finally {
        setChangingDir(false);
      }
    },
    [sessionId, isLocalPod, loadRootFiles, updateSessionInfo]
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-border-subtle px-3 py-2 shrink-0">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-text-muted uppercase tracking-wide">
            Explorer
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowHiddenFiles(!showHiddenFiles)}
              className={cn(
                'shrink-0 p-1 rounded hover:bg-overlay',
                showHiddenFiles ? 'text-text-primary' : 'text-text-muted hover:text-text-primary'
              )}
              title={showHiddenFiles ? 'Hide hidden files' : 'Show hidden files'}
            >
              {showHiddenFiles ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
            </button>
            <button
              onClick={handleRefresh}
              disabled={filesLoading || changingDir}
              className="shrink-0 p-1 rounded text-text-muted hover:text-text-primary hover:bg-overlay disabled:opacity-50"
              title="Refresh"
            >
              <RefreshCw
                className={cn('h-4 w-4', (filesLoading || changingDir) && 'animate-spin')}
              />
            </button>
          </div>
        </div>

        {/* Local pod working directory selector */}
        {isLocalPod && localPodId && (
          <div className="mt-2">
            <button
              onClick={() => setShowDirSelector(!showDirSelector)}
              className="flex items-center gap-1 w-full text-left px-2 py-1 rounded bg-surface-hover hover:bg-overlay text-xs"
              title={currentWorkingDir || workingDir || 'Select workspace directory'}
            >
              <Folder className="h-3.5 w-3.5 text-accent-primary shrink-0" />
              <span className="truncate flex-1 text-text-primary font-mono">
                {currentWorkingDir || workingDir
                  ? (currentWorkingDir || workingDir || '').split('/').pop() ||
                    currentWorkingDir ||
                    workingDir
                  : '(select directory)'}
              </span>
              <ChevronDown
                className={cn(
                  'h-3.5 w-3.5 text-text-muted shrink-0 transition-transform',
                  showDirSelector && 'rotate-180'
                )}
              />
            </button>

            {/* Directory browser dropdown */}
            {showDirSelector && (
              <div className="mt-2">
                <DirectoryBrowser
                  podId={localPodId}
                  selectedPath={currentWorkingDir || workingDir || null}
                  onSelect={handleWorkingDirChange}
                />
              </div>
            )}
          </div>
        )}
      </div>
      {/* File tree */}
      <DropdownMenu
        open={rootMenuOpen}
        onOpenChange={(open) => {
          setRootMenuOpen(open);
          if (!open) {
            setRootMenuPosition(null);
          }
        }}
      >
        <div
          ref={rootContainerRef}
          className="flex-1 overflow-y-auto py-1 relative"
          onContextMenu={(e) => {
            // Let file/folder nodes handle their own context menus
            if ((e.target as HTMLElement).closest('[data-file-node]')) {
              return;
            }
            e.preventDefault();

            const container = rootContainerRef.current;
            if (!container) return;

            const rect = container.getBoundingClientRect();
            setRootMenuPosition({
              x: e.clientX - rect.left,
              y: e.clientY - rect.top,
            });
            setRootMenuOpen(true);
          }}
        >
          {rootMenuOpen && rootMenuPosition && (
            <DropdownMenuTrigger asChild>
              <div
                style={{
                  position: 'absolute',
                  left: rootMenuPosition.x,
                  top: rootMenuPosition.y,
                  width: 0,
                  height: 0,
                }}
              />
            </DropdownMenuTrigger>
          )}
          {filesLoading && rootFiles.length === 0 ? (
            <div className="flex items-center justify-center h-24">
              <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
            </div>
          ) : filesError ? (
            <ErrorEmptyState message={filesError} onRetry={handleRefresh} size="sm" />
          ) : rootFiles.length === 0 ? (
            <NoFilesEmptyState size="sm" />
          ) : isMobile ? (
            // Mobile: Use swipeable file items
            filterFiles(rootFiles, showHiddenFiles)
              .filter((item) => item.path || item.name)
              .map((item, index) => (
                <MobileFileTreeNode
                  key={item.path || `file-${index}-${item.name}`}
                  item={item}
                  depth={0}
                  sessionId={sessionId}
                  onFileClick={handleFileClick}
                  onCopyPath={handleCopyPath}
                  expandedFolders={expandedFolders}
                  onToggleFolder={handleToggleFolder}
                  loadedFolders={loadedFolders}
                  loadingFolders={loadingFolders}
                  onLoadFolder={loadFolder}
                  emptyFolders={emptyFolders}
                  showHiddenFiles={showHiddenFiles}
                  getSyncInfo={getSyncInfo}
                />
              ))
          ) : (
            // Desktop: Use regular file tree
            filterFiles(rootFiles, showHiddenFiles)
              .filter((item) => item.path || item.name)
              .map((item, index) => (
                <FileTreeNode
                  key={item.path || `file-${index}-${item.name}`}
                  item={item}
                  depth={0}
                  sessionId={sessionId}
                  onFileClick={handleFileClick}
                  expandedFolders={expandedFolders}
                  onToggleFolder={handleToggleFolder}
                  loadedFolders={loadedFolders}
                  loadingFolders={loadingFolders}
                  onLoadFolder={loadFolder}
                  emptyFolders={emptyFolders}
                  showHiddenFiles={showHiddenFiles}
                  getSyncInfo={getSyncInfo}
                />
              ))
          )}
        </div>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuItem
            onClick={() => {
              openModal('new-file', { initialPath: '' });
              setRootMenuOpen(false);
            }}
          >
            New File...
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              openModal('new-folder', { initialPath: '' });
              setRootMenuOpen(false);
            }}
          >
            New Folder...
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => {
              setRootMenuOpen(false);
              handleRefresh();
            }}
          >
            Refresh
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              setRootMenuOpen(false);
              downloadFolder(sessionId, '.').catch((err) => {
                console.error('Failed to download workspace:', err);
              });
            }}
          >
            <Download className="mr-2 h-4 w-4" />
            Download Workspace
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Mobile file actions sheet */}
      {isMobile && (
        <MobileFileActionsSheet
          sessionId={sessionId}
          onOpen={handleOpenFromSheet}
          onCopyPath={handleCopyPath}
          getSyncInfo={getSyncInfo}
        />
      )}
    </div>
  );
}
