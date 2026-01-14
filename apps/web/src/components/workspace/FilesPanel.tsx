'use client';

import { useState, useCallback, useEffect } from 'react';
import {
  ChevronRight,
  File,
  Folder,
  FolderTree,
  Home,
  Loader2,
  RefreshCw,
  CloudSync,
} from 'lucide-react';
import { useSessionStore, type FilePreview } from '@/stores/session';
import { cn } from '@/lib/utils';
import { getLanguageFromPath } from './CodeEditor';
import { listFiles, getFileContent, type FileNode } from '@/lib/api';

interface FilesPanelProps {
  sessionId: string;
}

interface FileTreeNodeProps {
  item: FileNode;
  onFileClick: (path: string) => void;
  onFolderClick: (path: string) => void;
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

function isPathAutoSynced(path: string): boolean {
  const segments = path.split('/').filter(Boolean);
  return !segments.some((segment) => NON_SYNCED_SEGMENTS.includes(segment));
}

function FileTreeNode({ item, onFileClick, onFolderClick }: FileTreeNodeProps) {
  const isSynced = isPathAutoSynced(item.path || item.name || '');

  if (item.type === 'directory') {
    return (
      <button
        onClick={() => onFolderClick(item.path)}
        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-text-secondary hover:bg-overlay hover:text-text-primary"
      >
        <Folder className="h-4 w-4 text-accent-primary shrink-0" />
        <span className="truncate flex-1">{item.name}</span>
        {isSynced && (
          <CloudSync
            className="ml-1 h-3 w-3 text-accent-secondary opacity-70"
            aria-label="Auto-synced by Podex"
          />
        )}
      </button>
    );
  }

  return (
    <button
      onClick={() => onFileClick(item.path)}
      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-text-secondary hover:bg-overlay hover:text-text-primary"
    >
      <File className="h-4 w-4 text-text-muted shrink-0" />
      <span className="truncate flex-1">{item.name}</span>
      {isSynced && (
        <CloudSync
          className="ml-1 h-3 w-3 text-accent-secondary opacity-70"
          aria-label="Auto-synced by Podex"
        />
      )}
    </button>
  );
}

export function FilesPanel({ sessionId }: FilesPanelProps) {
  const { openFilePreview } = useSessionStore();
  const [files, setFiles] = useState<FileNode[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [currentPath, setCurrentPath] = useState('.');

  const loadFiles = useCallback(async () => {
    setFilesLoading(true);
    setFilesError(null);
    try {
      const fileTree = await listFiles(sessionId, currentPath);
      setFiles(fileTree);
    } catch (err) {
      setFilesError(err instanceof Error ? err.message : 'Failed to load files');
    } finally {
      setFilesLoading(false);
      setHasLoaded(true);
    }
  }, [sessionId, currentPath]);

  useEffect(() => {
    if (!hasLoaded && !filesLoading) {
      loadFiles();
    }
  }, [hasLoaded, filesLoading, loadFiles]);

  const navigateTo = useCallback((path: string) => {
    setCurrentPath(path);
    setHasLoaded(false); // Reset to trigger reload
  }, []);

  // Build breadcrumb parts from current path
  const pathParts = currentPath === '.' ? [] : currentPath.split('/').filter(Boolean);
  const breadcrumbs = pathParts.map((part, index) => ({
    label: part,
    path: pathParts.slice(0, index + 1).join('/'),
  }));

  const handleFileClick = useCallback(
    async (path: string) => {
      try {
        const fileContent = await getFileContent(sessionId, path);

        const preview: FilePreview = {
          id: `preview-${Date.now()}`,
          path: fileContent.path,
          content: fileContent.content,
          language: fileContent.language,
          pinned: false,
          position: { x: 100 + Math.random() * 200, y: 100 + Math.random() * 100 },
          docked: false,
        };

        openFilePreview(sessionId, preview);
      } catch (err) {
        console.error('Failed to load file content:', err);
        const preview: FilePreview = {
          id: `preview-${Date.now()}`,
          path,
          content: `// Failed to load content for ${path}`,
          language: getLanguageFromPath(path),
          pinned: false,
          position: { x: 100 + Math.random() * 200, y: 100 + Math.random() * 100 },
          docked: false,
        };
        openFilePreview(sessionId, preview);
      }
    },
    [sessionId, openFilePreview]
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header with breadcrumb navigation */}
      <div className="border-b border-border-subtle px-3 py-2 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1 text-sm min-w-0 flex-1 overflow-hidden">
          {/* Home button */}
          <button
            onClick={() => navigateTo('.')}
            className={cn(
              'shrink-0 p-1 rounded hover:bg-overlay',
              currentPath === '.'
                ? 'text-accent-primary'
                : 'text-text-muted hover:text-text-primary'
            )}
            title="Home"
          >
            <Home className="h-4 w-4" />
          </button>
          {/* Breadcrumb path */}
          {breadcrumbs.map((crumb, index) => (
            <div key={crumb.path} className="flex items-center gap-1 min-w-0">
              <ChevronRight className="h-3 w-3 text-text-muted shrink-0" />
              <button
                onClick={() => navigateTo(crumb.path)}
                className={cn(
                  'truncate hover:text-accent-primary',
                  index === breadcrumbs.length - 1
                    ? 'text-text-primary font-medium'
                    : 'text-text-secondary'
                )}
              >
                {crumb.label}
              </button>
            </div>
          ))}
        </div>
        <button
          onClick={loadFiles}
          disabled={filesLoading}
          className="shrink-0 p-1 rounded text-text-muted hover:text-text-primary hover:bg-overlay disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw className={cn('h-4 w-4', filesLoading && 'animate-spin')} />
        </button>
      </div>
      {/* File list */}
      <div className="flex-1 overflow-y-auto p-2">
        {filesLoading && files.length === 0 ? (
          <div className="flex items-center justify-center h-24">
            <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
          </div>
        ) : filesError ? (
          <div className="p-4 text-center">
            <p className="text-accent-error text-sm mb-2">{filesError}</p>
            <button onClick={loadFiles} className="text-sm text-accent-primary hover:underline">
              Retry
            </button>
          </div>
        ) : files.length === 0 ? (
          <div className="p-4 text-center text-text-muted text-sm">
            <FolderTree className="mx-auto mb-2 h-8 w-8 opacity-50" />
            <p>Empty folder</p>
          </div>
        ) : (
          files
            .filter((item) => item.path || item.name) // Filter out items without path or name
            .map((item, index) => (
              <FileTreeNode
                key={item.path || `file-${index}-${item.name}`}
                item={item}
                onFileClick={handleFileClick}
                onFolderClick={navigateTo}
              />
            ))
        )}
      </div>
    </div>
  );
}
