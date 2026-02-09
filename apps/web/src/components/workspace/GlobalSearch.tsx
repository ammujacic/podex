'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Search, X, File, ChevronRight, ChevronDown, Replace, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { searchWorkspace as searchWorkspaceApi } from '@/lib/api';

// ============================================================================
// Types
// ============================================================================

export interface SearchMatch {
  line: number;
  column: number;
  length: number;
  lineContent: string;
  previewStart: number;
  previewEnd: number;
}

export interface FileSearchResult {
  path: string;
  matches: SearchMatch[];
}

export interface SearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
  includePattern: string;
  excludePattern: string;
}

export interface SearchState {
  query: string;
  results: FileSearchResult[];
  totalMatches: number;
  searching: boolean;
  error: string | null;
}

// ============================================================================
// Transform API results to grouped format
// ============================================================================

function transformSearchResults(
  apiResults: Array<{ path: string; line: number; column: number; content: string; match: string }>,
  total: number
): { results: FileSearchResult[]; totalMatches: number } {
  // Group results by file path
  const fileMap = new Map<string, SearchMatch[]>();

  for (const result of apiResults) {
    const matches = fileMap.get(result.path) || [];
    matches.push({
      line: result.line,
      column: result.column,
      length: result.match.length,
      lineContent: result.content,
      previewStart: 0,
      previewEnd: result.content.length,
    });
    fileMap.set(result.path, matches);
  }

  const results: FileSearchResult[] = Array.from(fileMap.entries()).map(([path, matches]) => ({
    path,
    matches,
  }));

  return { results, totalMatches: total };
}

// ============================================================================
// Search Result Item
// ============================================================================

interface SearchResultItemProps {
  result: FileSearchResult;
  expanded: boolean;
  onToggle: () => void;
  onMatchClick: (path: string, line: number, column: number) => void;
}

