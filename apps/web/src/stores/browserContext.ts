import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import {
  useDevToolsStore,
  type ConsoleEntry,
  type NetworkRequest,
  type BrowserError,
} from './devtools';

/**
 * Browser context data that can be sent to agents for debugging assistance.
 */
export interface BrowserContextData {
  /** Current page URL */
  url: string;
  /** Page title */
  title?: string;
  /** Timestamp when context was captured */
  timestamp: string;
  /** Console log entries */
  consoleLogs: BrowserConsoleLog[];
  /** Network request entries */
  networkRequests: BrowserNetworkLog[];
  /** JavaScript errors */
  errors: BrowserErrorLog[];
  /** Optional HTML snapshot (truncated) */
  htmlSnapshot?: string;
  /** Browser metadata */
  metadata: {
    userAgent?: string;
    viewportSize?: { width: number; height: number };
  };
}

/** Simplified console log for context */
export interface BrowserConsoleLog {
  level: string;
  message: string;
  timestamp: string;
  source?: string;
}

/** Simplified network log for context */
export interface BrowserNetworkLog {
  url: string;
  method: string;
  status: number;
  statusText?: string;
  duration?: number;
  error?: string;
  type: string;
}

/** Simplified error log for context */
export interface BrowserErrorLog {
  type: string;
  message: string;
  stack?: string;
  timestamp: string;
}

// Limits for context size management
const CONTEXT_LIMITS = {
  maxConsoleLogs: 50,
  maxNetworkRequests: 30,
  maxErrors: 20,
  maxHtmlSize: 50000, // 50KB
};

interface BrowserContextState {
  // Per-agent capture settings
  agentCaptureEnabled: Record<string, boolean>;

  // Per-agent auto-include setting (automatically include with every message)
  agentAutoInclude: Record<string, boolean>;

  // Pending context to be sent with next message (per agent)
  pendingContext: Record<string, BrowserContextData | null>;

  // HTML snapshot (captured on demand)
  htmlSnapshot: string | null;

  // Actions
  toggleCapture: (agentId: string) => void;
  toggleAutoInclude: (agentId: string) => void;
  setCaptureEnabled: (agentId: string, enabled: boolean) => void;
  setAutoInclude: (agentId: string, enabled: boolean) => void;

  // Capture context
  captureContext: (agentId: string) => BrowserContextData;
  setPendingContext: (agentId: string, context: BrowserContextData | null) => void;
  clearPendingContext: (agentId: string) => void;
  getPendingContext: (agentId: string) => BrowserContextData | null;

  // HTML snapshot
  setHtmlSnapshot: (html: string | null) => void;

  // Reset
  resetAgent: (agentId: string) => void;
  reset: () => void;
}

/**
 * Convert DevTools console entry to context format
 */
function formatConsoleEntry(entry: ConsoleEntry): BrowserConsoleLog {
  return {
    level: entry.level,
    message: entry.args.map((arg) => arg.value).join(' '),
    timestamp: new Date(entry.timestamp).toISOString(),
    source: entry.url,
  };
}

/**
 * Convert DevTools network request to context format
 */
function formatNetworkRequest(req: NetworkRequest): BrowserNetworkLog {
  return {
    url: req.url,
    method: req.method,
    status: req.status || 0,
    statusText: req.statusText,
    duration: req.duration,
    error: req.error,
    type: req.type,
  };
}

/**
 * Convert DevTools error to context format
 */
function formatError(error: BrowserError): BrowserErrorLog {
  return {
    type: error.type,
    message: error.message,
    stack: error.stack || undefined,
    timestamp: new Date(error.timestamp).toISOString(),
  };
}

