'use client';

import { useMemo, useState, useCallback } from 'react';
import { ChevronRight, FileCode, Folder, Hash, Box, Braces, Code2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@podex/ui';
import { cn } from '@/lib/utils';

// ============================================================================
// Types
// ============================================================================

export type SymbolKind =
  | 'file'
  | 'folder'
  | 'class'
  | 'interface'
  | 'function'
  | 'method'
  | 'property'
  | 'variable'
  | 'constant'
  | 'enum'
  | 'namespace'
  | 'module';

export interface BreadcrumbSymbol {
  name: string;
  kind: SymbolKind;
  range?: {
    startLine: number;
    endLine: number;
  };
  children?: BreadcrumbSymbol[];
}

export interface BreadcrumbItem {
  label: string;
  kind: SymbolKind;
  path?: string;
  symbol?: BreadcrumbSymbol;
  siblings?: BreadcrumbItem[];
  onSelect?: () => void;
}

// ============================================================================
// Icon Helper
// ============================================================================

const getSymbolIcon = (kind: SymbolKind) => {
  const iconMap: Record<SymbolKind, { icon: typeof FileCode; color: string }> = {
    file: { icon: FileCode, color: '#9898a8' },
    folder: { icon: Folder, color: '#f59e0b' },
    class: { icon: Box, color: '#ffcb6b' },
    interface: { icon: Box, color: '#82aaff' },
    function: { icon: Code2, color: '#c792ea' },
    method: { icon: Code2, color: '#c792ea' },
    property: { icon: Hash, color: '#f78c6c' },
    variable: { icon: Hash, color: '#f0f0f5' },
    constant: { icon: Hash, color: '#00e5ff' },
    enum: { icon: Braces, color: '#22c55e' },
    namespace: { icon: Folder, color: '#a855f7' },
    module: { icon: Folder, color: '#82aaff' },
  };
  return iconMap[kind] || iconMap.file;
};

// ============================================================================
// Breadcrumb Segment
// ============================================================================

interface BreadcrumbSegmentProps {
  item: BreadcrumbItem;
  isLast: boolean;
}

function BreadcrumbSegment({ item, isLast }: BreadcrumbSegmentProps) {
  const [open, setOpen] = useState(false);
  const { icon: Icon, color } = getSymbolIcon(item.kind);
  const hasSiblings = item.siblings && item.siblings.length > 0;

  const handleSelect = useCallback(() => {
    item.onSelect?.();
    setOpen(false);
  }, [item]);

  const content = (
    <div
      className={cn(
        'flex items-center gap-1 rounded px-1.5 py-0.5 text-xs transition-colors',
        hasSiblings ? 'cursor-pointer hover:bg-overlay' : 'cursor-default',
        isLast ? 'text-text-primary' : 'text-text-secondary'
      )}
      onClick={!hasSiblings ? handleSelect : undefined}
    >
      <Icon className="h-3.5 w-3.5" style={{ color }} />
      <span className="max-w-[150px] truncate">{item.label}</span>
    </div>
  );

  if (!hasSiblings) {
    return content;
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>{content}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[300px] overflow-y-auto">
        {item.siblings?.map((sibling, index) => {
          const siblingIcon = getSymbolIcon(sibling.kind);
          return (
            <DropdownMenuItem
              key={index}
              onClick={() => {
                sibling.onSelect?.();
                setOpen(false);
              }}
              className={cn(
                'flex items-center gap-2',
                sibling.label === item.label && 'bg-overlay'
              )}
            >
              <siblingIcon.icon className="h-4 w-4" style={{ color: siblingIcon.color }} />
              <span className="truncate">{sibling.label}</span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ============================================================================
// Breadcrumbs Component
// ============================================================================

interface BreadcrumbsProps {
  path: string;
  symbols?: BreadcrumbSymbol[];
  cursorLine?: number;
  onNavigate?: (path: string) => void;
  onNavigateToSymbol?: (symbol: BreadcrumbSymbol) => void;
  className?: string;
}

export function Breadcrumbs({
  path,
  symbols = [],
  cursorLine,
  onNavigate,
  onNavigateToSymbol,
  className,
}: BreadcrumbsProps) {
  // Build path segments
  const pathSegments = useMemo(() => {
    const parts = path.split('/').filter(Boolean);
    const items: BreadcrumbItem[] = [];

    let currentPath = '';
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!part) continue;
      currentPath += '/' + part;
      const isFile = i === parts.length - 1;

      items.push({
        label: part,
        kind: isFile ? 'file' : 'folder',
        path: currentPath,
        onSelect: () => onNavigate?.(currentPath),
      });
    }

    return items;
  }, [path, onNavigate]);

  // Find current symbol hierarchy based on cursor position
  const symbolPath = useMemo(() => {
    if (!symbols || symbols.length === 0 || cursorLine === undefined) {
      return [];
    }

    const findSymbolAtLine = (syms: BreadcrumbSymbol[], line: number): BreadcrumbSymbol[] => {
      for (const sym of syms) {
        if (sym.range && line >= sym.range.startLine && line <= sym.range.endLine) {
          const childPath = sym.children ? findSymbolAtLine(sym.children, line) : [];
          return [sym, ...childPath];
        }
      }
      return [];
    };

    return findSymbolAtLine(symbols, cursorLine);
  }, [symbols, cursorLine]);

  // Build symbol breadcrumb items
  const symbolItems = useMemo(() => {
    return symbolPath.map((sym, index) => {
      // Get siblings at this level
      const parentChildren = index === 0 ? symbols : symbolPath[index - 1]?.children || [];

      return {
        label: sym.name,
        kind: sym.kind,
        symbol: sym,
        siblings: parentChildren.map((sibling) => ({
          label: sibling.name,
          kind: sibling.kind,
          symbol: sibling,
          onSelect: () => onNavigateToSymbol?.(sibling),
        })),
        onSelect: () => onNavigateToSymbol?.(sym),
      } as BreadcrumbItem;
    });
  }, [symbolPath, symbols, onNavigateToSymbol]);

  const allItems = [...pathSegments, ...symbolItems];

  if (allItems.length === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        'flex items-center gap-0.5 overflow-x-auto bg-elevated px-2 py-1',
        'scrollbar-thin scrollbar-thumb-border-strong scrollbar-track-transparent',
        className
      )}
    >
      {allItems.map((item, index) => (
        <div key={index} className="flex items-center">
          <BreadcrumbSegment item={item} isLast={index === allItems.length - 1} />
          {index < allItems.length - 1 && (
            <ChevronRight className="h-3 w-3 flex-shrink-0 text-text-muted" />
          )}
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// Hook for Document Symbols
// ============================================================================

/**
 * Hook to fetch document symbols from Monaco editor
 * This should be used in conjunction with the CodeEditor component
 */
export function useDocumentSymbols(_editorInstance: unknown, _model: unknown): BreadcrumbSymbol[] {
  // This is a placeholder - actual implementation would use Monaco's
  // languages.DocumentSymbolProvider or LSP textDocument/documentSymbol
  //
  // Example Monaco integration:
  // const symbols = await monaco.languages.getDocumentSymbols(model);
  // return convertMonacoSymbols(symbols);

  return useMemo(() => [], []);
}

/**
 * Convert Monaco SymbolKind to our SymbolKind
 */
export function convertMonacoSymbolKind(kind: number): SymbolKind {
  // Monaco SymbolKind values (from monaco-editor/esm/vs/editor/common/languages.d.ts)
  const kindMap: Record<number, SymbolKind> = {
    0: 'file', // File
    1: 'module', // Module
    2: 'namespace', // Namespace
    3: 'module', // Package
    4: 'class', // Class
    5: 'method', // Method
    6: 'property', // Property
    7: 'variable', // Field
    8: 'function', // Constructor
    9: 'enum', // Enum
    10: 'interface', // Interface
    11: 'function', // Function
    12: 'variable', // Variable
    13: 'constant', // Constant
    14: 'property', // String
    15: 'property', // Number
    16: 'property', // Boolean
    17: 'property', // Array
    18: 'property', // Object
    19: 'property', // Key
    20: 'property', // Null
    21: 'enum', // EnumMember
    22: 'class', // Struct
    23: 'function', // Event
    24: 'function', // Operator
    25: 'variable', // TypeParameter
  };

  return kindMap[kind] || 'variable';
}
