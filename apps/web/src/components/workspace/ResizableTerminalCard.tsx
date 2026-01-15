'use client';

import { useRef, useCallback } from 'react';
import { type Agent, type GridSpan, useSessionStore } from '@/stores/session';
import { TerminalAgentCell, type TerminalAgentCellRef } from './TerminalAgentCell';
import { useOptionalGridContext } from './GridContext';
import { useGridResize } from '@/hooks/useGridResize';
import { cn } from '@/lib/utils';

interface ResizableTerminalCardProps {
  agent: Agent;
  sessionId: string;
  workspaceId: string;
  maxCols?: number;
  onRemove?: () => void;
}

export function ResizableTerminalCard({
  agent,
  sessionId,
  workspaceId,
  maxCols = 3,
  onRemove,
}: ResizableTerminalCardProps) {
  const { updateAgentGridSpan } = useSessionStore();
  const cardRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<TerminalAgentCellRef>(null);
  const gridContext = useOptionalGridContext();

  const gridSpan = agent.gridSpan ?? { colSpan: 1, rowSpan: 1 };

  const handleResize = useCallback(
    (newSpan: GridSpan) => {
      const clampedSpan = {
        colSpan: Math.min(newSpan.colSpan, maxCols),
        rowSpan: newSpan.rowSpan,
      };
      updateAgentGridSpan(sessionId, agent.id, clampedSpan);

      // Trigger terminal refit after resize completes
      requestAnimationFrame(() => {
        terminalRef.current?.fit();
      });
    },
    [sessionId, agent.id, maxCols, updateAgentGridSpan]
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

  return (
    <div
      ref={cardRef}
      className={cn(
        'relative rounded-lg border bg-surface overflow-hidden transition-shadow',
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
        <div className="absolute top-2 left-2 z-20 px-2 py-1 rounded bg-accent-primary text-text-inverse text-xs font-medium shadow-lg">
          {previewSpan.colSpan} x {previewSpan.rowSpan}
          {spanChanged && ' (releasing will resize)'}
        </div>
      )}

      {/* Terminal cell fills the container */}
      <div className="h-full">
        <TerminalAgentCell
          ref={terminalRef}
          agent={agent}
          sessionId={sessionId}
          workspaceId={workspaceId}
          onRemove={onRemove}
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
