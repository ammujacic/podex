'use client';

import { useEffect, useCallback, useState, useRef } from 'react';
import { useUIStore } from '@/stores/ui';
import { useSessionStore } from '@/stores/session';
import { getUserConfig } from '@/lib/api/user-config';
import { useTerminalStore } from '@/stores/terminal';
import { SplitTerminalLayout } from './SplitTerminalLayout';
import { cn } from '@/lib/utils';

const MIN_HEIGHT = 150;
const MAX_HEIGHT = 800;

export interface TerminalPanelProps {
  sessionId: string;
}

export function TerminalPanel({ sessionId }: TerminalPanelProps) {
  const { setTerminalVisible, terminalHeight, setTerminalHeight } = useUIStore();
  const session = useSessionStore((state) => state.sessions[sessionId]);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartY = useRef(0);
  const dragStartHeight = useRef(0);

  // Handle resize drag
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      dragStartY.current = e.clientY;
      dragStartHeight.current = terminalHeight;
    },
    [terminalHeight]
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      // Dragging up increases height, dragging down decreases
      const delta = dragStartY.current - e.clientY;
      const newHeight = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, dragStartHeight.current + delta));
      setTerminalHeight(newHeight);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, setTerminalHeight]);

  // Get actual workspace_id from session, fallback to sessionId
  const workspaceId = session?.workspaceId || sessionId;

  const { initLayout, setDefaultShell, getLayout } = useTerminalStore();

  const layout = getLayout(sessionId);

  // Load user's default shell preference and init layout
  useEffect(() => {
    async function loadConfig() {
      try {
        const config = await getUserConfig();
        if (config?.default_shell) {
          setDefaultShell(config.default_shell);
          initLayout(sessionId, config.default_shell);
        } else {
          initLayout(sessionId);
        }
      } catch {
        initLayout(sessionId);
      }
    }
    loadConfig();
  }, [sessionId, initLayout, setDefaultShell]);

  if (!layout) {
    return (
      <div className="flex h-full items-center justify-center bg-surface">
        <div className="animate-spin h-6 w-6 border-2 border-accent-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-surface">
      {/* Draggable resize handle at top - visible purple border */}
      <div
        onMouseDown={handleMouseDown}
        className={cn(
          'h-1 cursor-row-resize flex-shrink-0 transition-colors',
          'bg-accent-primary/40',
          'hover:bg-accent-primary/70',
          isDragging && 'bg-accent-primary'
        )}
        title="Drag to resize terminal"
      />

      {/* Terminal content - pane headers provide all controls */}
      <div className="flex-1 relative" style={{ minHeight: 0 }}>
        <SplitTerminalLayout
          sessionId={sessionId}
          workspaceId={workspaceId}
          layout={layout}
          terminalHeight={terminalHeight}
          setTerminalHeight={setTerminalHeight}
          setTerminalVisible={setTerminalVisible}
        />
      </div>

      {/* Keyboard shortcuts hint */}
      <div className="flex items-center justify-center gap-4 px-2 py-1 border-t border-border-subtle text-[10px] text-text-muted">
        <span>
          <kbd className="px-1 py-0.5 bg-overlay rounded text-[9px]">Cmd+Shift+D</kbd> Split H
        </span>
        <span>
          <kbd className="px-1 py-0.5 bg-overlay rounded text-[9px]">Cmd+Shift+E</kbd> Split V
        </span>
        <span>
          <kbd className="px-1 py-0.5 bg-overlay rounded text-[9px]">Cmd+]</kbd> Next Pane
        </span>
        <span>
          <kbd className="px-1 py-0.5 bg-overlay rounded text-[9px]">Cmd+[</kbd> Prev Pane
        </span>
      </div>
    </div>
  );
}
