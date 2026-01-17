'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  X,
  Plus,
  Terminal as TerminalIcon,
  SplitSquareHorizontal,
  SplitSquareVertical,
  RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { TerminalInstance } from './TerminalInstance';
import {
  useTerminalStore,
  type TerminalLayout,
  type TerminalPane,
  type TerminalSplit,
  isTerminalPane,
} from '@/stores/terminal';

interface SplitTerminalLayoutProps {
  sessionId: string;
  workspaceId: string;
  layout: TerminalLayout;
}

interface TerminalPaneViewProps {
  sessionId: string;
  workspaceId: string;
  pane: TerminalPane;
  isActive: boolean;
  onFocus: () => void;
}

// Resizer component for split panes
function Resizer({
  direction,
  onResize,
}: {
  direction: 'horizontal' | 'vertical';
  onResize: (delta: number) => void;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const startPos = useRef(0);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    startPos.current = direction === 'horizontal' ? e.clientX : e.clientY;
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const currentPos = direction === 'horizontal' ? e.clientX : e.clientY;
      const delta = currentPos - startPos.current;
      startPos.current = currentPos;
      onResize(delta);
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
  }, [isDragging, direction, onResize]);

  return (
    <div
      className={cn(
        'flex-shrink-0 transition-colors',
        direction === 'horizontal'
          ? 'w-1 cursor-col-resize hover:bg-accent-primary/50'
          : 'h-1 cursor-row-resize hover:bg-accent-primary/50',
        isDragging && 'bg-accent-primary/70'
      )}
      onMouseDown={handleMouseDown}
    />
  );
}

