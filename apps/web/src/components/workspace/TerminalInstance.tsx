'use client';

import { useEffect, useRef, useCallback } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useUIStore } from '@/stores/ui';
import { getWebSocketToken } from '@/lib/api';

export interface TerminalInstanceProps {
  workspaceId: string;
  tabId: string;
  shell: string;
  isActive: boolean;
  onReady?: () => void;
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

export function TerminalInstance({
  workspaceId,
  tabId,
  shell,
  isActive,
  onReady,
}: TerminalInstanceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<import('@xterm/xterm').Terminal | null>(null);
  const fitAddonRef = useRef<import('@xterm/addon-fit').FitAddon | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const terminalReadyRef = useRef(false);
  const initializedRef = useRef(false);
  const wsTokenRef = useRef<string | null>(null);

  const resizeTerminal = useCallback(() => {
    if (!fitAddonRef.current || !termRef.current || !isActive) return;
    fitAddonRef.current.fit();

    if (socketRef.current?.connected && terminalReadyRef.current) {
      socketRef.current.emit('terminal_resize', {
        workspace_id: workspaceId,
        terminal_id: tabId,
        rows: termRef.current.rows,
        cols: termRef.current.cols,
      });
    }
  }, [workspaceId, tabId, isActive]);

  const initTerminal = useCallback(async () => {
    const container = containerRef.current;
    if (!container || initializedRef.current) return;

    initializedRef.current = true;

    const { Terminal } = await import('@xterm/xterm');
    const { FitAddon } = await import('@xterm/addon-fit');
    const { WebLinksAddon } = await import('@xterm/addon-web-links');
    const { WebglAddon } = await import('@xterm/addon-webgl');
    const { CanvasAddon } = await import('@xterm/addon-canvas');
    const { Unicode11Addon } = await import('@xterm/addon-unicode11');
    const { LigaturesAddon } = await import('@xterm/addon-ligatures');
    const { SearchAddon } = await import('@xterm/addon-search');

    // Import xterm CSS
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

    // Load core addons
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.loadAddon(unicode11Addon);
    term.loadAddon(searchAddon);

    // Activate Unicode 11 for better emoji/symbol support
    term.unicode.activeVersion = '11';

    term.open(container);

    // Try to load WebGL addon for GPU-accelerated rendering
    let rendererLoaded = false;
    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        webglAddon.dispose();
      });
      term.loadAddon(webglAddon);
      rendererLoaded = true;
    } catch {
      // WebGL not supported, try canvas renderer
    }

    // Fallback to canvas renderer if WebGL failed
    if (!rendererLoaded) {
      try {
        const canvasAddon = new CanvasAddon();
        term.loadAddon(canvasAddon);
      } catch {
        // Use default DOM renderer
      }
    }

    // Try to load ligatures addon (requires font with ligature support)
    try {
      const ligaturesAddon = new LigaturesAddon();
      term.loadAddon(ligaturesAddon);
    } catch {
      // Ligatures not supported
    }

    fitAddon.fit();

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // Fetch WebSocket token for authentication (required for cross-origin)
    const wsToken = await getWebSocketToken();
    wsTokenRef.current = wsToken;

