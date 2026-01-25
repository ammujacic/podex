import { useEffect, useCallback, useRef } from 'react';
import { useDevToolsStore, type DOMNode } from '@/stores/devtools';

/**
 * Message types from the injected DevTools bridge script.
 * Must match the types defined in script_injector.py
 */
interface DevToolsMessage {
  type: string;
  payload: unknown;
  timestamp: number;
  source?: string;
}

interface ConsolePayload {
  level: 'log' | 'warn' | 'error' | 'info' | 'debug';
  args: Array<{ type: string; value: string }>;
  url?: string;
}

interface NetworkRequestPayload {
  id: string;
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string | null;
  type?: 'fetch' | 'xhr';
}

interface NetworkResponsePayload {
  id: string;
  url?: string;
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  body?: string | null;
  duration?: number;
  size?: number;
  error?: string;
}

interface ErrorPayload {
  type: 'js_error' | 'unhandled_rejection';
  message: string;
  stack?: string | null;
  filename?: string;
  lineno?: number;
  colno?: number;
}

interface NavigatePayload {
  url: string;
  type: string;
  title?: string;
}

interface ReadyPayload {
  url: string;
  title?: string;
  userAgent?: string;
  viewport?: { width: number; height: number };
}

interface HtmlPayload {
  html: string;
  url: string;
}

interface EvalResultPayload {
  id: string;
  code: string;
  result?: string;
  error?: string;
}

interface UsePreviewDevToolsOptions {
  /** Reference to the iframe element */
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  /** Workspace ID for context */
  workspaceId: string;
  /** Whether DevTools features are enabled */
  enabled?: boolean;
}

interface UsePreviewDevToolsReturn {
  /** Send a command to the iframe */
  sendCommand: (command: string, payload?: unknown) => void;
  /** Request a DOM snapshot from the iframe */
  requestDOMSnapshot: () => void;
  /** Request HTML content from the iframe */
  requestHTML: () => void;
  /** Navigate the iframe to a new URL */
  navigate: (url: string) => void;
  /** Reload the iframe */
  reload: () => void;
  /** Evaluate JavaScript code in the iframe context */
  evalCode: (code: string) => string;
}

/**
 * Hook for DevTools communication with the preview iframe.
 *
 * Handles postMessage communication between the parent frame and the
 * injected DevTools bridge script in the preview iframe.
 */
