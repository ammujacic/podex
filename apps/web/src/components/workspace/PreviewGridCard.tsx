'use client';

import { useRef, useCallback, useMemo } from 'react';
import { X, Maximize2, Minimize2, Globe } from 'lucide-react';
import { useSessionStore, type GridSpan } from '@/stores/session';
import { useUIStore } from '@/stores/ui';
import { PreviewPanel } from './PreviewPanel';
import { useOptionalGridContext } from './GridContext';
import { useGridResize } from '@/hooks/useGridResize';
import { cn } from '@/lib/utils';

// ============================================================================
// Types
// ============================================================================

interface PreviewGridCardProps {
  sessionId: string;
  workspaceId: string;
  maxCols?: number;
  className?: string;
}

// ============================================================================
// Component
// ============================================================================

export function PreviewGridCard({
  sessionId,
  workspaceId,
  maxCols = 2,
  className,
}: PreviewGridCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const gridContext = useOptionalGridContext();
  const gridConfig = useUIStore((state) => state.gridConfig);

  // Session store state
  const session = useSessionStore((s) => s.sessions[sessionId]);
  const updatePreviewGridSpan = useSessionStore((s) => s.updatePreviewGridSpan);
  const removePreviewGridCard = useSessionStore((s) => s.removePreviewGridCard);

  // Get grid span from session (memoized to prevent dependency changes)
  const gridSpan = useMemo(
    () => session?.previewGridSpan ?? { colSpan: 2, rowSpan: 2 },
    [session?.previewGridSpan]
  );

  // Calculate dynamic heights based on rowSpan
  const gap = 16; // matches gap-4 in Tailwind
  const calculateHeight = (rowSpan: number) => {
    return rowSpan * gridConfig.rowHeight + (rowSpan - 1) * gap;
  };

  // Handle resize
  const handleResize = useCallback(
    (newSpan: GridSpan) => {
      const clampedSpan: GridSpan = {
        colSpan: Math.min(newSpan.colSpan, maxCols),
        rowSpan: newSpan.rowSpan,
        colStart: newSpan.colStart,
      };
      updatePreviewGridSpan(sessionId, clampedSpan);
    },
    [sessionId, maxCols, updatePreviewGridSpan]
  );

  const { isResizing, previewSpan, resizeDirection, handleResizeStart } = useGridResize({
    initialSpan: gridSpan,
    maxCols,
    maxRows: 3,
    onResize: handleResize,
    gridRef: gridContext?.gridRef,
  });

  const displaySpan = isResizing ? previewSpan : gridSpan;
  const spanChanged =
    isResizing &&
    (previewSpan.colSpan !== gridSpan.colSpan || previewSpan.rowSpan !== gridSpan.rowSpan);

  // Close preview grid card
  const handleClose = useCallback(() => {
    removePreviewGridCard(sessionId);
  }, [removePreviewGridCard, sessionId]);

  // Toggle between 1x1 and 2x2 size
  const handleToggleSize = useCallback(() => {
    if (gridSpan.colSpan === 1 && gridSpan.rowSpan === 1) {
      updatePreviewGridSpan(sessionId, { colSpan: 2, rowSpan: 2 });
    } else {
      updatePreviewGridSpan(sessionId, { colSpan: 1, rowSpan: 1 });
    }
  }, [gridSpan, updatePreviewGridSpan, sessionId]);

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
        gridColumn: displaySpan.colStart
          ? `${displaySpan.colStart} / span ${displaySpan.colSpan}`
          : `span ${displaySpan.colSpan}`,
        gridRow: `span ${displaySpan.rowSpan}`,
        minHeight: `${calculateHeight(displaySpan.rowSpan)}px`,
        maxHeight: `${calculateHeight(displaySpan.rowSpan)}px`,
        height: `${calculateHeight(displaySpan.rowSpan)}px`,
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
          <Globe className="h-4 w-4 text-accent-secondary" />
          <span className="text-xs font-medium text-text-primary">Live Preview</span>
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
            title="Close Preview"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Preview content - PreviewPanel handles the iframe and controls */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <PreviewPanel workspaceId={workspaceId} />
      </div>

      {/* Drag resize handle in bottom-left corner */}
      <div
        onMouseDown={(e) => cardRef.current && handleResizeStart(e, cardRef.current, 'bottom-left')}
        className={cn(
          'absolute bottom-0 left-0 w-6 h-6 cursor-sw-resize z-10 group',
          'flex items-end justify-start p-1'
        )}
        title="Drag to resize"
      >
        {/* Resize grip visual - mirrored for left side */}
        <div
          className={cn(
            'w-3 h-3 transition-colors',
            isResizing && (resizeDirection === 'left' || resizeDirection === 'bottom-left')
              ? 'opacity-100'
              : 'opacity-50 group-hover:opacity-100'
          )}
        >
          <svg viewBox="0 0 12 12" className="w-full h-full scale-x-[-1]">
            <path
              d="M10 2L2 10M10 6L6 10M10 10L10 10"
              stroke={
                isResizing && (resizeDirection === 'left' || resizeDirection === 'bottom-left')
                  ? 'var(--accent-primary)'
                  : 'currentColor'
              }
              strokeWidth="1.5"
              strokeLinecap="round"
              className="text-text-muted"
            />
          </svg>
        </div>
      </div>

      {/* Drag resize handle in bottom-right corner */}
      <div
        onMouseDown={(e) =>
          cardRef.current && handleResizeStart(e, cardRef.current, 'bottom-right')
        }
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
            isResizing && (resizeDirection === 'right' || resizeDirection === 'bottom-right')
              ? 'opacity-100'
              : 'opacity-50 group-hover:opacity-100'
          )}
        >
          <svg viewBox="0 0 12 12" className="w-full h-full">
            <path
              d="M10 2L2 10M10 6L6 10M10 10L10 10"
              stroke={
                isResizing && (resizeDirection === 'right' || resizeDirection === 'bottom-right')
                  ? 'var(--accent-primary)'
                  : 'currentColor'
              }
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
          {(resizeDirection === 'right' || resizeDirection === 'bottom-right') && (
            <div className="absolute top-0 bottom-0 right-0 w-1 bg-accent-primary/30" />
          )}
          {(resizeDirection === 'left' || resizeDirection === 'bottom-left') && (
            <div className="absolute top-0 bottom-0 left-0 w-1 bg-accent-primary/30" />
          )}
        </>
      )}
    </div>
  );
}
