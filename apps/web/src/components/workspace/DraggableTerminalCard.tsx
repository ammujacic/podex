'use client';

import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { motion, useDragControls, useMotionValue } from 'framer-motion';
import { GripVertical, Maximize2, Minimize2, X } from 'lucide-react';
import { type Agent, type AgentPosition, useSessionStore } from '@/stores/session';
import { TerminalAgentCell, type TerminalAgentCellRef } from './TerminalAgentCell';
import { cn } from '@/lib/utils';

interface DraggableTerminalCardProps {
  agent: Agent;
  sessionId: string;
  workspaceId: string;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onRemove?: () => void;
}

const MIN_WIDTH = 400;
const MIN_HEIGHT = 300;
const DEFAULT_WIDTH = 500;
const DEFAULT_HEIGHT = 400;

export function DraggableTerminalCard({
  agent,
  sessionId,
  workspaceId,
  containerRef,
  onRemove,
}: DraggableTerminalCardProps) {
  const { updateAgentPosition, bringAgentToFront } = useSessionStore();
  const dragControls = useDragControls();
  const cardRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<TerminalAgentCellRef>(null);
  const [isResizing, setIsResizing] = useState(false);
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const [isMaximized, setIsMaximized] = useState(false);
  const [preMaximizePosition, setPreMaximizePosition] = useState<AgentPosition | null>(null);

  // Store initial random offset in ref to keep it stable
  const initialOffsetRef = useRef({
    x: 50 + Math.random() * 100,
    y: 50 + Math.random() * 50,
  });

  // Memoize position to avoid creating new object on every render
  const position = useMemo<AgentPosition>(() => {
    return (
      agent.position ?? {
        x: initialOffsetRef.current.x,
        y: initialOffsetRef.current.y,
        width: DEFAULT_WIDTH,
        height: DEFAULT_HEIGHT,
        zIndex: 1,
      }
    );
  }, [agent.position]);

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
    if (!agent.position && !hasInitializedRef.current) {
      hasInitializedRef.current = true;
      updateAgentPosition(sessionId, agent.id, position);
    }
  }, [agent.id, agent.position, sessionId, updateAgentPosition, position]);

  const handleDragStart = useCallback(() => {
    bringAgentToFront(sessionId, agent.id);
  }, [bringAgentToFront, sessionId, agent.id]);

  const handleDragEnd = useCallback(() => {
    // Get the current position from motion values
    const newX = x.get();
    const newY = y.get();

    // Clamp position within container bounds
    const container = containerRef.current;
    if (container) {
      const bounds = container.getBoundingClientRect();
      const clampedX = Math.max(0, Math.min(newX, bounds.width - position.width));
      const clampedY = Math.max(0, Math.min(newY, bounds.height - position.height));

      // Update both motion values and store
      x.set(clampedX);
      y.set(clampedY);
      updateAgentPosition(sessionId, agent.id, { x: clampedX, y: clampedY });
    } else {
      updateAgentPosition(sessionId, agent.id, { x: newX, y: newY });
    }
  }, [
    x,
    y,
    containerRef,
    position.width,
    position.height,
    sessionId,
    agent.id,
    updateAgentPosition,
  ]);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      bringAgentToFront(sessionId, agent.id);
      setIsResizing(true);
      setResizeStart({
        x: e.clientX,
        y: e.clientY,
        width: position.width,
        height: position.height,
      });
    },
    [bringAgentToFront, sessionId, agent.id, position.width, position.height]
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isResizing) return;

      const deltaX = e.clientX - resizeStart.x;
      const deltaY = e.clientY - resizeStart.y;

      const newWidth = Math.max(MIN_WIDTH, resizeStart.width + deltaX);
      const newHeight = Math.max(MIN_HEIGHT, resizeStart.height + deltaY);

      updateAgentPosition(sessionId, agent.id, { width: newWidth, height: newHeight });
    },
    [isResizing, resizeStart, sessionId, agent.id, updateAgentPosition]
  );

  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
    // Trigger terminal refit after resize
    requestAnimationFrame(() => {
      terminalRef.current?.fit();
    });
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
      // Restore to previous position
      x.set(preMaximizePosition.x);
      y.set(preMaximizePosition.y);
      updateAgentPosition(sessionId, agent.id, preMaximizePosition);
      setIsMaximized(false);
      setPreMaximizePosition(null);
    } else {
      // Save current position and maximize
      setPreMaximizePosition(position);
      const bounds = container.getBoundingClientRect();
      x.set(0);
      y.set(0);
      updateAgentPosition(sessionId, agent.id, {
        x: 0,
        y: 0,
        width: bounds.width - 16,
        height: bounds.height - 16,
      });
      setIsMaximized(true);
    }

    // Trigger terminal refit after maximize/restore
    requestAnimationFrame(() => {
      terminalRef.current?.fit();
    });
  }, [
    containerRef,
    isMaximized,
    preMaximizePosition,
    position,
    sessionId,
    agent.id,
    updateAgentPosition,
    x,
    y,
  ]);

  const handleCardClick = useCallback(() => {
    bringAgentToFront(sessionId, agent.id);
  }, [bringAgentToFront, sessionId, agent.id]);

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
            <span className="text-xs font-medium">{agent.name}</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleMaximize}
              className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-overlay"
              title={isMaximized ? 'Restore' : 'Maximize'}
            >
              {isMaximized ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
            </button>
            {onRemove && (
              <button
                onClick={onRemove}
                className="p-1 rounded text-text-muted hover:text-red-400 hover:bg-red-500/10"
                title="Remove agent"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

        {/* Terminal content - flex-1 to fill remaining space */}
        <div className="flex-1 min-h-0">
          <TerminalAgentCell
            ref={terminalRef}
            agent={agent}
            sessionId={sessionId}
            workspaceId={workspaceId}
            hideHeader
          />
        </div>

        {/* Resize handle - z-20 to be above terminal content (z-10) */}
        <div
          className={cn(
            'absolute bottom-0 right-0 w-6 h-6 cursor-se-resize z-20',
            'after:absolute after:bottom-1 after:right-1 after:w-3 after:h-3',
            'after:border-r-2 after:border-b-2 after:border-text-muted after:opacity-50',
            'hover:after:opacity-100 hover:after:border-accent-primary'
          )}
          onMouseDown={handleResizeStart}
        />
      </div>
    </motion.div>
  );
}
