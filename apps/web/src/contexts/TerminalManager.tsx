'use client';

import { createContext, useContext, useRef, useCallback, useEffect, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import { getWebSocketToken } from '@/lib/api';

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

export type TerminalStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface TerminalConnection {
  id: string;
  workspaceId: string;
  shell: string;
  socket: Socket;
  term: import('@xterm/xterm').Terminal | null;
  fitAddon: import('@xterm/addon-fit').FitAddon | null;
  status: TerminalStatus;
  currentContainer: HTMLDivElement | null;
  ready: boolean;
  opened: boolean; // Track if term.open() has been called
  rendererLoaded: boolean; // Track if GPU renderer has been loaded
}

interface TerminalManagerContextType {
  // Create a new terminal connection (dedicated socket per terminal)
  createTerminal: (terminalId: string, workspaceId: string, shell: string) => Promise<void>;

  // Destroy a terminal connection
  destroyTerminal: (terminalId: string) => void;

  // Attach terminal to a DOM container (for rendering)
  attachToContainer: (terminalId: string, container: HTMLDivElement) => void;

  // Detach terminal from container (keeps connection alive)
  detachFromContainer: (terminalId: string) => void;

  // Get terminal status
  getStatus: (terminalId: string) => TerminalStatus | null;

  // Focus terminal
  focusTerminal: (terminalId: string) => void;

  // Resize terminal
  resizeTerminal: (terminalId: string) => void;

  // Reconnect terminal
  reconnectTerminal: (terminalId: string) => Promise<void>;

  // Check if terminal exists
  hasTerminal: (terminalId: string) => boolean;
}

const TerminalManagerContext = createContext<TerminalManagerContextType | null>(null);

export function useTerminalManager() {
  const context = useContext(TerminalManagerContext);
  if (!context) {
    throw new Error('useTerminalManager must be used within TerminalManagerProvider');
  }
  return context;
}

interface TerminalManagerProviderProps {
  children: ReactNode;
}

export function TerminalManagerProvider({ children }: TerminalManagerProviderProps) {
  // Map of terminal ID -> connection
  // Using ref to avoid re-renders on every connection update
  const terminalsRef = useRef<Map<string, TerminalConnection>>(new Map());

  // Status listeners for triggering re-renders in consuming components
  const statusListenersRef = useRef<Map<string, Set<(status: TerminalStatus) => void>>>(new Map());

  const notifyStatusChange = useCallback((terminalId: string, status: TerminalStatus) => {
    const listeners = statusListenersRef.current.get(terminalId);
    if (listeners) {
      listeners.forEach((listener) => listener(status));
    }
  }, []);

  const createTerminal = useCallback(
    async (terminalId: string, workspaceId: string, shell: string) => {
      // Check if terminal already exists
      if (terminalsRef.current.has(terminalId)) {
        // Debug:(`[TerminalManager] Terminal ${terminalId} already exists, skipping creation`);
        return;
      }

      // Debug:(`[TerminalManager] Creating terminal ${terminalId} for workspace ${workspaceId}`);

      // Create dedicated socket for this terminal
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
      const socket = io(apiUrl, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        withCredentials: true,
      });

      // Create terminal connection object
      const connection: TerminalConnection = {
        id: terminalId,
        workspaceId,
        shell,
        socket,
        term: null,
        fitAddon: null,
        status: 'connecting',
        currentContainer: null,
        ready: false,
        opened: false,
        rendererLoaded: false,
      };

      terminalsRef.current.set(terminalId, connection);
      notifyStatusChange(terminalId, 'connecting');

      // Initialize xterm
      const { Terminal } = await import('@xterm/xterm');
      const { FitAddon } = await import('@xterm/addon-fit');
      const { WebLinksAddon } = await import('@xterm/addon-web-links');
      const { Unicode11Addon } = await import('@xterm/addon-unicode11');
      const { SearchAddon } = await import('@xterm/addon-search');

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
      const unicode11Addon = new Unicode11Addon();
      const searchAddon = new SearchAddon();

      term.loadAddon(fitAddon);
      term.loadAddon(webLinksAddon);
      term.loadAddon(unicode11Addon);
      term.loadAddon(searchAddon);
      term.unicode.activeVersion = '11';

      connection.term = term;
      connection.fitAddon = fitAddon;

      // Socket event handlers
      socket.on('connect', async () => {
        // Debug:(`[TerminalManager] Socket connected for terminal ${terminalId}`);

        term.writeln('\x1b[36m╭─────────────────────────────────────────╮\x1b[0m');
        term.writeln(
          '\x1b[36m│\x1b[0m  \x1b[1mPodex Terminal\x1b[0m                         \x1b[36m│\x1b[0m'
        );
        term.writeln('\x1b[36m│\x1b[0m  Connecting to workspace...             \x1b[36m│\x1b[0m');
        term.writeln('\x1b[36m╰─────────────────────────────────────────╯\x1b[0m');
        term.writeln('');

        const token = await getWebSocketToken();

        socket.emit('terminal_attach', {
          workspace_id: workspaceId,
          terminal_id: terminalId,
          auth_token: token,
          shell: shell,
        });
      });

      socket.on('disconnect', () => {
        // Debug:(`[TerminalManager] Socket disconnected for terminal ${terminalId}`);
        term.writeln('\r\n\x1b[31m[Disconnected from server]\x1b[0m\r\n');
        connection.status = 'disconnected';
        connection.ready = false;
        notifyStatusChange(terminalId, 'disconnected');
      });

      socket.on('terminal_ready', (data: { workspace_id: string; cwd: string }) => {
        // Debug:(`[TerminalManager] Terminal ${terminalId} ready at ${data.cwd}`);
        term.writeln(`\x1b[32m[Connected to workspace: ${data.cwd}]\x1b[0m`);
        term.writeln('');

        connection.status = 'connected';
        connection.ready = true;
        notifyStatusChange(terminalId, 'connected');

        // Send initial resize
        if (connection.currentContainer && fitAddon) {
          fitAddon.fit();
          socket.emit('terminal_resize', {
            workspace_id: workspaceId,
            terminal_id: terminalId,
            rows: term.rows,
            cols: term.cols,
          });
        }
      });

      // IMPORTANT: Only handle data for THIS terminal
      socket.on(
        'terminal_data',
        (data: { workspace_id: string; terminal_id?: string; data: string }) => {
          // Strict filtering - only accept data for this exact terminal
          if (data.workspace_id === workspaceId && data.terminal_id === terminalId) {
            term.write(data.data);
          }
        }
      );

      socket.on('terminal_error', (data: { error: string }) => {
        term.writeln(`\r\n\x1b[31m[Error: ${data.error}]\x1b[0m\r\n`);
        connection.status = 'error';
        notifyStatusChange(terminalId, 'error');
      });

      // Send terminal input - goes ONLY to this terminal's session
      term.onData((data) => {
        socket.emit('terminal_input', {
          workspace_id: workspaceId,
          terminal_id: terminalId,
          data: data,
        });
      });
    },
    [notifyStatusChange]
  );

  const destroyTerminal = useCallback((terminalId: string) => {
    const connection = terminalsRef.current.get(terminalId);
    if (!connection) return;

    // Debug:(`[TerminalManager] Destroying terminal ${terminalId}`);

    // Emit detach before disconnecting
    connection.socket.emit('terminal_detach', {
      workspace_id: connection.workspaceId,
      terminal_id: terminalId,
    });

    // Disconnect socket
    connection.socket.disconnect();

    // Dispose xterm
    connection.term?.dispose();

    // Remove from map
    terminalsRef.current.delete(terminalId);
    statusListenersRef.current.delete(terminalId);
  }, []);

  const attachToContainer = useCallback((terminalId: string, container: HTMLDivElement) => {
    const connection = terminalsRef.current.get(terminalId);
    if (!connection || !connection.term) {
      console.warn(`[TerminalManager] Cannot attach - terminal ${terminalId} not found`);
      return;
    }

    // If already attached to this container, just fit
    if (connection.currentContainer === container) {
      connection.fitAddon?.fit();
      return;
    }

    // Handle attaching terminal to container
    if (!connection.opened) {
      // First time opening - call term.open()
      connection.term.open(container);
      connection.opened = true;
    } else if (connection.term.element) {
      // Terminal already opened - move the DOM element to new container
      // appendChild automatically removes from old parent
      container.appendChild(connection.term.element);
    }

    connection.currentContainer = container;

    // Try to load GPU-accelerated renderer (only once)
    if (!connection.rendererLoaded) {
      connection.rendererLoaded = true;
      (async () => {
        try {
          const { WebglAddon } = await import('@xterm/addon-webgl');
          const webglAddon = new WebglAddon();
          webglAddon.onContextLoss(() => webglAddon.dispose());
          connection.term?.loadAddon(webglAddon);
        } catch {
          try {
            const { CanvasAddon } = await import('@xterm/addon-canvas');
            const canvasAddon = new CanvasAddon();
            connection.term?.loadAddon(canvasAddon);
          } catch {
            // Use default DOM renderer
          }
        }
      })();
    }

    // Fit to container
    setTimeout(() => {
      connection.fitAddon?.fit();

      // Send resize to server if ready
      if (connection.ready && connection.term) {
        connection.socket.emit('terminal_resize', {
          workspace_id: connection.workspaceId,
          terminal_id: terminalId,
          rows: connection.term.rows,
          cols: connection.term.cols,
        });
      }
    }, 50);
  }, []);

  const detachFromContainer = useCallback((terminalId: string) => {
    const connection = terminalsRef.current.get(terminalId);
    if (!connection) return;

    // Just clear the container reference - the element will be moved when attached elsewhere
    // Don't clear innerHTML or dispose - we want to preserve the terminal state
    connection.currentContainer = null;
  }, []);

  const getStatus = useCallback((terminalId: string): TerminalStatus | null => {
    return terminalsRef.current.get(terminalId)?.status ?? null;
  }, []);

  const focusTerminal = useCallback((terminalId: string) => {
    const connection = terminalsRef.current.get(terminalId);
    connection?.term?.focus();
  }, []);

  const resizeTerminal = useCallback((terminalId: string) => {
    const connection = terminalsRef.current.get(terminalId);
    if (!connection || !connection.fitAddon || !connection.term) return;

    connection.fitAddon.fit();

    if (connection.ready) {
      connection.socket.emit('terminal_resize', {
        workspace_id: connection.workspaceId,
        terminal_id: terminalId,
        rows: connection.term.rows,
        cols: connection.term.cols,
      });
    }
  }, []);

  const reconnectTerminal = useCallback(async (terminalId: string) => {
    const connection = terminalsRef.current.get(terminalId);
    if (!connection) return;

    // Debug:(`[TerminalManager] Reconnecting terminal ${terminalId}`);
    connection.term?.writeln('\r\n\x1b[33m[Reconnecting...]\x1b[0m\r\n');

    const token = await getWebSocketToken();

    if (connection.socket.connected) {
      connection.socket.emit('terminal_detach', {
        workspace_id: connection.workspaceId,
        terminal_id: terminalId,
      });

      setTimeout(() => {
        connection.socket.emit('terminal_attach', {
          workspace_id: connection.workspaceId,
          terminal_id: terminalId,
          auth_token: token,
          shell: connection.shell,
        });
      }, 100);
    } else {
      connection.socket.connect();
    }
  }, []);

  const hasTerminal = useCallback((terminalId: string): boolean => {
    return terminalsRef.current.has(terminalId);
  }, []);

  // Cleanup all terminals on unmount
  useEffect(() => {
    const terminals = terminalsRef.current;
    return () => {
      terminals.forEach((_, terminalId) => {
        destroyTerminal(terminalId);
      });
    };
  }, [destroyTerminal]);

  // Emit terminal_detach on page unload so backend can schedule cleanup
  useEffect(() => {
    const handleBeforeUnload = () => {
      terminalsRef.current.forEach((connection) => {
        if (connection.socket.connected) {
          // Use sendBeacon-style sync emit before page closes
          connection.socket.emit('terminal_detach', {
            workspace_id: connection.workspaceId,
            terminal_id: connection.id,
          });
        }
      });
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  const contextValue: TerminalManagerContextType = {
    createTerminal,
    destroyTerminal,
    attachToContainer,
    detachFromContainer,
    getStatus,
    focusTerminal,
    resizeTerminal,
    reconnectTerminal,
    hasTerminal,
  };

  return (
    <TerminalManagerContext.Provider value={contextValue}>
      {children}
    </TerminalManagerContext.Provider>
  );
}
