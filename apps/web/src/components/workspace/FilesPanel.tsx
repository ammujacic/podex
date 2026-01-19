'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  ChevronRight,
  ChevronDown,
  File,
  Folder,
  FolderOpen,
  Loader2,
  RefreshCw,
  CloudSync,
  Eye,
  EyeOff,
} from 'lucide-react';
import { useSessionStore } from '@/stores/session';
import { useEditorStore } from '@/stores/editor';
import { useUIStore } from '@/stores/ui';
import { cn } from '@/lib/utils';
import { NoFilesEmptyState, ErrorEmptyState, EmptyFolderState } from '@/components/ui/EmptyState';
import { useIsMobile } from '@/hooks/useIsMobile';
import { getLanguageFromPath } from './CodeEditor';
import { listFiles, getFileContent, type FileNode } from '@/lib/api';
import { getUserConfig } from '@/lib/api/user-config';
import { MobileFileItem } from './MobileFileItem';
import { MobileFileActionsSheet } from './MobileFileActionsSheet';

interface FilesPanelProps {
  sessionId: string;
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
  showHiddenFiles: boolean;
  isPathSynced: (path: string) => boolean;
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

// Default dotfiles (used when user config not available)
const DEFAULT_DOTFILES = [
  '.bashrc',
  '.zshrc',
  '.gitconfig',
  '.npmrc',
  '.vimrc',
  '.profile',
  '.config/starship.toml',
  '.ssh/config',
  '.claude/',
  '.claude.json',
  '.codex/',
  '.gemini/',
  '.opencode/',
];

/**
 * Create a sync checker function based on user's dotfiles_paths
 */
function createSyncChecker(dotfilesPaths: string[]): (path: string) => boolean {
  // Separate directories (ending with /) from files
  const directories = dotfilesPaths.filter((p) => p.endsWith('/'));
  const files = dotfilesPaths.filter((p) => !p.endsWith('/'));

  return (path: string): boolean => {
    const segments = path.split('/').filter(Boolean);

    // Check if path contains excluded segments
    if (segments.some((segment) => NON_SYNCED_SEGMENTS.includes(segment))) {
      return false;
    }

    // Check if path is under a synced prefix (projects directory)
    const isUnderSyncedPrefix = SYNCED_PREFIXES.some(
      (prefix) => path === prefix || path.startsWith(prefix)
    );

    // Check if path is a synced directory or inside one
    const isInSyncedDirectory = directories.some((dir) => {
      const dirWithoutSlash = dir.slice(0, -1);
      return (
        path === dirWithoutSlash || path.startsWith(dir) || path.startsWith(dirWithoutSlash + '/')
      );
    });

    // Check if path is a synced file
    const isSyncedFile = files.some((file) => path === file);

    return isUnderSyncedPrefix || isInSyncedDirectory || isSyncedFile;
  };
}

function isHiddenFile(name: string): boolean {
  return name.startsWith('.');
}

function filterFiles(files: FileNode[], showHidden: boolean): FileNode[] {
  if (showHidden) return files;
  return files.filter((file) => !isHiddenFile(file.name));
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
  showHiddenFiles,
  isPathSynced,
}: FileTreeNodeProps) {
  const isSynced = isPathSynced(item.path || item.name || '');
  const isExpanded = expandedFolders.has(item.path);
  const isLoading = loadingFolders.has(item.path);
  const rawChildren = loadedFolders.get(item.path);
  const children = rawChildren ? filterFiles(rawChildren, showHiddenFiles) : undefined;
  const paddingLeft = 8 + depth * 12; // Base padding + indentation per level

  const handleFolderClick = useCallback(() => {
    if (!isExpanded && !loadedFolders.has(item.path)) {
      // Load folder contents when first expanding
      onLoadFolder(item.path);
    }
    onToggleFolder(item.path);
  }, [isExpanded, item.path, loadedFolders, onLoadFolder, onToggleFolder]);

  if (item.type === 'directory') {
    return (
      <div>
        <button
          onClick={handleFolderClick}
          className="flex w-full items-center gap-1 rounded py-1 pr-2 text-left text-sm text-text-secondary hover:bg-overlay hover:text-text-primary"
          style={{ paddingLeft }}
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-text-muted shrink-0" />
          ) : (
            <span className="shrink-0 w-4 h-4 flex items-center justify-center">
              {isExpanded ? (
                <ChevronDown className="h-3.5 w-3.5 text-text-muted" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 text-text-muted" />
              )}
            </span>
          )}
          {isExpanded ? (
            <FolderOpen className="h-4 w-4 text-accent-primary shrink-0" />
          ) : (
            <Folder className="h-4 w-4 text-accent-primary shrink-0" />
          )}
          <span className="truncate flex-1 ml-1">{item.name}</span>
          {isSynced && (
            <CloudSync
              className="h-3 w-3 text-accent-secondary opacity-70 shrink-0"
              aria-label="Auto-synced by Podex"
            />
          )}
        </button>
        {isExpanded && children && (
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
                  showHiddenFiles={showHiddenFiles}
                  isPathSynced={isPathSynced}
                />
              ))}
            {children.length === 0 && <EmptyFolderState size="sm" />}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={() => onFileClick(item.path)}
      className="flex w-full items-center gap-1 rounded py-1 pr-2 text-left text-sm text-text-secondary hover:bg-overlay hover:text-text-primary"
      style={{ paddingLeft: paddingLeft + 20 }} // Extra indent for files (no chevron)
    >
      <File className="h-4 w-4 text-text-muted shrink-0" />
      <span className="truncate flex-1 ml-1">{item.name}</span>
      {isSynced && (
        <CloudSync
          className="h-3 w-3 text-accent-secondary opacity-70 shrink-0"
          aria-label="Auto-synced by Podex"
        />
      )}
    </button>
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
  showHiddenFiles: boolean;
  isPathSynced: (path: string) => boolean;
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
  showHiddenFiles,
  isPathSynced,
}: MobileFileTreeNodeProps) {
  const isExpanded = expandedFolders.has(item.path);
  const isLoading = loadingFolders.has(item.path);
  const rawChildren = loadedFolders.get(item.path);
  const children = rawChildren ? filterFiles(rawChildren, showHiddenFiles) : undefined;

  const handleToggleFolder = useCallback(() => {
    if (!isExpanded && !loadedFolders.has(item.path)) {
      onLoadFolder(item.path);
    }
    onToggleFolder(item.path);
  }, [isExpanded, item.path, loadedFolders, onLoadFolder, onToggleFolder]);

  return (
    <MobileFileItem
      item={item}
      depth={depth}
      sessionId={sessionId}
      onFileClick={onFileClick}
      onCopyPath={onCopyPath}
      isExpanded={isExpanded}
      isLoading={isLoading}
      onToggleFolder={handleToggleFolder}
      isPathSynced={isPathSynced}
    >
      {item.type === 'directory' && isExpanded && children && (
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
                showHiddenFiles={showHiddenFiles}
                isPathSynced={isPathSynced}
              />
            ))}
          {children.length === 0 && <EmptyFolderState size="sm" />}
        </>
      )}
    </MobileFileItem>
  );
}