export function usePreviewDevTools({
  iframeRef,
  workspaceId,
  enabled = true,
}: UsePreviewDevToolsOptions): UsePreviewDevToolsReturn {
  // Get store actions - using refs to avoid stale closures
  const storeRef = useRef(useDevToolsStore.getState());

  // Keep store ref updated
  useEffect(() => {
    return useDevToolsStore.subscribe((state) => {
      storeRef.current = state;
    });
  }, []);

  // Handle incoming messages from iframe
  const handleMessage = useCallback(
    (event: MessageEvent) => {
      // Only accept messages from same origin (proxied content)
      if (typeof window !== 'undefined' && event.origin !== window.location.origin) {
        return;
      }

      const message = event.data as DevToolsMessage;

      // Validate message structure
      if (!message?.type || typeof message.type !== 'string') {
        return;
      }

      // Only handle devtools messages
      if (!message.type.startsWith('devtools:')) {
        return;
      }

      // Validate source
      if (message.source !== 'podex-devtools') {
        return;
      }

      const store = storeRef.current;

      switch (message.type) {
        case 'devtools:ready': {
          const payload = message.payload as ReadyPayload;
          store.setIframeReady(true);
          if (payload?.url) {
            store.pushHistory(payload.url, payload.title);
          }
          break;
        }

        case 'devtools:dom:ready': {
          // DOM is fully loaded
          const payload = message.payload as ReadyPayload;
          if (payload?.url) {
            store.setCurrentUrl(payload.url);
          }
          break;
        }

        case 'devtools:console': {
          const payload = message.payload as ConsolePayload;
          if (payload?.level && payload?.args) {
            store.addConsoleEntry({
              timestamp: message.timestamp,
              level: payload.level,
              args: payload.args,
              url: payload.url,
            });
          }
          break;
        }

        case 'devtools:network:request': {
          const payload = message.payload as NetworkRequestPayload;
          if (payload?.id && payload?.url) {
            store.addNetworkRequest({
              id: payload.id,
              url: payload.url,
              method: payload.method || 'GET',
              headers: payload.headers || {},
              body: payload.body || null,
              type: payload.type || 'fetch',
            });
          }
          break;
        }

        case 'devtools:network:response': {
          const payload = message.payload as NetworkResponsePayload;
          if (payload?.id) {
            store.updateNetworkRequest(payload.id, {
              status: payload.status,
              statusText: payload.statusText,
              responseHeaders: payload.headers,
              responseBody: payload.body,
              duration: payload.duration,
              size: payload.size,
              error: payload.error,
            });
          }
          break;
        }

        case 'devtools:dom:snapshot': {
          const payload = message.payload as DOMNode;
          store.setDOMSnapshot(payload);
          break;
        }

        case 'devtools:navigate': {
          const payload = message.payload as NavigatePayload;
          if (payload?.url) {
            store.pushHistory(payload.url, payload.title);
          }
          break;
        }

        case 'devtools:error': {
          const payload = message.payload as ErrorPayload;
          if (payload?.message) {
            // Add to errors
            store.addError({
              type: payload.type || 'js_error',
              message: payload.message,
              stack: payload.stack,
              filename: payload.filename,
              lineno: payload.lineno,
              colno: payload.colno,
              timestamp: message.timestamp,
            });

            // Also add to console as error
            store.addConsoleEntry({
              timestamp: message.timestamp,
              level: 'error',
              args: [
                {
                  type: 'error',
                  value: JSON.stringify(
                    {
                      message: payload.message,
                      stack: payload.stack,
                      location: payload.filename
                        ? `${payload.filename}:${payload.lineno}:${payload.colno}`
                        : undefined,
                    },
                    null,
                    2
                  ),
                },
              ],
            });
          }
          break;
        }

        case 'devtools:html': {
          const payload = message.payload as HtmlPayload;
          if (payload?.html && payload?.url) {
            store.setHtmlSnapshot(payload.html, payload.url);
          }
          break;
        }

        case 'devtools:eval:result': {
          const payload = message.payload as EvalResultPayload;
          if (payload?.id && payload?.code) {
            store.addEvalResult({
              code: payload.code,
              result: payload.result || '',
              error: payload.error,
              timestamp: message.timestamp,
            });
          }
          break;
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workspaceId]
  );

  // Send command to iframe
  const sendCommand = useCallback(
    (command: string, payload?: unknown) => {
      const iframe = iframeRef.current;
      if (!iframe?.contentWindow) {
        console.warn('[DevTools] Cannot send command: iframe not available');
        return;
      }

      try {
        iframe.contentWindow.postMessage({ type: 'devtools:command', command, payload }, '*');
      } catch (error) {
        console.warn('[DevTools] Failed to send command:', error);
      }
    },
    [iframeRef]
  );

  // Request DOM snapshot
  const requestDOMSnapshot = useCallback(() => {
    sendCommand('getDOMSnapshot');
  }, [sendCommand]);

  // Request HTML content
  const requestHTML = useCallback(() => {
    sendCommand('getHTML');
  }, [sendCommand]);

  // Navigate iframe to URL
  const navigate = useCallback(
    (url: string) => {
      sendCommand('navigate', { url });
    },
    [sendCommand]
  );

  // Reload iframe
  const reload = useCallback(() => {
    sendCommand('reload');
  }, [sendCommand]);

  // Evaluate JavaScript code in iframe
  const evalCode = useCallback(
    (code: string): string => {
      const evalId = `eval-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      storeRef.current.setPendingEvalId(evalId);
      sendCommand('eval', { id: evalId, code });
      return evalId;
    },
    [sendCommand]
  );

  // Setup message listener
  useEffect(() => {
    if (!enabled) return;

    // Reset DevTools state when mounting new preview
    storeRef.current.resetForNewPreview();

    // Add message listener
    window.addEventListener('message', handleMessage);

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [enabled, handleMessage]);

  return {
    sendCommand,
    requestDOMSnapshot,
    requestHTML,
    navigate,
    reload,
    evalCode,
  };
}

export default usePreviewDevTools;
