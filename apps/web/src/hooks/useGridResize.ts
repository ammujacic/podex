'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import type { GridSpan } from '@/stores/session';

interface UseGridResizeOptions {
  initialSpan: GridSpan;
  maxCols?: number;
  maxRows?: number;
  onResize: (span: GridSpan) => void;
  gridRef?: React.RefObject<HTMLElement | null>;
}

interface ResizeState {
  isResizing: boolean;
  previewSpan: GridSpan;
}

const MIN_COLS = 1;
const MIN_ROWS = 1;

export function useGridResize({
  initialSpan,
  maxCols = 3,
  maxRows = 2,
  onResize,
  gridRef,
}: UseGridResizeOptions) {
  const [resizeState, setResizeState] = useState<ResizeState>({
    isResizing: false,
    previewSpan: initialSpan,
  });

  const startPosRef = useRef({ x: 0, y: 0 });
  const cardRectRef = useRef<DOMRect | null>(null);
  const gridInfoRef = useRef<{ cellWidth: number; cellHeight: number; gap: number } | null>(null);

  const calculateGridInfo = useCallback(() => {
    if (!gridRef?.current) return null;

    const gridStyle = getComputedStyle(gridRef.current);
    const gap = parseFloat(gridStyle.gap) || 16;
    const gridRect = gridRef.current.getBoundingClientRect();

    // Get the number of columns from the grid
    const cols = gridStyle.gridTemplateColumns.split(' ').length;
    const cellWidth = (gridRect.width - gap * (cols - 1)) / cols;

    // Estimate row height from first child or use default
    const firstChild = gridRef.current.firstElementChild as HTMLElement;
    const cellHeight = firstChild?.offsetHeight || 300;

    return { cellWidth, cellHeight, gap };
  }, [gridRef]);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent, cardElement: HTMLElement) => {
      e.preventDefault();
      e.stopPropagation();

      startPosRef.current = { x: e.clientX, y: e.clientY };
      cardRectRef.current = cardElement.getBoundingClientRect();
      gridInfoRef.current = calculateGridInfo();

      setResizeState({
        isResizing: true,
        previewSpan: initialSpan,
      });
    },
    [initialSpan, calculateGridInfo]
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!resizeState.isResizing || !cardRectRef.current || !gridInfoRef.current) return;

      const { cellWidth, cellHeight, gap } = gridInfoRef.current;
      const deltaX = e.clientX - startPosRef.current.x;
      const deltaY = e.clientY - startPosRef.current.y;

      // Calculate new dimensions
      const newWidth = cardRectRef.current.width + deltaX;
      const newHeight = cardRectRef.current.height + deltaY;

      // Convert to grid spans (add half cell for snapping threshold)
      const colSpan = Math.max(
        MIN_COLS,
        Math.min(maxCols, Math.round((newWidth + gap / 2) / (cellWidth + gap)))
      );
      const rowSpan = Math.max(
        MIN_ROWS,
        Math.min(maxRows, Math.round((newHeight + gap / 2) / (cellHeight + gap)))
      );

      setResizeState((prev) => ({
        ...prev,
        previewSpan: { colSpan, rowSpan },
      }));
    },
    [resizeState.isResizing, maxCols, maxRows]
  );

  const handleMouseUp = useCallback(() => {
    if (!resizeState.isResizing) return;

    // Commit the resize
    onResize(resizeState.previewSpan);

    setResizeState({
      isResizing: false,
      previewSpan: resizeState.previewSpan,
    });
  }, [resizeState.isResizing, resizeState.previewSpan, onResize]);

  useEffect(() => {
    if (!resizeState.isResizing) return;

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizeState.isResizing, handleMouseMove, handleMouseUp]);

  // Store previous span values in refs to compare without triggering effect
  const prevColSpanRef = useRef(initialSpan.colSpan);
  const prevRowSpanRef = useRef(initialSpan.rowSpan);

  // Update preview span when initial span changes (but not during resize)
  useEffect(() => {
    const colSpanChanged = prevColSpanRef.current !== initialSpan.colSpan;
    const rowSpanChanged = prevRowSpanRef.current !== initialSpan.rowSpan;

    if (!resizeState.isResizing && (colSpanChanged || rowSpanChanged)) {
      prevColSpanRef.current = initialSpan.colSpan;
      prevRowSpanRef.current = initialSpan.rowSpan;
      setResizeState((prev) => ({
        ...prev,
        previewSpan: initialSpan,
      }));
    }
  }, [initialSpan, resizeState.isResizing]);

  return {
    isResizing: resizeState.isResizing,
    previewSpan: resizeState.previewSpan,
    handleResizeStart,
  };
}