export function FilesPanel({ sessionId }: FilesPanelProps) {
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

  // Tree expansion state
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [loadedFolders, setLoadedFolders] = useState<Map<string, FileNode[]>>(new Map());
  const [loadingFolders, setLoadingFolders] = useState<Set<string>>(new Set());
  const [showHiddenFiles, setShowHiddenFiles] = useState(false);

  // User's dotfiles sync configuration
  const [userDotfilesPaths, setUserDotfilesPaths] = useState<string[]>(DEFAULT_DOTFILES);

  // Fetch user config on mount
  useEffect(() => {
    getUserConfig()
      .then((config) => {
        if (config?.dotfiles_paths && config.dotfiles_paths.length > 0) {
          setUserDotfilesPaths(config.dotfiles_paths);
        }
      })
      .catch(() => {
        // Use defaults if config fetch fails
      });
  }, []);

  // Create sync checker based on user's settings
  const isPathSynced = useMemo(() => createSyncChecker(userDotfilesPaths), [userDotfilesPaths]);

  const loadRootFiles = useCallback(async () => {
    setFilesLoading(true);
    setFilesError(null);
    try {
      const fileTree = await listFiles(sessionId, '.');
      setRootFiles(fileTree);
    } catch (err) {
      setFilesError(err instanceof Error ? err.message : 'Failed to load files');
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

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-border-subtle px-3 py-2 flex items-center justify-between shrink-0">
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
            disabled={filesLoading}
            className="shrink-0 p-1 rounded text-text-muted hover:text-text-primary hover:bg-overlay disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw className={cn('h-4 w-4', filesLoading && 'animate-spin')} />
          </button>
        </div>
      </div>
      {/* File tree */}
      <div className="flex-1 overflow-y-auto py-1">
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
                showHiddenFiles={showHiddenFiles}
                isPathSynced={isPathSynced}
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
                showHiddenFiles={showHiddenFiles}
                isPathSynced={isPathSynced}
              />
            ))
        )}
      </div>

      {/* Mobile file actions sheet */}
      {isMobile && (
        <MobileFileActionsSheet
          sessionId={sessionId}
          onOpen={handleOpenFromSheet}
          onCopyPath={handleCopyPath}
        />
      )}
    </div>
  );
}
