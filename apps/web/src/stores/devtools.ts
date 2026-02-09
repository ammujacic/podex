import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

// Console entry types
export interface ConsoleEntry {
  id: string;
  timestamp: number;
  level: 'log' | 'warn' | 'error' | 'info' | 'debug';
  args: Array<{ type: string; value: string }>;
  url?: string;
}

// Network request types
export interface NetworkRequest {
  id: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
  timestamp: number;
  type: 'fetch' | 'xhr';
  // Response fields (populated when response arrives)
  status?: number;
  statusText?: string;
  responseHeaders?: Record<string, string>;
  responseBody?: string | null;
  duration?: number;
  size?: number;
  error?: string;
}

// DOM node for element inspector
export interface DOMNode {
  tagName?: string;
  id?: string;
  className?: string;
  attributes?: Record<string, string>;
  children?: DOMNode[];
  text?: string;
}

// Browser error entry
export interface BrowserError {
  id: string;
  type: 'js_error' | 'unhandled_rejection' | 'network_error';
  message: string;
  stack?: string | null;
  filename?: string;
  lineno?: number;
  colno?: number;
  timestamp: number;
}

// Browser history entry for navigation
export interface HistoryEntry {
  url: string;
  title?: string;
  timestamp: number;
}

// HTML snapshot for context capture
export interface HtmlSnapshot {
  html: string;
  url: string;
  timestamp: number;
}

// Eval result for console REPL
export interface EvalResult {
  id: string;
  code: string;
  result: string;
  error?: string;
  timestamp: number;
}

// DevTools panel types
export type DevToolsPanel = 'console' | 'network' | 'elements';
export type ConsoleFilter = 'all' | 'log' | 'info' | 'warn' | 'error' | 'debug';

// Limits to prevent memory issues
const MAX_CONSOLE_ENTRIES = 1000;
const MAX_NETWORK_REQUESTS = 500;
const MAX_ERRORS = 100;
const MAX_HISTORY_ENTRIES = 100;
const MAX_EVAL_RESULTS = 100;

interface DevToolsState {
  // Panel state
  activePanel: DevToolsPanel;
  panelHeight: number;
  isOpen: boolean;

  // Console
  consoleEntries: ConsoleEntry[];
  consoleFilter: ConsoleFilter;

  // Network
  networkRequests: NetworkRequest[];
  selectedRequestId: string | null;
  networkFilter: string;

  // Elements
  domSnapshot: DOMNode | null;
  selectedElementPath: number[];

  // Errors (separate from console for easy access)
  errors: BrowserError[];

  // Browser history (for back/forward navigation)
  history: HistoryEntry[];
  historyIndex: number;
  currentUrl: string;

  // Connection state
  iframeReady: boolean;

  // HTML snapshot for AI context capture
  htmlSnapshot: HtmlSnapshot | null;

  // Eval results for console REPL
  evalResults: EvalResult[];
  pendingEvalId: string | null;

  // Actions - Panel
  setActivePanel: (panel: DevToolsPanel) => void;
  setPanelHeight: (height: number) => void;
  toggleDevTools: () => void;
  openDevTools: () => void;
  closeDevTools: () => void;

  // Actions - Console
  addConsoleEntry: (entry: Omit<ConsoleEntry, 'id'>) => void;
  clearConsole: () => void;
  setConsoleFilter: (filter: ConsoleFilter) => void;
  getFilteredConsoleEntries: () => ConsoleEntry[];

  // Actions - Network
  addNetworkRequest: (request: Omit<NetworkRequest, 'timestamp'>) => void;
  updateNetworkRequest: (id: string, update: Partial<NetworkRequest>) => void;
  clearNetworkRequests: () => void;
  setSelectedRequest: (id: string | null) => void;
  setNetworkFilter: (filter: string) => void;
  getFilteredNetworkRequests: () => NetworkRequest[];

  // Actions - Elements
  setDOMSnapshot: (snapshot: DOMNode | null) => void;
  setSelectedElementPath: (path: number[]) => void;

  // Actions - Errors
  addError: (error: Omit<BrowserError, 'id'>) => void;
  clearErrors: () => void;

