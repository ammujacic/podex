'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  ChevronRight,
  ChevronDown,
  Code,
  Box,
  Braces,
  Hash,
  Type,
  FileCode,
  Puzzle,
  Circle,
  Square,
  Triangle,
  Minus,
  List,
  X,
  RefreshCw,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';

// ============================================================================
// Types
// ============================================================================

export enum SymbolKind {
  File = 1,
  Module = 2,
  Namespace = 3,
  Package = 4,
  Class = 5,
  Method = 6,
  Property = 7,
  Field = 8,
  Constructor = 9,
  Enum = 10,
  Interface = 11,
  Function = 12,
  Variable = 13,
  Constant = 14,
  String = 15,
  Number = 16,
  Boolean = 17,
  Array = 18,
  Object = 19,
  Key = 20,
  Null = 21,
  EnumMember = 22,
  Struct = 23,
  Event = 24,
  Operator = 25,
  TypeParameter = 26,
}

export interface DocumentSymbol {
  name: string;
  detail?: string;
  kind: SymbolKind;
  range: {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
  };
  selectionRange: {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
  };
  children?: DocumentSymbol[];
}

export interface OutlineState {
  symbols: DocumentSymbol[];
  loading: boolean;
  error: string | null;
}

// ============================================================================
// Symbol Icons
// ============================================================================

function getSymbolIcon(kind: SymbolKind): React.ReactNode {
  const iconClass = 'h-4 w-4';

  switch (kind) {
    case SymbolKind.File:
      return <FileCode className={cn(iconClass, 'text-text-muted')} />;
    case SymbolKind.Module:
    case SymbolKind.Namespace:
    case SymbolKind.Package:
      return <Box className={cn(iconClass, 'text-purple-400')} />;
    case SymbolKind.Class:
      return <Square className={cn(iconClass, 'text-amber-400')} />;
    case SymbolKind.Method:
    case SymbolKind.Function:
    case SymbolKind.Constructor:
      return <Braces className={cn(iconClass, 'text-blue-400')} />;
    case SymbolKind.Property:
    case SymbolKind.Field:
      return <Minus className={cn(iconClass, 'text-cyan-400')} />;
    case SymbolKind.Variable:
      return <Code className={cn(iconClass, 'text-sky-400')} />;
    case SymbolKind.Constant:
      return <Hash className={cn(iconClass, 'text-orange-400')} />;
    case SymbolKind.Enum:
    case SymbolKind.EnumMember:
      return <List className={cn(iconClass, 'text-green-400')} />;
    case SymbolKind.Interface:
      return <Triangle className={cn(iconClass, 'text-teal-400')} />;
    case SymbolKind.Struct:
      return <Puzzle className={cn(iconClass, 'text-rose-400')} />;
    case SymbolKind.TypeParameter:
      return <Type className={cn(iconClass, 'text-violet-400')} />;
    default:
      return <Circle className={cn(iconClass, 'text-text-muted')} />;
  }
}

export function getSymbolKindLabel(kind: SymbolKind): string {
  return SymbolKind[kind] || 'Unknown';
}

// ============================================================================
// Symbol Tree Item
// ============================================================================

interface SymbolTreeItemProps {
  symbol: DocumentSymbol;
  depth: number;
  expanded: boolean;
  onToggle: () => void;
  onSelect: (symbol: DocumentSymbol) => void;
  expandedSymbols: Set<string>;
  onToggleChild: (path: string) => void;
  path: string;
  selectedSymbol: DocumentSymbol | null;
}

