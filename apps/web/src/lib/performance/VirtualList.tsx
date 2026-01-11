'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { cn } from '@/lib/utils';

// ============================================================================
// Types
// ============================================================================

interface VirtualListProps<T> {
  items: T[];
  itemHeight: number | ((item: T, index: number) => number);
  renderItem: (item: T, index: number, style: React.CSSProperties) => React.ReactNode;
  overscan?: number;
  className?: string;
  onEndReached?: () => void;
  endReachedThreshold?: number;
  getItemKey?: (item: T, index: number) => string | number;
}

// ============================================================================
// Virtual List Component
// ============================================================================

export function VirtualList<T>({
  items,
  itemHeight,
  renderItem,
  overscan = 5,
  className,
  onEndReached,
  endReachedThreshold = 200,
  getItemKey = (_, index) => index,
}: VirtualListProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);

  // Calculate item heights and positions
  const { totalHeight, itemPositions } = useMemo(() => {
    const positions: { top: number; height: number }[] = [];
    let total = 0;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item === undefined) continue;
      const height = typeof itemHeight === 'function' ? itemHeight(item, i) : itemHeight;
      positions.push({ top: total, height });
      total += height;
    }

    return { totalHeight: total, itemPositions: positions };
  }, [items, itemHeight]);

  // Find visible range
  const visibleRange = useMemo(() => {
    if (itemPositions.length === 0) return { start: 0, end: 0 };

    let start = 0;
    let end = itemPositions.length;

    // Binary search for start
    let low = 0;
    let high = itemPositions.length - 1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const pos = itemPositions[mid];
      if (pos && pos.top + pos.height < scrollTop) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    start = Math.max(0, low - overscan);

    // Binary search for end
    low = start;
    high = itemPositions.length - 1;
    const bottomThreshold = scrollTop + containerHeight;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const pos = itemPositions[mid];
      if (pos && pos.top > bottomThreshold) {
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }
    end = Math.min(itemPositions.length, low + overscan);

    return { start, end };
  }, [scrollTop, containerHeight, itemPositions, overscan]);

  // Handle scroll
  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const target = e.target as HTMLDivElement;
      setScrollTop(target.scrollTop);

      // Check if end reached
      if (onEndReached) {
        const distanceFromBottom = totalHeight - target.scrollTop - target.clientHeight;
        if (distanceFromBottom < endReachedThreshold) {
          onEndReached();
        }
      }
    },
    [totalHeight, endReachedThreshold, onEndReached]
  );

  // Observe container resize
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height);
      }
    });

    observer.observe(container);
    setContainerHeight(container.clientHeight);

    return () => observer.disconnect();
  }, []);

  // Render visible items
  const visibleItems = useMemo(() => {
    const result: React.ReactNode[] = [];

    for (let i = visibleRange.start; i < visibleRange.end; i++) {
      const item = items[i];
      const position = itemPositions[i];
      if (item === undefined || position === undefined) continue;

      const style: React.CSSProperties = {
        position: 'absolute',
        top: position.top,
        left: 0,
        right: 0,
        height: position.height,
      };

      result.push(
        <div key={getItemKey(item, i)} style={style}>
          {renderItem(item, i, style)}
        </div>
      );
    }

    return result;
  }, [items, visibleRange, itemPositions, renderItem, getItemKey]);

  return (
    <div ref={containerRef} className={cn('overflow-auto', className)} onScroll={handleScroll}>
      <div style={{ height: totalHeight, position: 'relative' }}>{visibleItems}</div>
    </div>
  );
}

// ============================================================================
// Virtual Grid Component
// ============================================================================

interface VirtualGridProps<T> {
  items: T[];
  itemWidth: number;
  itemHeight: number;
  renderItem: (item: T, index: number, style: React.CSSProperties) => React.ReactNode;
  gap?: number;
  overscan?: number;
  className?: string;
  getItemKey?: (item: T, index: number) => string | number;
}

export function VirtualGrid<T>({
  items,
  itemWidth,
  itemHeight,
  renderItem,
  gap = 0,
  overscan = 2,
  className,
  getItemKey = (_, index) => index,
}: VirtualGridProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  // Calculate columns
  const columns = useMemo(() => {
    if (containerSize.width === 0) return 1;
    return Math.max(1, Math.floor((containerSize.width + gap) / (itemWidth + gap)));
  }, [containerSize.width, itemWidth, gap]);

  // Calculate rows
  const rows = Math.ceil(items.length / columns);
  const totalHeight = rows * (itemHeight + gap) - gap;

  // Find visible range
  const visibleRange = useMemo(() => {
    const rowHeight = itemHeight + gap;
    const startRow = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
    const endRow = Math.min(
      rows,
      Math.ceil((scrollTop + containerSize.height) / rowHeight) + overscan
    );

    return {
      startRow,
      endRow,
      startIndex: startRow * columns,
      endIndex: Math.min(items.length, endRow * columns),
    };
  }, [scrollTop, containerSize.height, itemHeight, gap, rows, columns, overscan, items.length]);

  // Handle scroll
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop((e.target as HTMLDivElement).scrollTop);
  }, []);

  // Observe container resize
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });

    observer.observe(container);
    setContainerSize({
      width: container.clientWidth,
      height: container.clientHeight,
    });

    return () => observer.disconnect();
  }, []);

  // Render visible items
  const visibleItems = useMemo(() => {
    const result: React.ReactNode[] = [];

    for (let i = visibleRange.startIndex; i < visibleRange.endIndex; i++) {
      const item = items[i];
      if (item === undefined) continue;
      const row = Math.floor(i / columns);
      const col = i % columns;

      const style: React.CSSProperties = {
        position: 'absolute',
        top: row * (itemHeight + gap),
        left: col * (itemWidth + gap),
        width: itemWidth,
        height: itemHeight,
      };

      result.push(
        <div key={getItemKey(item, i)} style={style}>
          {renderItem(item, i, style)}
        </div>
      );
    }

    return result;
  }, [items, visibleRange, columns, itemWidth, itemHeight, gap, renderItem, getItemKey]);

  return (
    <div ref={containerRef} className={cn('overflow-auto', className)} onScroll={handleScroll}>
      <div style={{ height: totalHeight, position: 'relative' }}>{visibleItems}</div>
    </div>
  );
}