    // Connect to Socket.IO
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
    const socket = io(apiUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      withCredentials: true, // Required for cross-origin cookie authentication
    });

    socketRef.current = socket;

    // Socket.IO event handlers
    socket.on('connect', async () => {
      term.writeln('\x1b[36m╭─────────────────────────────────────────╮\x1b[0m');
      term.writeln(
        '\x1b[36m│\x1b[0m  \x1b[1mPodex Terminal\x1b[0m                         \x1b[36m│\x1b[0m'
      );
      term.writeln('\x1b[36m│\x1b[0m  Connecting to workspace...             \x1b[36m│\x1b[0m');
      term.writeln('\x1b[36m╰─────────────────────────────────────────╯\x1b[0m');
      term.writeln('');

      // Fetch fresh token on reconnect (tokens are one-time use)
      const token = await getWebSocketToken();
      wsTokenRef.current = token;

      socket.emit('terminal_attach', {
        workspace_id: workspaceId,
        terminal_id: tabId,
        auth_token: token,
        shell: shell,
      });
    });

    socket.on('disconnect', () => {
      term.writeln('\r\n\x1b[31m[Disconnected from server]\x1b[0m\r\n');
      terminalReadyRef.current = false;
    });

    socket.on('terminal_ready', (data: { workspace_id: string; cwd: string }) => {
      term.writeln(`\x1b[32m[Connected to workspace: ${data.cwd}]\x1b[0m`);
      term.writeln('');

      terminalReadyRef.current = true;

      socket.emit('terminal_resize', {
        workspace_id: workspaceId,
        terminal_id: tabId,
        rows: term.rows,
        cols: term.cols,
      });

      onReady?.();
    });

    socket.on(
      'terminal_data',
      (data: { workspace_id: string; terminal_id?: string; data: string }) => {
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
  }, [workspaceId, tabId, shell, onReady]);

  // Initialize terminal
  useEffect(() => {
    const timer = setTimeout(initTerminal, 50);
    return () => clearTimeout(timer);
  }, [initTerminal]);

  // Handle resize
  useEffect(() => {
    const handleResize = () => {
      resizeTerminal();
    };

    window.addEventListener('resize', handleResize);

    // Refit when becoming active
    if (isActive) {
      setTimeout(handleResize, 100);
    }

    return () => window.removeEventListener('resize', handleResize);
  }, [resizeTerminal, isActive]);

  // Handle container resize (panel drag/split resize)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (typeof ResizeObserver === 'undefined') return;

    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(resizeTerminal);
    });
    resizeObserver.observe(container);

    return () => resizeObserver.disconnect();
  }, [resizeTerminal]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (socketRef.current) {
        socketRef.current.emit('terminal_detach', {
          workspace_id: workspaceId,
          terminal_id: tabId,
        });
        socketRef.current.disconnect();
        socketRef.current = null;
      }

      if (termRef.current) {
        termRef.current.dispose();
        termRef.current = null;
      }

      fitAddonRef.current = null;
      terminalReadyRef.current = false;
      initializedRef.current = false;
    };
  }, [workspaceId, tabId]);

  // Focus terminal when active
  useEffect(() => {
    if (isActive && termRef.current) {
      termRef.current.focus();
    }
  }, [isActive]);

  // Handle pending terminal commands from voice or other sources
  const pendingCommand = useUIStore((state) => state.pendingTerminalCommand);
  const clearPendingCommand = useUIStore((state) => state.clearPendingTerminalCommand);

  useEffect(() => {
    if (pendingCommand && terminalReadyRef.current && socketRef.current?.connected && isActive) {
      // Send the command to the terminal (with newline to execute)
      socketRef.current.emit('terminal_input', {
        workspace_id: workspaceId,
        terminal_id: tabId,
        data: pendingCommand + '\n',
      });
      clearPendingCommand();
    }
  }, [pendingCommand, workspaceId, tabId, isActive, clearPendingCommand]);

  // Expose methods for external control
  const reconnect = useCallback(async () => {
    const socket = socketRef.current;
    const term = termRef.current;

    if (term) {
      term.writeln('\r\n\x1b[33m[Reconnecting...]\x1b[0m\r\n');
    }

    // Fetch fresh WebSocket token for reconnection
    const token = await getWebSocketToken();
    wsTokenRef.current = token;

    if (socket?.connected) {
      socket.emit('terminal_detach', { workspace_id: workspaceId, terminal_id: tabId });
      setTimeout(() => {
        socket.emit('terminal_attach', {
          workspace_id: workspaceId,
          terminal_id: tabId,
          auth_token: token,
          shell: shell,
        });
      }, 100);
    } else {
      socket?.emit('terminal_attach', {
        workspace_id: workspaceId,
        terminal_id: tabId,
        auth_token: token,
        shell: shell,
      });
    }
  }, [workspaceId, tabId, shell]);

  const fit = useCallback(() => {
    resizeTerminal();
  }, [resizeTerminal]);

  // Attach methods to ref for parent access (via imperative handle pattern)
  useEffect(() => {
    const container = containerRef.current;
    if (container) {
      (container as HTMLDivElement & { reconnect?: () => void; fit?: () => void }).reconnect =
        reconnect;
      (container as HTMLDivElement & { reconnect?: () => void; fit?: () => void }).fit = fit;
    }
  }, [reconnect, fit]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full overflow-hidden p-1"
      style={{ backgroundColor: terminalTheme.background }}
    />
  );
}
