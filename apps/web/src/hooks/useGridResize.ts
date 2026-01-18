'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import type { GridSpan } from '@/stores/session';

export type ResizeDirection = 'right' | 'left' | 'bottom-right' | 'bottom-left';

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
  direction: ResizeDirection | null;
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
    direction: null,
  });

  const startPosRef = useRef({ x: 0, y: 0 });
  const cardRectRef = useRef<DOMRect | null>(null);
  const gridInfoRef = useRef<{
    cellWidth: number;
    cellHeight: number;
    gap: number;
    cols: number;
    gridLeft: number;
  } | null>(null);
  const initialColStartRef = useRef<number>(1);

  const calculateGridInfo = useCallback(
    (cardElement?: HTMLElement) => {
      if (!gridRef?.current) return null;

      const gridStyle = getComputedStyle(gridRef.current);
      const gap = parseFloat(gridStyle.gap) || 16;
      const gridRect = gridRef.current.getBoundingClientRect();

      // Get the number of columns from the grid
      const cols = gridStyle.gridTemplateColumns.split(' ').length;
      const cellWidth = (gridRect.width - gap * (cols - 1)) / cols;

      // Get row height from grid auto-rows style (e.g., "300px" from auto-rows-[300px])
      const autoRows = gridStyle.gridAutoRows;
      const cellHeight = parseFloat(autoRows) || 300;

      // Calculate current column position of the card (1-based)
      if (cardElement) {
        const cardRect = cardElement.getBoundingClientRect();
        const relativeLeft = cardRect.left - gridRect.left;
        // Calculate which column the card starts in (1-based)
        const colStart = Math.round(relativeLeft / (cellWidth + gap)) + 1;
        initialColStartRef.current = Math.max(1, Math.min(cols, colStart));
      }

      return { cellWidth, cellHeight, gap, cols, gridLeft: gridRect.left };
    },
    [gridRef]
  );

  const handleResizeStart = useCallback(
    (
      e: React.MouseEvent,
      cardElement: HTMLElement,
      direction: ResizeDirection = 'bottom-right'
    ) => {
      e.preventDefault();
      e.stopPropagation();

      startPosRef.current = { x: e.clientX, y: e.clientY };
      cardRectRef.current = cardElement.getBoundingClientRect();
      gridInfoRef.current = calculateGridInfo(cardElement);

      // Use existing colStart or the calculated one
      const startColStart = initialSpan.colStart ?? initialColStartRef.current;

      setResizeState({
        isResizing: true,
        previewSpan: { ...initialSpan, colStart: startColStart },
        direction,
      });
    },
    [initialSpan, calculateGridInfo]
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!resizeState.isResizing || !cardRectRef.current || !gridInfoRef.current) return;

      const { cellWidth, cellHeight, gap, cols } = gridInfoRef.current;
      const deltaX = e.clientX - startPosRef.current.x;
      const deltaY = e.clientY - startPosRef.current.y;

      const isLeftResize =
        resizeState.direction === 'left' || resizeState.direction === 'bottom-left';

      // Calculate row span (same for both directions)
      const newHeight = cardRectRef.current.height + deltaY;
      const rowSpan = Math.max(
        MIN_ROWS,
        Math.min(maxRows, Math.round((newHeight + gap / 2) / (cellHeight + gap)))
      );

      const currentColStart = resizeState.previewSpan.colStart ?? initialColStartRef.current;
      const currentColSpan = initialSpan.colSpan;

      let newColStart: number;
      let newColSpan: number;

      if (isLeftResize) {
        // Left resize: moving left decreases colStart and increases colSpan
        // Calculate how many columns the mouse has moved
        const colDelta = Math.round(deltaX / (cellWidth + gap));

        // New start position (moving left = negative delta = lower colStart)
        newColStart = Math.max(1, currentColStart + colDelta);

        // Calculate the right edge position (should stay fixed)
        const originalRightCol = currentColStart + currentColSpan - 1;

        // New span is from newColStart to the original right edge
        newColSpan = Math.max(MIN_COLS, Math.min(maxCols, originalRightCol - newColStart + 1));

        // Ensure colStart doesn't go below 1
        if (newColStart < 1) {
          newColStart = 1;
          newColSpan = Math.min(maxCols, originalRightCol);
        }

        // Ensure we don't exceed maxCols total
        if (newColStart + newColSpan - 1 > cols) {
          newColSpan = cols - newColStart + 1;
        }
      } else {
        // Right resize: colStart stays the same, only colSpan changes
        newColStart = currentColStart;
        const newWidth = cardRectRef.current.width + deltaX;
        newColSpan = Math.max(
          MIN_COLS,
          Math.min(maxCols, Math.round((newWidth + gap / 2) / (cellWidth + gap)))
        );

        // Ensure we don't exceed grid bounds
        if (newColStart + newColSpan - 1 > cols) {
          newColSpan = cols - newColStart + 1;
        }
      }

      setResizeState((prev) => ({
        ...prev,
        previewSpan: { colSpan: newColSpan, rowSpan, colStart: newColStart },
      }));
    },
    [
      resizeState.isResizing,
      resizeState.direction,
      resizeState.previewSpan.colStart,
      initialSpan.colSpan,
      maxCols,
      maxRows,
    ]
  );

  const handleMouseUp = useCallback(() => {
    if (!resizeState.isResizing) return;

    // Commit the resize
    onResize(resizeState.previewSpan);

    setResizeState({
      isResizing: false,
      previewSpan: resizeState.previewSpan,
      direction: null,
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
    resizeDirection: resizeState.direction,
    handleResizeStart,
  };
}
