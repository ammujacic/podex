'use client';

import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { motion, useDragControls, useMotionValue } from 'framer-motion';
import { GripVertical, Maximize2, Minimize2, X, Globe } from 'lucide-react';
import { type AgentPosition, useSessionStore } from '@/stores/session';
import { PreviewPanel } from './PreviewPanel';
import { cn } from '@/lib/utils';
import { useCardDimensions } from '@/hooks/useCardDimensions';

interface DraggablePreviewCardProps {
  sessionId: string;
  workspaceId: string;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

export function DraggablePreviewCard({
  sessionId,
  workspaceId,
  containerRef,
}: DraggablePreviewCardProps) {
  const { sessions, updatePreviewFreeformPosition, removePreviewGridCard } = useSessionStore();

  const dragControls = useDragControls();
  const cardRef = useRef<HTMLDivElement>(null);
  const [isResizing, setIsResizing] = useState(false);
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const [isMaximized, setIsMaximized] = useState(false);
  const [preMaximizePosition, setPreMaximizePosition] = useState<AgentPosition | null>(null);
  const [localZIndex, setLocalZIndex] = useState(100);

  // Get dimensions from ConfigStore (config is guaranteed to be loaded by ConfigGate)
  const cardDimensions = useCardDimensions('preview');
  const MIN_WIDTH = cardDimensions.minWidth;
  const MIN_HEIGHT = cardDimensions.minHeight;
  const DEFAULT_WIDTH = cardDimensions.width;
  const DEFAULT_HEIGHT = cardDimensions.height;

  const session = sessions[sessionId];

  // Memoize position to avoid creating new object on every render
  const position = useMemo<AgentPosition>(() => {
    return (
      session?.previewFreeformPosition ?? {
        x: 150,
        y: 150,
        width: DEFAULT_WIDTH,
        height: DEFAULT_HEIGHT,
        zIndex: 100,
      }
    );
  }, [session?.previewFreeformPosition, DEFAULT_WIDTH, DEFAULT_HEIGHT]);

  // Use motion values for smooth dragging
  const x = useMotionValue(position.x);
  const y = useMotionValue(position.y);

  // Sync motion values with store position when it changes externally
  useEffect(() => {
    x.set(position.x);
    y.set(position.y);
  }, [position.x, position.y, x, y]);

  // Track if we've initialized the position
  const hasInitializedRef = useRef(false);

  // Sync initial position to store if not set (only once)
  useEffect(() => {
    if (!session?.previewFreeformPosition && !hasInitializedRef.current) {
      hasInitializedRef.current = true;
      updatePreviewFreeformPosition(sessionId, position);
    }
  }, [session?.previewFreeformPosition, sessionId, updatePreviewFreeformPosition, position]);

  const bringToFront = useCallback(() => {
    setLocalZIndex((prev) => prev + 1);
    updatePreviewFreeformPosition(sessionId, { zIndex: localZIndex + 1 });
  }, [sessionId, updatePreviewFreeformPosition, localZIndex]);

  const handleDragStart = useCallback(() => {
    bringToFront();
  }, [bringToFront]);

  const handleDragEnd = useCallback(() => {
    const newX = x.get();
    const newY = y.get();

    const container = containerRef.current;
    if (container) {
      const bounds = container.getBoundingClientRect();
      const clampedX = Math.max(0, Math.min(newX, bounds.width - position.width));
      const clampedY = Math.max(0, Math.min(newY, bounds.height - position.height));

      x.set(clampedX);
      y.set(clampedY);
      updatePreviewFreeformPosition(sessionId, { x: clampedX, y: clampedY });
    } else {
      updatePreviewFreeformPosition(sessionId, { x: newX, y: newY });
    }
  }, [
    x,
    y,
    containerRef,
    position.width,
    position.height,
    sessionId,
    updatePreviewFreeformPosition,
  ]);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      bringToFront();
      setIsResizing(true);
      setResizeStart({
        x: e.clientX,
        y: e.clientY,
        width: position.width,
        height: position.height,
      });
    },
    [bringToFront, position.width, position.height]
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isResizing) return;

      const deltaX = e.clientX - resizeStart.x;
      const deltaY = e.clientY - resizeStart.y;

      const newWidth = Math.max(MIN_WIDTH, resizeStart.width + deltaX);
      const newHeight = Math.max(MIN_HEIGHT, resizeStart.height + deltaY);

      updatePreviewFreeformPosition(sessionId, { width: newWidth, height: newHeight });
    },
    [isResizing, resizeStart, sessionId, updatePreviewFreeformPosition, MIN_WIDTH, MIN_HEIGHT]
  );

  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, handleMouseMove, handleMouseUp]);

  const handleMaximize = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    if (isMaximized && preMaximizePosition) {
      x.set(preMaximizePosition.x);
      y.set(preMaximizePosition.y);
      updatePreviewFreeformPosition(sessionId, preMaximizePosition);
      setIsMaximized(false);
      setPreMaximizePosition(null);
    } else {
      setPreMaximizePosition(position);
      const bounds = container.getBoundingClientRect();
      x.set(0);
      y.set(0);
      updatePreviewFreeformPosition(sessionId, {
        x: 0,
        y: 0,
        width: bounds.width - 16,
        height: bounds.height - 16,
      });
      setIsMaximized(true);
    }
  }, [
    containerRef,
    isMaximized,
    preMaximizePosition,
    position,
    sessionId,
    updatePreviewFreeformPosition,
    x,
    y,
  ]);

  const handleClose = useCallback(() => {
    removePreviewGridCard(sessionId);
  }, [removePreviewGridCard, sessionId]);

  const handleCardClick = useCallback(() => {
    bringToFront();
  }, [bringToFront]);

  // Don't render if no preview card exists
  if (!session?.previewGridCardId) {
    return null;
  }

  return (
    <motion.div
      ref={cardRef}
      drag
      dragControls={dragControls}
      dragMomentum={false}
      dragElastic={0}
      dragListener={false}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onClick={handleCardClick}
      className="absolute rounded-lg shadow-lg overflow-hidden border border-border-default bg-surface"
      style={{
        x,
        y,
        width: position.width,
        height: position.height,
        zIndex: position.zIndex,
      }}
    >
      <div className="relative h-full flex flex-col">
        {/* Drag handle bar */}
        <div
          className="flex items-center justify-between px-2 py-1 bg-elevated border-b border-border-subtle cursor-move select-none shrink-0"
          onPointerDown={(e) => dragControls.start(e)}
        >
          <div className="flex items-center gap-1 text-text-muted">
            <GripVertical className="h-4 w-4" />
            <Globe className="h-4 w-4 text-accent-secondary" />
            <span className="text-xs font-medium">Live Preview</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleMaximize}
              className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-overlay"
              title={isMaximized ? 'Restore' : 'Maximize'}
            >
              {isMaximized ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
            </button>
            <button
              onClick={handleClose}
              className="p-1 rounded text-text-muted hover:text-accent-error hover:bg-overlay"
              title="Close Preview"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>

        {/* Preview content */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <PreviewPanel workspaceId={workspaceId} />
        </div>

        {/* Resize handle */}
        <div
          className={cn(
            'absolute bottom-0 right-0 w-4 h-4 cursor-se-resize z-10',
            'after:absolute after:bottom-1 after:right-1 after:w-2 after:h-2',
            'after:border-r-2 after:border-b-2 after:border-text-muted after:opacity-50',
            'hover:after:opacity-100'
          )}
          onMouseDown={handleResizeStart}
        />
      </div>
    </motion.div>
  );
}