  // Actions - History
  pushHistory: (url: string, title?: string) => void;
  goBack: () => HistoryEntry | null;
  goForward: () => HistoryEntry | null;
  canGoBack: () => boolean;
  canGoForward: () => boolean;
  setCurrentUrl: (url: string) => void;

  // Actions - Connection
  setIframeReady: (ready: boolean) => void;

  // Actions - HTML Snapshot
  setHtmlSnapshot: (html: string, url: string) => void;
  clearHtmlSnapshot: () => void;

  // Actions - Eval
  addEvalResult: (result: Omit<EvalResult, 'id'>) => void;
  setPendingEvalId: (id: string | null) => void;
  clearEvalResults: () => void;

  // Actions - Reset
  reset: () => void;
  resetForNewPreview: () => void;
}

const initialState = {
  activePanel: 'console' as DevToolsPanel,
  panelHeight: 250,
  isOpen: false,

  consoleEntries: [] as ConsoleEntry[],
  consoleFilter: 'all' as ConsoleFilter,

  networkRequests: [] as NetworkRequest[],
  selectedRequestId: null as string | null,
  networkFilter: '',

  domSnapshot: null as DOMNode | null,
  selectedElementPath: [] as number[],

  errors: [] as BrowserError[],

  history: [] as HistoryEntry[],
  historyIndex: -1,
  currentUrl: '',

  iframeReady: false,

  htmlSnapshot: null as HtmlSnapshot | null,
  evalResults: [] as EvalResult[],
  pendingEvalId: null as string | null,
};

