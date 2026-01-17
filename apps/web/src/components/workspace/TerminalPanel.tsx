'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Maximize2,
  Minimize2,
  X,
  LayoutGrid,
  Columns,
  Rows,
  Terminal as TerminalIcon,
} from 'lucide-react';
import { useUIStore } from '@/stores/ui';
import { useSessionStore } from '@/stores/session';
import { getUserConfig } from '@/lib/api/user-config';
import { cn } from '@/lib/utils';
import { useTerminalStore, isTerminalSplit, type TerminalLayout } from '@/stores/terminal';
import { SplitTerminalLayout } from './SplitTerminalLayout';

export interface TerminalPanelProps {
  sessionId: string;
}

export function TerminalPanel({ sessionId }: TerminalPanelProps) {
  const [useSplitMode, setUseSplitMode] = useState(true);
  const { setTerminalVisible, terminalHeight, setTerminalHeight } = useUIStore();
  const session = useSessionStore((state) => state.sessions[sessionId]);

  // Get actual workspace_id from session, fallback to sessionId
  const workspaceId = session?.workspaceId || sessionId;

  const { initLayout, setDefaultShell, getLayout, splitPane, activePaneId } = useTerminalStore();

  const layout = getLayout(sessionId);
  const currentActivePaneId = activePaneId[sessionId] || '';

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

  // Count panes for display
  const countPanes = useCallback((l: TerminalLayout | null): number => {
    if (!l) return 0;
    if (!isTerminalSplit(l)) return 1;
    return l.panes.reduce((sum, child) => sum + countPanes(child), 0);
  }, []);

  const paneCount = countPanes(layout);
  const hasSplits = paneCount > 1;

  const handleSplitHorizontal = useCallback(() => {
    if (currentActivePaneId) {
      splitPane(sessionId, currentActivePaneId, 'horizontal');
    }
  }, [sessionId, currentActivePaneId, splitPane]);

  const handleSplitVertical = useCallback(() => {
    if (currentActivePaneId) {
      splitPane(sessionId, currentActivePaneId, 'vertical');
    }
  }, [sessionId, currentActivePaneId, splitPane]);

  if (!layout) {
    return (
      <div className="flex h-full items-center justify-center bg-surface">
        <div className="animate-spin h-6 w-6 border-2 border-accent-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-surface">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border-subtle px-2 py-1">
        {/* Left side - title and pane count */}
        <div className="flex items-center gap-2">
          <TerminalIcon className="h-4 w-4 text-accent-primary" />
          <span className="text-sm font-medium text-text-primary">Terminal</span>
          {hasSplits && (
            <span className="text-xs text-text-muted bg-overlay px-1.5 py-0.5 rounded">
              {paneCount} panes
            </span>
          )}
        </div>

        {/* Right side - controls */}
        <div className="flex items-center gap-1">
          {/* Split controls */}
          <div className="flex items-center gap-0.5 mr-2 border-r border-border-subtle pr-2">
            <button
              onClick={handleSplitHorizontal}
              className={cn(
                'rounded p-1 text-text-muted hover:bg-overlay hover:text-text-secondary',
                'transition-colors'
              )}
              title="Split Horizontally (Cmd+Shift+D)"
            >
              <Columns className="h-4 w-4" />
            </button>
            <button
              onClick={handleSplitVertical}
              className={cn(
                'rounded p-1 text-text-muted hover:bg-overlay hover:text-text-secondary',
                'transition-colors'
              )}
              title="Split Vertically (Cmd+Shift+E)"
            >
              <Rows className="h-4 w-4" />
            </button>
            {hasSplits && (
              <button
                onClick={() => setUseSplitMode(!useSplitMode)}
                className={cn(
                  'rounded p-1 transition-colors',
                  useSplitMode
                    ? 'text-accent-primary bg-accent-primary/10'
                    : 'text-text-muted hover:bg-overlay hover:text-text-secondary'
                )}
                title="Toggle Split View"
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Size controls */}
          <button
            onClick={() => setTerminalHeight(terminalHeight === 300 ? 500 : 300)}
            className="rounded p-1 text-text-muted hover:bg-overlay hover:text-text-secondary"
            title={terminalHeight === 300 ? 'Maximize' : 'Minimize'}
          >
            {terminalHeight === 300 ? (
              <Maximize2 className="h-4 w-4" />
            ) : (
              <Minimize2 className="h-4 w-4" />
            )}
          </button>
          <button
            onClick={() => setTerminalVisible(false)}
            className="rounded p-1 text-text-muted hover:bg-overlay hover:text-text-secondary"
            title="Close Terminal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Terminal content */}
      <div className="flex-1 relative" style={{ minHeight: 0 }}>
        <SplitTerminalLayout sessionId={sessionId} workspaceId={workspaceId} layout={layout} />
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
