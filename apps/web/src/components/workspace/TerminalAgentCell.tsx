'use client';

import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import { Terminal as TerminalIcon, RotateCcw, X, Play, Square } from 'lucide-react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import type { Agent } from '@/stores/session';
import { useSessionStore } from '@/stores/session';
import { useAuthStore } from '@/stores/auth';
import { cn } from '@/lib/utils';
import { deleteTerminalAgent, createTerminalAgent } from '@/lib/api';
import '@xterm/xterm/css/xterm.css';

// Type for WebSocket messages from terminal backend
interface TerminalWebSocketMessage {
  type: 'output' | 'error' | 'resize' | 'heartbeat';
  data?: string;
  error?: string;
}

interface TerminalAgentCellProps {
  agent: Agent;
  sessionId: string;
  workspaceId: string;
  onRemove?: () => void;
  /** Hide the header (useful when wrapped by DraggableTerminalCard which has its own header) */
  hideHeader?: boolean;
}

export interface TerminalAgentCellRef {
  fit: () => void;
}

export const TerminalAgentCell = forwardRef<TerminalAgentCellRef, TerminalAgentCellProps>(
  function TerminalAgentCell({ agent, sessionId, workspaceId, onRemove, hideHeader = false }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const terminalRef = useRef<HTMLDivElement>(null);
    const terminalInstanceRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const websocketRef = useRef<WebSocket | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [isConnecting, setIsConnecting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const { updateAgent } = useSessionStore();

    // Expose fit method to parent via ref
    useImperativeHandle(ref, () => ({
      fit: () => {
        if (fitAddonRef.current) {
          fitAddonRef.current.fit();
          // Send resize to backend
          if (
            websocketRef.current &&
            websocketRef.current.readyState === WebSocket.OPEN &&
            terminalInstanceRef.current
          ) {
            const { cols, rows } = terminalInstanceRef.current;
            websocketRef.current.send(
              JSON.stringify({
                type: 'resize',
                cols,
                rows,
              })
            );
          }
        }
      },
    }));

    // Use refs to store functions so they can be called without causing effect re-runs
    const connectToTerminalRef = useRef<(() => Promise<void>) | null>(null);
    const disconnectFromTerminalRef = useRef<(() => void) | null>(null);

    const disconnectFromTerminal = useCallback(() => {
      if (websocketRef.current) {
        websocketRef.current.close();
        websocketRef.current = null;
      }
      setIsConnected(false);
    }, []);

    // Store in ref
    disconnectFromTerminalRef.current = disconnectFromTerminal;

    const connectToTerminal = useCallback(async () => {
      if (!agent.terminalSessionId) {
        setError('No terminal session ID available');
        return;
      }

      setIsConnecting(true);
      setError(null);

      try {
        // Connect directly to API server (same as Socket.IO does)
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
        const wsProtocol = apiUrl.startsWith('https') ? 'wss:' : 'ws:';
        const apiHost = apiUrl.replace(/^https?:\/\//, '');

        // Security note: Token is passed in URL which may appear in browser history/logs.
        // Production deployment uses HTTPS to encrypt the connection. For enhanced security,
        // consider implementing ticket-based auth where a short-lived ticket is exchanged
        // server-side for the session token. This would require backend WebSocket changes.
        const token = useAuthStore.getState().tokens?.accessToken;
        const tokenParam = token ? `?token=${encodeURIComponent(token)}` : '';
        const wsUrl = `${wsProtocol}//${apiHost}/api/v1/terminal-agents/${agent.terminalSessionId}/ws${tokenParam}`;
        const ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          setIsConnected(true);
          setIsConnecting(false);
          websocketRef.current = ws;
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data) as TerminalWebSocketMessage;
            if (data.type === 'output' && data.data && terminalInstanceRef.current) {
              terminalInstanceRef.current.write(data.data);
            }
          } catch (err) {
            console.error('Failed to parse terminal WebSocket message:', err);
          }
        };

        ws.onclose = () => {
          setIsConnected(false);
          websocketRef.current = null;
        };

        ws.onerror = (error) => {
          console.error('Terminal WebSocket error:', error);
          setError('Connection failed');
          setIsConnecting(false);
        };
      } catch {
        setError('Failed to connect to terminal');
        setIsConnecting(false);
      }
    }, [agent.terminalSessionId]);

    // Store in ref
    connectToTerminalRef.current = connectToTerminal;

    const restartTerminal = useCallback(async () => {
      if (!agent.terminalAgentTypeId) {
        setError('No terminal agent type ID available');
        return;
      }

      disconnectFromTerminal();

      // Close existing terminal session
      if (agent.terminalSessionId) {
        try {
          await deleteTerminalAgent(agent.terminalSessionId);
        } catch (err) {
          console.error('Failed to close terminal session:', err);
        }
      }

      // Create new terminal session
      try {
        const data = await createTerminalAgent({
          workspace_id: workspaceId,
          agent_type_id: agent.terminalAgentTypeId,
        });
        // Update the agent with new session ID
        updateAgent(sessionId, agent.id, {
          terminalSessionId: data.id,
        });
        // Connection will happen via the useEffect when terminalSessionId changes
      } catch {
        setError('Failed to restart terminal');
      }
    }, [
      agent.terminalSessionId,
      agent.terminalAgentTypeId,
      agent.id,
      sessionId,
      workspaceId,
      disconnectFromTerminal,
      updateAgent,
    ]);

    // Initialize terminal only once on mount
    useEffect(() => {
      if (!terminalRef.current) return;

      // Initialize xterm
      const terminal = new Terminal({
        fontSize: 14,
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
        theme: {
          background: '#000000',
          foreground: '#ffffff',
          cursor: '#ffffff',
          selectionBackground: '#ffffff44',
        },
        cursorBlink: true,
        allowTransparency: false,
        scrollback: 1000,
      });

      const fitAddon = new FitAddon();
      const webLinksAddon = new WebLinksAddon();

      terminal.loadAddon(fitAddon);
      terminal.loadAddon(webLinksAddon);

      terminal.open(terminalRef.current);

      // Load WebGL addon for GPU-accelerated rendering (significant performance boost)
      try {
        const webglAddon = new WebglAddon();
        webglAddon.onContextLoss(() => {
          webglAddon.dispose();
        });
        terminal.loadAddon(webglAddon);
      } catch (e) {
        console.warn('WebGL addon failed to load, using canvas renderer:', e);
      }

      fitAddon.fit();

      // Handle input
      terminal.onData((data) => {
        if (websocketRef.current && websocketRef.current.readyState === WebSocket.OPEN) {
          websocketRef.current.send(
            JSON.stringify({
              type: 'input',
              data: data,
            })
          );
        }
      });

      terminalInstanceRef.current = terminal;
      fitAddonRef.current = fitAddon;

      // Connect to backend using ref to avoid dependency issues
      connectToTerminalRef.current?.();

      return () => {
        terminal.dispose();
        disconnectFromTerminalRef.current?.();
      };
    }, []); // Run only once on mount

    // Reconnect when terminalSessionId changes
    useEffect(() => {
      if (agent.terminalSessionId && terminalInstanceRef.current) {
        connectToTerminalRef.current?.();
      }
    }, [agent.terminalSessionId]);

    // Handle resize using ResizeObserver to detect container size changes
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      const handleResize = () => {
        if (fitAddonRef.current && terminalInstanceRef.current) {
          fitAddonRef.current.fit();
          // Send resize to backend
          if (websocketRef.current && websocketRef.current.readyState === WebSocket.OPEN) {
            const { cols, rows } = terminalInstanceRef.current;
            websocketRef.current.send(
              JSON.stringify({
                type: 'resize',
                cols,
                rows,
              })
            );
          }
        }
      };

      // Use ResizeObserver to detect container size changes (handles all resize cases)
      const resizeObserver = new ResizeObserver(() => {
        // Use requestAnimationFrame to batch resize calls
        requestAnimationFrame(handleResize);
      });
      resizeObserver.observe(container);

      // Delayed initial fit to ensure layout has settled (especially for 2x2 default)
      const initialFitTimeout = setTimeout(handleResize, 100);

      return () => {
        resizeObserver.disconnect();
        clearTimeout(initialFitTimeout);
      };
    }, []);

    // Send heartbeat
    useEffect(() => {
      const heartbeatInterval = setInterval(() => {
        if (websocketRef.current && websocketRef.current.readyState === WebSocket.OPEN) {
          websocketRef.current.send(JSON.stringify({ type: 'heartbeat' }));
        }
      }, 30000); // 30 seconds

      return () => clearInterval(heartbeatInterval);
    }, []);

    // Cleanup WebSocket on unmount to prevent memory leaks
    useEffect(() => {
      return () => {
        if (websocketRef.current) {
          websocketRef.current.close();
          websocketRef.current = null;
        }
      };
    }, []);

    // Focus the terminal when clicking on it
    const focusTerminal = useCallback(() => {
      terminalInstanceRef.current?.focus();
    }, []);

    return (
      <div className="overflow-hidden flex flex-col h-full">
        {/* Header - can be hidden when wrapped by a parent with its own header */}
        {!hideHeader && (
          <div className="flex items-center justify-between p-3 border-b border-border-subtle shrink-0">
            <div className="flex items-center gap-2">
              <TerminalIcon className="h-4 w-4 text-text-muted" />
              <span className="font-medium text-text-primary">{agent.name}</span>
              <div
                className={cn(
                  'flex items-center gap-1 text-xs px-2 py-0.5 rounded-full',
                  isConnected
                    ? 'bg-green-500/10 text-green-400'
                    : error
                      ? 'bg-red-500/10 text-red-400'
                      : isConnecting
                        ? 'bg-yellow-500/10 text-yellow-400'
                        : 'bg-gray-500/10 text-gray-400'
                )}
              >
                <div
                  className={cn(
                    'w-1.5 h-1.5 rounded-full',
                    isConnected
                      ? 'bg-green-400'
                      : error
                        ? 'bg-red-400'
                        : isConnecting
                          ? 'bg-yellow-400 animate-pulse'
                          : 'bg-gray-400'
                  )}
                />
                {isConnected
                  ? 'Connected'
                  : error
                    ? 'Error'
                    : isConnecting
                      ? 'Connecting...'
                      : 'Disconnected'}
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={restartTerminal}
                aria-label="Restart terminal"
                className="p-1.5 text-text-muted hover:text-text-primary hover:bg-overlay rounded transition-colors cursor-pointer"
                title="Restart terminal"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>

              {!isConnected && !isConnecting && (
                <button
                  onClick={connectToTerminal}
                  aria-label="Connect to terminal"
                  className="p-1.5 text-green-400 hover:text-green-300 hover:bg-green-500/10 rounded transition-colors cursor-pointer"
                  title="Connect"
                >
                  <Play className="h-3.5 w-3.5" />
                </button>
              )}

              {isConnected && (
                <button
                  onClick={disconnectFromTerminal}
                  aria-label="Disconnect from terminal"
                  className="p-1.5 text-yellow-400 hover:text-yellow-300 hover:bg-yellow-500/10 rounded transition-colors cursor-pointer"
                  title="Disconnect"
                >
                  <Square className="h-3.5 w-3.5" />
                </button>
              )}

              {onRemove && (
                <button
                  onClick={onRemove}
                  aria-label="Remove agent"
                  className="p-1.5 text-text-muted hover:text-red-400 hover:bg-red-500/10 rounded transition-colors cursor-pointer"
                  title="Remove agent"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Terminal Content */}
        <div ref={containerRef} className="flex-1 relative overflow-hidden bg-black">
          {error && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/80 text-red-400 text-sm z-10">
              <div className="text-center">
                <p className="mb-2">Connection Error</p>
                <p className="text-xs opacity-75">{error}</p>
                <button
                  onClick={connectToTerminal}
                  className="mt-3 px-3 py-1 bg-red-500/20 hover:bg-red-500/30 rounded text-xs transition-colors cursor-pointer"
                >
                  Retry
                </button>
              </div>
            </div>
          )}

          <div
            ref={terminalRef}
            className="absolute inset-0"
            onMouseDown={focusTerminal}
            onFocus={focusTerminal}
            tabIndex={-1}
            data-terminal-container
          />
        </div>
      </div>
    );
  }
);
