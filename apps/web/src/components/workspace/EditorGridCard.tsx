'use client';

import { useRef, useCallback, useEffect, useMemo } from 'react';
import { X, Maximize2, Minimize2 } from 'lucide-react';
import { useEditorStore } from '@/stores/editor';
import { useSessionStore, type GridSpan } from '@/stores/session';
import { EnhancedCodeEditor } from '@/components/editor/EnhancedCodeEditor';
import { useOptionalGridContext } from './GridContext';
import { useGridResize } from '@/hooks/useGridResize';
import { cn } from '@/lib/utils';

// ============================================================================
// Types
// ============================================================================

interface EditorGridCardProps {
  sessionId: string;
  paneId?: string;
  maxCols?: number;
  className?: string;
}

// ============================================================================
// Component
// ============================================================================

export function EditorGridCard({
  sessionId,
  paneId = 'main',
  maxCols = 2,
  className,
}: EditorGridCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const gridContext = useOptionalGridContext();

  // Editor store state
  const pane = useEditorStore((s) => s.panes[paneId]);
  const closeAllTabs = useEditorStore((s) => s.closeAllTabs);

  // Session store state
  const session = useSessionStore((s) => s.sessions[sessionId]);
  const updateEditorGridSpan = useSessionStore((s) => s.updateEditorGridSpan);
  const removeEditorGridCard = useSessionStore((s) => s.removeEditorGridCard);

  // Get grid span from session (memoized to prevent dependency changes)
  const gridSpan = useMemo(
    () => session?.editorGridSpan ?? { colSpan: 1, rowSpan: 1 },
    [session?.editorGridSpan]
  );

  // Handle resize
  const handleResize = useCallback(
    (newSpan: GridSpan) => {
      const clampedSpan = {
        colSpan: Math.min(newSpan.colSpan, maxCols),
        rowSpan: newSpan.rowSpan,
      };
      updateEditorGridSpan(sessionId, clampedSpan);
    },
    [sessionId, maxCols, updateEditorGridSpan]
  );

  const { isResizing, previewSpan, handleResizeStart } = useGridResize({
    initialSpan: gridSpan,
    maxCols,
    maxRows: 2,
    onResize: handleResize,
    gridRef: gridContext?.gridRef,
  });

  const displaySpan = isResizing ? previewSpan : gridSpan;
  const spanChanged =
    isResizing &&
    (previewSpan.colSpan !== gridSpan.colSpan || previewSpan.rowSpan !== gridSpan.rowSpan);

  // Check if there are any tabs
  const hasTabs = pane && pane.tabs.length > 0;
  const tabCount = pane?.tabs.length ?? 0;

  // Close editor grid card (closes all tabs and removes from grid)
  const handleClose = useCallback(() => {
    closeAllTabs(paneId);
    removeEditorGridCard(sessionId);
  }, [closeAllTabs, paneId, removeEditorGridCard, sessionId]);

  // Auto-remove when all tabs are closed
  useEffect(() => {
    if (pane && pane.tabs.length === 0 && session?.editorGridCardId) {
      removeEditorGridCard(sessionId);
    }
  }, [pane, session?.editorGridCardId, removeEditorGridCard, sessionId]);

  // Toggle between 1x1 and 2x2 size
  const handleToggleSize = useCallback(() => {
    if (gridSpan.colSpan === 1 && gridSpan.rowSpan === 1) {
      updateEditorGridSpan(sessionId, { colSpan: 2, rowSpan: 2 });
    } else {
      updateEditorGridSpan(sessionId, { colSpan: 1, rowSpan: 1 });
    }
  }, [gridSpan, updateEditorGridSpan, sessionId]);

  const isMaximized = gridSpan.colSpan === 2 && gridSpan.rowSpan === 2;

  return (
    <div
      ref={cardRef}
      className={cn(
        'relative rounded-lg border bg-surface overflow-hidden flex flex-col transition-shadow',
        isResizing
          ? 'border-accent-primary shadow-lg ring-2 ring-accent-primary/20'
          : 'border-border-default',
        className
      )}
      style={{
        gridColumn: `span ${displaySpan.colSpan}`,
        gridRow: `span ${displaySpan.rowSpan}`,
        minHeight: displaySpan.rowSpan === 1 ? '300px' : '616px',
        maxHeight: displaySpan.rowSpan === 1 ? '300px' : '616px',
        height: displaySpan.rowSpan === 1 ? '300px' : '616px',
      }}
    >
      {/* Size indicator during resize */}
      {isResizing && (
        <div className="absolute top-2 left-2 z-20 px-2 py-1 rounded bg-accent-primary text-text-inverse text-xs font-medium shadow-lg">
          {previewSpan.colSpan} x {previewSpan.rowSpan}
          {spanChanged && ' (releasing will resize)'}
        </div>
      )}

      {/* Header with controls */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border-subtle bg-elevated shrink-0">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-accent-primary shrink-0" />
          <span className="text-xs font-medium text-text-primary">Editor</span>
          {tabCount > 0 && (
            <span className="text-xs text-text-muted">
              {tabCount} file{tabCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* Maximize/Minimize button */}
          <button
            onClick={handleToggleSize}
            className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-overlay transition-colors"
            title={isMaximized ? 'Minimize' : 'Maximize'}
          >
            {isMaximized ? (
              <Minimize2 className="h-3.5 w-3.5" />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" />
            )}
          </button>

          {/* Close button */}
          <button
            onClick={handleClose}
            className="p-1 rounded text-text-muted hover:text-accent-error hover:bg-overlay transition-colors"
            title="Close Editor"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Editor content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {hasTabs ? (
          <EnhancedCodeEditor paneId={paneId} className="h-full" />
        ) : (
          <div className="flex h-full flex-col items-center justify-center text-text-muted">
            <div className="mb-2 text-3xl opacity-20">{'</>'}</div>
            <p className="text-sm">No files open</p>
            <p className="mt-1 text-xs opacity-60">
              Open a file from the sidebar or use{' '}
              <kbd className="rounded bg-overlay px-1.5 py-0.5 text-xs">Cmd+P</kbd>
            </p>
          </div>
        )}
      </div>

      {/* Drag resize handle in bottom-right corner */}
      <div
        onMouseDown={(e) => cardRef.current && handleResizeStart(e, cardRef.current)}
        className={cn(
          'absolute bottom-0 right-0 w-6 h-6 cursor-se-resize z-10 group',
          'flex items-end justify-end p-1'
        )}
        title="Drag to resize"
      >
        {/* Resize grip visual */}
        <div
          className={cn(
            'w-3 h-3 transition-colors',
            isResizing ? 'opacity-100' : 'opacity-50 group-hover:opacity-100'
          )}
        >
          <svg viewBox="0 0 12 12" className="w-full h-full">
            <path
              d="M10 2L2 10M10 6L6 10M10 10L10 10"
              stroke={isResizing ? 'var(--accent-primary)' : 'currentColor'}
              strokeWidth="1.5"
              strokeLinecap="round"
              className="text-text-muted"
            />
          </svg>
        </div>
      </div>

      {/* Resize edge indicators when dragging */}
      {isResizing && (
        <>
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-accent-primary/30" />
          <div className="absolute top-0 bottom-0 right-0 w-1 bg-accent-primary/30" />
        </>
      )}
    </div>
  );
}
