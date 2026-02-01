'use client';

import { useEffect, useCallback, useState, useRef } from 'react';
import { Plus, X, Terminal as TerminalIcon, RefreshCw, Maximize2, Minimize2 } from 'lucide-react';
import { useUIStore } from '@/stores/ui';
import { useSessionStore } from '@/stores/session';
import { TerminalView } from './TerminalView';
import { useTerminalManager } from '@/contexts/TerminalManager';
import { cn } from '@/lib/utils';

const MIN_HEIGHT = 150;
const MAX_HEIGHT = 800;

export interface TerminalPanelProps {
  sessionId: string;
}

export function TerminalPanel({ sessionId }: TerminalPanelProps) {
  const { setTerminalVisible, terminalHeight, setTerminalHeight, defaultShell } = useUIStore();
  const session = useSessionStore((state) => state.sessions[sessionId]);
  const { addTerminalWindow, removeTerminalWindow, setActiveWindow } = useSessionStore();
  const { reconnectTerminal, destroyTerminal } = useTerminalManager();

  const [isDragging, setIsDragging] = useState(false);
  const dragStartY = useRef(0);
  const dragStartHeight = useRef(0);

  // Get panel terminals only (not grid terminals)
  // Default to 'panel' for terminals without location (migration case)
  const allTerminalWindows = session?.terminalWindows ?? [];
  const terminalWindows = allTerminalWindows.filter((t) => !t.location || t.location === 'panel');
  const activeWindowId = session?.activeWindowId;
  const workspaceId = session?.workspaceId;

  // Find active terminal - default to first panel terminal if none selected
  const activeTerminal = terminalWindows.find((t) => t.id === activeWindowId) ?? terminalWindows[0];
  const activeTerminalId = activeTerminal?.id;

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

  // Add a new panel terminal
  const handleAddTerminal = useCallback(() => {
    addTerminalWindow(sessionId, 'panel', undefined, defaultShell);
  }, [sessionId, addTerminalWindow, defaultShell]);

  // Close a terminal tab
  const handleCloseTab = useCallback(
    (terminalId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      // Destroy the terminal connection first
      destroyTerminal(terminalId);
      // Then remove from session store
      removeTerminalWindow(sessionId, terminalId);
    },
    [sessionId, removeTerminalWindow, destroyTerminal]
  );

  // Switch to a terminal tab
  const handleSelectTab = useCallback(
    (terminalId: string) => {
      setActiveWindow(sessionId, terminalId);
    },
    [sessionId, setActiveWindow]
  );

  // Reconnect terminal
  const handleReconnect = useCallback(() => {
    if (!activeTerminalId) return;
    reconnectTerminal(activeTerminalId);
  }, [activeTerminalId, reconnectTerminal]);

  // Wait for valid workspaceId before rendering
  if (!workspaceId) {
    return (
      <div className="flex h-full items-center justify-center bg-surface">
        <div className="animate-spin h-6 w-6 border-2 border-accent-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  // If no terminals exist, show prompt to create one
  if (terminalWindows.length === 0) {
    return (
      <div className="flex h-full flex-col bg-surface">
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
        <div className="flex-1 flex items-center justify-center">
          <button
            onClick={handleAddTerminal}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-elevated hover:bg-overlay transition-colors text-text-secondary hover:text-text-primary"
          >
            <Plus className="h-4 w-4" />
            <span>New Terminal</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-surface">
      {/* Draggable resize handle at top */}
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

      {/* Tab bar */}
      <div className="flex items-center justify-between border-b border-border-subtle bg-elevated/50 flex-shrink-0">
        {/* Tabs */}
        <div className="flex items-center overflow-x-auto flex-1">
          {terminalWindows.map((terminal) => (
            <div
              key={terminal.id}
              onClick={() => handleSelectTab(terminal.id)}
              className={cn(
                'group flex items-center gap-1.5 px-3 py-2 text-xs cursor-pointer border-b-2 transition-colors min-w-0',
                activeTerminalId === terminal.id
                  ? 'border-accent-primary text-text-primary bg-overlay/50'
                  : 'border-transparent text-text-muted hover:text-text-secondary hover:bg-overlay/30'
              )}
            >
              <TerminalIcon className="h-3 w-3 flex-shrink-0 text-cyan-400" />
              <span className="truncate max-w-[100px]">{terminal.name}</span>
              <span className="text-[10px] text-text-muted">({terminal.shell})</span>
              {terminalWindows.length > 1 && (
                <button
                  onClick={(e) => handleCloseTab(terminal.id, e)}
                  className="ml-1 rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-overlay hover:text-text-primary transition-opacity"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              )}
            </div>
          ))}

          {/* Add tab button */}
          <button
            onClick={handleAddTerminal}
            className="flex items-center px-2 py-2 text-text-muted hover:text-text-secondary hover:bg-overlay/30 transition-colors"
            title="New Terminal"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-1 px-2">
          <button
            onClick={handleReconnect}
            className="rounded p-1 text-text-muted hover:bg-overlay hover:text-text-secondary"
            title="Reconnect"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setTerminalHeight(terminalHeight === 300 ? 500 : 300)}
            className="rounded p-1 text-text-muted hover:bg-overlay hover:text-text-secondary"
            title={terminalHeight === 300 ? 'Maximize' : 'Minimize'}
          >
            {terminalHeight === 300 ? (
              <Maximize2 className="h-3.5 w-3.5" />
            ) : (
              <Minimize2 className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            onClick={() => setTerminalVisible(false)}
            className="rounded p-1 text-text-muted hover:bg-overlay hover:text-accent-error"
            title="Close Terminal Panel"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Terminal instances - only render active terminal to prevent duplicates */}
      <div className="flex-1 relative" style={{ minHeight: 0 }}>
        {activeTerminal && (
          <div className="absolute inset-0">
            <TerminalView
              terminalId={activeTerminal.id}
              workspaceId={workspaceId}
              shell={activeTerminal.shell}
              isActive={true}
            />
          </div>
        )}
      </div>
    </div>
  );
}