// Single pane view with tabs and terminal
function TerminalPaneView({
  sessionId,
  workspaceId,
  pane,
  isActive,
  onFocus,
}: TerminalPaneViewProps) {
  const { setActiveTab, addTab, closeTab, splitPane, closePane } = useTerminalStore();
  const terminalRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const handleAddTab = useCallback(() => {
    addTab(sessionId, pane.id);
  }, [sessionId, pane.id, addTab]);

  const handleCloseTab = useCallback(
    (tabId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      closeTab(sessionId, pane.id, tabId);
    },
    [sessionId, pane.id, closeTab]
  );

  const handleReconnect = useCallback(() => {
    const container = terminalRefs.current[pane.activeTabId] as HTMLDivElement & {
      reconnect?: () => void;
    };
    container?.reconnect?.();
  }, [pane.activeTabId]);

  const handleSplitHorizontal = useCallback(() => {
    splitPane(sessionId, pane.id, 'horizontal');
  }, [sessionId, pane.id, splitPane]);

  const handleSplitVertical = useCallback(() => {
    splitPane(sessionId, pane.id, 'vertical');
  }, [sessionId, pane.id, splitPane]);

  const handleClosePane = useCallback(() => {
    closePane(sessionId, pane.id);
  }, [sessionId, pane.id, closePane]);

  return (
    <div
      className={cn(
        'flex flex-col h-full bg-surface border border-border-subtle rounded overflow-hidden',
        isActive && 'ring-1 ring-accent-primary/50'
      )}
      onClick={onFocus}
    >
      {/* Pane header with tabs */}
      <div className="flex items-center justify-between border-b border-border-subtle bg-elevated/50">
        {/* Tabs */}
        <div className="flex items-center overflow-x-auto flex-1">
          {pane.tabs.map((tab) => (
            <div
              key={tab.id}
              onClick={(e) => {
                e.stopPropagation();
                setActiveTab(sessionId, pane.id, tab.id);
              }}
              className={cn(
                'group flex items-center gap-1.5 px-2.5 py-1.5 text-xs cursor-pointer border-b-2 transition-colors min-w-0',
                pane.activeTabId === tab.id
                  ? 'border-accent-primary text-text-primary bg-overlay/50'
                  : 'border-transparent text-text-muted hover:text-text-secondary hover:bg-overlay/30'
              )}
            >
              <TerminalIcon className="h-3 w-3 flex-shrink-0" />
              <span className="truncate max-w-[80px]">{tab.name}</span>
              <span className="text-[10px] text-text-muted">({tab.shell})</span>
              {pane.tabs.length > 1 && (
                <button
                  onClick={(e) => handleCloseTab(tab.id, e)}
                  className="ml-0.5 rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-overlay hover:text-text-primary transition-opacity"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              )}
            </div>
          ))}

          {/* Add tab button */}
          <button
            onClick={handleAddTab}
            className="flex items-center px-2 py-1.5 text-text-muted hover:text-text-secondary hover:bg-overlay/30 transition-colors"
            title="New Tab"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Pane controls */}
        <div className="flex items-center gap-0.5 px-1">
          <button
            onClick={handleReconnect}
            className="rounded p-1 text-text-muted hover:bg-overlay hover:text-text-secondary"
            title="Reconnect"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={handleSplitHorizontal}
            className="rounded p-1 text-text-muted hover:bg-overlay hover:text-text-secondary"
            title="Split Horizontally (Cmd+Shift+D)"
          >
            <SplitSquareHorizontal className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={handleSplitVertical}
            className="rounded p-1 text-text-muted hover:bg-overlay hover:text-text-secondary"
            title="Split Vertically (Cmd+Shift+E)"
          >
            <SplitSquareVertical className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={handleClosePane}
            className="rounded p-1 text-text-muted hover:bg-overlay hover:text-accent-error"
            title="Close Pane (Cmd+W)"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Terminal instances */}
      <div className="flex-1 relative" style={{ minHeight: 0 }}>
        {pane.tabs.map((tab) => (
          <div
            key={tab.id}
            ref={(el) => {
              terminalRefs.current[tab.id] = el;
            }}
            className={cn('absolute inset-0', pane.activeTabId === tab.id ? 'block' : 'hidden')}
          >
            <TerminalInstance
              workspaceId={workspaceId}
              tabId={tab.id}
              shell={tab.shell}
              isActive={isActive && pane.activeTabId === tab.id}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// Recursive split layout renderer
function SplitLayoutRenderer({
  sessionId,
  workspaceId,
  layout,
  activePaneId,
  onFocusPane,
  parentSize: _parentSize,
}: {
  sessionId: string;
  workspaceId: string;
  layout: TerminalLayout;
  activePaneId: string;
  onFocusPane: (paneId: string) => void;
  parentSize?: { width: number; height: number };
}) {
  const { resizePane } = useTerminalStore();
  const containerRef = useRef<HTMLDivElement>(null);

  if (isTerminalPane(layout)) {
    return (
      <TerminalPaneView
        sessionId={sessionId}
        workspaceId={workspaceId}
        pane={layout}
        isActive={layout.id === activePaneId}
        onFocus={() => onFocusPane(layout.id)}
      />
    );
  }

  // It's a split
  const split = layout as TerminalSplit;
  const isHorizontal = split.direction === 'horizontal';

  const handleResize = (index: number, delta: number) => {
    const container = containerRef.current;
    if (!container) return;

    const totalSize = isHorizontal ? container.offsetWidth : container.offsetHeight;
    const deltaPercent = (delta / totalSize) * 100;

    const pane = split.panes[index];
    if (pane && 'size' in pane) {
      const newSize = pane.size + deltaPercent;
      resizePane(sessionId, pane.id, newSize);

      // Also adjust the next pane
      const nextPane = split.panes[index + 1];
      if (nextPane && 'size' in nextPane) {
        resizePane(sessionId, nextPane.id, nextPane.size - deltaPercent);
      }
    }
  };

  return (
    <div
      ref={containerRef}
      className={cn('flex h-full w-full', isHorizontal ? 'flex-row' : 'flex-col')}
    >
      {split.panes.map((child, index) => {
        const size = 'size' in child ? child.size : 100 / split.panes.length;

        return (
          <div
            key={child.id}
            className="flex"
            style={{ [isHorizontal ? 'width' : 'height']: `${size}%` }}
          >
            <div className="flex-1 min-w-0 min-h-0">
              <SplitLayoutRenderer
                sessionId={sessionId}
                workspaceId={workspaceId}
                layout={child}
                activePaneId={activePaneId}
                onFocusPane={onFocusPane}
              />
            </div>

            {/* Add resizer between panes */}
            {index < split.panes.length - 1 && (
              <Resizer
                direction={split.direction}
                onResize={(delta) => handleResize(index, delta)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// Main split terminal layout component
export function SplitTerminalLayout({ sessionId, workspaceId, layout }: SplitTerminalLayoutProps) {
  const { activePaneId, setActivePane, splitPane, focusNextPane, focusPrevPane } =
    useTerminalStore();
  const currentActivePaneId = activePaneId[sessionId] || '';

  const handleFocusPane = useCallback(
    (paneId: string) => {
      setActivePane(sessionId, paneId);
    },
    [sessionId, setActivePane]
  );

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+Shift+D: Split horizontally
      if (e.metaKey && e.shiftKey && e.key === 'd') {
        e.preventDefault();
        if (currentActivePaneId) {
          splitPane(sessionId, currentActivePaneId, 'horizontal');
        }
      }
      // Cmd+Shift+E: Split vertically
      else if (e.metaKey && e.shiftKey && e.key === 'e') {
        e.preventDefault();
        if (currentActivePaneId) {
          splitPane(sessionId, currentActivePaneId, 'vertical');
        }
      }
      // Cmd+]: Focus next pane
      else if (e.metaKey && e.key === ']') {
        e.preventDefault();
        focusNextPane(sessionId);
      }
      // Cmd+[: Focus previous pane
      else if (e.metaKey && e.key === '[') {
        e.preventDefault();
        focusPrevPane(sessionId);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [sessionId, currentActivePaneId, splitPane, focusNextPane, focusPrevPane]);

  return (
    <div className="h-full w-full bg-void">
      <SplitLayoutRenderer
        sessionId={sessionId}
        workspaceId={workspaceId}
        layout={layout}
        activePaneId={currentActivePaneId}
        onFocusPane={handleFocusPane}
      />
    </div>
  );
}
