'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  Search,
  X,
  ChevronDown,
  ChevronRight,
  File,
  Replace,
  RefreshCw,
  Filter,
  FolderOpen,
  FolderX,
  CaseSensitive,
  WholeWord,
  Regex,
  Loader2,
  Check,
  AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { create } from 'zustand';

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
  filePath: string;
  fileName: string;
  matches: SearchMatch[];
}

export interface SearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  useRegex: boolean;
  includePattern: string;
  excludePattern: string;
}

// ============================================================================
// Search Store
// ============================================================================

interface SearchState {
  query: string;
  replaceText: string;
  options: SearchOptions;
  results: FileSearchResult[];
  isSearching: boolean;
  totalMatches: number;
  showReplace: boolean;
  expandedFiles: Set<string>;

  setQuery: (query: string) => void;
  setReplaceText: (text: string) => void;
  setOption: <K extends keyof SearchOptions>(key: K, value: SearchOptions[K]) => void;
  setResults: (results: FileSearchResult[]) => void;
  setIsSearching: (searching: boolean) => void;
  toggleShowReplace: () => void;
  toggleFileExpanded: (filePath: string) => void;
  expandAll: () => void;
  collapseAll: () => void;
  clearResults: () => void;
}

export const useSearchStore = create<SearchState>((set, _get) => ({
  query: '',
  replaceText: '',
  options: {
    caseSensitive: false,
    wholeWord: false,
    useRegex: false,
    includePattern: '',
    excludePattern: '**/node_modules/**',
  },
  results: [],
  isSearching: false,
  totalMatches: 0,
  showReplace: false,
  expandedFiles: new Set(),

  setQuery: (query) => set({ query }),
  setReplaceText: (text) => set({ replaceText: text }),
  setOption: (key, value) =>
    set((state) => ({
      options: { ...state.options, [key]: value },
    })),
  setResults: (results) => {
    const totalMatches = results.reduce((sum, f) => sum + f.matches.length, 0);
    const expandedFiles = new Set(results.slice(0, 10).map((r) => r.filePath));
    set({ results, totalMatches, expandedFiles });
  },
  setIsSearching: (isSearching) => set({ isSearching }),
  toggleShowReplace: () => set((state) => ({ showReplace: !state.showReplace })),
  toggleFileExpanded: (filePath) =>
    set((state) => {
      const next = new Set(state.expandedFiles);
      if (next.has(filePath)) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      return { expandedFiles: next };
    }),
  expandAll: () =>
    set((state) => ({
      expandedFiles: new Set(state.results.map((r) => r.filePath)),
    })),
  collapseAll: () => set({ expandedFiles: new Set() }),
  clearResults: () => set({ results: [], totalMatches: 0, expandedFiles: new Set() }),
}));

// ============================================================================
// Search Match Component
// ============================================================================

interface SearchMatchItemProps {
  match: SearchMatch;
  query: string;
  onClick: () => void;
}

function SearchMatchItem({ match, query: _query, onClick }: SearchMatchItemProps) {
  const beforeMatch = match.lineContent.substring(0, match.column - 1);
  const matchText = match.lineContent.substring(match.column - 1, match.column - 1 + match.length);
  const afterMatch = match.lineContent.substring(match.column - 1 + match.length);

  return (
    <button
      onClick={onClick}
      className="w-full flex items-start gap-2 px-3 py-1 text-left hover:bg-overlay text-xs"
    >
      <span className="text-text-muted shrink-0 w-8 text-right">{match.line}</span>
      <span className="font-mono truncate">
        <span className="text-text-muted">{beforeMatch}</span>
        <span className="bg-accent-primary/30 text-accent-primary font-medium">{matchText}</span>
        <span className="text-text-muted">{afterMatch}</span>
      </span>
    </button>
  );
}

// ============================================================================
// File Result Component
// ============================================================================

interface FileResultProps {
  result: FileSearchResult;
  expanded: boolean;
  onToggle: () => void;
  onMatchClick: (match: SearchMatch) => void;
  query: string;
}