function SearchResultItem({ result, expanded, onToggle, onMatchClick }: SearchResultItemProps) {
  const fileName = result.path.split('/').pop() || result.path;
  const dirPath = result.path.split('/').slice(0, -1).join('/');

  return (
    <div className="border-b border-border-subtle last:border-0">
      {/* File header */}
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-overlay"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-text-muted" />
        ) : (
          <ChevronRight className="h-4 w-4 text-text-muted" />
        )}
        <File className="h-4 w-4 text-text-secondary" />
        <span className="flex-1 truncate text-sm">
          <span className="text-text-primary">{fileName}</span>
          {dirPath && <span className="ml-2 text-text-muted">{dirPath}</span>}
        </span>
        <span className="rounded-full bg-overlay px-2 py-0.5 text-xs text-text-secondary">
          {result.matches.length}
        </span>
      </button>

      {/* Matches */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            {result.matches.map((match, index) => (
              <button
                key={index}
                onClick={() => onMatchClick(result.path, match.line, match.column)}
                className="flex w-full items-start gap-2 px-3 py-1.5 pl-10 text-left hover:bg-overlay"
              >
                <span className="w-8 shrink-0 text-right text-xs text-text-muted">
                  {match.line}
                </span>
                <span className="flex-1 overflow-hidden font-mono text-xs">
                  <span className="text-text-muted">
                    {match.lineContent.slice(0, match.column - 1)}
                  </span>
                  <span className="rounded bg-accent-warning/30 text-text-primary">
                    {match.lineContent.slice(match.column - 1, match.column - 1 + match.length)}
                  </span>
                  <span className="text-text-muted">
                    {match.lineContent.slice(match.column - 1 + match.length)}
                  </span>
                </span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================================
// Global Search Component
// ============================================================================

interface GlobalSearchProps {
  sessionId: string;
  onResultClick: (path: string, line: number, column: number) => void;
  onClose?: () => void;
  className?: string;
}

export function GlobalSearch({ sessionId, onResultClick, onClose, className }: GlobalSearchProps) {
  const [query, setQuery] = useState('');
  const [replaceQuery, setReplaceQuery] = useState('');
  const [showReplace, setShowReplace] = useState(false);
  const [options, setOptions] = useState<SearchOptions>({
    caseSensitive: false,
    wholeWord: false,
    regex: false,
    includePattern: '',
    excludePattern: 'node_modules,dist,.git,.next',
  });
  const [state, setState] = useState<SearchState>({
    query: '',
    results: [],
    totalMatches: 0,
    searching: false,
    error: null,
  });
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [showOptions, setShowOptions] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounced search
  const performSearch = useCallback(
    async (searchQuery: string) => {
      if (!searchQuery.trim()) {
        setState({
          query: '',
          results: [],
          totalMatches: 0,
          searching: false,
          error: null,
        });
        return;
      }

      setState((s) => ({ ...s, searching: true, error: null }));

      try {
        const response = await searchWorkspaceApi(sessionId, searchQuery, {
          case_sensitive: options.caseSensitive,
          regex: options.regex,
          include: options.includePattern || '*',
          exclude: options.excludePattern || 'node_modules,dist,.git,.next',
        });

        const { results, totalMatches } = transformSearchResults(response.results, response.total);

        setState({
          query: searchQuery,
          results,
          totalMatches,
          searching: false,
          error: null,
        });

        // Expand first few files by default
        setExpandedFiles(new Set(results.slice(0, 3).map((r) => r.path)));
      } catch (error) {
        setState((s) => ({
          ...s,
          searching: false,
          error: error instanceof Error ? error.message : 'Search failed',
        }));
      }
    },
    [sessionId, options]
  );

  // Handle query change with debounce
  const handleQueryChange = useCallback(
    (value: string) => {
      setQuery(value);

      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }

      searchTimeoutRef.current = setTimeout(() => {
        performSearch(value);
      }, 300);
    },
    [performSearch]
  );

  // Toggle file expansion
  const toggleFile = useCallback((path: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  // Toggle option
  const toggleOption = useCallback(
    (key: keyof Pick<SearchOptions, 'caseSensitive' | 'wholeWord' | 'regex'>) => {
      setOptions((prev) => ({ ...prev, [key]: !prev[key] }));
    },
    []
  );

  return (
    <div className={cn('flex h-full flex-col bg-elevated', className)}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border-default px-4 py-3">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-accent-primary" />
          <span className="text-sm font-medium text-text-primary">Search</span>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="rounded p-1 text-text-muted hover:bg-overlay hover:text-text-secondary"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Search input */}
      <div className="space-y-2 border-b border-border-subtle p-4">
        {/* Main search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            placeholder="Search files..."
            className="w-full rounded-md border border-border-default bg-surface py-2 pl-9 pr-20 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-primary focus:outline-none"
          />
          <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
            <button
              onClick={() => toggleOption('caseSensitive')}
              className={cn(
                'rounded px-1.5 py-0.5 text-xs font-mono',
                options.caseSensitive
                  ? 'bg-accent-primary/20 text-accent-primary'
                  : 'text-text-muted hover:bg-overlay'
              )}
              title="Match Case"
            >
              Aa
            </button>
            <button
              onClick={() => toggleOption('wholeWord')}
              className={cn(
                'rounded px-1.5 py-0.5 text-xs',
                options.wholeWord
                  ? 'bg-accent-primary/20 text-accent-primary'
                  : 'text-text-muted hover:bg-overlay'
              )}
              title="Whole Word"
            >
              ab
            </button>
            <button
              onClick={() => toggleOption('regex')}
              className={cn(
                'rounded px-1.5 py-0.5 text-xs font-mono',
                options.regex
                  ? 'bg-accent-primary/20 text-accent-primary'
                  : 'text-text-muted hover:bg-overlay'
              )}
              title="Use Regex"
            >
              .*
            </button>
          </div>
        </div>

        {/* Replace (toggle) */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowReplace(!showReplace)}
            className="text-xs text-text-muted hover:text-text-secondary"
          >
            <Replace className="h-3 w-3" />
          </button>
          {showReplace && (
            <input
              type="text"
              value={replaceQuery}
              onChange={(e) => setReplaceQuery(e.target.value)}
              placeholder="Replace..."
              className="flex-1 rounded-md border border-border-default bg-surface px-3 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-primary focus:outline-none"
            />
          )}
        </div>

        {/* Advanced options toggle */}
        <button
          onClick={() => setShowOptions(!showOptions)}
          className="flex items-center gap-1 text-xs text-text-muted hover:text-text-secondary"
        >
          {showOptions ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          Files to include/exclude
        </button>

        {showOptions && (
          <div className="space-y-2 pl-4">
            <input
              type="text"
              value={options.includePattern}
              onChange={(e) => setOptions((o) => ({ ...o, includePattern: e.target.value }))}
              placeholder="Files to include (e.g., *.ts, src/**)"
              className="w-full rounded border border-border-subtle bg-surface px-2 py-1 text-xs"
            />
            <input
              type="text"
              value={options.excludePattern}
              onChange={(e) => setOptions((o) => ({ ...o, excludePattern: e.target.value }))}
              placeholder="Files to exclude"
              className="w-full rounded border border-border-subtle bg-surface px-2 py-1 text-xs"
            />
          </div>
        )}
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {state.searching && (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="h-5 w-5 animate-spin text-accent-primary" />
          </div>
        )}

        {state.error && <div className="p-4 text-sm text-accent-error">{state.error}</div>}

        {!state.searching && state.results.length === 0 && query && (
          <div className="p-4 text-center text-sm text-text-muted">
            No results found for "{query}"
          </div>
        )}

        {!state.searching && state.results.length > 0 && (
          <>
            <div className="border-b border-border-subtle px-4 py-2 text-xs text-text-muted">
              {state.totalMatches} results in {state.results.length} files
            </div>
            {state.results.map((result) => (
              <SearchResultItem
                key={result.path}
                result={result}
                expanded={expandedFiles.has(result.path)}
                onToggle={() => toggleFile(result.path)}
                onMatchClick={onResultClick}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
