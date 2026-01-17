'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { Maximize2, Minimize2, X, RefreshCw, Plus, Terminal as TerminalIcon } from 'lucide-react';
import { io, type Socket } from 'socket.io-client';
import { useUIStore } from '@/stores/ui';
import { useAuthStore } from '@/stores/auth';
import { useSessionStore } from '@/stores/session';
import { getUserConfig } from '@/lib/api/user-config';
import { cn } from '@/lib/utils';

export interface TerminalPanelProps {
  sessionId: string;
}

interface TerminalTab {
  id: string;
  name: string;
  shell: string;
}

// Terminal theme matching Terminal Noir design
const terminalTheme = {
  background: '#0d0d12',
  foreground: '#f0f0f5',
  cursor: '#00e5ff',
  cursorAccent: '#07070a',
  selectionBackground: 'rgba(0, 229, 255, 0.2)',
  black: '#07070a',
  red: '#ef4444',
  green: '#22c55e',
  yellow: '#f59e0b',
  blue: '#82aaff',
  magenta: '#a855f7',
  cyan: '#00e5ff',
  white: '#f0f0f5',
  brightBlack: '#5c5c6e',
  brightRed: '#f87171',
  brightGreen: '#4ade80',
  brightYellow: '#fbbf24',
  brightBlue: '#93c5fd',
  brightMagenta: '#c084fc',
  brightCyan: '#22d3ee',
  brightWhite: '#ffffff',
};

