'use client';

import { useRef, useCallback } from 'react';
import { X, ExternalLink } from 'lucide-react';
import { type FilePreview, type GridSpan, useSessionStore } from '@/stores/session';
import { CodeEditor } from './CodeEditor';
import { useOptionalGridContext } from './GridContext';
import { useGridResize } from '@/hooks/useGridResize';
import { cn } from '@/lib/utils';

interface DockedFilePreviewCardProps {
  preview: FilePreview;
  sessionId: string;
  maxCols?: number;
}

export function DockedFilePreviewCard({
  preview,
  sessionId,
  maxCols = 3,
}: DockedFilePreviewCardProps) {
  const { updateFilePreviewGridSpan, dockFilePreview, closeFilePreview } = useSessionStore();
  const cardRef = useRef<HTMLDivElement>(null);
  const gridContext = useOptionalGridContext();

  const gridSpan = preview.gridSpan ?? { colSpan: 1, rowSpan: 1 };
  const fileName = preview.path.split('/').pop() || preview.path;

  const handleResize = useCallback(
    (newSpan: GridSpan) => {
      const clampedSpan = {
        colSpan: Math.min(newSpan.colSpan, maxCols),
        rowSpan: newSpan.rowSpan,
      };
      updateFilePreviewGridSpan(sessionId, preview.id, clampedSpan);
    },
    [sessionId, preview.id, maxCols, updateFilePreviewGridSpan]
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

  const handleUndock = useCallback(() => {
    dockFilePreview(sessionId, preview.id, false);
  }, [sessionId, preview.id, dockFilePreview]);

  const handleClose = useCallback(() => {
    closeFilePreview(sessionId, preview.id);
  }, [sessionId, preview.id, closeFilePreview]);

  return (
    <div
      ref={cardRef}
      className={cn(
        'relative rounded-lg border bg-surface overflow-hidden flex flex-col transition-shadow',
        isResizing
          ? 'border-accent-primary shadow-lg ring-2 ring-accent-primary/20'
          : 'border-border-default'
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
        <div className="absolute top-10 left-2 z-20 px-2 py-1 rounded bg-accent-primary text-text-inverse text-xs font-medium shadow-lg">
          {previewSpan.colSpan} x {previewSpan.rowSpan}
          {spanChanged && ' (releasing will resize)'}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle bg-elevated shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="h-2 w-2 rounded-full bg-accent-secondary shrink-0" />
          <span className="text-sm font-medium text-text-primary truncate">{fileName}</span>
          <span className="text-xs text-text-muted hidden sm:inline truncate">{preview.path}</span>
        </div>
        <div className="flex items-center gap-1">
          {/* Undock button */}
          <button
            onClick={handleUndock}
            className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-overlay"
            title="Undock (make floating)"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </button>

          {/* Close button */}
          <button
            onClick={handleClose}
            className="p-1.5 rounded text-text-muted hover:text-accent-error hover:bg-overlay"
            title="Close"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Code editor */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <CodeEditor
          value={preview.content}
          language={preview.language}
          onChange={() => {}}
          readOnly
          className="h-full"
        />
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