export const useBrowserContextStore = create<BrowserContextState>()(
  devtools(
    (set, get) => ({
      agentCaptureEnabled: {},
      agentAutoInclude: {},
      pendingContext: {},
      htmlSnapshot: null,

      toggleCapture: (agentId) =>
        set((state) => ({
          agentCaptureEnabled: {
            ...state.agentCaptureEnabled,
            [agentId]: !state.agentCaptureEnabled[agentId],
          },
        })),

      toggleAutoInclude: (agentId) =>
        set((state) => ({
          agentAutoInclude: {
            ...state.agentAutoInclude,
            [agentId]: !state.agentAutoInclude[agentId],
          },
        })),

      setCaptureEnabled: (agentId, enabled) =>
        set((state) => ({
          agentCaptureEnabled: {
            ...state.agentCaptureEnabled,
            [agentId]: enabled,
          },
        })),

      setAutoInclude: (agentId, enabled) =>
        set((state) => ({
          agentAutoInclude: {
            ...state.agentAutoInclude,
            [agentId]: enabled,
          },
        })),

      captureContext: (_agentId) => {
        const devToolsState = useDevToolsStore.getState();
        const state = get();

        // Get recent entries within limits
        const consoleLogs = devToolsState.consoleEntries
          .slice(-CONTEXT_LIMITS.maxConsoleLogs)
          .map(formatConsoleEntry);

        const networkRequests = devToolsState.networkRequests
          .slice(-CONTEXT_LIMITS.maxNetworkRequests)
          .map(formatNetworkRequest);

        const errors = devToolsState.errors.slice(-CONTEXT_LIMITS.maxErrors).map(formatError);

        // Truncate HTML snapshot if present
        let htmlSnapshot = state.htmlSnapshot || undefined;
        if (htmlSnapshot && htmlSnapshot.length > CONTEXT_LIMITS.maxHtmlSize) {
          htmlSnapshot = htmlSnapshot.slice(0, CONTEXT_LIMITS.maxHtmlSize) + '\n<!-- truncated -->';
        }

        const context: BrowserContextData = {
          url: devToolsState.currentUrl || window.location.href,
          timestamp: new Date().toISOString(),
          consoleLogs,
          networkRequests,
          errors,
          htmlSnapshot,
          metadata: {
            userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
            viewportSize:
              typeof window !== 'undefined'
                ? { width: window.innerWidth, height: window.innerHeight }
                : undefined,
          },
        };

        return context;
      },

      setPendingContext: (agentId, context) =>
        set((state) => ({
          pendingContext: {
            ...state.pendingContext,
            [agentId]: context,
          },
        })),

      clearPendingContext: (agentId) =>
        set((state) => ({
          pendingContext: {
            ...state.pendingContext,
            [agentId]: null,
          },
        })),

      getPendingContext: (agentId) => get().pendingContext[agentId] || null,

      setHtmlSnapshot: (html) => set({ htmlSnapshot: html }),

      resetAgent: (agentId) =>
        set((state) => ({
          agentCaptureEnabled: {
            ...state.agentCaptureEnabled,
            [agentId]: false,
          },
          agentAutoInclude: {
            ...state.agentAutoInclude,
            [agentId]: false,
          },
          pendingContext: {
            ...state.pendingContext,
            [agentId]: null,
          },
        })),

      reset: () =>
        set({
          agentCaptureEnabled: {},
          agentAutoInclude: {},
          pendingContext: {},
          htmlSnapshot: null,
        }),
    }),
    { name: 'podex-browser-context' }
  )
);

// Selector hooks
export const useIsCaptureEnabled = (agentId: string) =>
  useBrowserContextStore((s) => s.agentCaptureEnabled[agentId] ?? false);

export const useIsAutoInclude = (agentId: string) =>
  useBrowserContextStore((s) => s.agentAutoInclude[agentId] ?? false);

export const useHasPendingContext = (agentId: string) =>
  useBrowserContextStore((s) => !!s.pendingContext[agentId]);

/**
 * Estimate the size of browser context in bytes (rough estimate)
 */
export function estimateContextSize(context: BrowserContextData): number {
  return JSON.stringify(context).length;
}

/**
 * Format context size for display
 */
export function formatContextSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