export function TerminalPanel({ sessionId }: TerminalPanelProps) {
  const [defaultShell, setDefaultShell] = useState<string>('bash');
  const [tabs, setTabs] = useState<TerminalTab[]>([
    { id: 'terminal-1', name: 'Terminal 1', shell: 'bash' },
  ]);
  const [activeTabId, setActiveTabId] = useState('terminal-1');
  const [nextTabId, setNextTabId] = useState(2);

  // Load user's default shell preference
  useEffect(() => {
    async function loadDefaultShell() {
      try {
        const config = await getUserConfig();
        if (config?.default_shell) {
          setDefaultShell(config.default_shell);
          // Update the initial tab with the user's preferred shell
          setTabs((prev) => {
            if (prev.length === 1 && prev[0]?.id === 'terminal-1') {
              const firstTab = prev[0];
              return [{ id: firstTab.id, name: firstTab.name, shell: config.default_shell }];
            }
            return prev;
          });
        }
      } catch {
        // Silently use default shell on error
      }
    }
    loadDefaultShell();
  }, []);

  const terminalRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const termInstances = useRef<Record<string, import('@xterm/xterm').Terminal>>({});
  const fitAddons = useRef<Record<string, import('@xterm/addon-fit').FitAddon>>({});
  const sockets = useRef<Record<string, Socket>>({});
  const resizeHandlers = useRef<Record<string, () => void>>({});
  const terminalReady = useRef<Record<string, boolean>>({});

  const { setTerminalVisible, terminalHeight, setTerminalHeight } = useUIStore();
  const tokens = useAuthStore((state) => state.tokens);
  const session = useSessionStore((state) => state.sessions[sessionId]);

  // Get actual workspace_id from session, fallback to sessionId
  const workspaceId = session?.workspaceId || sessionId;

  const initTerminalForTab = useCallback(
    async (tabId: string, tabShell?: string) => {
      const container = terminalRefs.current[tabId];
      if (!container || termInstances.current[tabId]) return;

      // Get shell from parameter or find it from tabs
      const shell = tabShell || tabs.find((t) => t.id === tabId)?.shell || defaultShell;

      const { Terminal } = await import('@xterm/xterm');
      const { FitAddon } = await import('@xterm/addon-fit');
      const { WebLinksAddon } = await import('@xterm/addon-web-links');

      // Import xterm CSS (only once)
      await import('@xterm/xterm/css/xterm.css');

      const term = new Terminal({
        cursorBlink: true,
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        fontSize: 13,
        lineHeight: 1.2,
        theme: terminalTheme,
        allowProposedApi: true,
        scrollback: 5000,
        convertEol: true,
      });

      const fitAddon = new FitAddon();
      const webLinksAddon = new WebLinksAddon();

      term.loadAddon(fitAddon);
      term.loadAddon(webLinksAddon);
      term.open(container);
      fitAddon.fit();

      termInstances.current[tabId] = term;
      fitAddons.current[tabId] = fitAddon;

      // Connect to Socket.IO for this terminal
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
      const socket = io(apiUrl, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
      });

      sockets.current[tabId] = socket;

      // Socket.IO event handlers
      socket.on('connect', () => {
        term.writeln('\x1b[36m╭─────────────────────────────────────────╮\x1b[0m');
        term.writeln(
          '\x1b[36m│\x1b[0m  \x1b[1mPodex Terminal\x1b[0m                         \x1b[36m│\x1b[0m'
        );
        term.writeln('\x1b[36m│\x1b[0m  Connecting to workspace...             \x1b[36m│\x1b[0m');
        term.writeln('\x1b[36m╰─────────────────────────────────────────╯\x1b[0m');
        term.writeln('');

        // Attach to terminal with unique terminal_id and shell preference
        // Note: Don't send terminal_resize here - wait for terminal_ready
        socket.emit('terminal_attach', {
          workspace_id: workspaceId,
          terminal_id: tabId,
          auth_token: tokens?.accessToken,
          shell: shell,
        });
      });

      socket.on('disconnect', () => {
        term.writeln('\r\n\x1b[31m[Disconnected from server]\x1b[0m\r\n');
        // Clear ready state on disconnect
        terminalReady.current[tabId] = false;
      });

      socket.on('terminal_ready', (data: { workspace_id: string; cwd: string }) => {
        term.writeln(`\x1b[32m[Connected to workspace: ${data.cwd}]\x1b[0m`);
        term.writeln('');

        // Mark terminal as ready - now safe to send resize events
        terminalReady.current[tabId] = true;

        // Now that we're attached, send the initial terminal size
        socket.emit('terminal_resize', {
          workspace_id: workspaceId,
          terminal_id: tabId,
          rows: term.rows,
          cols: term.cols,
        });
      });

      socket.on(
        'terminal_data',
        (data: { workspace_id: string; terminal_id?: string; data: string }) => {
          // Accept data if it matches our workspace and terminal (or no terminal_id specified)
          if (
            data.workspace_id === workspaceId &&
            (!data.terminal_id || data.terminal_id === tabId)
          ) {
            term.write(data.data);
          }
        }
      );

      socket.on('terminal_error', (data: { error: string }) => {
        term.writeln(`\r\n\x1b[31m[Error: ${data.error}]\x1b[0m\r\n`);
      });

      // Send terminal input to server
      term.onData((data) => {
        socket.emit('terminal_input', {
          workspace_id: workspaceId,
          terminal_id: tabId,
          data: data,
        });
      });

      // Handle window resize - clean up any existing handler first
      if (resizeHandlers.current[tabId]) {
        window.removeEventListener('resize', resizeHandlers.current[tabId]);
      }

      const handleResize = () => {
        if (fitAddons.current[tabId]) {
          fitAddons.current[tabId].fit();
          const currentSocket = sockets.current[tabId];
          const currentTerm = termInstances.current[tabId];
          // Only send resize if terminal is ready (attached successfully)
          if (currentSocket?.connected && currentTerm && terminalReady.current[tabId]) {
            currentSocket.emit('terminal_resize', {
              workspace_id: workspaceId,
              terminal_id: tabId,
              rows: currentTerm.rows,
              cols: currentTerm.cols,
            });
          }
        }
      };

      resizeHandlers.current[tabId] = handleResize;
      window.addEventListener('resize', handleResize);
    },
    [workspaceId, tokens, tabs, defaultShell]
  );

  // Initialize terminal when tab becomes active
  useEffect(() => {
    const timer = setTimeout(() => {
      initTerminalForTab(activeTabId);
    }, 50);

    return () => clearTimeout(timer);
  }, [activeTabId, initTerminalForTab]);

  // Re-fit terminal when height changes or active tab changes
  useEffect(() => {
    const fitAddon = fitAddons.current[activeTabId];
    const socket = sockets.current[activeTabId];
    const term = termInstances.current[activeTabId];

    if (fitAddon) {
      setTimeout(() => {
        fitAddon.fit();
        // Only send resize if terminal is ready (attached successfully)
        if (socket?.connected && term && terminalReady.current[activeTabId]) {
          socket.emit('terminal_resize', {
            workspace_id: workspaceId,
            terminal_id: activeTabId,
            rows: term.rows,
            cols: term.cols,
          });
        }
      }, 100);
    }
  }, [terminalHeight, activeTabId, workspaceId]);

  // Cleanup all terminals on component unmount
  useEffect(() => {
    return () => {
      // Clean up all resize handlers
      Object.entries(resizeHandlers.current).forEach(([, handler]) => {
        window.removeEventListener('resize', handler);
      });
      // Clean up all sockets and terminal instances
      Object.entries(sockets.current).forEach(([tabId, socket]) => {
        socket.emit('terminal_detach', { workspace_id: workspaceId, terminal_id: tabId });
        socket.disconnect();
      });
      Object.values(termInstances.current).forEach((term) => {
        term.dispose();
      });
      sockets.current = {};
      termInstances.current = {};
      fitAddons.current = {};
      resizeHandlers.current = {};
      terminalReady.current = {};
    };
  }, [workspaceId]);

  const handleAddTerminal = useCallback(() => {
    const newTabId = `terminal-${nextTabId}`;
    setTabs((prev) => [
      ...prev,
      { id: newTabId, name: `Terminal ${nextTabId}`, shell: defaultShell },
    ]);
    setNextTabId((prev) => prev + 1);
    setActiveTabId(newTabId);
  }, [nextTabId, defaultShell]);

  const handleCloseTab = useCallback(
    (tabId: string, e: React.MouseEvent) => {
      e.stopPropagation();

      // Cleanup resize handler
      const resizeHandler = resizeHandlers.current[tabId];
      if (resizeHandler) {
        window.removeEventListener('resize', resizeHandler);
        delete resizeHandlers.current[tabId];
      }

      // Cleanup terminal instance
      const socket = sockets.current[tabId];
      const term = termInstances.current[tabId];

      if (socket) {
        socket.emit('terminal_detach', { workspace_id: workspaceId, terminal_id: tabId });
        socket.disconnect();
        delete sockets.current[tabId];
      }

      if (term) {
        term.dispose();
        delete termInstances.current[tabId];
      }

      delete fitAddons.current[tabId];
      delete terminalRefs.current[tabId];
      delete terminalReady.current[tabId];

      setTabs((prev) => {
        const newTabs = prev.filter((t) => t.id !== tabId);

        // If we're closing the active tab, switch to another
        if (activeTabId === tabId && newTabs.length > 0) {
          setActiveTabId(newTabs[newTabs.length - 1]?.id ?? '');
        }

        // If no tabs left, close the terminal panel
        if (newTabs.length === 0) {
          setTerminalVisible(false);
          return [{ id: 'terminal-1', name: 'Terminal 1', shell: defaultShell }];
        }

        return newTabs;
      });
    },
    [activeTabId, workspaceId, setTerminalVisible, defaultShell]
  );

  const handleReconnect = useCallback(() => {
    const socket = sockets.current[activeTabId];
    const term = termInstances.current[activeTabId];
    const currentTab = tabs.find((t) => t.id === activeTabId);
    const shell = currentTab?.shell || defaultShell;

    if (term) {
      term.writeln('\r\n\x1b[33m[Reconnecting...]\x1b[0m\r\n');
    }

    if (socket?.connected) {
      socket.emit('terminal_detach', { workspace_id: workspaceId, terminal_id: activeTabId });
      // Wait briefly for detach to complete before reattaching
      setTimeout(() => {
        socket.emit('terminal_attach', {
          workspace_id: workspaceId,
          terminal_id: activeTabId,
          auth_token: tokens?.accessToken,
          shell: shell,
        });
      }, 100);
    } else {
      socket?.emit('terminal_attach', {
        workspace_id: workspaceId,
        terminal_id: activeTabId,
        auth_token: tokens?.accessToken,
        shell: shell,
      });
    }
  }, [activeTabId, workspaceId, tokens, tabs, defaultShell]);

  return (
    <div className="flex h-full flex-col bg-surface">
      {/* Header with tabs */}
      <div className="flex items-center justify-between border-b border-border-subtle">
        {/* Tabs */}
        <div className="flex items-center overflow-x-auto">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              onClick={() => setActiveTabId(tab.id)}
              className={cn(
                'group flex items-center gap-2 px-3 py-2 text-sm cursor-pointer border-b-2 transition-colors',
                activeTabId === tab.id
                  ? 'border-accent-primary text-text-primary bg-elevated/50'
                  : 'border-transparent text-text-muted hover:text-text-secondary hover:bg-overlay/50'
              )}
            >
              <TerminalIcon className="h-3.5 w-3.5" />
              <span>{tab.name}</span>
              <span className="text-xs text-text-muted">({tab.shell})</span>
              {tabs.length > 1 && (
                <button
                  onClick={(e) => handleCloseTab(tab.id, e)}
                  className="ml-1 rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-overlay hover:text-text-primary transition-opacity"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}

          {/* Add terminal button */}
          <button
            onClick={handleAddTerminal}
            className="flex items-center gap-1 px-3 py-2 text-text-muted hover:text-text-secondary hover:bg-overlay/50 transition-colors"
            title="New Terminal"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-1 px-2">
          <button
            onClick={handleReconnect}
            className="rounded p-1 text-text-muted hover:bg-overlay hover:text-text-secondary"
            title="Reconnect"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
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
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Terminal content - show only active tab */}
      <div className="flex-1 relative" style={{ minHeight: 0 }}>
        {tabs.map((tab) => (
          <div
            key={tab.id}
            ref={(el) => {
              terminalRefs.current[tab.id] = el;
            }}
            className={cn(
              'absolute inset-0 p-2 overflow-hidden',
              activeTabId === tab.id ? 'block' : 'hidden'
            )}
          />
        ))}
      </div>
    </div>
  );
}
