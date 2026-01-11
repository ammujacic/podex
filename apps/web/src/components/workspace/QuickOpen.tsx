'use client';

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { Command } from 'cmdk';
import {
  File,
  FileCode,
  FileJson,
  FileText,
  FileType,
  Image,
  Search,
  Clock,
  X,
} from 'lucide-react';
import { useUIStore } from '@/stores/ui';
import { useSessionStore } from '@/stores/session';
import { cn } from '@/lib/utils';
import { listFiles, type FileNode } from '@/lib/api';

interface FlatFileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  depth: number;
}

interface SearchResult extends FlatFileNode {
  score: number;
  matchIndices: number[];
}

// Fuzzy matching algorithm (similar to fzf)
function fuzzyMatch(query: string, text: string): { score: number; indices: number[] } | null {
  const queryLower = query.toLowerCase();
  const textLower = text.toLowerCase();

  let queryIdx = 0;
  let score = 0;
  const indices: number[] = [];
  let lastMatchIdx = -1;
  let consecutiveMatches = 0;

  for (let i = 0; i < textLower.length && queryIdx < queryLower.length; i++) {
    if (textLower[i] === queryLower[queryIdx]) {
      indices.push(i);

      // Bonus for consecutive matches
      if (lastMatchIdx === i - 1) {
        consecutiveMatches++;
        score += 2 * consecutiveMatches;
      } else {
        consecutiveMatches = 0;
        score += 1;
      }

      // Bonus for matching at start of word
      if (
        i === 0 ||
        text[i - 1] === '/' ||
        text[i - 1] === '_' ||
        text[i - 1] === '-' ||
        text[i - 1] === '.'
      ) {
        score += 3;
      }

      // Bonus for matching filename (after last /)
      const lastSlash = text.lastIndexOf('/');
      if (i > lastSlash) {
        score += 1;
      }

      lastMatchIdx = i;
      queryIdx++;
    }
  }

  // All query characters must be found
  if (queryIdx !== queryLower.length) {
    return null;
  }

  // Penalize longer paths slightly
  score -= text.length * 0.01;

  return { score, indices };
}

// Get file icon based on extension
function getFileIcon(path: string) {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  const name = path.split('/').pop() || '';

  // Special files
  if (name === 'package.json' || name === 'tsconfig.json') {
    return <FileJson className="h-4 w-4 text-yellow-500" />;
  }
  if (name.endsWith('.md')) {
    return <FileText className="h-4 w-4 text-blue-400" />;
  }

  // By extension
  switch (ext) {
    case 'ts':
    case 'tsx':
      return <FileCode className="h-4 w-4 text-blue-500" />;
    case 'js':
    case 'jsx':
      return <FileCode className="h-4 w-4 text-yellow-400" />;
    case 'py':
      return <FileCode className="h-4 w-4 text-green-500" />;
    case 'rs':
      return <FileCode className="h-4 w-4 text-orange-500" />;
    case 'go':
      return <FileCode className="h-4 w-4 text-cyan-400" />;
    case 'json':
    case 'jsonc':
      return <FileJson className="h-4 w-4 text-yellow-500" />;
    case 'css':
    case 'scss':
    case 'less':
      return <FileCode className="h-4 w-4 text-pink-400" />;
    case 'html':
      return <FileCode className="h-4 w-4 text-orange-400" />;
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
    case 'webp':
      return <Image className="h-4 w-4 text-purple-400" />;
    case 'yaml':
    case 'yml':
      return <FileType className="h-4 w-4 text-red-400" />;
    default:
      return <File className="h-4 w-4 text-text-muted" />;
  }
}

// Flatten file tree for searching
function flattenFileTree(nodes: FileNode[], basePath = '', depth = 0): FlatFileNode[] {
  const result: FlatFileNode[] = [];

  for (const node of nodes) {
    const path = basePath ? `${basePath}/${node.name}` : node.name;

    if (node.type === 'file') {
      result.push({ name: node.name, path, type: 'file', depth });
    } else if (node.children) {
      // Include directory for navigation but prioritize files
      result.push({ name: node.name, path, type: 'directory', depth });
      result.push(...flattenFileTree(node.children, path, depth + 1));
    }
  }

  return result;
}

// Highlight matched characters
function HighlightedText({ text, indices }: { text: string; indices: number[] }) {
  const indexSet = new Set(indices);
  const chars = text.split('');

  return (
    <span>
      {chars.map((char, i) => (
        <span key={i} className={indexSet.has(i) ? 'text-accent-primary font-semibold' : ''}>
          {char}
        </span>
      ))}
    </span>
  );
}

