import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useDevToolsStore } from '../devtools';
import type {
  ConsoleEntry,
  NetworkRequest,
  DOMNode,
  BrowserError,
  HistoryEntry,
  EvalResult,
  DevToolsPanel,
  ConsoleFilter,
} from '../devtools';

// Mock fixtures
const mockConsoleEntry: Omit<ConsoleEntry, 'id'> = {
  timestamp: Date.now(),
  level: 'log',
  args: [{ type: 'string', value: 'Hello world' }],
  url: 'http://localhost:3000',
};

const mockConsoleErrorEntry: Omit<ConsoleEntry, 'id'> = {
  timestamp: Date.now(),
  level: 'error',
  args: [{ type: 'string', value: 'Error occurred' }],
  url: 'http://localhost:3000',
};

const mockConsoleWarnEntry: Omit<ConsoleEntry, 'id'> = {
  timestamp: Date.now(),
  level: 'warn',
  args: [{ type: 'string', value: 'Warning message' }],
  url: 'http://localhost:3000',
};

const mockNetworkRequest: Omit<NetworkRequest, 'timestamp'> = {
  id: 'req-1',
  url: 'https://api.example.com/users',
  method: 'GET',
  headers: { 'Content-Type': 'application/json' },
  body: null,
  type: 'fetch',
};

const mockNetworkRequestWithResponse: Omit<NetworkRequest, 'timestamp'> = {
  ...mockNetworkRequest,
  id: 'req-2',
  status: 200,
  statusText: 'OK',
  responseHeaders: { 'Content-Type': 'application/json' },
  responseBody: '{"users": []}',
  duration: 150,
  size: 1024,
};

const mockNetworkRequestError: Omit<NetworkRequest, 'timestamp'> = {
  ...mockNetworkRequest,
  id: 'req-3',
  status: 500,
  statusText: 'Internal Server Error',
  error: 'Failed to fetch',
  duration: 250,
};

const mockDOMNode: DOMNode = {
  tagName: 'DIV',
  id: 'root',
  className: 'container',
  attributes: { 'data-testid': 'app' },
  children: [
    {
      tagName: 'H1',
      text: 'Hello World',
      attributes: {},
    },
    {
      tagName: 'P',
      text: 'Welcome to the app',
      attributes: {},
    },
  ],
};

const mockBrowserError: Omit<BrowserError, 'id'> = {
  type: 'js_error',
  message: 'Uncaught TypeError: Cannot read property of undefined',
  stack: 'Error: at line 10',
  filename: 'app.js',
  lineno: 10,
  colno: 5,
  timestamp: Date.now(),
};

const mockEvalResult: Omit<EvalResult, 'id'> = {
  code: '2 + 2',
  result: '4',
  timestamp: Date.now(),
};

const mockEvalResultWithError: Omit<EvalResult, 'id'> = {
  code: 'undefinedVar',
  result: '',
  error: 'ReferenceError: undefinedVar is not defined',
  timestamp: Date.now(),
};

