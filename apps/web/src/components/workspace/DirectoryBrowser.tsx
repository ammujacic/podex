'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Folder,
  ChevronRight,
  Home,
  Loader2,
  AlertCircle,
  ArrowUp,
  RefreshCw,
  Eye,
  EyeOff,
  Check,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { browseLocalPodDirectory, type DirectoryEntry } from '@/lib/api';

interface DirectoryBrowserProps {
  podId: string;
  selectedPath: string | null;
  onSelect: (path: string | null) => void;
}

export function DirectoryBrowser({
  podId,
  selectedPath: _selectedPath,
  onSelect,
}: DirectoryBrowserProps) {
  const [currentPath, setCurrentPath] = useState<string>('~');
  const [entries, setEntries] = useState<DirectoryEntry[]>([]);
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);

  const fetchDirectory = useCallback(
    async (path: string) => {
      setLoading(true);
      setError(null);

      try {
        const result = await browseLocalPodDirectory(podId, path, showHidden);

        if (result.error) {
          setError(result.error);
          setEntries([]);
        } else {
          setEntries(result.entries);
          setCurrentPath(result.path);
          setParentPath(result.parent);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to browse directory');
        setEntries([]);
      } finally {
        setLoading(false);
      }
    },
    [podId, showHidden]
  );

  useEffect(() => {
    fetchDirectory(currentPath);
    onSelect(currentPath);
  }, [fetchDirectory, currentPath, onSelect]);

  const handleNavigate = (path: string) => {
    setCurrentPath(path);
    // Auto-select when navigating
    onSelect(path);
  };

  const handleGoUp = () => {
    if (parentPath) {
      setCurrentPath(parentPath);
      // Auto-select when navigating
      onSelect(parentPath);
    }
  };

  const handleGoHome = () => {
    setCurrentPath('~');
    // Auto-select when navigating
    onSelect('~');
  };

  const handleRefresh = () => {
    fetchDirectory(currentPath);
  };

  const handleSelectFolder = (entry: DirectoryEntry) => {
    if (entry.is_dir) {
      // Navigate into the directory (will auto-select via handleNavigate)
      handleNavigate(entry.path);
    }
  };

  // Parse path into breadcrumbs
  const breadcrumbs = currentPath.split('/').filter(Boolean);

  // Only show directories in the list
  const directories = entries.filter((e) => e.is_dir);

  return (
    <div className="rounded-lg border border-border-subtle bg-elevated overflow-hidden flex flex-col max-h-[70vh]">
      {/* Header with navigation */}
      <div className="px-4 py-3 border-b border-border-subtle bg-surface flex-shrink-0">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-medium text-text-primary">Select Workspace Folder</h4>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowHidden(!showHidden)}
              className="p-1.5 rounded hover:bg-overlay text-text-muted"
              title={showHidden ? 'Hide hidden files' : 'Show hidden files'}
            >
              {showHidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
            <button
              onClick={handleRefresh}
              className="p-1.5 rounded hover:bg-overlay text-text-muted"
              title="Refresh"
              disabled={loading}
            >
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            </button>
          </div>
        </div>

        {/* Breadcrumb navigation */}
        <div className="flex items-center gap-1 text-sm overflow-x-auto">
          <button
            onClick={handleGoHome}
            className="flex items-center gap-1 px-2 py-1 rounded hover:bg-overlay text-text-muted"
          >
            <Home className="h-3.5 w-3.5" />
          </button>

          {breadcrumbs.map((crumb, index) => {
            const path = '/' + breadcrumbs.slice(0, index + 1).join('/');
            const isLast = index === breadcrumbs.length - 1;

            return (
              <div key={path} className="flex items-center">
                <ChevronRight className="h-3.5 w-3.5 text-text-muted" />
                <button
                  onClick={() => handleNavigate(path)}
                  className={cn(
                    'px-2 py-1 rounded truncate max-w-[120px]',
                    isLast
                      ? 'text-text-primary font-medium'
                      : 'text-text-muted hover:bg-overlay hover:text-text-primary'
                  )}
                  title={crumb}
                >
                  {crumb}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
          </div>
        ) : error ? (
          <div className="p-4">
            <div className="flex items-start gap-3 text-error">
              <AlertCircle className="h-5 w-5 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium">Unable to browse directory</p>
                <p className="text-xs text-text-muted mt-1">{error}</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-2">
            {/* Go up option */}
            {parentPath && (
              <button
                onClick={handleGoUp}
                className="w-full flex items-center gap-3 px-3 py-2 text-left text-sm rounded-lg hover:bg-overlay text-text-muted"
              >
                <ArrowUp className="h-4 w-4" />
                <span>..</span>
              </button>
            )}

            {/* Directory entries */}
            {directories.length === 0 && !parentPath ? (
              <div className="px-3 py-8 text-center text-text-muted text-sm">
                No folders in this directory
              </div>
            ) : (
              directories.map((entry) => (
                <button
                  key={entry.path}
                  onClick={() => handleSelectFolder(entry)}
                  className="w-full flex items-center gap-3 px-3 py-2 text-left text-sm rounded-lg hover:bg-overlay group"
                >
                  <Folder className="h-4 w-4 text-accent-primary" />
                  <span className="flex-1 truncate text-text-primary">{entry.name}</span>
                  <ChevronRight className="h-4 w-4 text-text-muted opacity-0 group-hover:opacity-100" />
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* Footer with current directory display */}
      <div className="px-4 py-3 border-t border-border-subtle bg-surface flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-text-muted mb-1">Selected workspace directory:</p>
            <code className="text-sm text-accent-primary font-mono truncate block">
              {currentPath}
            </code>
          </div>
          <div className="ml-4 flex items-center gap-2 text-accent-primary">
            <Check className="h-4 w-4" />
          </div>
        </div>
      </div>
    </div>
  );
}

export default DirectoryBrowser;