function FileResult({ result, expanded, onToggle, onMatchClick, query }: FileResultProps) {
  return (
    <div className="border-b border-border-subtle last:border-0">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-overlay"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 text-text-muted shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 text-text-muted shrink-0" />
        )}
        <File className="h-3.5 w-3.5 text-text-secondary shrink-0" />
        <span className="text-xs text-text-primary truncate flex-1">{result.fileName}</span>
        <span className="text-[10px] text-text-muted shrink-0 bg-overlay px-1.5 py-0.5 rounded">
          {result.matches.length}
        </span>
      </button>

      {expanded && (
        <div className="bg-surface/50 border-t border-border-subtle">
          {result.matches.slice(0, 100).map((match, idx) => (
            <SearchMatchItem
              key={`${match.line}-${match.column}-${idx}`}
              match={match}
              query={query}
              onClick={() => onMatchClick(match)}
            />
          ))}
          {result.matches.length > 100 && (
            <div className="px-3 py-2 text-xs text-text-muted text-center">
              +{result.matches.length - 100} more matches
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main Search Panel Component
// ============================================================================

interface SearchPanelProps {
  sessionId: string;
  onNavigate?: (filePath: string, line: number, column: number) => void;
}

export function SearchPanel({ sessionId: _sessionId, onNavigate }: SearchPanelProps) {
  const {
    query,
    replaceText,
    options,
    results,
    isSearching,
    totalMatches,
    showReplace,
    expandedFiles,
    setQuery,
    setReplaceText,
    setOption,
    setResults,
    setIsSearching,
    toggleShowReplace,
    toggleFileExpanded,
    expandAll,
    collapseAll,
    clearResults,
  } = useSearchStore();

  const [showFilters, setShowFilters] = useState(false);
  const [replaceStatus, setReplaceStatus] = useState<'idle' | 'replacing' | 'done' | 'error'>(
    'idle'
  );
  const searchInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Focus search input on mount
  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  // Debounced search
  const performSearch = useCallback(async () => {
    if (!query.trim()) {
      clearResults();
      return;
    }

    setIsSearching(true);

    try {
      // In real implementation, call API
      // const response = await api.post(`/api/workspaces/${workspaceId}/search`, {
      //   query,
      //   options,
      // });

      // Mock results for demonstration
      await new Promise((resolve) => setTimeout(resolve, 300));

      const mockResults: FileSearchResult[] =
        query.length > 0
          ? [
              {
                filePath: 'src/components/Button.tsx',
                fileName: 'Button.tsx',
                matches: [
                  {
                    line: 12,
                    column: 8,
                    length: query.length,
                    lineContent: `  const ${query} = useCallback(() => {`,
                    previewStart: 0,
                    previewEnd: 50,
                  },
                  {
                    line: 25,
                    column: 15,
                    length: query.length,
                    lineContent: `    return <button className="${query}">`,
                    previewStart: 0,
                    previewEnd: 50,
                  },
                ],
              },
              {
                filePath: 'src/lib/utils.ts',
                fileName: 'utils.ts',
                matches: [
                  {
                    line: 5,
                    column: 10,
                    length: query.length,
                    lineContent: `export function ${query}(value: string) {`,
                    previewStart: 0,
                    previewEnd: 50,
                  },
                ],
              },
              {
                filePath: 'src/hooks/useSearch.ts',
                fileName: 'useSearch.ts',
                matches: [
                  {
                    line: 18,
                    column: 5,
                    length: query.length,
                    lineContent: `  ${query}: string;`,
                    previewStart: 0,
                    previewEnd: 30,
                  },
                  {
                    line: 42,
                    column: 12,
                    length: query.length,
                    lineContent: `    const ${query}Result = await fetch();`,
                    previewStart: 0,
                    previewEnd: 50,
                  },
                  {
                    line: 67,
                    column: 8,
                    length: query.length,
                    lineContent: `  if (${query}) {`,
                    previewStart: 0,
                    previewEnd: 30,
                  },
                ],
              },
            ]
          : [];

      setResults(mockResults);
    } catch (error) {
      console.error('Search failed:', error);
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [query, setIsSearching, setResults, clearResults]);

  // Handle query change with debounce
  const handleQueryChange = useCallback(
    (value: string) => {
      setQuery(value);
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      debounceRef.current = setTimeout(performSearch, 300);
    },
    [setQuery, performSearch]
  );

  // Handle match click
  const handleMatchClick = useCallback(
    (filePath: string, match: SearchMatch) => {
      onNavigate?.(filePath, match.line, match.column);
    },
    [onNavigate]
  );

  // Handle replace all
  const handleReplaceAll = useCallback(async () => {
    if (!query || !replaceText) return;

    setReplaceStatus('replacing');
    try {
      // In real implementation, call API to replace
      await new Promise((resolve) => setTimeout(resolve, 500));
      setReplaceStatus('done');
      // Re-search to update results
      setTimeout(() => {
        setReplaceStatus('idle');
        performSearch();
      }, 1000);
    } catch {
      setReplaceStatus('error');
      setTimeout(() => setReplaceStatus('idle'), 2000);
    }
  }, [query, replaceText, performSearch]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Search input */}
      <div className="p-2 border-b border-border-subtle space-y-2">
        {/* Main search row */}
        <div className="flex items-center gap-1">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted" />
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              placeholder="Search..."
              className="w-full pl-7 pr-2 py-1.5 text-xs rounded bg-void border border-border-default text-text-primary placeholder:text-text-muted focus:border-accent-primary focus:outline-none"
            />
            {query && (
              <button
                onClick={() => {
                  setQuery('');
                  clearResults();
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          {/* Toggle options */}
          <button
            onClick={() => setOption('caseSensitive', !options.caseSensitive)}
            className={cn(
              'p-1.5 rounded',
              options.caseSensitive
                ? 'bg-accent-primary/20 text-accent-primary'
                : 'text-text-muted hover:text-text-primary hover:bg-overlay'
            )}
            title="Match Case"
          >
            <CaseSensitive className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setOption('wholeWord', !options.wholeWord)}
            className={cn(
              'p-1.5 rounded',
              options.wholeWord
                ? 'bg-accent-primary/20 text-accent-primary'
                : 'text-text-muted hover:text-text-primary hover:bg-overlay'
            )}
            title="Match Whole Word"
          >
            <WholeWord className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setOption('useRegex', !options.useRegex)}
            className={cn(
              'p-1.5 rounded',
              options.useRegex
                ? 'bg-accent-primary/20 text-accent-primary'
                : 'text-text-muted hover:text-text-primary hover:bg-overlay'
            )}
            title="Use Regular Expression"
          >
            <Regex className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={toggleShowReplace}
            className={cn(
              'p-1.5 rounded',
              showReplace
                ? 'bg-accent-primary/20 text-accent-primary'
                : 'text-text-muted hover:text-text-primary hover:bg-overlay'
            )}
            title="Toggle Replace"
          >
            <Replace className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Replace input */}
        {showReplace && (
          <div className="flex items-center gap-1">
            <div className="relative flex-1">
              <Replace className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted" />
              <input
                type="text"
                value={replaceText}
                onChange={(e) => setReplaceText(e.target.value)}
                placeholder="Replace with..."
                className="w-full pl-7 pr-2 py-1.5 text-xs rounded bg-void border border-border-default text-text-primary placeholder:text-text-muted focus:border-accent-primary focus:outline-none"
              />
            </div>
            <button
              onClick={handleReplaceAll}
              disabled={!query || !replaceText || replaceStatus === 'replacing'}
              className="px-2 py-1.5 text-xs rounded bg-accent-primary text-void hover:bg-accent-primary/90 disabled:opacity-50 flex items-center gap-1"
            >
              {replaceStatus === 'replacing' ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : replaceStatus === 'done' ? (
                <Check className="h-3 w-3" />
              ) : replaceStatus === 'error' ? (
                <AlertCircle className="h-3 w-3" />
              ) : null}
              Replace All
            </button>
          </div>
        )}

        {/* File filters toggle */}
        <button
          onClick={() => setShowFilters(!showFilters)}
          className="flex items-center gap-1 text-xs text-text-muted hover:text-text-primary"
        >
          <Filter className="h-3 w-3" />
          {showFilters ? 'Hide' : 'Show'} file filters
          {(options.includePattern || options.excludePattern !== '**/node_modules/**') && (
            <span className="w-1.5 h-1.5 rounded-full bg-accent-primary" />
          )}
        </button>

        {/* File filters */}
        {showFilters && (
          <div className="space-y-2 pt-1">
            <div className="flex items-center gap-2">
              <FolderOpen className="h-3.5 w-3.5 text-text-muted shrink-0" />
              <input
                type="text"
                value={options.includePattern}
                onChange={(e) => setOption('includePattern', e.target.value)}
                placeholder="Files to include (e.g., **/*.ts)"
                className="flex-1 px-2 py-1 text-xs rounded bg-void border border-border-default text-text-primary placeholder:text-text-muted focus:border-accent-primary focus:outline-none"
              />
            </div>
            <div className="flex items-center gap-2">
              <FolderX className="h-3.5 w-3.5 text-text-muted shrink-0" />
              <input
                type="text"
                value={options.excludePattern}
                onChange={(e) => setOption('excludePattern', e.target.value)}
                placeholder="Files to exclude (e.g., **/node_modules/**)"
                className="flex-1 px-2 py-1 text-xs rounded bg-void border border-border-default text-text-primary placeholder:text-text-muted focus:border-accent-primary focus:outline-none"
              />
            </div>
          </div>
        )}
      </div>

      {/* Results header */}
      {(results.length > 0 || isSearching) && (
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-border-subtle bg-elevated">
          <span className="text-xs text-text-secondary">
            {isSearching ? (
              <span className="flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                Searching...
              </span>
            ) : (
              `${totalMatches} results in ${results.length} files`
            )}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={expandAll}
              className="text-[10px] text-text-muted hover:text-text-primary px-1"
            >
              Expand
            </button>
            <span className="text-text-muted">|</span>
            <button
              onClick={collapseAll}
              className="text-[10px] text-text-muted hover:text-text-primary px-1"
            >
              Collapse
            </button>
            <button
              onClick={performSearch}
              className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-overlay"
              title="Refresh"
            >
              <RefreshCw className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}

      {/* Results list */}
      <div className="flex-1 overflow-y-auto">
        {!query ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <Search className="h-8 w-8 text-text-muted mb-2" />
            <p className="text-xs text-text-muted">Enter a search term</p>
            <p className="text-[10px] text-text-muted mt-1">Use Cmd+Shift+F to open search</p>
          </div>
        ) : results.length === 0 && !isSearching ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <Search className="h-8 w-8 text-text-muted mb-2" />
            <p className="text-xs text-text-muted">No results found</p>
            <p className="text-[10px] text-text-muted mt-1">
              Try different search terms or file filters
            </p>
          </div>
        ) : (
          results.map((result) => (
            <FileResult
              key={result.filePath}
              result={result}
              expanded={expandedFiles.has(result.filePath)}
              onToggle={() => toggleFileExpanded(result.filePath)}
              onMatchClick={(match) => handleMatchClick(result.filePath, match)}
              query={query}
            />
          ))
        )}
      </div>
    </div>
  );
}
