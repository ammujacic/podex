import { useCallback, useEffect, useRef } from 'react';

/**
 * VSCode API interface.
 */
interface VSCodeAPI {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

/**
 * Declare the global acquireVsCodeApi function.
 */
declare function acquireVsCodeApi(): VSCodeAPI;

/**
 * Get the VSCode API (singleton).
 */
let vscodeApi: VSCodeAPI | null = null;

function getVSCodeApi(): VSCodeAPI {
  if (!vscodeApi) {
    try {
      vscodeApi = acquireVsCodeApi();
    } catch {
      // Running outside VSCode (e.g., in tests)
      vscodeApi = {
        postMessage: (msg) => console.log('VSCode postMessage:', msg),
        getState: () => ({}),
        setState: () => {},
      };
    }
  }
  return vscodeApi;
}

/**
 * Message from extension to webview.
 */
interface ExtensionMessage {
  type: string;
  payload?: unknown;
}

/**
 * Hook for communicating with the VSCode extension host.
 */
export function useVSCodeApi() {
  const api = getVSCodeApi();
  const handlersRef = useRef<Map<string, Set<(payload: unknown) => void>>>(new Map());

  // Set up message listener
  useEffect(() => {
    const handleMessage = (event: MessageEvent<ExtensionMessage>) => {
      const { type, payload } = event.data;
      const handlers = handlersRef.current.get(type);
      if (handlers) {
        handlers.forEach((handler) => handler(payload));
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  /**
   * Send a message to the extension host.
   */
  const postMessage = useCallback(
    (type: string, payload?: unknown) => {
      api.postMessage({ type, payload });
    },
    [api]
  );

  /**
   * Subscribe to messages from the extension host.
   */
  const onMessage = useCallback((type: string, handler: (payload: unknown) => void) => {
    if (!handlersRef.current.has(type)) {
      handlersRef.current.set(type, new Set());
    }
    handlersRef.current.get(type)!.add(handler);

    // Return unsubscribe function
    return () => {
      handlersRef.current.get(type)?.delete(handler);
    };
  }, []);

  /**
   * Get persisted webview state.
   */
  const getState = useCallback(<T>(): T | undefined => {
    return api.getState() as T | undefined;
  }, [api]);

  /**
   * Set persisted webview state.
   */
  const setState = useCallback(
    <T>(state: T) => {
      api.setState(state);
    },
    [api]
  );

  return {
    postMessage,
    onMessage,
    getState,
    setState,
  };
}