export function QuickOpen() {
  const { quickOpenOpen, closeQuickOpen } = useUIStore();
  const { currentSessionId, openFilePreview, recentFiles, addRecentFile } = useSessionStore();
  const [search, setSearch] = useState('');
  const [files, setFiles] = useState<FlatFileNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load files when opened - with abort controller to prevent race conditions
  useEffect(() => {
    if (!quickOpenOpen || !currentSessionId) return;

    // Create abort controller to cancel pending requests when deps change
    const abortController = new AbortController();
    let isCancelled = false;

    async function loadFiles() {
      setLoading(true);
      setError(null);
      try {
        const tree = await listFiles(currentSessionId!);

        // Check if this request was cancelled while in-flight
        if (isCancelled) return;

        const flat = flattenFileTree(tree);
        // Filter out directories and common non-code files
        const filtered = flat.filter(
          (f) =>
            f.type === 'file' &&
            !f.path.includes('node_modules') &&
            !f.path.includes('.git/') &&
            !f.path.includes('__pycache__') &&
            !f.path.includes('.next/') &&
            !f.path.includes('dist/') &&
            !f.path.includes('build/')
        );
        setFiles(filtered);
      } catch (err) {
        // Ignore errors from cancelled requests
        if (isCancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load files');
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    }

    loadFiles();

    // Cleanup: mark request as cancelled when deps change or unmount
    return () => {
      isCancelled = true;
      abortController.abort();
    };
  }, [quickOpenOpen, currentSessionId]);

  // Focus input when opened
  useEffect(() => {
    if (quickOpenOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [quickOpenOpen]);

  // Reset search when closed
  useEffect(() => {
    if (!quickOpenOpen) {
      setSearch('');
    }
  }, [quickOpenOpen]);

  // Search and sort results
  const searchResults = useMemo(() => {
    if (!search.trim()) {
      // Show recent files first, then alphabetically
      const recentPaths = new Set(recentFiles || []);
      const recent = files.filter((f) => recentPaths.has(f.path));
      const others = files.filter((f) => !recentPaths.has(f.path));

      return [
        ...recent.map((f) => ({ ...f, score: 1000, matchIndices: [] })),
        ...others.slice(0, 50).map((f) => ({ ...f, score: 0, matchIndices: [] })),
      ];
    }

    const results: SearchResult[] = [];

    for (const file of files) {
      const match = fuzzyMatch(search, file.path);
      if (match) {
        results.push({
          ...file,
          score: match.score,
          matchIndices: match.indices,
        });
      }
    }

    // Sort by score (highest first)
    results.sort((a, b) => b.score - a.score);

    return results.slice(0, 50); // Limit results
  }, [files, search, recentFiles]);

  // Handle file selection
  const handleSelect = useCallback(
    (path: string) => {
      if (currentSessionId) {
        openFilePreview(currentSessionId, path);
        addRecentFile?.(path);
      }
      closeQuickOpen();
    },
    [currentSessionId, openFilePreview, closeQuickOpen, addRecentFile]
  );

  // Close on escape
  useEffect(() => {
    if (!quickOpenOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeQuickOpen();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [quickOpenOpen, closeQuickOpen]);

  if (!quickOpenOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-void/80 backdrop-blur-sm" onClick={closeQuickOpen} />

      {/* Quick open dialog */}
      <Command
        className="relative w-full max-w-2xl rounded-xl border border-border-default bg-surface shadow-2xl overflow-hidden"
        loop
        shouldFilter={false}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 border-b border-border-subtle px-4">
          <Search className="h-5 w-5 text-text-muted" />
          <Command.Input
            ref={inputRef}
            value={search}
            onValueChange={setSearch}
            placeholder="Search files by name..."
            className="flex-1 bg-transparent py-4 text-text-primary placeholder:text-text-muted focus:outline-none"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="p-1 rounded hover:bg-overlay text-text-muted hover:text-text-primary"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          <kbd className="hidden sm:inline-flex rounded bg-elevated px-2 py-0.5 text-xs text-text-muted">
            ⌘P
          </kbd>
        </div>

        {/* Results list */}
        <Command.List className="max-h-[400px] overflow-y-auto p-2">
          {loading && (
            <div className="py-6 text-center text-sm text-text-muted">Loading files...</div>
          )}

          {error && <div className="py-6 text-center text-sm text-red-400">{error}</div>}

          {!loading && !error && searchResults.length === 0 && (
            <Command.Empty className="py-6 text-center text-sm text-text-muted">
              No files found.
            </Command.Empty>
          )}

          {!loading && !error && searchResults.length > 0 && (
            <>
              {/* Show recent files section if no search */}
              {!search.trim() && recentFiles && recentFiles.length > 0 && (
                <div className="px-2 py-1.5 text-xs font-medium text-text-muted uppercase tracking-wider flex items-center gap-2">
                  <Clock className="h-3 w-3" />
                  Recent Files
                </div>
              )}

              {searchResults.map((result) => {
                const isRecent = !search.trim() && recentFiles?.includes(result.path);

                return (
                  <Command.Item
                    key={result.path}
                    value={result.path}
                    onSelect={() => handleSelect(result.path)}
                    className={cn(
                      'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm cursor-pointer',
                      'text-text-secondary hover:bg-overlay hover:text-text-primary',
                      'data-[selected=true]:bg-overlay data-[selected=true]:text-text-primary'
                    )}
                  >
                    {getFileIcon(result.path)}
                    <div className="flex-1 min-w-0">
                      <div className="truncate">
                        {search.trim() && result.matchIndices.length > 0 ? (
                          <HighlightedText text={result.path} indices={result.matchIndices} />
                        ) : (
                          result.path
                        )}
                      </div>
                    </div>
                    {isRecent && <Clock className="h-3 w-3 text-text-muted flex-shrink-0" />}
                  </Command.Item>
                );
              })}
            </>
          )}
        </Command.List>

        {/* Footer with hints */}
        <div className="border-t border-border-subtle px-4 py-2 flex items-center justify-between text-xs text-text-muted">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1">
              <kbd className="rounded bg-elevated px-1.5 py-0.5">↑↓</kbd>
              navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded bg-elevated px-1.5 py-0.5">↵</kbd>
              open
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded bg-elevated px-1.5 py-0.5">esc</kbd>
              close
            </span>
          </div>
          <span>{searchResults.length} files</span>
        </div>
      </Command>
    </div>
  );
}