describe('devToolsStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    act(() => {
      useDevToolsStore.setState({
        activePanel: 'console',
        panelHeight: 250,
        isOpen: false,
        consoleEntries: [],
        consoleFilter: 'all',
        networkRequests: [],
        selectedRequestId: null,
        networkFilter: '',
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
      });
    });
  });

  // ========================================================================
  // Initial State
  // ========================================================================

  describe('Initial State', () => {
    it('has devtools panel closed', () => {
      const { result } = renderHook(() => useDevToolsStore());
      expect(result.current.isOpen).toBe(false);
    });

    it('has console as default active panel', () => {
      const { result } = renderHook(() => useDevToolsStore());
      expect(result.current.activePanel).toBe('console');
    });

    it('has default panel height of 250', () => {
      const { result } = renderHook(() => useDevToolsStore());
      expect(result.current.panelHeight).toBe(250);
    });

    it('has empty console entries', () => {
      const { result } = renderHook(() => useDevToolsStore());
      expect(result.current.consoleEntries).toEqual([]);
    });

    it('has empty network requests', () => {
      const { result } = renderHook(() => useDevToolsStore());
      expect(result.current.networkRequests).toEqual([]);
    });

    it('has no DOM snapshot', () => {
      const { result } = renderHook(() => useDevToolsStore());
      expect(result.current.domSnapshot).toBeNull();
    });

    it('has iframe not ready', () => {
      const { result } = renderHook(() => useDevToolsStore());
      expect(result.current.iframeReady).toBe(false);
    });
  });

  // ========================================================================
  // DevTools Panel
  // ========================================================================

  describe('DevTools Panel Management', () => {
    describe('openDevTools', () => {
      it('opens the devtools panel', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.openDevTools();
        });

        expect(result.current.isOpen).toBe(true);
      });
    });

    describe('closeDevTools', () => {
      it('closes the devtools panel', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.openDevTools();
          result.current.closeDevTools();
        });

        expect(result.current.isOpen).toBe(false);
      });
    });

    describe('toggleDevTools', () => {
      it('toggles devtools from closed to open', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.toggleDevTools();
        });

        expect(result.current.isOpen).toBe(true);
      });

      it('toggles devtools from open to closed', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.openDevTools();
          result.current.toggleDevTools();
        });

        expect(result.current.isOpen).toBe(false);
      });

      it('can toggle multiple times', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.toggleDevTools();
          result.current.toggleDevTools();
          result.current.toggleDevTools();
        });

        expect(result.current.isOpen).toBe(true);
      });
    });

    describe('setActivePanel', () => {
      it('sets active panel to console', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.setActivePanel('console');
        });

        expect(result.current.activePanel).toBe('console');
      });

      it('sets active panel to network', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.setActivePanel('network');
        });

        expect(result.current.activePanel).toBe('network');
      });

      it('sets active panel to elements', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.setActivePanel('elements');
        });

        expect(result.current.activePanel).toBe('elements');
      });

      it('can switch between panels', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.setActivePanel('network');
          result.current.setActivePanel('elements');
          result.current.setActivePanel('console');
        });

        expect(result.current.activePanel).toBe('console');
      });
    });

    describe('setPanelHeight', () => {
      it('sets panel height', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.setPanelHeight(300);
        });

        expect(result.current.panelHeight).toBe(300);
      });

      it('enforces minimum height of 150', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.setPanelHeight(100);
        });

        expect(result.current.panelHeight).toBe(150);
      });

      it('enforces maximum height of 500', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.setPanelHeight(600);
        });

        expect(result.current.panelHeight).toBe(500);
      });

      it('allows height within valid range', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.setPanelHeight(350);
        });

        expect(result.current.panelHeight).toBe(350);
      });
    });
  });

  // ========================================================================
  // Network Monitoring
  // ========================================================================

  describe('Network Monitoring', () => {
    describe('addNetworkRequest', () => {
      it('adds network request to store', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.addNetworkRequest(mockNetworkRequest);
        });

        expect(result.current.networkRequests).toHaveLength(1);
        expect(result.current.networkRequests[0]).toMatchObject(mockNetworkRequest);
      });

      it('adds timestamp to network request', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.addNetworkRequest(mockNetworkRequest);
        });

        expect(result.current.networkRequests[0].timestamp).toBeDefined();
        expect(typeof result.current.networkRequests[0].timestamp).toBe('number');
      });

      it('can add multiple network requests', () => {
        const { result } = renderHook(() => useDevToolsStore());
        const request2 = {
          ...mockNetworkRequest,
          id: 'req-2',
          url: 'https://api.example.com/posts',
        };

        act(() => {
          result.current.addNetworkRequest(mockNetworkRequest);
          result.current.addNetworkRequest(request2);
        });

        expect(result.current.networkRequests).toHaveLength(2);
      });

      it('enforces max network requests limit', () => {
        const { result } = renderHook(() => useDevToolsStore());
        const MAX_NETWORK_REQUESTS = 500;

        act(() => {
          for (let i = 0; i < MAX_NETWORK_REQUESTS + 10; i++) {
            result.current.addNetworkRequest({
              ...mockNetworkRequest,
              id: `req-${i}`,
            });
          }
        });

        expect(result.current.networkRequests.length).toBeLessThanOrEqual(MAX_NETWORK_REQUESTS);
      });

      it('keeps most recent requests when enforcing limit', () => {
        const { result } = renderHook(() => useDevToolsStore());
        const MAX_NETWORK_REQUESTS = 500;

        act(() => {
          for (let i = 0; i < MAX_NETWORK_REQUESTS + 10; i++) {
            result.current.addNetworkRequest({
              ...mockNetworkRequest,
              id: `req-${i}`,
            });
          }
        });

        // Should have the last MAX_NETWORK_REQUESTS requests
        expect(result.current.networkRequests[0].id).toBe('req-10');
      });
    });

    describe('updateNetworkRequest', () => {
      it('updates network request with response data', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.addNetworkRequest(mockNetworkRequest);
          result.current.updateNetworkRequest('req-1', {
            status: 200,
            statusText: 'OK',
            duration: 150,
          });
        });

        const request = result.current.networkRequests.find((r) => r.id === 'req-1');
        expect(request?.status).toBe(200);
        expect(request?.statusText).toBe('OK');
        expect(request?.duration).toBe(150);
      });

      it('updates specific request without affecting others', () => {
        const { result } = renderHook(() => useDevToolsStore());
        const request2 = { ...mockNetworkRequest, id: 'req-2' };

        act(() => {
          result.current.addNetworkRequest(mockNetworkRequest);
          result.current.addNetworkRequest(request2);
          result.current.updateNetworkRequest('req-1', { status: 200 });
        });

        const req1 = result.current.networkRequests.find((r) => r.id === 'req-1');
        const req2 = result.current.networkRequests.find((r) => r.id === 'req-2');

        expect(req1?.status).toBe(200);
        expect(req2?.status).toBeUndefined();
      });

      it('handles updating non-existent request gracefully', () => {
        const { result } = renderHook(() => useDevToolsStore());

        expect(() => {
          act(() => {
            result.current.updateNetworkRequest('non-existent', { status: 200 });
          });
        }).not.toThrow();
      });
    });

    describe('clearNetworkRequests', () => {
      it('clears all network requests', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.addNetworkRequest(mockNetworkRequest);
          result.current.addNetworkRequest({ ...mockNetworkRequest, id: 'req-2' });
          result.current.clearNetworkRequests();
        });

        expect(result.current.networkRequests).toEqual([]);
      });

      it('clears selected request', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.addNetworkRequest(mockNetworkRequest);
          result.current.setSelectedRequest('req-1');
          result.current.clearNetworkRequests();
        });

        expect(result.current.selectedRequestId).toBeNull();
      });
    });

    describe('setSelectedRequest', () => {
      it('sets selected request ID', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.addNetworkRequest(mockNetworkRequest);
          result.current.setSelectedRequest('req-1');
        });

        expect(result.current.selectedRequestId).toBe('req-1');
      });

      it('can clear selected request', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.setSelectedRequest('req-1');
          result.current.setSelectedRequest(null);
        });

        expect(result.current.selectedRequestId).toBeNull();
      });
    });

    describe('setNetworkFilter', () => {
      it('sets network filter string', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.setNetworkFilter('users');
        });

        expect(result.current.networkFilter).toBe('users');
      });

      it('can clear network filter', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.setNetworkFilter('users');
          result.current.setNetworkFilter('');
        });

        expect(result.current.networkFilter).toBe('');
      });
    });

    describe('getFilteredNetworkRequests', () => {
      it('returns all requests when filter is empty', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.addNetworkRequest(mockNetworkRequest);
          result.current.addNetworkRequest({
            ...mockNetworkRequest,
            id: 'req-2',
            url: 'https://api.example.com/posts',
          });
        });

        const filtered = result.current.getFilteredNetworkRequests();
        expect(filtered).toHaveLength(2);
      });

      it('filters requests by URL', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.addNetworkRequest(mockNetworkRequest);
          result.current.addNetworkRequest({
            ...mockNetworkRequest,
            id: 'req-2',
            url: 'https://api.example.com/posts',
          });
          result.current.setNetworkFilter('users');
        });

        const filtered = result.current.getFilteredNetworkRequests();
        expect(filtered).toHaveLength(1);
        expect(filtered[0].url).toContain('users');
      });

      it('filters are case insensitive', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.addNetworkRequest(mockNetworkRequest);
          result.current.setNetworkFilter('USERS');
        });

        const filtered = result.current.getFilteredNetworkRequests();
        expect(filtered).toHaveLength(1);
      });
    });
  });

  // ========================================================================
  // Console Logs
  // ========================================================================

  describe('Console Logs', () => {
    describe('addConsoleEntry', () => {
      it('adds console entry to store', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.addConsoleEntry(mockConsoleEntry);
        });

        expect(result.current.consoleEntries).toHaveLength(1);
        expect(result.current.consoleEntries[0]).toMatchObject(mockConsoleEntry);
      });

      it('generates unique ID for console entry', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.addConsoleEntry(mockConsoleEntry);
          result.current.addConsoleEntry(mockConsoleEntry);
        });

        expect(result.current.consoleEntries[0].id).not.toBe(result.current.consoleEntries[1].id);
      });

      it('can add error level entries', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.addConsoleEntry(mockConsoleErrorEntry);
        });

        expect(result.current.consoleEntries[0].level).toBe('error');
      });

      it('can add warn level entries', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.addConsoleEntry(mockConsoleWarnEntry);
        });

        expect(result.current.consoleEntries[0].level).toBe('warn');
      });

      it('enforces max console entries limit', () => {
        const { result } = renderHook(() => useDevToolsStore());
        const MAX_CONSOLE_ENTRIES = 1000;

        act(() => {
          for (let i = 0; i < MAX_CONSOLE_ENTRIES + 10; i++) {
            result.current.addConsoleEntry({
              ...mockConsoleEntry,
              args: [{ type: 'string', value: `Message ${i}` }],
            });
          }
        });

        expect(result.current.consoleEntries.length).toBeLessThanOrEqual(MAX_CONSOLE_ENTRIES);
      });

      it('keeps most recent entries when enforcing limit', () => {
        const { result } = renderHook(() => useDevToolsStore());
        const MAX_CONSOLE_ENTRIES = 1000;

        act(() => {
          for (let i = 0; i < MAX_CONSOLE_ENTRIES + 10; i++) {
            result.current.addConsoleEntry({
              ...mockConsoleEntry,
              args: [{ type: 'string', value: `Message ${i}` }],
            });
          }
        });

        // Should have the last MAX_CONSOLE_ENTRIES entries
        expect(result.current.consoleEntries[0].args[0].value).toBe('Message 10');
      });
    });

    describe('clearConsole', () => {
      it('clears all console entries', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.addConsoleEntry(mockConsoleEntry);
          result.current.addConsoleEntry(mockConsoleErrorEntry);
          result.current.clearConsole();
        });

        expect(result.current.consoleEntries).toEqual([]);
      });
    });

    describe('setConsoleFilter', () => {
      it('sets console filter to all', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.setConsoleFilter('all');
        });

        expect(result.current.consoleFilter).toBe('all');
      });

      it('sets console filter to error', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.setConsoleFilter('error');
        });

        expect(result.current.consoleFilter).toBe('error');
      });

      it('sets console filter to warn', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.setConsoleFilter('warn');
        });

        expect(result.current.consoleFilter).toBe('warn');
      });

      it('sets console filter to log', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.setConsoleFilter('log');
        });

        expect(result.current.consoleFilter).toBe('log');
      });
    });

    describe('getFilteredConsoleEntries', () => {
      beforeEach(() => {
        const { result } = renderHook(() => useDevToolsStore());
        act(() => {
          result.current.addConsoleEntry(mockConsoleEntry);
          result.current.addConsoleEntry(mockConsoleErrorEntry);
          result.current.addConsoleEntry(mockConsoleWarnEntry);
        });
      });

      it('returns all entries when filter is all', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.setConsoleFilter('all');
        });

        const filtered = result.current.getFilteredConsoleEntries();
        expect(filtered).toHaveLength(3);
      });

      it('filters entries by error level', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.setConsoleFilter('error');
        });

        const filtered = result.current.getFilteredConsoleEntries();
        expect(filtered).toHaveLength(1);
        expect(filtered[0].level).toBe('error');
      });

      it('filters entries by warn level', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.setConsoleFilter('warn');
        });

        const filtered = result.current.getFilteredConsoleEntries();
        expect(filtered).toHaveLength(1);
        expect(filtered[0].level).toBe('warn');
      });

      it('filters entries by log level', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.setConsoleFilter('log');
        });

        const filtered = result.current.getFilteredConsoleEntries();
        expect(filtered).toHaveLength(1);
        expect(filtered[0].level).toBe('log');
      });
    });
  });

  // ========================================================================
  // Performance Metrics (Indirect - via Network & Errors)
  // ========================================================================

  describe('Performance Metrics', () => {
    it('tracks request timing via duration field', () => {
      const { result } = renderHook(() => useDevToolsStore());

      act(() => {
        result.current.addNetworkRequest(mockNetworkRequestWithResponse);
      });

      expect(result.current.networkRequests[0].duration).toBe(150);
    });

    it('tracks request size', () => {
      const { result } = renderHook(() => useDevToolsStore());

      act(() => {
        result.current.addNetworkRequest(mockNetworkRequestWithResponse);
      });

      expect(result.current.networkRequests[0].size).toBe(1024);
    });

    it('can identify slow requests', () => {
      const { result } = renderHook(() => useDevToolsStore());
      const slowRequest = { ...mockNetworkRequest, duration: 5000 };

      act(() => {
        result.current.addNetworkRequest(mockNetworkRequestWithResponse);
        result.current.addNetworkRequest(slowRequest);
      });

      const requests = result.current.networkRequests;
      const slow = requests.filter((r) => r.duration && r.duration > 1000);
      expect(slow).toHaveLength(1);
    });

    it('tracks API request failures via error field', () => {
      const { result } = renderHook(() => useDevToolsStore());

      act(() => {
        result.current.addNetworkRequest(mockNetworkRequestError);
      });

      expect(result.current.networkRequests[0].error).toBe('Failed to fetch');
    });

    it('tracks timestamp for all console entries', () => {
      const { result } = renderHook(() => useDevToolsStore());

      act(() => {
        result.current.addConsoleEntry(mockConsoleEntry);
      });

      expect(result.current.consoleEntries[0].timestamp).toBeDefined();
      expect(typeof result.current.consoleEntries[0].timestamp).toBe('number');
    });
  });

  // ========================================================================
  // Debugger (Elements & Errors)
  // ========================================================================

  describe('Debugger - Elements', () => {
    describe('setDOMSnapshot', () => {
      it('sets DOM snapshot', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.setDOMSnapshot(mockDOMNode);
        });

        expect(result.current.domSnapshot).toEqual(mockDOMNode);
      });

      it('can clear DOM snapshot', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.setDOMSnapshot(mockDOMNode);
          result.current.setDOMSnapshot(null);
        });

        expect(result.current.domSnapshot).toBeNull();
      });

      it('updates DOM snapshot with new data', () => {
        const { result } = renderHook(() => useDevToolsStore());
        const updatedNode: DOMNode = {
          ...mockDOMNode,
          tagName: 'SECTION',
        };

        act(() => {
          result.current.setDOMSnapshot(mockDOMNode);
          result.current.setDOMSnapshot(updatedNode);
        });

        expect(result.current.domSnapshot?.tagName).toBe('SECTION');
      });
    });

    describe('setSelectedElementPath', () => {
      it('sets selected element path', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.setSelectedElementPath([0, 1]);
        });

        expect(result.current.selectedElementPath).toEqual([0, 1]);
      });

      it('can clear selected element path', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.setSelectedElementPath([0, 1]);
          result.current.setSelectedElementPath([]);
        });

        expect(result.current.selectedElementPath).toEqual([]);
      });

      it('can navigate to nested elements', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.setSelectedElementPath([0, 2, 1]);
        });

        expect(result.current.selectedElementPath).toEqual([0, 2, 1]);
      });
    });
  });

  describe('Debugger - Errors', () => {
    describe('addError', () => {
      it('adds browser error to store', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.addError(mockBrowserError);
        });

        expect(result.current.errors).toHaveLength(1);
        expect(result.current.errors[0]).toMatchObject(mockBrowserError);
      });

      it('generates unique ID for error', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.addError(mockBrowserError);
          result.current.addError(mockBrowserError);
        });

        expect(result.current.errors[0].id).not.toBe(result.current.errors[1].id);
      });

      it('can track different error types', () => {
        const { result } = renderHook(() => useDevToolsStore());
        const networkError: Omit<BrowserError, 'id'> = {
          ...mockBrowserError,
          type: 'network_error',
          message: 'Failed to load resource',
        };

        act(() => {
          result.current.addError(mockBrowserError);
          result.current.addError(networkError);
        });

        expect(result.current.errors).toHaveLength(2);
        expect(result.current.errors[0].type).toBe('js_error');
        expect(result.current.errors[1].type).toBe('network_error');
      });

      it('enforces max errors limit', () => {
        const { result } = renderHook(() => useDevToolsStore());
        const MAX_ERRORS = 100;

        act(() => {
          for (let i = 0; i < MAX_ERRORS + 10; i++) {
            result.current.addError({
              ...mockBrowserError,
              message: `Error ${i}`,
            });
          }
        });

        expect(result.current.errors.length).toBeLessThanOrEqual(MAX_ERRORS);
      });
    });

    describe('clearErrors', () => {
      it('clears all errors', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.addError(mockBrowserError);
          result.current.addError(mockBrowserError);
          result.current.clearErrors();
        });

        expect(result.current.errors).toEqual([]);
      });
    });
  });

  // ========================================================================
  // Browser History & Navigation
  // ========================================================================

  describe('Browser History', () => {
    describe('pushHistory', () => {
      it('adds URL to history', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.pushHistory('http://localhost:3000');
        });

        expect(result.current.history).toHaveLength(1);
        expect(result.current.history[0].url).toBe('http://localhost:3000');
      });

      it('adds title to history entry', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.pushHistory('http://localhost:3000', 'Home Page');
        });

        expect(result.current.history[0].title).toBe('Home Page');
      });

      it('sets current URL', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.pushHistory('http://localhost:3000');
        });

        expect(result.current.currentUrl).toBe('http://localhost:3000');
      });

      it('updates history index', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.pushHistory('http://localhost:3000/page1');
          result.current.pushHistory('http://localhost:3000/page2');
        });

        expect(result.current.historyIndex).toBe(1);
      });

      it('does not add duplicate URLs', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.pushHistory('http://localhost:3000');
          result.current.pushHistory('http://localhost:3000');
        });

        expect(result.current.history).toHaveLength(1);
      });

      it('removes forward history when navigating to new page', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.pushHistory('http://localhost:3000/page1');
          result.current.pushHistory('http://localhost:3000/page2');
          result.current.pushHistory('http://localhost:3000/page3');
          result.current.goBack();
          result.current.pushHistory('http://localhost:3000/page4');
        });

        expect(result.current.history).toHaveLength(3);
        expect(result.current.history[2].url).toBe('http://localhost:3000/page4');
      });

      it('enforces max history limit', () => {
        const { result } = renderHook(() => useDevToolsStore());
        const MAX_HISTORY = 100;

        act(() => {
          for (let i = 0; i < MAX_HISTORY + 10; i++) {
            result.current.pushHistory(`http://localhost:3000/page${i}`);
          }
        });

        expect(result.current.history.length).toBeLessThanOrEqual(MAX_HISTORY);
      });
    });

    describe('goBack', () => {
      beforeEach(() => {
        const { result } = renderHook(() => useDevToolsStore());
        act(() => {
          result.current.pushHistory('http://localhost:3000/page1');
          result.current.pushHistory('http://localhost:3000/page2');
          result.current.pushHistory('http://localhost:3000/page3');
        });
      });

      it('goes back in history', () => {
        const { result } = renderHook(() => useDevToolsStore());

        let entry;
        act(() => {
          entry = result.current.goBack();
        });

        expect(entry?.url).toBe('http://localhost:3000/page2');
        expect(result.current.currentUrl).toBe('http://localhost:3000/page2');
      });

      it('decrements history index', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.goBack();
        });

        expect(result.current.historyIndex).toBe(1);
      });

      it('returns null when at beginning of history', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.goBack();
          result.current.goBack();
        });

        let entry;
        act(() => {
          entry = result.current.goBack();
        });

        expect(entry).toBeNull();
      });
    });

    describe('goForward', () => {
      beforeEach(() => {
        const { result } = renderHook(() => useDevToolsStore());
        act(() => {
          result.current.pushHistory('http://localhost:3000/page1');
          result.current.pushHistory('http://localhost:3000/page2');
          result.current.pushHistory('http://localhost:3000/page3');
          result.current.goBack();
        });
      });

      it('goes forward in history', () => {
        const { result } = renderHook(() => useDevToolsStore());

        let entry;
        act(() => {
          entry = result.current.goForward();
        });

        expect(entry?.url).toBe('http://localhost:3000/page3');
        expect(result.current.currentUrl).toBe('http://localhost:3000/page3');
      });

      it('increments history index', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.goForward();
        });

        expect(result.current.historyIndex).toBe(2);
      });

      it('returns null when at end of history', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.goForward();
        });

        let entry;
        act(() => {
          entry = result.current.goForward();
        });

        expect(entry).toBeNull();
      });
    });

    describe('canGoBack', () => {
      it('returns false when at beginning of history', () => {
        const { result } = renderHook(() => useDevToolsStore());

        expect(result.current.canGoBack()).toBe(false);
      });

      it('returns true when history exists', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.pushHistory('http://localhost:3000/page1');
          result.current.pushHistory('http://localhost:3000/page2');
        });

        expect(result.current.canGoBack()).toBe(true);
      });
    });

    describe('canGoForward', () => {
      it('returns false when at end of history', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.pushHistory('http://localhost:3000/page1');
        });

        expect(result.current.canGoForward()).toBe(false);
      });

      it('returns true when forward history exists', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.pushHistory('http://localhost:3000/page1');
          result.current.pushHistory('http://localhost:3000/page2');
          result.current.goBack();
        });

        expect(result.current.canGoForward()).toBe(true);
      });
    });

    describe('setCurrentUrl', () => {
      it('sets current URL without affecting history', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.setCurrentUrl('http://localhost:3000');
        });

        expect(result.current.currentUrl).toBe('http://localhost:3000');
        expect(result.current.history).toHaveLength(0);
      });
    });
  });

  // ========================================================================
  // Connection & IFrame
  // ========================================================================

  describe('Connection State', () => {
    it('sets iframe ready state', () => {
      const { result } = renderHook(() => useDevToolsStore());

      act(() => {
        result.current.setIframeReady(true);
      });

      expect(result.current.iframeReady).toBe(true);
    });

    it('can set iframe to not ready', () => {
      const { result } = renderHook(() => useDevToolsStore());

      act(() => {
        result.current.setIframeReady(true);
        result.current.setIframeReady(false);
      });

      expect(result.current.iframeReady).toBe(false);
    });
  });

  // ========================================================================
  // HTML Snapshot
  // ========================================================================

  describe('HTML Snapshot', () => {
    describe('setHtmlSnapshot', () => {
      it('sets HTML snapshot with URL', () => {
        const { result } = renderHook(() => useDevToolsStore());
        const html = '<html><body>Test</body></html>';

        act(() => {
          result.current.setHtmlSnapshot(html, 'http://localhost:3000');
        });

        expect(result.current.htmlSnapshot).toBeDefined();
        expect(result.current.htmlSnapshot?.html).toBe(html);
        expect(result.current.htmlSnapshot?.url).toBe('http://localhost:3000');
      });

      it('adds timestamp to snapshot', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.setHtmlSnapshot('<html></html>', 'http://localhost:3000');
        });

        expect(result.current.htmlSnapshot?.timestamp).toBeDefined();
        expect(typeof result.current.htmlSnapshot?.timestamp).toBe('number');
      });

      it('replaces existing snapshot', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.setHtmlSnapshot('<html>First</html>', 'http://localhost:3000/page1');
          result.current.setHtmlSnapshot('<html>Second</html>', 'http://localhost:3000/page2');
        });

        expect(result.current.htmlSnapshot?.html).toBe('<html>Second</html>');
        expect(result.current.htmlSnapshot?.url).toBe('http://localhost:3000/page2');
      });
    });

    describe('clearHtmlSnapshot', () => {
      it('clears HTML snapshot', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.setHtmlSnapshot('<html></html>', 'http://localhost:3000');
          result.current.clearHtmlSnapshot();
        });

        expect(result.current.htmlSnapshot).toBeNull();
      });
    });
  });

  // ========================================================================
  // Eval Results (Console REPL)
  // ========================================================================

  describe('Eval Results', () => {
    describe('addEvalResult', () => {
      it('adds eval result to store', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.addEvalResult(mockEvalResult);
        });

        expect(result.current.evalResults).toHaveLength(1);
        expect(result.current.evalResults[0]).toMatchObject(mockEvalResult);
      });

      it('generates unique ID for eval result', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.addEvalResult(mockEvalResult);
          result.current.addEvalResult(mockEvalResult);
        });

        expect(result.current.evalResults[0].id).not.toBe(result.current.evalResults[1].id);
      });

      it('can add eval results with errors', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.addEvalResult(mockEvalResultWithError);
        });

        expect(result.current.evalResults[0].error).toBe(
          'ReferenceError: undefinedVar is not defined'
        );
      });

      it('clears pending eval ID when adding result', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.setPendingEvalId('eval-123');
          result.current.addEvalResult(mockEvalResult);
        });

        expect(result.current.pendingEvalId).toBeNull();
      });

      it('enforces max eval results limit', () => {
        const { result } = renderHook(() => useDevToolsStore());
        const MAX_EVAL_RESULTS = 100;

        act(() => {
          for (let i = 0; i < MAX_EVAL_RESULTS + 10; i++) {
            result.current.addEvalResult({
              ...mockEvalResult,
              code: `${i} + ${i}`,
            });
          }
        });

        expect(result.current.evalResults.length).toBeLessThanOrEqual(MAX_EVAL_RESULTS);
      });
    });

    describe('setPendingEvalId', () => {
      it('sets pending eval ID', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.setPendingEvalId('eval-123');
        });

        expect(result.current.pendingEvalId).toBe('eval-123');
      });

      it('can clear pending eval ID', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.setPendingEvalId('eval-123');
          result.current.setPendingEvalId(null);
        });

        expect(result.current.pendingEvalId).toBeNull();
      });
    });

    describe('clearEvalResults', () => {
      it('clears all eval results', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.addEvalResult(mockEvalResult);
          result.current.addEvalResult(mockEvalResultWithError);
          result.current.clearEvalResults();
        });

        expect(result.current.evalResults).toEqual([]);
      });

      it('clears pending eval ID', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.setPendingEvalId('eval-123');
          result.current.clearEvalResults();
        });

        expect(result.current.pendingEvalId).toBeNull();
      });
    });
  });

  // ========================================================================
  // Reset Actions
  // ========================================================================

  describe('Reset Actions', () => {
    describe('reset', () => {
      it('resets all state to initial values', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.openDevTools();
          result.current.addConsoleEntry(mockConsoleEntry);
          result.current.addNetworkRequest(mockNetworkRequest);
          result.current.reset();
        });

        expect(result.current.consoleEntries).toEqual([]);
        expect(result.current.networkRequests).toEqual([]);
      });

      it('preserves user preferences during reset', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.openDevTools();
          result.current.setPanelHeight(350);
          result.current.setConsoleFilter('error');
          result.current.reset();
        });

        expect(result.current.isOpen).toBe(true);
        expect(result.current.panelHeight).toBe(350);
        expect(result.current.consoleFilter).toBe('error');
      });
    });

    describe('resetForNewPreview', () => {
      it('clears all preview-related data', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.addConsoleEntry(mockConsoleEntry);
          result.current.addNetworkRequest(mockNetworkRequest);
          result.current.setDOMSnapshot(mockDOMNode);
          result.current.addError(mockBrowserError);
          result.current.pushHistory('http://localhost:3000');
          result.current.setHtmlSnapshot('<html></html>', 'http://localhost:3000');
          result.current.addEvalResult(mockEvalResult);
          result.current.resetForNewPreview();
        });

        expect(result.current.consoleEntries).toEqual([]);
        expect(result.current.networkRequests).toEqual([]);
        expect(result.current.domSnapshot).toBeNull();
        expect(result.current.errors).toEqual([]);
        expect(result.current.history).toEqual([]);
        expect(result.current.htmlSnapshot).toBeNull();
        expect(result.current.evalResults).toEqual([]);
      });

      it('preserves panel state during preview reset', () => {
        const { result } = renderHook(() => useDevToolsStore());

        act(() => {
          result.current.openDevTools();
          result.current.setPanelHeight(350);
          result.current.setActivePanel('network');
          result.current.resetForNewPreview();
        });

        expect(result.current.isOpen).toBe(true);
        expect(result.current.panelHeight).toBe(350);
        expect(result.current.activePanel).toBe('network');
      });
    });
  });
});