export const useDevToolsStore = create<DevToolsState>()(
  devtools(
    persist(
      (set, get) => ({
        ...initialState,

        // Panel actions
        setActivePanel: (panel) => set({ activePanel: panel }),
        setPanelHeight: (height) => set({ panelHeight: Math.max(150, Math.min(500, height)) }),
        toggleDevTools: () => set((state) => ({ isOpen: !state.isOpen })),
        openDevTools: () => set({ isOpen: true }),
        closeDevTools: () => set({ isOpen: false }),

        // Console actions
        addConsoleEntry: (entry) =>
          set((state) => ({
            consoleEntries: [
              ...state.consoleEntries.slice(-(MAX_CONSOLE_ENTRIES - 1)),
              { ...entry, id: `console-${Date.now()}-${Math.random().toString(36).slice(2)}` },
            ],
          })),
        clearConsole: () => set({ consoleEntries: [] }),
        setConsoleFilter: (filter) => set({ consoleFilter: filter }),
        getFilteredConsoleEntries: () => {
          const state = get();
          if (state.consoleFilter === 'all') return state.consoleEntries;
          return state.consoleEntries.filter((e) => e.level === state.consoleFilter);
        },

        // Network actions
        addNetworkRequest: (request) =>
          set((state) => ({
            networkRequests: [
              ...state.networkRequests.slice(-(MAX_NETWORK_REQUESTS - 1)),
              { ...request, timestamp: Date.now() },
            ],
          })),
        updateNetworkRequest: (id, update) =>
          set((state) => ({
            networkRequests: state.networkRequests.map((req) =>
              req.id === id ? { ...req, ...update } : req
            ),
          })),
        clearNetworkRequests: () => set({ networkRequests: [], selectedRequestId: null }),
        setSelectedRequest: (id) => set({ selectedRequestId: id }),
        setNetworkFilter: (filter) => set({ networkFilter: filter }),
        getFilteredNetworkRequests: () => {
          const state = get();
          if (!state.networkFilter) return state.networkRequests;
          const filterLower = state.networkFilter.toLowerCase();
          return state.networkRequests.filter((r) => r.url.toLowerCase().includes(filterLower));
        },

        // Elements actions
        setDOMSnapshot: (snapshot) => set({ domSnapshot: snapshot }),
        setSelectedElementPath: (path) => set({ selectedElementPath: path }),

        // Error actions
        addError: (error) =>
          set((state) => ({
            errors: [
              ...state.errors.slice(-(MAX_ERRORS - 1)),
              { ...error, id: `error-${Date.now()}-${Math.random().toString(36).slice(2)}` },
            ],
          })),
        clearErrors: () => set({ errors: [] }),

        // History actions
        pushHistory: (url, title) => {
          const state = get();
          // Remove forward history when navigating to a new page
          const newHistory = state.history.slice(0, state.historyIndex + 1);

          // Don't add duplicate entries for the same URL
          const lastEntry = newHistory[newHistory.length - 1];
          if (lastEntry && lastEntry.url === url) {
            return;
          }

          newHistory.push({ url, title, timestamp: Date.now() });

          // Limit history size
          const trimmedHistory = newHistory.slice(-MAX_HISTORY_ENTRIES);

          set({
            history: trimmedHistory,
            historyIndex: trimmedHistory.length - 1,
            currentUrl: url,
          });
        },

        goBack: () => {
          const state = get();
          if (state.historyIndex > 0) {
            const newIndex = state.historyIndex - 1;
            const entry = state.history[newIndex];
            if (entry) {
              set({ historyIndex: newIndex, currentUrl: entry.url });
              return entry;
            }
          }
          return null;
        },

        goForward: () => {
          const state = get();
          if (state.historyIndex < state.history.length - 1) {
            const newIndex = state.historyIndex + 1;
            const entry = state.history[newIndex];
            if (entry) {
              set({ historyIndex: newIndex, currentUrl: entry.url });
              return entry;
            }
          }
          return null;
        },

        canGoBack: () => get().historyIndex > 0,
        canGoForward: () => {
          const state = get();
          return state.historyIndex < state.history.length - 1;
        },

        setCurrentUrl: (url) => set({ currentUrl: url }),

        // Connection actions
        setIframeReady: (ready) => set({ iframeReady: ready }),

        // HTML Snapshot actions
        setHtmlSnapshot: (html, url) =>
          set({
            htmlSnapshot: {
              html,
              url,
              timestamp: Date.now(),
            },
          }),
        clearHtmlSnapshot: () => set({ htmlSnapshot: null }),

        // Eval actions
        addEvalResult: (result) =>
          set((state) => ({
            evalResults: [
              ...state.evalResults.slice(-(MAX_EVAL_RESULTS - 1)),
              { ...result, id: `eval-${Date.now()}-${Math.random().toString(36).slice(2)}` },
            ],
            pendingEvalId: null,
          })),
        setPendingEvalId: (id) => set({ pendingEvalId: id }),
        clearEvalResults: () => set({ evalResults: [], pendingEvalId: null }),

        // Reset actions
        reset: () =>
          set({
            ...initialState,
            // Preserve user preferences
            panelHeight: get().panelHeight,
            isOpen: get().isOpen,
            consoleFilter: get().consoleFilter,
          }),

        resetForNewPreview: () =>
          set({
            consoleEntries: [],
            networkRequests: [],
            selectedRequestId: null,
            domSnapshot: null,
            selectedElementPath: [],
            errors: [],
            history: [],
            historyIndex: -1,
            currentUrl: '',
            iframeReady: false,
            htmlSnapshot: null,
            evalResults: [],
            pendingEvalId: null,
          }),
      }),
      {
        name: 'podex-devtools',
        // Only persist user preferences, not data
        partialize: (state) => ({
          panelHeight: state.panelHeight,
          isOpen: state.isOpen,
          consoleFilter: state.consoleFilter,
          activePanel: state.activePanel,
        }),
      }
    ),
    { name: 'podex-devtools', enabled: process.env.NODE_ENV === 'development' }
  )
);

// Selector hooks for common patterns
export const useDevToolsIsOpen = () => useDevToolsStore((s) => s.isOpen);
export const useDevToolsActivePanel = () => useDevToolsStore((s) => s.activePanel);
export const useConsoleEntries = () => useDevToolsStore((s) => s.consoleEntries);
export const useNetworkRequests = () => useDevToolsStore((s) => s.networkRequests);
export const useDevToolsHistory = () =>
  useDevToolsStore((s) => ({
    canGoBack: s.historyIndex > 0,
    canGoForward: s.historyIndex < s.history.length - 1,
    currentUrl: s.currentUrl,
  }));
export const useHtmlSnapshot = () => useDevToolsStore((s) => s.htmlSnapshot);
export const useEvalResults = () => useDevToolsStore((s) => s.evalResults);