function SymbolTreeItem({
  symbol,
  depth,
  expanded,
  onToggle,
  onSelect,
  expandedSymbols,
  onToggleChild,
  path,
  selectedSymbol,
}: SymbolTreeItemProps) {
  const hasChildren = symbol.children && symbol.children.length > 0;
  const isSelected =
    selectedSymbol?.name === symbol.name &&
    selectedSymbol?.range.startLine === symbol.range.startLine;

  return (
    <div>
      <button
        onClick={() => {
          onSelect(symbol);
          if (hasChildren) {
            onToggle();
          }
        }}
        className={cn(
          'flex w-full items-center gap-1.5 py-1 pr-2 text-left text-sm hover:bg-overlay',
          isSelected && 'bg-accent-primary/10 text-accent-primary'
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        {/* Expand/collapse arrow */}
        <span className="w-4 shrink-0">
          {hasChildren &&
            (expanded ? (
              <ChevronDown className="h-3 w-3 text-text-muted" />
            ) : (
              <ChevronRight className="h-3 w-3 text-text-muted" />
            ))}
        </span>

        {/* Symbol icon */}
        {getSymbolIcon(symbol.kind)}

        {/* Symbol name */}
        <span
          className={cn(
            'flex-1 truncate',
            isSelected ? 'text-accent-primary' : 'text-text-primary'
          )}
        >
          {symbol.name}
        </span>

        {/* Symbol detail/type */}
        {symbol.detail && (
          <span className="shrink-0 truncate text-xs text-text-muted">{symbol.detail}</span>
        )}

        {/* Line number */}
        <span className="shrink-0 text-xs text-text-muted">:{symbol.range.startLine}</span>
      </button>

      {/* Children */}
      <AnimatePresence>
        {expanded && hasChildren && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            {symbol.children!.map((child, index) => {
              const childPath = `${path}/${child.name}-${index}`;
              return (
                <SymbolTreeItem
                  key={childPath}
                  symbol={child}
                  depth={depth + 1}
                  expanded={expandedSymbols.has(childPath)}
                  onToggle={() => onToggleChild(childPath)}
                  onSelect={onSelect}
                  expandedSymbols={expandedSymbols}
                  onToggleChild={onToggleChild}
                  path={childPath}
                  selectedSymbol={selectedSymbol}
                />
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================================
// Filter Controls
// ============================================================================

interface FilterControlsProps {
  filter: string;
  onFilterChange: (filter: string) => void;
  sortBy: 'name' | 'position' | 'kind';
  onSortChange: (sort: 'name' | 'position' | 'kind') => void;
}

function FilterControls({ filter, onFilterChange, sortBy, onSortChange }: FilterControlsProps) {
  return (
    <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
      <input
        type="text"
        value={filter}
        onChange={(e) => onFilterChange(e.target.value)}
        placeholder="Filter symbols..."
        className="flex-1 rounded border border-border-default bg-surface px-2 py-1 text-xs text-text-primary placeholder:text-text-muted focus:border-accent-primary focus:outline-none"
      />
      <select
        value={sortBy}
        onChange={(e) => onSortChange(e.target.value as 'name' | 'position' | 'kind')}
        className="rounded border border-border-default bg-surface px-2 py-1 text-xs text-text-secondary focus:outline-none"
      >
        <option value="position">By Position</option>
        <option value="name">By Name</option>
        <option value="kind">By Kind</option>
      </select>
    </div>
  );
}

// ============================================================================
// Symbol Outline API
// ============================================================================

async function fetchDocumentSymbols(
  sessionId: string,
  filePath: string
): Promise<DocumentSymbol[]> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

  const response = await fetch(
    `${apiUrl}/api/sessions/${sessionId}/symbols?path=${encodeURIComponent(filePath)}`,
    { method: 'GET' }
  );

  if (!response.ok) {
    throw new Error('Failed to fetch symbols');
  }

  return response.json();
}

// ============================================================================
// Main Symbol Outline Component
// ============================================================================

interface SymbolOutlineProps {
  sessionId: string;
  filePath: string | null;
  onSymbolClick: (line: number, column: number) => void;
  onClose?: () => void;
  className?: string;
}

export function SymbolOutline({
  sessionId,
  filePath,
  onSymbolClick,
  onClose,
  className,
}: SymbolOutlineProps) {
  const [state, setState] = useState<OutlineState>({
    symbols: [],
    loading: false,
    error: null,
  });
  const [expandedSymbols, setExpandedSymbols] = useState<Set<string>>(new Set());
  const [selectedSymbol, setSelectedSymbol] = useState<DocumentSymbol | null>(null);
  const [filter, setFilter] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'position' | 'kind'>('position');

  // Fetch symbols when file changes
  useEffect(() => {
    if (!filePath) {
      setState({ symbols: [], loading: false, error: null });
      return;
    }

    const loadSymbols = async () => {
      setState((s) => ({ ...s, loading: true, error: null }));

      try {
        const symbols = await fetchDocumentSymbols(sessionId, filePath);
        setState({ symbols, loading: false, error: null });

        // Auto-expand top-level symbols
        const topLevel = new Set(symbols.map((s, i) => `/${s.name}-${i}`));
        setExpandedSymbols(topLevel);
      } catch (error) {
        setState((s) => ({
          ...s,
          loading: false,
          error: error instanceof Error ? error.message : 'Failed to load symbols',
        }));
      }
    };

    loadSymbols();
  }, [sessionId, filePath]);

  // Toggle symbol expansion
  const toggleSymbol = useCallback((path: string) => {
    setExpandedSymbols((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  // Handle symbol selection
  const handleSelect = useCallback(
    (symbol: DocumentSymbol) => {
      setSelectedSymbol(symbol);
      onSymbolClick(symbol.selectionRange.startLine, symbol.selectionRange.startColumn);
    },
    [onSymbolClick]
  );

  // Filter symbols recursively
  const filterSymbols = useCallback(
    (symbols: DocumentSymbol[], query: string): DocumentSymbol[] => {
      if (!query) return symbols;

      const lowerQuery = query.toLowerCase();
      return symbols
        .map((symbol) => {
          const matchesName = symbol.name.toLowerCase().includes(lowerQuery);
          const filteredChildren = symbol.children ? filterSymbols(symbol.children, query) : [];

          if (matchesName || filteredChildren.length > 0) {
            return {
              ...symbol,
              children: filteredChildren.length > 0 ? filteredChildren : symbol.children,
            };
          }
          return null;
        })
        .filter(Boolean) as DocumentSymbol[];
    },
    []
  );

  // Sort symbols
  const sortSymbols = useCallback(
    (symbols: DocumentSymbol[]): DocumentSymbol[] => {
      const sorted = [...symbols];

      switch (sortBy) {
        case 'name':
          sorted.sort((a, b) => a.name.localeCompare(b.name));
          break;
        case 'kind':
          sorted.sort((a, b) => a.kind - b.kind || a.name.localeCompare(b.name));
          break;
        case 'position':
        default:
          sorted.sort((a, b) => a.range.startLine - b.range.startLine);
          break;
      }

      return sorted.map((s) => ({
        ...s,
        children: s.children ? sortSymbols(s.children) : undefined,
      }));
    },
    [sortBy]
  );

  // Apply filter and sort
  const displaySymbols = useMemo(() => {
    const filtered = filterSymbols(state.symbols, filter);
    return sortSymbols(filtered);
  }, [state.symbols, filter, filterSymbols, sortSymbols]);

  // Refresh symbols
  const handleRefresh = useCallback(async () => {
    if (!filePath) return;

    setState((s) => ({ ...s, loading: true, error: null }));

    try {
      const symbols = await fetchDocumentSymbols(sessionId, filePath);
      setState({ symbols, loading: false, error: null });
    } catch (error) {
      setState((s) => ({
        ...s,
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to load symbols',
      }));
    }
  }, [sessionId, filePath]);

  return (
    <div className={cn('flex h-full flex-col bg-elevated', className)}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border-default px-4 py-3">
        <div className="flex items-center gap-2">
          <List className="h-4 w-4 text-accent-primary" />
          <span className="text-sm font-medium text-text-primary">Outline</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleRefresh}
            className="rounded p-1 text-text-muted hover:bg-overlay hover:text-text-secondary"
            title="Refresh"
          >
            <RefreshCw className={cn('h-4 w-4', state.loading && 'animate-spin')} />
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="rounded p-1 text-text-muted hover:bg-overlay hover:text-text-secondary"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Filter */}
      <FilterControls
        filter={filter}
        onFilterChange={setFilter}
        sortBy={sortBy}
        onSortChange={setSortBy}
      />

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {!filePath && (
          <div className="flex items-center justify-center py-8 text-sm text-text-muted">
            No file selected
          </div>
        )}

        {filePath && state.loading && (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="h-5 w-5 animate-spin text-accent-primary" />
          </div>
        )}

        {filePath && state.error && (
          <div className="p-4 text-sm text-accent-error">{state.error}</div>
        )}

        {filePath && !state.loading && displaySymbols.length === 0 && (
          <div className="p-4 text-center text-sm text-text-muted">
            {filter ? 'No matching symbols' : 'No symbols found'}
          </div>
        )}

        {filePath && !state.loading && displaySymbols.length > 0 && (
          <div className="py-1">
            {displaySymbols.map((symbol, index) => {
              const path = `/${symbol.name}-${index}`;
              return (
                <SymbolTreeItem
                  key={path}
                  symbol={symbol}
                  depth={0}
                  expanded={expandedSymbols.has(path)}
                  onToggle={() => toggleSymbol(path)}
                  onSelect={handleSelect}
                  expandedSymbols={expandedSymbols}
                  onToggleChild={toggleSymbol}
                  path={path}
                  selectedSymbol={selectedSymbol}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Footer with stats */}
      {filePath && displaySymbols.length > 0 && (
        <div className="border-t border-border-subtle px-4 py-2 text-xs text-text-muted">
          {countSymbols(displaySymbols)} symbols
        </div>
      )}
    </div>
  );
}

// Helper to count all symbols including nested
function countSymbols(symbols: DocumentSymbol[]): number {
  return symbols.reduce((count, symbol) => {
    return count + 1 + (symbol.children ? countSymbols(symbol.children) : 0);
  }, 0);
}

// ============================================================================
// Symbol Quick Pick (Command Palette Style)
// ============================================================================

interface SymbolQuickPickProps {
  symbols: DocumentSymbol[];
  onSelect: (symbol: DocumentSymbol) => void;
  onClose: () => void;
}

export function SymbolQuickPick({ symbols, onSelect, onClose }: SymbolQuickPickProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Flatten symbols for searching
  const flatSymbols = useMemo(() => {
    const flatten = (
      syms: DocumentSymbol[],
      parent?: string
    ): Array<DocumentSymbol & { parent?: string }> => {
      return syms.flatMap((sym) => [
        { ...sym, parent },
        ...(sym.children ? flatten(sym.children, sym.name) : []),
      ]);
    };
    return flatten(symbols);
  }, [symbols]);

  // Filter symbols
  const filteredSymbols = useMemo(() => {
    if (!query) return flatSymbols;
    const lowerQuery = query.toLowerCase();
    return flatSymbols.filter((s) => s.name.toLowerCase().includes(lowerQuery));
  }, [flatSymbols, query]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, filteredSymbols.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          if (filteredSymbols[selectedIndex]) {
            onSelect(filteredSymbols[selectedIndex]);
          }
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
      }
    },
    [filteredSymbols, selectedIndex, onSelect, onClose]
  );

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-lg rounded-lg border border-border-default bg-elevated shadow-xl">
        {/* Search input */}
        <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-3">
          <Code className="h-4 w-4 text-text-muted" />
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Go to symbol..."
            className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
            autoFocus
          />
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto py-2">
          {filteredSymbols.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-text-muted">No symbols found</div>
          ) : (
            filteredSymbols.slice(0, 50).map((symbol, index) => (
              <button
                key={`${symbol.name}-${symbol.range.startLine}`}
                onClick={() => onSelect(symbol)}
                className={cn(
                  'flex w-full items-center gap-3 px-4 py-2 text-left',
                  index === selectedIndex
                    ? 'bg-accent-primary/10 text-accent-primary'
                    : 'hover:bg-overlay'
                )}
              >
                {getSymbolIcon(symbol.kind)}
                <span className="flex-1 truncate text-sm">{symbol.name}</span>
                {symbol.parent && <span className="text-xs text-text-muted">{symbol.parent}</span>}
                <span className="text-xs text-text-muted">:{symbol.range.startLine}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </motion.div>
  );
}
