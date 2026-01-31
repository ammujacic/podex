'use client';

import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { motion, useDragControls, useMotionValue } from 'framer-motion';
import { GripVertical, Maximize2, Minimize2 } from 'lucide-react';
import { type TerminalWindow, type AgentPosition, useSessionStore } from '@/stores/session';
import { TerminalCard } from './TerminalCard';
import { cn } from '@/lib/utils';
import { useCardDimensions } from '@/hooks/useCardDimensions';

interface DraggableTerminalCardProps {
  terminalWindow: TerminalWindow;
  sessionId: string;
  workspaceId: string;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

export function DraggableTerminalCard({
  terminalWindow,
  sessionId,
  workspaceId,
  containerRef,
}: DraggableTerminalCardProps) {
  const { updateTerminalWindowPosition, bringTerminalWindowToFront } = useSessionStore();
  const dragControls = useDragControls();
  const cardRef = useRef<HTMLDivElement>(null);
  const [isResizing, setIsResizing] = useState(false);
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const [isMaximized, setIsMaximized] = useState(false);
  const [preMaximizePosition, setPreMaximizePosition] = useState<AgentPosition | null>(null);

  // Get dimensions from ConfigStore (config is guaranteed to be loaded by ConfigGate)
  const cardDimensions = useCardDimensions('terminal');
  const MIN_WIDTH = cardDimensions.minWidth;
  const MIN_HEIGHT = cardDimensions.minHeight;
  const DEFAULT_WIDTH = cardDimensions.width;
  const DEFAULT_HEIGHT = cardDimensions.height;

  // Store initial random offset in ref to keep it stable
  const initialOffsetRef = useRef({
    x: 50 + Math.random() * 100,
    y: 50 + Math.random() * 50,
  });

  // Memoize position to avoid creating new object on every render
  const position = useMemo<AgentPosition>(() => {
    return (
      terminalWindow.position ?? {
        x: initialOffsetRef.current.x,
        y: initialOffsetRef.current.y,
        width: DEFAULT_WIDTH,
        height: DEFAULT_HEIGHT,
        zIndex: 1,
      }
    );
  }, [terminalWindow.position, DEFAULT_WIDTH, DEFAULT_HEIGHT]);

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
    if (!terminalWindow.position && !hasInitializedRef.current) {
      hasInitializedRef.current = true;
      updateTerminalWindowPosition(sessionId, terminalWindow.id, position);
    }
  }, [
    terminalWindow.id,
    terminalWindow.position,
    sessionId,
    updateTerminalWindowPosition,
    position,
  ]);

  const handleDragStart = useCallback(() => {
    bringTerminalWindowToFront(sessionId, terminalWindow.id);
  }, [bringTerminalWindowToFront, sessionId, terminalWindow.id]);

  const handleDragEnd = useCallback(() => {
    // Get the current position from motion values
    const newX = x.get();
    const newY = y.get();

    // Constrain to container bounds
    const container = containerRef.current;
    if (container) {
      const rect = container.getBoundingClientRect();
      const constrainedX = Math.max(0, Math.min(newX, rect.width - position.width));
      const constrainedY = Math.max(0, Math.min(newY, rect.height - position.height));

      updateTerminalWindowPosition(sessionId, terminalWindow.id, {
        x: constrainedX,
        y: constrainedY,
      });
    } else {
      updateTerminalWindowPosition(sessionId, terminalWindow.id, { x: newX, y: newY });
    }
  }, [
    containerRef,
    position.width,
    position.height,
    sessionId,
    terminalWindow.id,
    updateTerminalWindowPosition,
    x,
    y,
  ]);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      bringTerminalWindowToFront(sessionId, terminalWindow.id);
      setIsResizing(true);
      setResizeStart({
        x: e.clientX,
        y: e.clientY,
        width: position.width,
        height: position.height,
      });
    },
    [bringTerminalWindowToFront, sessionId, terminalWindow.id, position.width, position.height]
  );

  const handleResizeMove = useCallback(
    (e: MouseEvent) => {
      if (!isResizing) return;

      const deltaX = e.clientX - resizeStart.x;
      const deltaY = e.clientY - resizeStart.y;

      const newWidth = Math.max(MIN_WIDTH, resizeStart.width + deltaX);
      const newHeight = Math.max(MIN_HEIGHT, resizeStart.height + deltaY);

      updateTerminalWindowPosition(sessionId, terminalWindow.id, {
        width: newWidth,
        height: newHeight,
      });
    },
    [
      isResizing,
      resizeStart,
      MIN_WIDTH,
      MIN_HEIGHT,
      sessionId,
      terminalWindow.id,
      updateTerminalWindowPosition,
    ]
  );

  const handleResizeEnd = useCallback(() => {
    setIsResizing(false);
  }, []);

  // Global mouse events for resizing
  useEffect(() => {
    if (!isResizing) return undefined;
    window.addEventListener('mousemove', handleResizeMove);
    window.addEventListener('mouseup', handleResizeEnd);
    return () => {
      window.removeEventListener('mousemove', handleResizeMove);
      window.removeEventListener('mouseup', handleResizeEnd);
    };
  }, [isResizing, handleResizeMove, handleResizeEnd]);

  const handleMaximize = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    if (isMaximized) {
      // Restore previous position
      if (preMaximizePosition) {
        updateTerminalWindowPosition(sessionId, terminalWindow.id, preMaximizePosition);
      }
      setIsMaximized(false);
    } else {
      // Save current position and maximize
      setPreMaximizePosition(position);
      const rect = container.getBoundingClientRect();
      updateTerminalWindowPosition(sessionId, terminalWindow.id, {
        x: 0,
        y: 0,
        width: rect.width,
        height: rect.height,
      });
      setIsMaximized(true);
    }
    bringTerminalWindowToFront(sessionId, terminalWindow.id);
  }, [
    containerRef,
    isMaximized,
    preMaximizePosition,
    position,
    sessionId,
    terminalWindow.id,
    updateTerminalWindowPosition,
    bringTerminalWindowToFront,
  ]);

  return (
    <motion.div
      ref={cardRef}
      className="absolute"
      style={{
        x,
        y,
        width: position.width,
        height: position.height,
        zIndex: position.zIndex,
      }}
      drag
      dragControls={dragControls}
      dragMomentum={false}
      dragElastic={0}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onClick={() => bringTerminalWindowToFront(sessionId, terminalWindow.id)}
    >
      <div className="relative h-full w-full">
        {/* Drag handle */}
        <div
          className="absolute left-0 top-0 z-10 flex h-10 w-8 cursor-move items-center justify-center rounded-tl-lg bg-zinc-800/50 opacity-0 transition-opacity hover:opacity-100"
          onPointerDown={(e) => {
            e.preventDefault();
            dragControls.start(e);
          }}
        >
          <GripVertical className="h-4 w-4 text-zinc-400" />
        </div>

        {/* Maximize/restore button */}
        <button
          className="absolute right-8 top-0 z-10 flex h-10 w-8 cursor-pointer items-center justify-center rounded-tr-lg bg-zinc-800/50 opacity-0 transition-opacity hover:opacity-100"
          onClick={handleMaximize}
        >
          {isMaximized ? (
            <Minimize2 className="h-4 w-4 text-zinc-400" />
          ) : (
            <Maximize2 className="h-4 w-4 text-zinc-400" />
          )}
        </button>

        {/* Terminal card content */}
        <TerminalCard
          terminalWindow={terminalWindow}
          sessionId={sessionId}
          workspaceId={workspaceId}
          expanded
        />

        {/* Resize handle */}
        <div
          className={cn(
            'absolute bottom-0 right-0 h-4 w-4 cursor-se-resize',
            'hover:bg-cyan-500/20 transition-colors rounded-br-lg'
          )}
          onMouseDown={handleResizeStart}
        />
      </div>
    </motion.div>
  );
}
