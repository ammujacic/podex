'use client';

import { useRef, useCallback } from 'react';
import { type TerminalWindow, type GridSpan, useSessionStore } from '@/stores/session';
import { useUIStore } from '@/stores/ui';
import { TerminalCard } from './TerminalCard';
import { useOptionalGridContext } from './GridContext';
import { useGridResize } from '@/hooks/useGridResize';
import { cn } from '@/lib/utils';

interface ResizableTerminalGridCardProps {
  terminalWindow: TerminalWindow;
  sessionId: string;
  workspaceId: string;
  maxCols?: number;
}

export function ResizableTerminalGridCard({
  terminalWindow,
  sessionId,
  workspaceId,
  maxCols = 3,
}: ResizableTerminalGridCardProps) {
  const { updateTerminalWindowGridSpan } = useSessionStore();
  const gridConfig = useUIStore((state) => state.gridConfig);
  const cardRef = useRef<HTMLDivElement>(null);
  const gridContext = useOptionalGridContext();

  const gridSpan = terminalWindow.gridSpan ?? { colSpan: 1, rowSpan: 1 };

  // Calculate dynamic heights based on rowSpan
  const gap = 16; // matches gap-4 in Tailwind
  const calculateHeight = (rowSpan: number) => {
    return rowSpan * gridConfig.rowHeight + (rowSpan - 1) * gap;
  };

  const handleResize = useCallback(
    (newSpan: GridSpan) => {
      const clampedSpan: GridSpan = {
        colSpan: Math.min(newSpan.colSpan, maxCols),
        rowSpan: newSpan.rowSpan,
        colStart: newSpan.colStart,
      };
      updateTerminalWindowGridSpan(sessionId, terminalWindow.id, clampedSpan);
    },
    [sessionId, terminalWindow.id, maxCols, updateTerminalWindowGridSpan]
  );

  const { isResizing, previewSpan, resizeDirection, handleResizeStart } = useGridResize({
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

  return (
    <div
      ref={cardRef}
      className={cn(
        'relative rounded-lg overflow-hidden transition-shadow',
        isResizing ? 'shadow-lg ring-2 ring-cyan-500/30' : ''
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
        <div className="absolute top-2 left-2 z-20 px-2 py-1 rounded bg-cyan-500 text-white text-xs font-medium shadow-lg">
          {previewSpan.colSpan} x {previewSpan.rowSpan}
          {spanChanged && ' (releasing will resize)'}
        </div>
      )}

      {/* Terminal card fills the container */}
      <div className="h-full">
        <TerminalCard
          terminalWindow={terminalWindow}
          sessionId={sessionId}
          workspaceId={workspaceId}
          expanded
        />
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
                  ? '#06b6d4'
                  : 'currentColor'
              }
              strokeWidth="1.5"
              strokeLinecap="round"
              className="text-zinc-500"
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
                  ? '#06b6d4'
                  : 'currentColor'
              }
              strokeWidth="1.5"
              strokeLinecap="round"
              className="text-zinc-500"
            />
          </svg>
        </div>
      </div>

      {/* Resize edge indicators when dragging */}
      {isResizing && (
        <>
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-cyan-500/30" />
          {(resizeDirection === 'right' || resizeDirection === 'bottom-right') && (
            <div className="absolute top-0 bottom-0 right-0 w-1 bg-cyan-500/30" />
          )}
          {(resizeDirection === 'left' || resizeDirection === 'bottom-left') && (
            <div className="absolute top-0 bottom-0 left-0 w-1 bg-cyan-500/30" />
          )}
        </>
      )}
    </div>
  );
}
